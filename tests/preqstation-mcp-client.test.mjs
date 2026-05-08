import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fetchPreqstationProjectsFromMcp } from "../src/preqstation-mcp-client.mjs";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

test("fetchPreqstationProjectsFromMcp calls preq_list_projects with a cached OAuth token", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-mcp-client-"));
  const oauthPath = path.join(tempDir, "oauth.json");
  await fs.writeFile(
    oauthPath,
    JSON.stringify({
      discoveryState: {
        authorizationServerUrl: "https://preq.example.com",
      },
      clientInformation: {
        client_id: "client-123",
      },
      tokens: {
        access_token: "token-123",
        token_type: "bearer",
      },
    }),
  );

  const calls = [];
  const projects = await fetchPreqstationProjectsFromMcp({
    serverUrl: "https://preq.example.com",
    oauthPath,
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      assert.equal(options.headers.Authorization, "Bearer token-123");

      const request = JSON.parse(options.body);
      if (request.method === "initialize") {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              serverInfo: { name: "preqstation", version: "test" },
            },
          },
          { headers: { "mcp-session-id": "session-123" } },
        );
      }

      if (request.method === "notifications/initialized") {
        assert.equal(options.headers["Mcp-Session-Id"], "session-123");
        return new Response("", { status: 202 });
      }

      assert.equal(request.method, "tools/call");
      assert.equal(request.params.name, "preq_list_projects");
      assert.equal(options.headers["Mcp-Session-Id"], "session-123");
      return jsonResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                projects: [
                  {
                    projectKey: "PROJ",
                    repoUrl: "https://github.com/sonim1/projects-manager",
                  },
                ],
              }),
            },
          ],
        },
      });
    },
  });

  assert.deepEqual(projects, [
    {
      projectKey: "PROJ",
      repoUrl: "https://github.com/sonim1/projects-manager",
    },
  ]);
  assert.equal(calls.length, 3);
});

test("fetchPreqstationProjectsFromMcp opens OAuth login when no token is cached", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-mcp-oauth-"));
  const oauthPath = path.join(tempDir, "oauth.json");

  const calls = [];
  const projects = await fetchPreqstationProjectsFromMcp({
    serverUrl: "https://preq.example.com",
    oauthPath,
    openUrlFn: (loginUrl) => {
      const url = new URL(loginUrl);
      const callbackUrl = new URL(url.searchParams.get("redirect_uri"));
      callbackUrl.searchParams.set("code", "auth-code");
      callbackUrl.searchParams.set("state", url.searchParams.get("state"));
      setTimeout(() => {
        fetch(callbackUrl).catch(() => {});
      }, 0);
    },
    fetchFn: async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (String(url).endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          issuer: "https://preq.example.com",
          authorization_endpoint: "https://preq.example.com/api/oauth/authorize",
          token_endpoint: "https://preq.example.com/api/oauth/token",
          registration_endpoint: "https://preq.example.com/api/oauth/register",
        });
      }

      if (String(url).endsWith("/api/oauth/register")) {
        return jsonResponse({ client_id: "client-123" });
      }

      if (String(url).endsWith("/api/oauth/token")) {
        const body = new URLSearchParams(options.body);
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("code"), "auth-code");
        return jsonResponse({
          access_token: "new-token",
          token_type: "bearer",
        });
      }

      assert.equal(options.headers.Authorization, "Bearer new-token");
      const request = JSON.parse(options.body);
      if (request.method === "initialize") {
        return jsonResponse({ jsonrpc: "2.0", id: request.id, result: {} }, {
          headers: { "mcp-session-id": "session-123" },
        });
      }
      if (request.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: {
            projects: [
              {
                key: "PROJ",
                repositoryUrl: "https://github.com/sonim1/projects-manager",
              },
            ],
          },
        },
      });
    },
  });

  assert.deepEqual(projects, [
    {
      projectKey: "PROJ",
      repoUrl: "https://github.com/sonim1/projects-manager",
    },
  ]);
  assert.equal(JSON.parse(await fs.readFile(oauthPath, "utf8")).tokens.access_token, "new-token");
  assert.equal(calls.length, 6);
});
