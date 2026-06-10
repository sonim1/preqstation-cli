import fs from "node:fs/promises";
import path from "node:path";

import { resolveDefaultUserHome } from "./project-mapping.mjs";

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

export function getPreqstationDispatchHome(env = process.env) {
  const explicitHome = String(env?.PREQSTATION_DISPATCH_HOME || "").trim();
  if (explicitHome) {
    return path.resolve(explicitHome);
  }

  const currentHome = String(env?.HOME || "").trim();
  if (
    currentHome &&
    !currentHome.includes(`${path.sep}.hermes${path.sep}profiles${path.sep}`) &&
    !currentHome.endsWith(`${path.sep}.hermes`)
  ) {
    return path.join(path.resolve(currentHome), ".preqstation-dispatch");
  }

  return path.join(resolveDefaultUserHome(env), ".preqstation-dispatch");
}

export function getPreqstationConfigPath(env = process.env) {
  return path.join(getPreqstationDispatchHome(env), "config.json");
}

export function getPreqstationOauthPath(env = process.env) {
  return path.join(getPreqstationDispatchHome(env), "oauth.json");
}

export async function readPreqstationConfig({
  env = process.env,
  readFile = fs.readFile,
} = {}) {
  const configPath = getPreqstationConfigPath(env);
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    return {
      config_path: configPath,
      server_url: parsed?.server_url
        ? normalizeConfigServerUrl(parsed.server_url)
        : null,
    };
  } catch {
    return {
      config_path: configPath,
      server_url: null,
    };
  }
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
