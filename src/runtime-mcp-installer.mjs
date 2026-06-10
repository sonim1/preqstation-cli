import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  getPreqstationOauthPaths,
  readPreqstationConfig,
} from "./preqstation-config.mjs";

const execFileAsync = promisify(execFile);
const PREQSTATION_MCP_NAME = "preqstation";

export const SUPPORTED_RUNTIME_TARGETS = [
  "claude-code",
  "codex",
  "gemini-cli",
];

const RUNTIME_MCP_INSTALLERS = {
  "claude-code": {
    command: "claude",
    args: (mcpUrl) => [
      "mcp",
      "add",
      "-s",
      "user",
      "--transport",
      "http",
      PREQSTATION_MCP_NAME,
      mcpUrl,
    ],
    removeArgs: () => ["mcp", "remove", "-s", "user", PREQSTATION_MCP_NAME],
    inspectArgs: () => ["mcp", "get", PREQSTATION_MCP_NAME],
    parseExistingConfig(stdout) {
      const match = String(stdout || "").match(/URL:\s+(\S+)/u);
      return {
        exists: true,
        url: match?.[1] ?? null,
      };
    },
    parseStatus(stdout) {
      const match = String(stdout || "").match(/URL:\s+(\S+)/u);
      const statusMatch = String(stdout || "").match(/Status:\s+([^\n]+)/u);
      return {
        exists: Boolean(match?.[1]),
        url: match?.[1] ?? null,
        status: normalizeConnectionStatus(statusMatch?.[1] ?? null),
        auth: null,
      };
    },
    isMissingConfigError(error) {
      return /No MCP server found with name:/iu.test(String(error?.stderr || error?.message || error));
    },
  },
  codex: {
    command: "codex",
    args: (mcpUrl) => ["mcp", "add", PREQSTATION_MCP_NAME, "--url", mcpUrl],
    removeArgs: () => ["mcp", "remove", PREQSTATION_MCP_NAME],
    inspectArgs: () => ["mcp", "get", PREQSTATION_MCP_NAME],
    statusInspectArgs: () => ["mcp", "list"],
    parseExistingConfig(stdout) {
      const match = String(stdout || "").match(/url:\s+(\S+)/iu);
      return {
        exists: true,
        url: match?.[1] ?? null,
      };
    },
    parseStatus(stdout) {
      const line = String(stdout || "")
        .split(/\r?\n/u)
        .find((value) => new RegExp(`^${PREQSTATION_MCP_NAME}\\b`, "u").test(value.trim()));
      if (!line) {
        return {
          exists: false,
          url: null,
          status: null,
          auth: null,
        };
      }
      const columns = line.trim().split(/\s{2,}/u);
      return {
        exists: columns[0] === PREQSTATION_MCP_NAME,
        url: columns[1] ?? null,
        status: normalizeConnectionStatus(columns[3] ?? null),
        auth: columns[4] ?? null,
      };
    },
    isMissingConfigError(error) {
      return /No MCP server named .* found\./iu.test(String(error?.stderr || error?.message || error));
    },
  },
  "gemini-cli": {
    command: "gemini",
    args: (mcpUrl) => [
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      PREQSTATION_MCP_NAME,
      mcpUrl,
    ],
    removeArgs: () => ["mcp", "remove", "--scope", "user", PREQSTATION_MCP_NAME],
    inspectArgs: () => ["mcp", "list"],
    parseExistingConfig(stdout) {
      const parsed = parseGeminiMcpStatus(stdout);
      return {
        exists: parsed.exists,
        url: parsed.url,
      };
    },
    parseStatus: parseGeminiMcpStatus,
    isMissingConfigError() {
      return false;
    },
  },
};

function normalizeConnectionStatus(value) {
  return String(value || "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim() || null;
}

function parseGeminiMcpStatus(stdout) {
  const match = String(stdout || "").match(
    /^(?:([✓✗])\s+)?preqstation:\s+(\S+)(?:\s+\([^)]+\))?(?:\s+-\s+(.+))?$/mu,
  );
  if (!match) {
    return {
      exists: false,
      url: null,
      status: null,
      auth: null,
    };
  }

  const symbol = match[1] ?? null;
  const explicitStatus = normalizeConnectionStatus(match[3] ?? null);
  return {
    exists: true,
    url: match[2] ?? null,
    status:
      explicitStatus || (symbol === "✓" ? "Connected" : symbol === "✗" ? "Disconnected" : null),
    auth: null,
  };
}

async function inspectRuntimeMcpServer({ installer, env, exec }) {
  if (!installer.inspectArgs || !installer.parseExistingConfig) {
    return {
      exists: false,
      url: null,
    };
  }

  try {
    const result = await exec(installer.command, installer.inspectArgs(), { env });
    return installer.parseExistingConfig(combineCommandOutput(result));
  } catch (error) {
    if (installer.isMissingConfigError?.(error)) {
      return {
        exists: false,
        url: null,
      };
    }
    throw error;
  }
}

function combineCommandOutput(result) {
  return `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
}

async function inspectRuntimeMcpStatus({ installer, env, exec }) {
  const args = installer.statusInspectArgs?.() ?? installer.inspectArgs?.() ?? null;
  const parse = installer.parseStatus ?? installer.parseExistingConfig;
  if (!args || typeof parse !== "function") {
    return {
      exists: false,
      url: null,
      status: null,
      auth: null,
    };
  }

  try {
    const result = await exec(installer.command, args, { env });
    return parse(combineCommandOutput(result));
  } catch (error) {
    if (installer.isMissingConfigError?.(error)) {
      return {
        exists: false,
        url: null,
        status: null,
        auth: null,
      };
    }
    throw error;
  }
}

function maybeNormalizePreqstationServerUrl(value) {
  try {
    return normalizePreqstationServerUrl(value);
  } catch {
    return null;
  }
}

function extractServerUrlFromMcpUrl(mcpUrl) {
  const normalizedMcpUrl = String(mcpUrl || "").trim().replace(/\/+$/u, "");
  if (!normalizedMcpUrl) {
    return null;
  }
  if (!/\/mcp$/iu.test(normalizedMcpUrl)) {
    return null;
  }
  return maybeNormalizePreqstationServerUrl(normalizedMcpUrl.replace(/\/mcp$/iu, ""));
}

function isLocalhostHttp(url) {
  return /^http:\/\/localhost(?::\d+)?(?:\/.*)?$/iu.test(url);
}

async function readSharedOauthServerUrl({
  env = process.env,
  readFile = fs.readFile,
} = {}) {
  for (const oauthPath of getPreqstationOauthPaths(env)) {
    try {
      const content = await readFile(oauthPath, "utf8");
      const parsed = JSON.parse(content);
      const serverUrl =
        maybeNormalizePreqstationServerUrl(parsed?.discoveryState?.authorizationServerUrl) ??
        maybeNormalizePreqstationServerUrl(parsed?.discoveryState?.authorizationServerMetadata?.issuer);
      if (serverUrl) {
        return serverUrl;
      }
    } catch {}
  }
  return null;
}

export function normalizePreqstationServerUrl(value) {
  const serverUrl = String(value || "").trim().replace(/\/+$/u, "");
  if (!serverUrl) {
    throw new Error("PREQSTATION server URL is required");
  }
  if (!/^https:\/\//iu.test(serverUrl) && !isLocalhostHttp(serverUrl)) {
    throw new Error(
      "PREQSTATION server URL must use https:// (or http://localhost for local development).",
    );
  }
  return serverUrl;
}

export function buildPreqstationMcpUrl(serverUrl) {
  return `${normalizePreqstationServerUrl(serverUrl)}/mcp`;
}

export async function resolveDefaultPreqstationServerUrl({
  runtimes = SUPPORTED_RUNTIME_TARGETS,
  env = process.env,
  exec = execFileAsync,
  readFile = fs.readFile,
} = {}) {
  for (const key of ["PREQSTATION_SERVER_URL", "PREQSTATION_API_URL"]) {
    const normalized = maybeNormalizePreqstationServerUrl(env?.[key]);
    if (normalized) {
      return normalized;
    }
  }

  const sharedOauthServerUrl = await readSharedOauthServerUrl({
    env,
    readFile,
  });
  if (sharedOauthServerUrl) {
    return sharedOauthServerUrl;
  }

  const configuredServerUrl = (await readPreqstationConfig({ env, readFile })).server_url;
  if (configuredServerUrl) {
    return configuredServerUrl;
  }

  const discoveredServerUrls = new Set();
  for (const runtime of Array.from(new Set((runtimes ?? []).filter(Boolean)))) {
    const installer = RUNTIME_MCP_INSTALLERS[runtime];
    if (!installer) {
      continue;
    }

    let existingConfig = null;
    try {
      existingConfig = await inspectRuntimeMcpServer({
        installer,
        env,
        exec,
      });
    } catch {
      continue;
    }

    const serverUrl = extractServerUrlFromMcpUrl(existingConfig?.url);
    if (serverUrl) {
      discoveredServerUrls.add(serverUrl);
    }
  }

  if (discoveredServerUrls.size === 1) {
    return Array.from(discoveredServerUrls)[0];
  }

  return null;
}

export async function inspectRuntimeMcpServers({
  runtimes = SUPPORTED_RUNTIME_TARGETS,
  env = process.env,
  exec = execFileAsync,
} = {}) {
  const results = [];

  for (const runtime of Array.from(new Set((runtimes ?? []).filter(Boolean)))) {
    const installer = RUNTIME_MCP_INSTALLERS[runtime];
    if (!installer) {
      throw new Error(
        `Unsupported runtime target: ${runtime}. Expected one of ${SUPPORTED_RUNTIME_TARGETS.join(", ")}`,
      );
    }

    const status = await inspectRuntimeMcpStatus({
      installer,
      env,
      exec,
    });
    const serverUrl = extractServerUrlFromMcpUrl(status?.url);

    results.push({
      ok: true,
      target: runtime,
      action: status.exists ? "mcp_configured" : "mcp_missing",
      server_url: serverUrl,
      mcp_url: status?.url ?? null,
      connection_status: status?.status ?? null,
      auth: status?.auth ?? null,
    });
  }

  return results;
}

export async function installRuntimeMcpServers({
  runtimes,
  serverUrl,
  env = process.env,
  exec = execFileAsync,
} = {}) {
  const runtimeTargets = Array.from(new Set((runtimes ?? []).filter(Boolean)));
  const mcpUrl = buildPreqstationMcpUrl(serverUrl);
  const normalizedServerUrl = normalizePreqstationServerUrl(serverUrl);
  const results = [];

  for (const runtime of runtimeTargets) {
    const installer = RUNTIME_MCP_INSTALLERS[runtime];
    if (!installer) {
      throw new Error(
        `Unsupported runtime target: ${runtime}. Expected one of ${SUPPORTED_RUNTIME_TARGETS.join(", ")}`,
      );
    }

    const args = installer.args(mcpUrl);
    const existingConfig = await inspectRuntimeMcpServer({
      installer,
      env,
      exec,
    });
    if (existingConfig.exists && existingConfig.url === mcpUrl) {
      results.push({
        ok: true,
        target: runtime,
        action: "mcp_already_configured",
        server_url: normalizedServerUrl,
        mcp_url: mcpUrl,
        command: installer.command,
        args: installer.inspectArgs?.() ?? [],
      });
      continue;
    }
    if (existingConfig.exists) {
      throw new Error(
        `MCP server ${PREQSTATION_MCP_NAME} already exists for ${runtime}. Remove it manually and rerun install if you want to change its configuration.`,
      );
    }

    await exec(installer.command, args, { env });
    results.push({
      ok: true,
      target: runtime,
      action: "mcp_installed",
      server_url: normalizedServerUrl,
      mcp_url: mcpUrl,
      command: installer.command,
      args,
    });
  }

  return results;
}

export async function uninstallRuntimeMcpServers({
  runtimes = SUPPORTED_RUNTIME_TARGETS,
  env = process.env,
  exec = execFileAsync,
} = {}) {
  const runtimeTargets = Array.from(new Set((runtimes ?? []).filter(Boolean)));
  const results = [];

  for (const runtime of runtimeTargets) {
    const installer = RUNTIME_MCP_INSTALLERS[runtime];
    if (!installer) {
      throw new Error(
        `Unsupported runtime target: ${runtime}. Expected one of ${SUPPORTED_RUNTIME_TARGETS.join(", ")}`,
      );
    }

    const existingConfig = await inspectRuntimeMcpServer({
      installer,
      env,
      exec,
    });
    if (!existingConfig.exists) {
      results.push({
        ok: true,
        target: runtime,
        action: "mcp_not_configured",
        mcp_url: null,
      });
      continue;
    }

    await exec(installer.command, installer.removeArgs(), { env });
    results.push({
      ok: true,
      target: runtime,
      action: "mcp_removed",
      mcp_url: existingConfig.url ?? null,
    });
  }

  return results;
}
