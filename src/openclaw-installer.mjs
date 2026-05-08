import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "@sonim1/preqstation";
const PLUGIN_ID = "preqstation-dispatcher";
const PACKAGE_JSON_FILE = fileURLToPath(new URL("../package.json", import.meta.url));

function isPluginNotInstalledError(error) {
  const message =
    typeof error?.stderr === "string" && error.stderr
      ? error.stderr
      : error instanceof Error
        ? error.message
        : String(error);
  return /not found|not installed|no plugin|unknown plugin/i.test(message);
}

async function readPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON_FILE, "utf8"));
  return pkg.version;
}

function parsePublishedPackageVersion(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return text.split(/\r?\n/u)[0]?.trim() || null;
  }
}

async function readPublishedPackageVersion({
  env = process.env,
  exec = execFileAsync,
} = {}) {
  try {
    const result = await exec("npm", ["view", PACKAGE_NAME, "version", "--json"], { env });
    return parsePublishedPackageVersion(result?.stdout ?? "");
  } catch {
    return null;
  }
}

function parseInstalledPluginVersion(stdout) {
  const text = String(stdout || "");
  const recordedMatch = text.match(/Recorded version:\s+(\S+)/iu);
  if (recordedMatch) {
    return recordedMatch[1];
  }
  const versionMatch = text.match(/Version:\s+(\S+)/iu);
  if (versionMatch) {
    return versionMatch[1];
  }
  return null;
}

async function inspectInstalledPluginVersion({ env, exec }) {
  const inspectResult = await exec("openclaw", ["plugins", "inspect", PLUGIN_ID], { env });
  return parseInstalledPluginVersion(inspectResult?.stdout ?? "");
}

export async function installOpenClawPlugin({
  env = process.env,
  exec = execFileAsync,
  updateOnly = false,
} = {}) {
  const localPackageVersion = await readPackageVersion();
  const packageVersion =
    (await readPublishedPackageVersion({
      env,
      exec,
    })) || localPackageVersion;
  const localVersionDetails =
    localPackageVersion !== packageVersion
      ? { local_package_version: localPackageVersion }
      : {};
  try {
    const installedVersion = await inspectInstalledPluginVersion({ env, exec });
    if (installedVersion && installedVersion === packageVersion) {
      return {
        ok: true,
        target: "openclaw",
        action: "already_current",
        package: PACKAGE_NAME,
        plugin_id: PLUGIN_ID,
        restart_command: "openclaw gateway restart",
        installed_version: installedVersion,
        package_version: packageVersion,
        ...localVersionDetails,
      };
    }

    await exec(
      "openclaw",
      [
        "plugins",
        "install",
        PACKAGE_NAME,
        "--dangerously-force-unsafe-install",
        "--force",
      ],
      { env },
    );
    const refreshedVersion = await inspectInstalledPluginVersion({ env, exec });
    if (!refreshedVersion || refreshedVersion !== packageVersion) {
      return {
        ok: false,
        target: "openclaw",
        action: "failed",
        package: PACKAGE_NAME,
        plugin_id: PLUGIN_ID,
        restart_command: "openclaw gateway restart",
        installed_version: refreshedVersion ?? installedVersion,
        package_version: packageVersion,
        error: `OpenClaw plugin did not reinstall at ${packageVersion}`,
        ...localVersionDetails,
      };
    }
    return {
      ok: true,
      target: "openclaw",
      action: "reinstalled",
      package: PACKAGE_NAME,
      plugin_id: PLUGIN_ID,
      restart_command: "openclaw gateway restart",
      installed_version: installedVersion,
      package_version: packageVersion,
      ...localVersionDetails,
    };
  } catch (inspectError) {
    if (!isPluginNotInstalledError(inspectError)) {
      throw inspectError;
    }
    if (updateOnly) {
      return {
        ok: true,
        target: "openclaw",
        action: "not_installed",
        package: PACKAGE_NAME,
        plugin_id: PLUGIN_ID,
        restart_command: "openclaw gateway restart",
        package_version: packageVersion,
        ...localVersionDetails,
      };
    }
  }

  try {
    await exec(
      "openclaw",
      [
        "plugins",
        "install",
        PACKAGE_NAME,
        "--dangerously-force-unsafe-install",
      ],
      { env },
    );

    const installedVersion = await inspectInstalledPluginVersion({ env, exec });
    if (!installedVersion || installedVersion !== packageVersion) {
      return {
        ok: false,
        target: "openclaw",
        action: "failed",
        package: PACKAGE_NAME,
        plugin_id: PLUGIN_ID,
        restart_command: "openclaw gateway restart",
        installed_version: installedVersion,
        package_version: packageVersion,
        error: `OpenClaw plugin did not install at ${packageVersion}`,
        ...localVersionDetails,
      };
    }
    return {
      ok: true,
      target: "openclaw",
      action: "installed",
      package: PACKAGE_NAME,
      plugin_id: PLUGIN_ID,
      restart_command: "openclaw gateway restart",
      package_version: packageVersion,
      ...localVersionDetails,
    };
  } catch (error) {
    throw error;
  }
}

export async function uninstallOpenClawPlugin({
  env = process.env,
  exec = execFileAsync,
} = {}) {
  let installedVersion = null;
  try {
    installedVersion = await inspectInstalledPluginVersion({ env, exec });
  } catch (error) {
    if (isPluginNotInstalledError(error)) {
      return {
        ok: true,
        target: "openclaw",
        action: "not_installed",
        package: PACKAGE_NAME,
        plugin_id: PLUGIN_ID,
        restart_command: "openclaw gateway restart",
      };
    }
    throw error;
  }

  await exec("openclaw", ["plugins", "uninstall", PLUGIN_ID, "--force"], { env });
  return {
    ok: true,
    target: "openclaw",
    action: "removed",
    package: PACKAGE_NAME,
    plugin_id: PLUGIN_ID,
    restart_command: "openclaw gateway restart",
    ...(installedVersion ? { installed_version: installedVersion } : {}),
  };
}
