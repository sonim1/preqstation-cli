import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@sonim1/preqstation";
const SKILL_NAME = "preqstation_dispatch";
const LEGACY_SKILL_NAMES = ["preqstation", "preq_dispatch"];
const TARGET = "hermes";
const BUNDLED_SKILL_FILE = fileURLToPath(
  new URL("../hermes-skills/preqstation/preqstation_dispatch/SKILL.md", import.meta.url),
);
const PACKAGE_JSON_FILE = fileURLToPath(new URL("../package.json", import.meta.url));

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getHermesHome(env = process.env) {
  return env.PREQSTATION_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), ".hermes");
}

function getSkillPathsForName(skillName, env = process.env) {
  const skillDir = path.join(
    getHermesHome(env),
    "skills",
    "preqstation",
    skillName,
  );
  return {
    skillDir,
    skillFile: path.join(skillDir, "SKILL.md"),
    metadataFile: path.join(skillDir, ".preqstation-dispatcher.json"),
  };
}

function getSkillPaths(env = process.env) {
  return getSkillPathsForName(SKILL_NAME, env);
}

function getLegacySkillPaths(env = process.env) {
  return LEGACY_SKILL_NAMES.map((skillName) => getSkillPathsForName(skillName, env));
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readPackageVersion() {
  const pkg = await readJsonFile(PACKAGE_JSON_FILE);
  return pkg.version;
}

async function readInstalledSkill(skillFile) {
  return fs.readFile(skillFile, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
}

async function readMetadata(metadataFile) {
  return readJsonFile(metadataFile).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
}

function backupSuffix() {
  return new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
}

async function writeSkillInstall({ skillDir, skillFile, metadataFile, content, metadata }) {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(`${skillFile}.tmp`, content, "utf8");
  await fs.rename(`${skillFile}.tmp`, skillFile);
  await fs.writeFile(
    `${metadataFile}.tmp`,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(`${metadataFile}.tmp`, metadataFile);
}

function detectUserModified({ installedContent, metadata, bundledSha }) {
  if (installedContent === null) {
    return false;
  }

  const installedSha = sha256(installedContent);
  return Boolean(
    (metadata?.sha256 && installedSha !== metadata.sha256) ||
      (!metadata && installedSha !== bundledSha),
  );
}

function detectLegacyUserModified({ installedContent, metadata, skillName }) {
  if (installedContent === null) {
    return false;
  }

  const installedSha = sha256(installedContent);
  const managed =
    metadata?.package === PACKAGE_NAME &&
    metadata?.skill === skillName &&
    typeof metadata?.sha256 === "string";
  return managed ? installedSha !== metadata.sha256 : true;
}

async function removeLegacyInstalls({
  env,
  force,
  backups,
}) {
  for (const paths of getLegacySkillPaths(env)) {
    const installedContent = await readInstalledSkill(paths.skillFile);
    if (installedContent === null) {
      continue;
    }

    const metadata = await readMetadata(paths.metadataFile);
    const userModified = detectLegacyUserModified({
      installedContent,
      metadata,
      skillName: path.basename(paths.skillDir),
    });
    if (userModified && !force) {
      throw new Error(
        "Legacy Hermes skill has local changes. Run `preqstation sync hermes --force` to back up and replace it.",
      );
    }

    if (force) {
      const backupFile = `${paths.skillFile}.bak-${backupSuffix()}`;
      await fs.copyFile(paths.skillFile, backupFile);
      backups.push(backupFile);
    }

    await fs.rm(paths.skillDir, { recursive: true, force: true });
  }
}

export async function getHermesSkillStatus({ env = process.env } = {}) {
  const { skillDir, skillFile, metadataFile } = getSkillPaths(env);
  const legacyPaths = getLegacySkillPaths(env);
  const bundledContent = await fs.readFile(BUNDLED_SKILL_FILE, "utf8");
  const bundledSha = sha256(bundledContent);
  const installedContent = await readInstalledSkill(skillFile);
  const legacyInstalls = [];
  for (const paths of legacyPaths) {
    const installedContentForLegacy = await readInstalledSkill(paths.skillFile);
    if (installedContentForLegacy !== null) {
      const metadata = await readMetadata(paths.metadataFile);
      legacyInstalls.push({
        ...paths,
        installedContent: installedContentForLegacy,
        metadata,
        userModified: detectLegacyUserModified({
          installedContent: installedContentForLegacy,
          metadata,
          skillName: path.basename(paths.skillDir),
        }),
      });
    }
  }

  if (installedContent === null && legacyInstalls.length === 0) {
    return {
      ok: true,
      target: TARGET,
      installed: false,
      current: false,
      user_modified: false,
      skill_file: skillFile,
      metadata_file: metadataFile,
    };
  }

  const metadata = installedContent === null ? null : await readMetadata(metadataFile);
  const installedSha = installedContent === null ? null : sha256(installedContent);
  const userModified =
    installedContent === null
      ? legacyInstalls.some((entry) => entry.userModified)
      : detectUserModified({
          installedContent,
          metadata,
          bundledSha,
        }) || legacyInstalls.some((entry) => entry.userModified);
  const firstLegacy = legacyInstalls[0] ?? null;

  return {
    ok: true,
    target: TARGET,
    installed: true,
    current: installedContent !== null && legacyInstalls.length === 0 && installedSha === bundledSha,
    user_modified: userModified,
    skill_file: installedContent === null ? firstLegacy.skillFile : skillFile,
    metadata_file: installedContent === null ? firstLegacy.metadataFile : metadataFile,
    installed_version: (installedContent === null ? firstLegacy.metadata : metadata)?.version ?? null,
    installed_sha256: installedContent === null ? sha256(firstLegacy.installedContent) : installedSha,
    bundled_sha256: bundledSha,
    skill_dir: installedContent === null ? firstLegacy.skillDir : skillDir,
    canonical_skill_file: skillFile,
    legacy_install: legacyInstalls.length > 0,
  };
}

export async function syncHermesSkill({ env = process.env, force = false } = {}) {
  const { skillDir, skillFile, metadataFile } = getSkillPaths(env);
  const packageVersion = await readPackageVersion();
  const bundledContent = await fs.readFile(BUNDLED_SKILL_FILE, "utf8");
  const bundledSha = sha256(bundledContent);
  const installedContent = await readInstalledSkill(skillFile);
  const metadata = await readMetadata(metadataFile);
  const userModified = detectUserModified({
    installedContent,
    metadata,
    bundledSha,
  });

  if (userModified && !force) {
    throw new Error(
      "Hermes skill has local changes. Run `preqstation sync hermes --force` to back up and replace it.",
    );
  }

  const legacyBackups = [];
  await removeLegacyInstalls({
    env,
    force,
    backups: legacyBackups,
  });

  if (installedContent !== null && sha256(installedContent) === bundledSha && !userModified) {
    const nextMetadata = {
      package: PACKAGE_NAME,
      version: packageVersion,
      source: "bundled",
      skill: SKILL_NAME,
      sha256: bundledSha,
      installedAt: new Date().toISOString(),
    };
    await writeSkillInstall({
      skillDir,
      skillFile,
      metadataFile,
      content: bundledContent,
      metadata: nextMetadata,
    });
    return {
      ok: true,
      target: TARGET,
      action: "already_current",
      skill_file: skillFile,
      metadata_file: metadataFile,
      version: packageVersion,
      sha256: bundledSha,
      ...(legacyBackups.length > 0 ? { backup_files: legacyBackups } : {}),
    };
  }

  const backupFiles = [];
  backupFiles.push(...legacyBackups);
  if (installedContent !== null && force) {
    const backupFile = `${skillFile}.bak-${backupSuffix()}`;
    await fs.copyFile(skillFile, backupFile);
    backupFiles.push(backupFile);
  }

  const metadataNext = {
    package: PACKAGE_NAME,
    version: packageVersion,
    source: "bundled",
    skill: SKILL_NAME,
    sha256: bundledSha,
    installedAt: new Date().toISOString(),
  };
  await writeSkillInstall({
    skillDir,
    skillFile,
    metadataFile,
    content: bundledContent,
    metadata: metadataNext,
  });

  return {
    ok: true,
    target: TARGET,
    action: installedContent === null ? "installed" : "updated",
    skill_file: skillFile,
    metadata_file: metadataFile,
    version: packageVersion,
    sha256: bundledSha,
    ...(backupFiles.length === 1
      ? { backup_file: backupFiles[0] }
      : backupFiles.length > 1
        ? { backup_files: backupFiles }
      : {}),
  };
}

export async function uninstallHermesSkill({ env = process.env, force = false } = {}) {
  const paths = getSkillPaths(env);
  const bundledContent = await fs.readFile(BUNDLED_SKILL_FILE, "utf8");
  const bundledSha = sha256(bundledContent);
  const installs = [
    {
      ...paths,
      bundledSha,
      installedContent: await readInstalledSkill(paths.skillFile),
      metadata: await readMetadata(paths.metadataFile),
      legacy: false,
    },
    ...(await Promise.all(
      getLegacySkillPaths(env).map(async (legacyPaths) => ({
        ...legacyPaths,
        bundledSha: null,
        installedContent: await readInstalledSkill(legacyPaths.skillFile),
        metadata: await readMetadata(legacyPaths.metadataFile),
        legacy: true,
      })),
    )),
  ].filter((entry) => entry.installedContent !== null);

  if (installs.length === 0) {
    return {
      ok: true,
      target: TARGET,
      action: "not_installed",
      skill_file: paths.skillFile,
    };
  }

  for (const install of installs) {
    const userModified = install.legacy
      ? detectLegacyUserModified({
          installedContent: install.installedContent,
          metadata: install.metadata,
          skillName: path.basename(install.skillDir),
        })
      : detectUserModified({
          installedContent: install.installedContent,
          metadata: install.metadata,
          bundledSha: install.bundledSha,
        });
    if (userModified && !force) {
      throw new Error(
        "Hermes skill has local changes. Run `preqstation uninstall hermes --force` to back up and remove it.",
      );
    }
  }

  const backupFiles = [];
  if (force) {
    for (const install of installs) {
      const backupFile = `${install.skillDir}.bak-${backupSuffix()}.SKILL.md`;
      await fs.copyFile(install.skillFile, backupFile);
      backupFiles.push(backupFile);
    }
  }

  for (const install of installs) {
    await fs.rm(install.skillDir, { recursive: true, force: true });
  }

  return {
    ok: true,
    target: TARGET,
    action: "removed",
    skill_file: paths.skillFile,
    ...(backupFiles.length === 1
      ? { backup_file: backupFiles[0] }
      : backupFiles.length > 1
        ? { backup_files: backupFiles }
        : {}),
  };
}
