import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPreqstationMcpUrl,
  inspectRuntimeMcpServers,
  installRuntimeMcpServers,
  normalizePreqstationServerUrl,
  resolveDefaultPreqstationServerUrl,
  uninstallRuntimeMcpServers,
} from "../src/runtime-mcp-installer.mjs";

test("normalizePreqstationServerUrl trims trailing slashes and accepts localhost http", () => {
  assert.equal(
    normalizePreqstationServerUrl("https://preq.example.com///"),
    "https://preq.example.com",
  );
  assert.equal(
    normalizePreqstationServerUrl("http://localhost:3000/"),
    "http://localhost:3000",
  );
  assert.equal(
    buildPreqstationMcpUrl("https://preq.example.com/"),
    "https://preq.example.com/mcp",
  );
});

test("installRuntimeMcpServers registers the PREQ MCP endpoint for selected runtimes", async () => {
  const calls = [];

  const results = await installRuntimeMcpServers({
    runtimes: ["claude-code", "codex", "gemini-cli"],
    serverUrl: "https://preq.example.com/",
    env: { PATH: process.env.PATH },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "claude" && args.join(" ") === "mcp get preqstation") {
        const error = new Error('No MCP server found with name: "preqstation".');
        error.stderr = 'No MCP server found with name: "preqstation".';
        throw error;
      }
      if (command === "codex" && args.join(" ") === "mcp get preqstation") {
        const error = new Error("Error: No MCP server named 'preqstation' found.");
        error.stderr = "Error: No MCP server named 'preqstation' found.";
        throw error;
      }
      if (command === "gemini" && args.join(" ") === "mcp list") {
        return {
          stdout: "Loaded cached credentials.\nNo MCP servers configured.\n",
          stderr: "",
        };
      }
    },
  });

  assert.deepEqual(calls, [
    {
      command: "claude",
      args: ["mcp", "get", "preqstation"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "claude",
      args: [
        "mcp",
        "add",
        "-s",
        "user",
        "--transport",
        "http",
        "preqstation",
        "https://preq.example.com/mcp",
      ],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "codex",
      args: ["mcp", "get", "preqstation"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "codex",
      args: [
        "mcp",
        "add",
        "preqstation",
        "--url",
        "https://preq.example.com/mcp",
      ],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "gemini",
      args: ["mcp", "list"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "gemini",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "--transport",
        "http",
        "preqstation",
        "https://preq.example.com/mcp",
      ],
      options: { env: { PATH: process.env.PATH } },
    },
  ]);
  assert.deepEqual(
    results.map((result) => ({
      target: result.target,
      action: result.action,
      mcp_url: result.mcp_url,
    })),
    [
      {
        target: "claude-code",
        action: "mcp_installed",
        mcp_url: "https://preq.example.com/mcp",
      },
      {
        target: "codex",
        action: "mcp_installed",
        mcp_url: "https://preq.example.com/mcp",
      },
      {
        target: "gemini-cli",
        action: "mcp_installed",
        mcp_url: "https://preq.example.com/mcp",
      },
    ],
  );
});

test("uninstallRuntimeMcpServers removes configured PREQ MCP endpoints", async () => {
  const calls = [];

  const results = await uninstallRuntimeMcpServers({
    runtimes: ["claude-code", "codex", "gemini-cli"],
    env: { PATH: process.env.PATH },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "claude" && args.join(" ") === "mcp get preqstation") {
        return { stdout: "URL: https://preq.example.com/mcp\n", stderr: "" };
      }
      if (command === "codex" && args.join(" ") === "mcp get preqstation") {
        return { stdout: "url: https://preq.example.com/mcp\n", stderr: "" };
      }
      if (command === "gemini" && args.join(" ") === "mcp list") {
        return { stdout: "preqstation: https://preq.example.com/mcp\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    {
      command: "claude",
      args: ["mcp", "get", "preqstation"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "claude",
      args: ["mcp", "remove", "-s", "user", "preqstation"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "codex",
      args: ["mcp", "get", "preqstation"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "codex",
      args: ["mcp", "remove", "preqstation"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "gemini",
      args: ["mcp", "list"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "gemini",
      args: ["mcp", "remove", "--scope", "user", "preqstation"],
      options: { env: { PATH: process.env.PATH } },
    },
  ]);
  assert.deepEqual(results, [
    {
      ok: true,
      target: "claude-code",
      action: "mcp_removed",
      mcp_url: "https://preq.example.com/mcp",
    },
    {
      ok: true,
      target: "codex",
      action: "mcp_removed",
      mcp_url: "https://preq.example.com/mcp",
    },
    {
      ok: true,
      target: "gemini-cli",
      action: "mcp_removed",
      mcp_url: "https://preq.example.com/mcp",
    },
  ]);
});

test("installRuntimeMcpServers skips runtimes that already point at the requested PREQ MCP URL", async () => {
  const calls = [];

  const results = await installRuntimeMcpServers({
    runtimes: ["claude-code", "codex"],
    serverUrl: "https://preq.example.com/",
    env: { PATH: process.env.PATH },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "claude" && args.join(" ") === "mcp get preqstation") {
        return {
          stdout: "preqstation:\n  URL: https://preq.example.com/mcp\n",
          stderr: "",
        };
      }
      if (command === "codex" && args.join(" ") === "mcp get preqstation") {
        return {
          stdout: "preqstation\n  url: https://preq.example.com/mcp\n",
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "claude", args: ["mcp", "get", "preqstation"] },
      { command: "codex", args: ["mcp", "get", "preqstation"] },
    ],
  );
  assert.deepEqual(
    results.map((result) => ({
      target: result.target,
      action: result.action,
      mcp_url: result.mcp_url,
    })),
    [
      {
        target: "claude-code",
        action: "mcp_already_configured",
        mcp_url: "https://preq.example.com/mcp",
      },
      {
        target: "codex",
        action: "mcp_already_configured",
        mcp_url: "https://preq.example.com/mcp",
      },
    ],
  );
});

test("resolveDefaultPreqstationServerUrl prefers an explicit PREQSTATION_SERVER_URL env override", async () => {
  const serverUrl = await resolveDefaultPreqstationServerUrl({
    runtimes: ["claude-code", "codex"],
    env: {
      PATH: process.env.PATH,
      PREQSTATION_SERVER_URL: "https://env-preq.example.com/",
    },
    exec: async () => {
      throw new Error("should not inspect runtimes when env already provides the server URL");
    },
  });

  assert.equal(serverUrl, "https://env-preq.example.com");
});

test("resolveDefaultPreqstationServerUrl falls back to the shared dispatcher OAuth cache", async () => {
  const serverUrl = await resolveDefaultPreqstationServerUrl({
    runtimes: ["claude-code", "codex"],
    env: {
      PATH: process.env.PATH,
      HOME: "/Users/tester",
    },
    readFile: async (filePath, encoding) => {
      assert.equal(filePath, "/Users/tester/.preqstation-dispatch/oauth.json");
      assert.equal(encoding, "utf8");
      return JSON.stringify({
        discoveryState: {
          authorizationServerUrl: "https://oauth-preq.example.com/",
        },
      });
    },
    exec: async () => {
      throw new Error("should not inspect runtime MCP config when shared OAuth cache already provides the server URL");
    },
  });

  assert.equal(serverUrl, "https://oauth-preq.example.com");
});

test("resolveDefaultPreqstationServerUrl infers a shared server URL from existing runtime MCP registrations", async () => {
  const calls = [];

  const serverUrl = await resolveDefaultPreqstationServerUrl({
    runtimes: ["claude-code", "codex", "gemini-cli"],
    env: { PATH: process.env.PATH },
    readFile: async () => {
      throw new Error("no shared oauth cache");
    },
    exec: async (command, args) => {
      calls.push({ command, args });
      if (command === "claude" && args.join(" ") === "mcp get preqstation") {
        return {
          stdout: "preqstation:\n  URL: https://preq.example.com/mcp\n",
          stderr: "",
        };
      }
      if (command === "codex" && args.join(" ") === "mcp get preqstation") {
        return {
          stdout: "preqstation\n  url: https://preq.example.com/mcp\n",
          stderr: "",
        };
      }
      if (command === "gemini" && args.join(" ") === "mcp list") {
        return {
          stdout: "preqstation  enabled\n",
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.equal(serverUrl, "https://preq.example.com");
  assert.deepEqual(calls, [
    { command: "claude", args: ["mcp", "get", "preqstation"] },
    { command: "codex", args: ["mcp", "get", "preqstation"] },
    { command: "gemini", args: ["mcp", "list"] },
  ]);
});

test("resolveDefaultPreqstationServerUrl returns null when installed runtimes disagree on the PREQ server URL", async () => {
  const serverUrl = await resolveDefaultPreqstationServerUrl({
    runtimes: ["claude-code", "codex"],
    env: { PATH: process.env.PATH },
    readFile: async () => {
      throw new Error("no shared oauth cache");
    },
    exec: async (command, args) => {
      if (command === "claude" && args.join(" ") === "mcp get preqstation") {
        return {
          stdout: "preqstation:\n  URL: https://preq-a.example.com/mcp\n",
          stderr: "",
        };
      }
      if (command === "codex" && args.join(" ") === "mcp get preqstation") {
        return {
          stdout: "preqstation\n  url: https://preq-b.example.com/mcp\n",
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.equal(serverUrl, null);
});

test("inspectRuntimeMcpServers reports configured runtime MCP endpoints with status details", async () => {
  const calls = [];

  const results = await inspectRuntimeMcpServers({
    runtimes: ["claude-code", "codex", "gemini-cli"],
    env: { PATH: process.env.PATH },
    exec: async (command, args) => {
      calls.push({ command, args });
      if (command === "claude" && args.join(" ") === "mcp get preqstation") {
        return {
          stdout:
            'preqstation:\n  Scope: User config\n  Status: ✓ Connected\n  Type: http\n  URL: https://preq.example.com/mcp\n',
          stderr: "",
        };
      }
      if (command === "codex" && args.join(" ") === "mcp list") {
        return {
          stdout:
            "Name         Url                        Bearer Token Env Var  Status   Auth        \npreqstation  https://preq.example.com/mcp  -                     enabled  OAuth      \n",
          stderr: "",
        };
      }
      if (command === "gemini" && args.join(" ") === "mcp list") {
        return {
          stdout: "",
          stderr:
            "Loaded cached credentials.\nConfigured MCP servers:\n\n✗ preqstation: https://preq.example.com/mcp (http) - Disconnected\n",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(calls, [
    { command: "claude", args: ["mcp", "get", "preqstation"] },
    { command: "codex", args: ["mcp", "list"] },
    { command: "gemini", args: ["mcp", "list"] },
  ]);
  assert.deepEqual(results, [
    {
      ok: true,
      target: "claude-code",
      action: "mcp_configured",
      server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      connection_status: "Connected",
      auth: null,
    },
    {
      ok: true,
      target: "codex",
      action: "mcp_configured",
      server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      connection_status: "enabled",
      auth: "OAuth",
    },
    {
      ok: true,
      target: "gemini-cli",
      action: "mcp_configured",
      server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      connection_status: "Disconnected",
      auth: null,
    },
  ]);
});
