import fs from "node:fs/promises";
import path from "node:path";

import { resolveDefaultUserHome } from "./project-mapping.mjs";

const PREQSTATION_HOME_DIR = ".preqstation";
const LEGACY_PREQSTATION_HOME_DIR = ".preqstation-dispatch";

function normalizeConfigServerUrl(value) {
  const serverUrl = String(value || "").trim().replace(/\/+$/u, "");
  if (!serverUrl) {
    throw new Error("PREQSTATION server URL is required");
  }
  if (
    !/^https:\/\//iu.test(serverUrl) &&
    !/^http:\/\/localhost(?::\d+)?(?:\/.*)?$/iu.test(serverUrl)
  ) {
    throw new Error(
      "PREQSTATION server URL must use https:// (or http://localhost for local development).",
    );
  }
  return serverUrl;
}

function resolvePreqstationHomeBase(env = process.env) {
  const currentHome = String(env?.HOME || "").trim();
  if (
    currentHome &&
    !currentHome.includes(`${path.sep}.hermes${path.sep}profiles${path.sep}`) &&
    !currentHome.endsWith(`${path.sep}.hermes`)
  ) {
    return path.resolve(currentHome);
  }

  return resolveDefaultUserHome(env);
}

function hasExplicitDispatchHome(env = process.env) {
  return Boolean(String(env?.PREQSTATION_DISPATCH_HOME || "").trim());
}

export function getPreqstationDispatchHome(env = process.env) {
  const explicitHome = String(env?.PREQSTATION_DISPATCH_HOME || "").trim();
  if (explicitHome) {
    return path.resolve(explicitHome);
  }

  return path.join(resolvePreqstationHomeBase(env), PREQSTATION_HOME_DIR);
}

export function getLegacyPreqstationDispatchHome(env = process.env) {
  return path.join(resolvePreqstationHomeBase(env), LEGACY_PREQSTATION_HOME_DIR);
}

export function getPreqstationConfigPath(env = process.env) {
  return path.join(getPreqstationDispatchHome(env), "config.json");
}

export function getPreqstationOauthPath(env = process.env) {
  return path.join(getPreqstationDispatchHome(env), "oauth.json");
}

export function getPreqstationErrorLogPath(env = process.env) {
  return path.join(getPreqstationDispatchHome(env), "logs", "error.log");
}

export function getPreqstationConfigPaths(env = process.env) {
  const primaryPath = getPreqstationConfigPath(env);
  if (hasExplicitDispatchHome(env)) {
    return [primaryPath];
  }

  const legacyPath = path.join(getLegacyPreqstationDispatchHome(env), "config.json");
  return legacyPath === primaryPath ? [primaryPath] : [primaryPath, legacyPath];
}

export function getPreqstationOauthPaths(env = process.env) {
  const primaryPath = getPreqstationOauthPath(env);
  if (hasExplicitDispatchHome(env)) {
    return [primaryPath];
  }

  const legacyPath = path.join(getLegacyPreqstationDispatchHome(env), "oauth.json");
  return legacyPath === primaryPath ? [primaryPath] : [primaryPath, legacyPath];
}

export async function readPreqstationConfig({
  env = process.env,
  readFile = fs.readFile,
} = {}) {
  const [primaryPath, ...fallbackPaths] = getPreqstationConfigPaths(env);
  for (const configPath of [primaryPath, ...fallbackPaths]) {
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8"));
      const serverUrl = parsed?.server_url
        ? normalizeConfigServerUrl(parsed.server_url)
        : null;
      if (serverUrl) {
        return {
          config_path: configPath,
          server_url: serverUrl,
        };
      }
    } catch {}
  }

  return {
    config_path: primaryPath,
    server_url: null,
  };
}

export async function writePreqstationConfig({
  env = process.env,
  serverUrl,
  writeFile = fs.writeFile,
  mkdir = fs.mkdir,
  rename = fs.rename,
} = {}) {
  const configPath = getPreqstationConfigPath(env);
  const config = {
    server_url: normalizeConfigServerUrl(serverUrl),
  };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(`${configPath}.tmp`, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(`${configPath}.tmp`, configPath);
  return {
    config_path: configPath,
    ...config,
  };
}
