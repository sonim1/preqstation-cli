import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildPreqstationMcpUrl,
  normalizePreqstationServerUrl,
} from "./runtime-mcp-installer.mjs";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_OAUTH_TIMEOUT_MS = 120_000;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readOauthCache(oauthPath) {
  try {
    return await readJsonFile(oauthPath);
  } catch {
    return null;
  }
}

async function writeOauthCache(oauthPath, cache) {
  await fs.mkdir(path.dirname(oauthPath), { recursive: true });
  await fs.writeFile(`${oauthPath}.tmp`, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await fs.rename(`${oauthPath}.tmp`, oauthPath);
}

function resolveAccessToken({ env, oauthCache }) {
  const envToken = normalizeString(env?.PREQSTATION_TOKEN);
  if (envToken) {
    return envToken;
  }
  return normalizeString(oauthCache?.tokens?.access_token);
}

export async function inspectPreqstationAuth({
  oauthPath,
  env = process.env,
} = {}) {
  if (!normalizeString(oauthPath)) {
    throw new Error("oauthPath is required to inspect PREQSTATION OAuth credentials");
  }

  const oauthCache = await readOauthCache(oauthPath);
  const envToken = normalizeString(env?.PREQSTATION_TOKEN);
  if (envToken) {
    return {
      authenticated: true,
      auth_source: "env_token",
      oauth_cache_exists: Boolean(oauthCache),
    };
  }

  return {
    authenticated: Boolean(resolveAccessToken({ env, oauthCache })),
    auth_source: resolveAccessToken({ env, oauthCache }) ? "oauth_cache" : null,
    oauth_cache_exists: Boolean(oauthCache),
  };
}

export async function logoutPreqstation({ oauthPath } = {}) {
  if (!normalizeString(oauthPath)) {
    throw new Error("oauthPath is required to remove PREQSTATION OAuth credentials");
  }
  await fs.rm(oauthPath, { force: true });
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${text || response.statusText}`);
  }
  return text ? JSON.parse(text) : null;
}

async function discoverOAuthMetadata({ serverUrl, fetchFn }) {
  const metadataUrl = `${normalizePreqstationServerUrl(serverUrl)}/.well-known/oauth-authorization-server`;
  const response = await fetchFn(metadataUrl, {
    headers: { accept: "application/json" },
  });
  return readJsonResponse(response, "OAuth discovery");
}

async function registerOAuthClient({ metadata, redirectUri, fetchFn }) {
  const registrationEndpoint = normalizeString(metadata?.registration_endpoint);
  if (!registrationEndpoint) {
    throw new Error("PREQSTATION OAuth server does not advertise dynamic client registration");
  }

  const response = await fetchFn(registrationEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "PREQSTATION Dispatch Channel",
    }),
  });
  return readJsonResponse(response, "OAuth client registration");
}

function createCallbackServer({ state, timeoutMs = DEFAULT_OAUTH_TIMEOUT_MS }) {
  let server;
  let timeout;

  const waitForCode = new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/callback") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const returnedState = requestUrl.searchParams.get("state");

      if (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("PREQSTATION login failed. You can close this tab.");
        reject(new Error(`PREQSTATION OAuth failed: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("Invalid PREQSTATION login response. You can close this tab.");
        reject(new Error("Invalid PREQSTATION OAuth callback"));
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>PREQSTATION</title><p>PREQSTATION login complete. You can close this tab.</p>");
      resolve(code);
    });

    server.once("error", reject);
    timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for PREQSTATION OAuth login"));
    }, timeoutMs);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to open PREQSTATION OAuth callback server"));
        return;
      }
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        waitForCode: waitForCode.finally(() => {
          clearTimeout(timeout);
          server.close();
        }),
      });
    });
  });
}

function openBrowserUrl(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function exchangeAuthorizationCode({
  metadata,
  clientInformation,
  code,
  codeVerifier,
  redirectUri,
  fetchFn,
}) {
  const tokenEndpoint = normalizeString(metadata?.token_endpoint);
  if (!tokenEndpoint) {
    throw new Error("PREQSTATION OAuth server does not advertise a token endpoint");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientInformation.client_id,
    code_verifier: codeVerifier,
  });

  const response = await fetchFn(tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return readJsonResponse(response, "OAuth token exchange");
}

async function loginWithOAuth({
  serverUrl,
  oauthPath,
  fetchFn,
  openUrlFn = openBrowserUrl,
  onLoginUrl,
}) {
  const metadata = await discoverOAuthMetadata({ serverUrl, fetchFn });
  const state = base64Url(crypto.randomBytes(16));
  const { redirectUri, waitForCode } = await createCallbackServer({ state });
  const clientInformation = await registerOAuthClient({
    metadata,
    redirectUri,
    fetchFn,
  });
  const { verifier, challenge } = createPkce();
  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientInformation.client_id);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);

  onLoginUrl?.(authorizationUrl.toString());
  try {
    openUrlFn(authorizationUrl.toString());
  } catch {
    // The caller already received the login URL; keep the callback server open
    // so the user can paste it into a browser manually.
  }

  const code = await waitForCode;
  const tokens = await exchangeAuthorizationCode({
    metadata,
    clientInformation,
    code,
    codeVerifier: verifier,
    redirectUri,
    fetchFn,
  });
  const oauthCache = {
    discoveryState: {
      authorizationServerUrl: serverUrl,
      authorizationServerMetadata: metadata,
    },
    clientInformation,
    codeVerifier: verifier,
    tokens,
  };
  await writeOauthCache(oauthPath, oauthCache);
  return oauthCache;
}

export async function loginPreqstation({
  serverUrl,
  oauthPath,
  env = process.env,
  fetchFn = globalThis.fetch,
  openUrlFn = openBrowserUrl,
  onLoginUrl,
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is required to connect to PREQSTATION OAuth");
  }
  if (!normalizeString(oauthPath)) {
    throw new Error("oauthPath is required to store PREQSTATION OAuth credentials");
  }
  return loginWithOAuth({
    serverUrl: normalizePreqstationServerUrl(serverUrl),
    oauthPath,
    fetchFn,
    openUrlFn,
    onLoginUrl,
  });
}

function parseServerSentEvent(text) {
  const data = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n")
    .trim();
  return data ? JSON.parse(data) : null;
}

async function parseMcpResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || `MCP request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (!text) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseServerSentEvent(text);
  }
  return JSON.parse(text);
}

async function postMcpRequest({ mcpUrl, token, sessionId, request, fetchFn }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const response = await fetchFn(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  const payload = await parseMcpResponse(response);
  if (payload?.error) {
    throw new Error(payload.error.message ?? "PREQSTATION MCP request failed");
  }
  return {
    payload,
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
  };
}

function extractToolJson(result) {
  if (result?.structuredContent) {
    return result.structuredContent;
  }

  const textContent = (result?.content ?? []).find(
    (entry) => entry?.type === "text" && normalizeString(entry.text),
  );
  if (!textContent) {
    return result;
  }
  return JSON.parse(textContent.text);
}

function normalizeProjectEntry(project) {
  const projectKey = normalizeString(
    project?.projectKey ?? project?.project_key ?? project?.key ?? project?.id,
  ).toUpperCase();
  const repoUrl = normalizeString(
    project?.repoUrl ??
      project?.repo_url ??
      project?.repositoryUrl ??
      project?.repository_url ??
      project?.githubUrl ??
      project?.github_url,
  );

  if (!projectKey || !repoUrl) {
    return null;
  }
  return { projectKey, repoUrl };
}

export function normalizePreqstationProjects(payload) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.projects)
      ? payload.projects
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return source.map(normalizeProjectEntry).filter(Boolean);
}

async function callListProjects({ mcpUrl, token, fetchFn }) {
  const result = await callMcpTool({
    mcpUrl,
    token,
    fetchFn,
    toolName: "preq_list_projects",
    toolArguments: {},
  });

  return normalizePreqstationProjects(result);
}

async function callMcpTool({ mcpUrl, token, fetchFn, toolName, toolArguments }) {
  const initialized = await postMcpRequest({
    mcpUrl,
    token,
    fetchFn,
    request: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "preqstation-cli",
          version: "0.0.0",
        },
      },
    },
  });
  const sessionId = initialized.sessionId;

  await postMcpRequest({
    mcpUrl,
    token,
    sessionId,
    fetchFn,
    request: {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
  });

  const result = await postMcpRequest({
    mcpUrl,
    token,
    sessionId,
    fetchFn,
    request: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArguments,
      },
    },
  });

  return extractToolJson(result.payload?.result);
}

export async function fetchPreqstationProjectsFromMcp({
  serverUrl,
  oauthPath,
  env = process.env,
  fetchFn = globalThis.fetch,
  openUrlFn = openBrowserUrl,
  onLoginUrl,
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is required to connect to PREQSTATION MCP");
  }
  if (!normalizeString(oauthPath)) {
    throw new Error("oauthPath is required to store PREQSTATION OAuth credentials");
  }
  const normalizedServerUrl = normalizePreqstationServerUrl(serverUrl);
  const mcpUrl = buildPreqstationMcpUrl(normalizedServerUrl);
  let oauthCache = await readOauthCache(oauthPath);
  let token = resolveAccessToken({ env, oauthCache });

  if (!token) {
    oauthCache = await loginWithOAuth({
      serverUrl: normalizedServerUrl,
      oauthPath,
      fetchFn,
      openUrlFn,
      onLoginUrl,
    });
    token = resolveAccessToken({ env, oauthCache });
  }

  try {
    return await callListProjects({ mcpUrl, token, fetchFn });
  } catch (error) {
    if (error?.status !== 401 || env?.PREQSTATION_TOKEN) {
      throw error;
    }
  }

  oauthCache = await loginWithOAuth({
    serverUrl: normalizedServerUrl,
    oauthPath,
    fetchFn,
    openUrlFn,
    onLoginUrl,
  });
  token = resolveAccessToken({ env, oauthCache });
  return callListProjects({ mcpUrl, token, fetchFn });
}

export async function callPreqstationMcpTool({
  serverUrl,
  oauthPath,
  toolName,
  toolArguments = {},
  env = process.env,
  fetchFn = globalThis.fetch,
  openUrlFn = openBrowserUrl,
  onLoginUrl,
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is required to connect to PREQSTATION MCP");
  }
  if (!normalizeString(oauthPath)) {
    throw new Error("oauthPath is required to store PREQSTATION OAuth credentials");
  }
  const normalizedToolName = normalizeString(toolName);
  if (!/^[a-zA-Z0-9_.:-]+$/u.test(normalizedToolName)) {
    throw new Error("PREQSTATION MCP tool name is invalid");
  }

  const normalizedServerUrl = normalizePreqstationServerUrl(serverUrl);
  const mcpUrl = buildPreqstationMcpUrl(normalizedServerUrl);
  let oauthCache = await readOauthCache(oauthPath);
  let token = resolveAccessToken({ env, oauthCache });

  if (!token) {
    oauthCache = await loginWithOAuth({
      serverUrl: normalizedServerUrl,
      oauthPath,
      fetchFn,
      openUrlFn,
      onLoginUrl,
    });
    token = resolveAccessToken({ env, oauthCache });
  }

  try {
    return await callMcpTool({
      mcpUrl,
      token,
      fetchFn,
      toolName: normalizedToolName,
      toolArguments,
    });
  } catch (error) {
    if (error?.status !== 401 || env?.PREQSTATION_TOKEN) {
      throw error;
    }
  }

  oauthCache = await loginWithOAuth({
    serverUrl: normalizedServerUrl,
    oauthPath,
    fetchFn,
    openUrlFn,
    onLoginUrl,
  });
  token = resolveAccessToken({ env, oauthCache });
  return callMcpTool({
    mcpUrl,
    token,
    fetchFn,
    toolName: normalizedToolName,
    toolArguments,
  });
}
