import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@sonim1/preqstation";
const SKILL_NAME = "preqstation_dispatch";
const LEGACY_SKILL_NAME = "preq_dispatch";
const TARGET = "hermes";
const BUNDLED_SKILL_FILE = fileURLToPath(
  new URL("../hermes-skills/preqstation/preqstation_dispatch/SKILL.md", import.meta.url),
);
const LEGACY_BUNDLED_SKILL_FILE = fileURLToPath(
  new URL("../hermes-skills/preqstation/preq_dispatch/SKILL.md", import.meta.url),
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
  return getSkillPathsForName(LEGACY_SKILL_NAME, env);
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

async function removeLegacyInstall({
  env,
  force,
  bundledSha,
  backups,
}) {
  const { skillDir, skillFile, metadataFile } = getLegacySkillPaths(env);
  const installedContent = await readInstalledSkill(skillFile);
  if (installedContent === null) {
    return;
  }

  const metadata = await readMetadata(metadataFile);
  const userModified = detectUserModified({
    installedContent,
    metadata,
    bundledSha,
  });
  if (userModified && !force) {
    throw new Error(
      "Legacy Hermes skill has local changes. Run `preqstation-dispatcher sync hermes --force` to back up and replace it.",
    );
  }

  if (force) {
    const backupFile = `${skillFile}.bak-${backupSuffix()}`;
    await fs.copyFile(skillFile, backupFile);
    backups.push(backupFile);
  }

  await fs.rm(skillDir, { recursive: true, force: true });
}

export async function getHermesSkillStatus({ env = process.env } = {}) {
  const { skillDir, skillFile, metadataFile } = getSkillPaths(env);
  const legacyPaths = getLegacySkillPaths(env);
  const bundledContent = await fs.readFile(BUNDLED_SKILL_FILE, "utf8");
  const bundledSha = sha256(bundledContent);
  const legacyBundledContent = await fs.readFile(LEGACY_BUNDLED_SKILL_FILE, "utf8");
  const legacyBundledSha = sha256(legacyBundledContent);
  const installedContent = await readInstalledSkill(skillFile);
  const legacyInstalledContent = await readInstalledSkill(legacyPaths.skillFile);

  if (installedContent === null && legacyInstalledContent === null) {
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

  const isLegacyInstall = installedContent === null;
  const resolvedContent = isLegacyInstall ? legacyInstalledContent : installedContent;
  const resolvedSkillFile = isLegacyInstall ? legacyPaths.skillFile : skillFile;
  const resolvedMetadataFile = isLegacyInstall ? legacyPaths.metadataFile : metadataFile;
  const resolvedMetadata = await readMetadata(resolvedMetadataFile);
  const resolvedBundledSha = isLegacyInstall ? legacyBundledSha : bundledSha;
  const installedSha = sha256(resolvedContent);
  const userModified = detectUserModified({
    installedContent: resolvedContent,
    metadata: resolvedMetadata,
    bundledSha: resolvedBundledSha,
  });

  return {
    ok: true,
    target: TARGET,
    installed: true,
    current: !isLegacyInstall && installedSha === bundledSha,
    user_modified: userModified,
    skill_file: resolvedSkillFile,
    metadata_file: resolvedMetadataFile,
    installed_version: resolvedMetadata?.version ?? null,
    installed_sha256: installedSha,
    bundled_sha256: bundledSha,
    skill_dir: isLegacyInstall ? legacyPaths.skillDir : skillDir,
    canonical_skill_file: skillFile,
    legacy_install: isLegacyInstall,
  };
}

export async function syncHermesSkill({ env = process.env, force = false } = {}) {
  const { skillDir, skillFile, metadataFile } = getSkillPaths(env);
  const legacyPaths = getLegacySkillPaths(env);
  const packageVersion = await readPackageVersion();
  const bundledContent = await fs.readFile(BUNDLED_SKILL_FILE, "utf8");
  const bundledSha = sha256(bundledContent);
  const legacyBundledContent = await fs.readFile(LEGACY_BUNDLED_SKILL_FILE, "utf8");
  const legacyBundledSha = sha256(legacyBundledContent);
  const installedContent = await readInstalledSkill(skillFile);
  const metadata = await readMetadata(metadataFile);
  const legacyInstalledContent = await readInstalledSkill(legacyPaths.skillFile);
  const legacyMetadata = await readMetadata(legacyPaths.metadataFile);
  const userModified = detectUserModified({
    installedContent,
    metadata,
    bundledSha,
  });
  const legacyUserModified = detectUserModified({
    installedContent: legacyInstalledContent,
    metadata: legacyMetadata,
    bundledSha: legacyBundledSha,
  });

  if (legacyInstalledContent !== null && legacyUserModified && !force) {
    throw new Error(
      "Legacy Hermes skill has local changes. Run `preqstation-dispatcher sync hermes --force` to back up and replace it.",
    );
  }

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
    const backups = [];
    await removeLegacyInstall({
      env,
      force,
      bundledSha: legacyBundledSha,
      backups,
    });
    return {
      ok: true,
      target: TARGET,
      action: "already_current",
      skill_file: skillFile,
      metadata_file: metadataFile,
      version: packageVersion,
      sha256: bundledSha,
      ...(backups.length > 0 ? { backup_files: backups } : {}),
    };
  }

  if (userModified && !force) {
    throw new Error(
      "Hermes skill has local changes. Run `preqstation-dispatcher sync hermes --force` to back up and replace it.",
    );
  }

  const backupFiles = [];
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
  await removeLegacyInstall({
    env,
    force,
    bundledSha: legacyBundledSha,
    backups: backupFiles,
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
