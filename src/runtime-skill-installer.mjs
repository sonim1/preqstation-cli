import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PREQSTATION_SKILL_NAME = "preqstation";
const PREQSTATION_SKILL_REPO = "sonim1/preqstation-skill";
const PREQSTATION_SKILL_GITHUB_URL = "https://github.com/sonim1/preqstation-skill";
const PREQSTATION_SKILL_PACKAGE_JSON_URL =
  "https://raw.githubusercontent.com/sonim1/preqstation-skill/main/package.json";
export const MINIMUM_CLI_FIRST_SKILL_VERSION = "0.1.46";

const RUNTIME_SKILL_TARGETS = {
  "claude-code": {
    type: "plugin",
    label: "Claude Code",
    commandName: "claude",
    claudePluginId: "preqstation@preqstation",
    marketplaceName: "preqstation",
  },
  codex: {
    type: "skill",
    label: "Codex",
    commandName: "codex",
    agentId: "codex",
    agentName: "Codex",
    homeEnvVar: "CODEX_HOME",
    defaultHomeDir: ".codex",
  },
  "gemini-cli": {
    type: "skill",
    label: "Gemini CLI",
    commandName: "gemini",
    agentId: "gemini-cli",
    agentName: "Gemini CLI",
    homeEnvVar: "GEMINI_HOME",
    defaultHomeDir: ".gemini",
  },
};

export const SUPPORTED_RUNTIME_SKILL_TARGETS = Object.keys(RUNTIME_SKILL_TARGETS);

const SESSION_SCOPED_EXECUTABLE_PATH_PATTERNS = [
  {
    pattern: /\/\.local\/state\/fnm_multishells\//u,
    label: "session-scoped fnm path",
  },
];

const STABLE_FNM_EXECUTABLE_PATH_PATTERN =
  /\/\.local\/share\/fnm\/node-versions\/.+\/installation\/bin\//u;

async function fetchLatestPreqstationSkillVersion({ fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== "function") {
    return null;
  }

  const response = await fetchFn(PREQSTATION_SKILL_PACKAGE_JSON_URL);
  if (!response?.ok) {
    throw new Error(
      `Failed to fetch latest preqstation-skill version from ${PREQSTATION_SKILL_PACKAGE_JSON_URL}`,
    );
  }

  const pkg = await response.json();
  return typeof pkg?.version === "string" ? pkg.version : null;
}

async function listInstalledSkills({ env, exec }) {
  const result = await exec("npx", ["skills", "ls", "-g", "--json"], { env });
  const parsed = JSON.parse(result?.stdout ?? "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function listExecutablePaths({ commandName, env, exec }) {
  const result = await exec(
    "sh",
    ["-lc", `which -a ${commandName} 2>/dev/null || true`],
    { env },
  );
  return Array.from(
    new Set(
      String(result?.stdout ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

function describeLaunchHosts(hosts = []) {
  if (!hosts.length) {
    return null;
  }
  return hosts
    .map((host) => {
      if (host === "openclaw") {
        return "OpenClaw";
      }
      if (host === "hermes") {
        return "Hermes Agent";
      }
      return RUNTIME_SKILL_TARGETS[host]?.label ?? host;
    })
    .join(", ");
}

function findSessionScopedExecutableWarning(resolvedPath) {
  if (!resolvedPath) {
    return null;
  }
  return (
    SESSION_SCOPED_EXECUTABLE_PATH_PATTERNS.find(({ pattern }) => pattern.test(resolvedPath)) ?? null
  );
}

function findStableFnmAlternative(executablePaths = []) {
  return executablePaths.find((candidate) => STABLE_FNM_EXECUTABLE_PATH_PATTERN.test(candidate)) ?? null;
}

function buildExecutableMissingError({ commandName, launchHosts }) {
  const launchHostLabel = describeLaunchHosts(launchHosts);
  if (launchHostLabel) {
    return `${commandName} command not found on PATH. ${launchHostLabel} dispatches will fail until ${commandName} is installed in a stable executable location.`;
  }
  return `${commandName} command not found on PATH. Install ${commandName} before dispatching PREQ tasks with this runtime.`;
}

function buildSessionScopedPathError({
  commandName,
  resolvedPath,
  stableAlternative,
  launchHosts,
  warningLabel,
}) {
  const launchHostLabel = describeLaunchHosts(launchHosts) ?? "Service-hosted";
  const stableHint = stableAlternative
    ? ` Expose ${stableAlternative} via /usr/local/bin/${commandName} or another stable PATH entry.`
    : ` Move ${commandName} into /usr/local/bin/${commandName} or another stable PATH entry.`;
  return `${launchHostLabel} dispatches may not inherit ${resolvedPath} (${warningLabel}).${stableHint}`;
}

function getConfiguredAgents(entry) {
  return Array.isArray(entry?.agents)
    ? entry.agents.filter((agent) => typeof agent === "string" && agent.trim())
    : [];
}

function resolveRuntimeHome(runtime, env = process.env) {
  const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
  const baseHome =
    (runtimeConfig?.homeEnvVar && typeof env?.[runtimeConfig.homeEnvVar] === "string"
      ? env[runtimeConfig.homeEnvVar]
      : null) ||
    (typeof env?.HOME === "string" && env.HOME ? env.HOME : os.homedir());
  return path.join(baseHome, runtimeConfig.defaultHomeDir);
}

function resolveAgentSkillPath(runtime, env = process.env) {
  return path.join(resolveRuntimeHome(runtime, env), "skills", PREQSTATION_SKILL_NAME);
}

async function synchronizeAgentSkillBinding({
  runtime,
  sourceSkillPath,
  env,
}) {
  if (!sourceSkillPath) {
    return false;
  }

  const targetSkillPath = resolveAgentSkillPath(runtime, env);
  if (targetSkillPath === sourceSkillPath) {
    return true;
  }

  await fs.mkdir(path.dirname(targetSkillPath), { recursive: true });
  await fs.rm(targetSkillPath, { recursive: true, force: true });
  await fs.cp(sourceSkillPath, targetSkillPath, { recursive: true });
  return true;
}

async function inspectAgentSkillState({ runtime, env, exec, readFile }) {
  const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
  const installedSkills = await listInstalledSkills({ env, exec });
  const agentSkillPath = resolveAgentSkillPath(runtime, env);
  const matchingEntries = installedSkills.filter((skill) => skill?.name === PREQSTATION_SKILL_NAME);
  const filesystemInstalledVersion = await readInstalledSkillVersion(agentSkillPath, readFile);
  const entryWithAgent =
    matchingEntries.find((skill) => getConfiguredAgents(skill).includes(runtimeConfig.agentName)) ?? null;
  const entryAtAgentPath =
    matchingEntries.find((skill) => skill?.path === agentSkillPath) ??
    (filesystemInstalledVersion ? { path: agentSkillPath } : null);
  const entry =
    entryWithAgent ??
    entryAtAgentPath ??
    matchingEntries[0] ??
    null;
  const syncSourceEntry =
    matchingEntries.find((skill) => skill?.path && skill.path !== agentSkillPath) ?? entry ?? null;
  const configuredAgents = Array.from(new Set(matchingEntries.flatMap((skill) => getConfiguredAgents(skill))));
  if (filesystemInstalledVersion) {
    configuredAgents.push(runtimeConfig.agentName);
  }
  const normalizedConfiguredAgents = Array.from(new Set(configuredAgents));
  const agentInstalled =
    normalizedConfiguredAgents.includes(runtimeConfig.agentName) || filesystemInstalledVersion !== null;
  const installedVersion =
    (entry?.path ? await readInstalledSkillVersion(entry.path, readFile) : null) ??
    filesystemInstalledVersion;

  return {
    entries: matchingEntries,
    entry,
    syncSourceEntry,
    configuredAgents: normalizedConfiguredAgents,
    agentInstalled,
    installedVersion,
  };
}

async function readInstalledSkillVersion(skillPath, readFile = fs.readFile) {
  const packageJsonPath = `${skillPath}/package.json`;
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return typeof pkg?.version === "string" ? pkg.version : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseClaudePluginVersion(stdout) {
  const match = String(stdout || "").match(
    /❯\s+preqstation@preqstation\s*\n(?:.*\n)*?\s+Version:\s+([^\n]+)/u,
  );
  return match?.[1]?.trim() ?? null;
}

function compareVersion(left, right) {
  const leftParts = String(left || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function isLegacyCliFirstSkillVersion(version) {
  return Boolean(
    version &&
      compareVersion(version, MINIMUM_CLI_FIRST_SKILL_VERSION) < 0,
  );
}

function isClaudePluginInstalled(stdout) {
  return /❯\s+preqstation@preqstation\b/u.test(String(stdout || ""));
}

function hasClaudeMarketplace(stdout) {
  return /❯\s+preqstation\b/u.test(String(stdout || ""));
}

async function ensureClaudePlugin({
  env,
  exec,
  latestVersion,
  installMissing,
}) {
  const pluginList = await exec("claude", ["plugin", "list"], { env });
  const pluginInstalled = isClaudePluginInstalled(pluginList?.stdout ?? "");
  const installedVersion = parseClaudePluginVersion(pluginList?.stdout ?? "");

  if (!pluginInstalled && !installMissing) {
    return {
      ok: true,
      target: "claude-code",
      action: "not_installed",
      installed_version: null,
      latest_version: latestVersion,
      marketplace_added: false,
    };
  }

  let marketplaceAdded = false;
  const marketplaceList = await exec("claude", ["plugin", "marketplace", "list"], { env });
  if (!hasClaudeMarketplace(marketplaceList?.stdout ?? "")) {
    await exec("claude", ["plugin", "marketplace", "add", PREQSTATION_SKILL_GITHUB_URL], {
      env,
    });
    marketplaceAdded = true;
  }

  if (!pluginInstalled) {
    await exec("claude", ["plugin", "install", "preqstation@preqstation"], { env });
    return {
      ok: true,
      target: "claude-code",
      action: "installed",
      installed_version: latestVersion,
      latest_version: latestVersion,
      marketplace_added: marketplaceAdded,
    };
  }

  if (latestVersion && installedVersion === latestVersion) {
    return {
      ok: true,
      target: "claude-code",
      action: "already_current",
      installed_version: installedVersion,
      latest_version: latestVersion,
      marketplace_added: marketplaceAdded,
    };
  }

  await exec("claude", ["plugin", "marketplace", "update", "preqstation"], { env });
  await exec("claude", ["plugin", "update", "preqstation@preqstation"], { env });
  return {
    ok: true,
    target: "claude-code",
    action: "updated",
    installed_version: installedVersion,
    latest_version: latestVersion,
    marketplace_added: marketplaceAdded,
  };
}

async function removeClaudePlugin({
  env,
  exec,
}) {
  const pluginList = await exec("claude", ["plugin", "list"], { env });
  const pluginInstalled = isClaudePluginInstalled(pluginList?.stdout ?? "");
  const installedVersion = parseClaudePluginVersion(pluginList?.stdout ?? "");

  if (!pluginInstalled) {
    return {
      ok: true,
      target: "claude-code",
      action: "not_installed",
      installed_version: null,
    };
  }

  await exec("claude", ["plugin", "uninstall", "preqstation@preqstation", "--scope", "user", "-y"], {
    env,
  });
  return {
    ok: true,
    target: "claude-code",
    action: "removed",
    installed_version: installedVersion,
  };
}

async function ensureAgentSkill({
  runtime,
  env,
  exec,
  readFile,
  latestVersion,
  installMissing,
}) {
  const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
  const initialState = await inspectAgentSkillState({ runtime, env, exec, readFile });
  const { entry, syncSourceEntry, configuredAgents, agentInstalled, installedVersion } = initialState;

  if (!agentInstalled && !installMissing) {
    return {
      ok: true,
      target: runtime,
      action: entry?.path ? "not_enabled" : "not_installed",
      installed_version: installedVersion,
      latest_version: latestVersion,
      skill_path: entry?.path ?? null,
      configured_agents: configuredAgents,
    };
  }

  if (agentInstalled && latestVersion && installedVersion === latestVersion) {
    return {
      ok: true,
      target: runtime,
      action: "already_current",
      installed_version: installedVersion,
      latest_version: latestVersion,
      skill_path: entry.path,
    };
  }

  if (agentInstalled) {
    await exec("npx", ["skills", "update", PREQSTATION_SKILL_NAME, "-g", "-y"], { env });
    let refreshedState = await inspectAgentSkillState({ runtime, env, exec, readFile });
    if (
      entry?.path &&
      (!refreshedState.agentInstalled ||
        (latestVersion && refreshedState.installedVersion && refreshedState.installedVersion !== latestVersion))
    ) {
      await synchronizeAgentSkillBinding({
        runtime,
        sourceSkillPath: syncSourceEntry?.path ?? entry.path,
        env,
      });
      refreshedState = await inspectAgentSkillState({ runtime, env, exec, readFile });
    }
    if (!refreshedState.agentInstalled) {
      return {
        ok: false,
        target: runtime,
        action: "failed",
        installed_version: refreshedState.installedVersion ?? installedVersion,
        latest_version: latestVersion,
        skill_path: refreshedState.entry?.path ?? entry?.path ?? null,
        configured_agents: refreshedState.configuredAgents,
        error: `preqstation skill did not stay enabled for ${runtimeConfig.agentName} after update`,
      };
    }
    return {
      ok: true,
      target: runtime,
      action: "updated",
      installed_version: refreshedState.installedVersion ?? installedVersion,
      latest_version: latestVersion,
      skill_path: refreshedState.entry?.path ?? entry.path,
    };
  }

  await exec(
    "npx",
    ["skills", "add", PREQSTATION_SKILL_REPO, "-g", "-a", runtimeConfig.agentId, "-y"],
    { env },
  );
  let refreshedState = await inspectAgentSkillState({ runtime, env, exec, readFile });
  if (!refreshedState.agentInstalled && refreshedState.syncSourceEntry?.path) {
    await synchronizeAgentSkillBinding({
      runtime,
      sourceSkillPath: refreshedState.syncSourceEntry.path,
      env,
    });
    refreshedState = await inspectAgentSkillState({ runtime, env, exec, readFile });
  }
  if (!refreshedState.agentInstalled) {
    return {
      ok: false,
      target: runtime,
      action: "failed",
      installed_version: refreshedState.installedVersion,
      latest_version: latestVersion,
      skill_path: refreshedState.entry?.path ?? entry?.path ?? null,
      configured_agents: refreshedState.configuredAgents,
      error: `preqstation skill did not become enabled for ${runtimeConfig.agentName} after install`,
    };
  }
  return {
    ok: true,
    target: runtime,
    action: "installed",
    installed_version: refreshedState.installedVersion,
    latest_version: latestVersion,
    skill_path: refreshedState.entry?.path ?? entry?.path ?? null,
  };
}

async function removeAgentSkill({
  runtime,
  env,
  exec,
  readFile,
}) {
  const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
  const state = await inspectAgentSkillState({ runtime, env, exec, readFile });
  const skillPath = resolveAgentSkillPath(runtime, env);

  if (!state.agentInstalled) {
    return {
      ok: true,
      target: runtime,
      action: state.entry?.path ? "not_enabled" : "not_installed",
      installed_version: state.installedVersion,
      skill_path: state.entry?.path ?? skillPath,
      configured_agents: state.configuredAgents,
    };
  }

  await exec(
    "npx",
    ["skills", "remove", PREQSTATION_SKILL_NAME, "-g", "-a", runtimeConfig.agentId, "-y"],
    { env },
  );
  await fs.rm(skillPath, { recursive: true, force: true });
  return {
    ok: true,
    target: runtime,
    action: "removed",
    installed_version: state.installedVersion,
    skill_path: state.entry?.path ?? skillPath,
  };
}

export async function installRuntimeWorkerSupport({
  runtimes,
  env = process.env,
  exec = execFileAsync,
  fetchFn = globalThis.fetch,
  readFile = fs.readFile,
  installMissing = true,
} = {}) {
  const runtimeTargets = Array.from(new Set((runtimes ?? []).filter(Boolean)));
  const latestVersion = await fetchLatestPreqstationSkillVersion({ fetchFn }).catch(() => null);
  const results = [];

  for (const runtime of runtimeTargets) {
    const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
    if (!runtimeConfig) {
      throw new Error(
        `Unsupported runtime target: ${runtime}. Expected one of ${SUPPORTED_RUNTIME_SKILL_TARGETS.join(", ")}`,
      );
    }

    if (runtimeConfig.type === "plugin") {
      results.push(await ensureClaudePlugin({ env, exec, latestVersion, installMissing }));
      continue;
    }

    results.push(
      await ensureAgentSkill({
        runtime,
        env,
        exec,
        readFile,
        latestVersion,
        installMissing,
      }),
    );
  }

  return results;
}

export async function inspectRuntimeWorkerSupport({
  runtimes,
  env = process.env,
  exec = execFileAsync,
  fetchFn = globalThis.fetch,
  readFile = fs.readFile,
} = {}) {
  const runtimeTargets = Array.from(new Set((runtimes ?? []).filter(Boolean)));
  const latestVersion = await fetchLatestPreqstationSkillVersion({ fetchFn }).catch(() => null);
  const results = [];

  for (const runtime of runtimeTargets) {
    const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
    if (!runtimeConfig) {
      throw new Error(
        `Unsupported runtime target: ${runtime}. Expected one of ${SUPPORTED_RUNTIME_SKILL_TARGETS.join(", ")}`,
      );
    }

    try {
      if (runtimeConfig.type === "plugin") {
        const pluginList = await exec("claude", ["plugin", "list"], { env });
        const pluginInstalled = isClaudePluginInstalled(pluginList?.stdout ?? "");
        const installedVersion = parseClaudePluginVersion(pluginList?.stdout ?? "");
        const legacySkill = pluginInstalled && isLegacyCliFirstSkillVersion(installedVersion);
        results.push({
          ok: true,
          target: runtime,
          action:
            !pluginInstalled
              ? "not_installed"
              : legacySkill
                ? "needs_attention"
                : latestVersion && installedVersion && installedVersion !== latestVersion
                ? "needs_attention"
                : "already_current",
          installed_version: installedVersion,
          latest_version: latestVersion,
          minimum_cli_first_skill_version: MINIMUM_CLI_FIRST_SKILL_VERSION,
          legacy_skill: legacySkill,
        });
        continue;
      }

      const state = await inspectAgentSkillState({ runtime, env, exec, readFile });
      const installedVersion = state.installedVersion ?? null;
      const legacySkill = state.agentInstalled && isLegacyCliFirstSkillVersion(installedVersion);
      results.push({
        ok: true,
        target: runtime,
        action:
          !state.agentInstalled
            ? state.entries.length > 0
              ? "not_enabled"
              : "not_installed"
            : legacySkill
              ? "needs_attention"
              : latestVersion && installedVersion && installedVersion !== latestVersion
              ? "needs_attention"
              : "already_current",
        installed_version: installedVersion,
        latest_version: latestVersion,
        configured_agents: state.configuredAgents,
        minimum_cli_first_skill_version: MINIMUM_CLI_FIRST_SKILL_VERSION,
        legacy_skill: legacySkill,
      });
    } catch (error) {
      results.push({
        ok: false,
        target: runtime,
        action: "unavailable",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export async function uninstallRuntimeWorkerSupport({
  runtimes,
  env = process.env,
  exec = execFileAsync,
  readFile = fs.readFile,
} = {}) {
  const runtimeTargets = Array.from(new Set((runtimes ?? []).filter(Boolean)));
  const results = [];

  for (const runtime of runtimeTargets) {
    const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
    if (!runtimeConfig) {
      throw new Error(
        `Unsupported runtime target: ${runtime}. Expected one of ${SUPPORTED_RUNTIME_SKILL_TARGETS.join(", ")}`,
      );
    }

    if (runtimeConfig.type === "plugin") {
      results.push(await removeClaudePlugin({ env, exec }));
      continue;
    }

    results.push(
      await removeAgentSkill({
        runtime,
        env,
        exec,
        readFile,
      }),
    );
  }

  return results;
}

export async function inspectRuntimeExecutableHealth({
  runtimes,
  env = process.env,
  exec = execFileAsync,
  launchHosts = [],
} = {}) {
  const runtimeTargets = Array.from(new Set((runtimes ?? []).filter(Boolean)));
  const results = [];

  for (const runtime of runtimeTargets) {
    const runtimeConfig = RUNTIME_SKILL_TARGETS[runtime];
    if (!runtimeConfig) {
      throw new Error(
        `Unsupported runtime target: ${runtime}. Expected one of ${SUPPORTED_RUNTIME_SKILL_TARGETS.join(", ")}`,
      );
    }

    const executablePaths = await listExecutablePaths({
      commandName: runtimeConfig.commandName,
      env,
      exec,
    });
    const resolvedPath = executablePaths[0] ?? null;

    if (!resolvedPath) {
      results.push({
        ok: false,
        target: runtime,
        category: "runtime_executable",
        action: "unavailable",
        executable: runtimeConfig.commandName,
        error: buildExecutableMissingError({
          commandName: runtimeConfig.commandName,
          launchHosts,
        }),
      });
      continue;
    }

    const sessionScopedWarning =
      launchHosts.includes("openclaw") ? findSessionScopedExecutableWarning(resolvedPath) : null;
    if (sessionScopedWarning) {
      const stableAlternative = findStableFnmAlternative(executablePaths);
      results.push({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: "needs_attention",
        executable: runtimeConfig.commandName,
        resolved_path: resolvedPath,
        alternate_path: stableAlternative,
        error: buildSessionScopedPathError({
          commandName: runtimeConfig.commandName,
          resolvedPath,
          stableAlternative,
          launchHosts,
          warningLabel: sessionScopedWarning.label,
        }),
      });
      continue;
    }

    results.push({
      ok: true,
      target: runtime,
      category: "runtime_executable",
      action: "ready",
      executable: runtimeConfig.commandName,
      resolved_path: resolvedPath,
    });
  }

  return results;
}
