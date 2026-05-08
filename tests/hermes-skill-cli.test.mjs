import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDispatcherCli } from "../src/cli/preqstation-dispatcher.mjs";

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("install hermes copies the bundled PREQ dispatch skill with provenance", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-install-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install", "hermes"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { HERMES_HOME: hermesHome },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  const skillFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation_dispatch",
    "SKILL.md",
  );
  const metadataFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation_dispatch",
    ".preqstation-dispatcher.json",
  );

  assert.equal(exitCode, 0);
  const skillText = await fs.readFile(skillFile, "utf8");
  assert.match(skillText, /name: preqstation_dispatch/);
  assert.match(skillText, /preqstation run/);
  assert.match(skillText, /comment_id/);
  assert.match(skillText, /--comment-id/);

  const metadata = await readJson(metadataFile);
  assert.equal(metadata.package, "@sonim1/preqstation");
  assert.equal(metadata.source, "bundled");
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/u);

  const result = JSON.parse(stdout.join(""));
  assert.equal(result.ok, true);
  assert.equal(result.target, "hermes");
  assert.equal(result.action, "installed");
  assert.equal(result.skill_file, skillFile);
  assert.equal(result.metadata_file, metadataFile);
});

test("install runs the interactive wizard when no target is provided", async () => {
  const stdout = [];
  let called = false;

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    runInstallWizard: async () => {
      called = true;
      return {
        ok: true,
        action: "installed",
        interactive: true,
        install_targets: ["hermes"],
        runtime_engines: ["codex"],
        preqstation_server_url: "https://preq.example.com",
        mcp_url: "https://preq.example.com/mcp",
        results: [
          { ok: true, target: "hermes", action: "installed" },
          { ok: true, target: "codex", action: "mcp_installed" },
        ],
      };
    },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  const result = JSON.parse(stdout.join(""));

  assert.equal(exitCode, 0);
  assert.equal(called, true);
  assert.deepEqual(result.install_targets, ["hermes"]);
  assert.deepEqual(result.runtime_engines, ["codex"]);
  assert.equal(result.mcp_url, "https://preq.example.com/mcp");
});

test("install renders a friendly summary for interactive tty output", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 240 },
    stderr: { write: () => {} },
    env: { FORCE_COLOR: "1" },
    runInstallWizard: async () => ({
      ok: true,
      action: "installed",
      interactive: true,
      install_targets: ["openclaw", "hermes"],
      runtime_engines: ["claude-code", "codex"],
      preqstation_server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      results: [
        {
          ok: true,
          target: "openclaw",
          action: "updated",
          installed_version: "0.1.19",
          package_version: "0.1.20",
          restart_command: "openclaw gateway restart",
        },
        { ok: true, target: "hermes", action: "already_current", version: "0.1.20" },
        { ok: true, target: "claude-code", action: "already_current", installed_version: "0.1.37" },
        { ok: true, target: "claude-code", action: "mcp_already_configured" },
        { ok: true, target: "codex", action: "installed", latest_version: "0.1.37" },
      ],
    }),
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);

  assert.equal(exitCode, 0);
  assert.match(plain, /Install summary/);
  assert.match(plain, /Request entrypoints/);
  assert.match(plain, /OpenClaw\s+updated\s+0\.1\.19 -> 0\.1\.20, restart: openclaw gateway restart/);
  assert.match(plain, /Hermes Agent\s+current\s+0\.1\.20/);
  assert.match(plain, /Agent runtimes/);
  assert.match(plain, /Claude Code\s+current\s+0\.1\.37/);
  assert.match(plain, /Codex\s+installed\s+0\.1\.37/);
  assert.match(plain, /MCP/);
  assert.match(plain, /Endpoint\s+https:\/\/preq\.example\.com\/mcp/);
  assert.match(plain, /Claude Code MCP\s+configured/);
  assert.match(plain, /Install complete/);
  assert.match(rendered, /\u001B\[38;2;34;211;238mOpenClaw\u001B\[0m/);
  assert.match(rendered, /\u001B\[38;2;16;163;127mCodex\u001B\[0m/);
  assert.match(rendered, /\u001B\[32mupdated\u001B\[0m/);
  assert.doesNotMatch(plain, /^\{/m);
});

test("install summary surfaces when the local repo is newer than the published OpenClaw plugin", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 240 },
    stderr: { write: () => {} },
    runInstallWizard: async () => ({
      ok: true,
      action: "installed",
      interactive: true,
      install_targets: ["openclaw"],
      runtime_engines: [],
      preqstation_server_url: null,
      mcp_url: null,
      results: [
        {
          ok: true,
          target: "openclaw",
          action: "already_current",
          installed_version: "0.1.21",
          package_version: "0.1.21",
          local_package_version: "0.1.24",
          restart_command: "openclaw gateway restart",
        },
      ],
    }),
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);

  assert.equal(exitCode, 0);
  assert.match(plain, /OpenClaw\s+current\s+0\.1\.21, restart: openclaw gateway restart, local repo: 0\.1\.24 unpublished/);
});

test("install returns a non-zero exit code when the interactive wizard reports failed runtime setup", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    runInstallWizard: async () => ({
      ok: false,
      action: "installed",
      interactive: true,
      install_targets: ["hermes"],
      runtime_engines: ["codex"],
      preqstation_server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      results: [
        { ok: true, target: "hermes", action: "installed" },
        {
          ok: false,
          target: "codex",
          action: "failed",
          error: "preqstation skill did not become enabled for Codex after install",
        },
      ],
    }),
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(exitCode, 1);
  assert.equal(result.ok, false);
});

test("sync hermes refuses user-modified skills unless forced", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-sync-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const env = { HERMES_HOME: hermesHome };
  const noopDispatch = async () => {
    throw new Error("skill install must not dispatch");
  };

  assert.equal(
    await runDispatcherCli({
      argv: ["install", "hermes"],
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      env,
      dispatchPreqRun: noopDispatch,
    }),
    0,
  );

  const skillFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation_dispatch",
    "SKILL.md",
  );
  await fs.appendFile(skillFile, "\n# local note\n", "utf8");

  const stderr = [];
  const rejectedExitCode = await runDispatcherCli({
    argv: ["sync", "hermes"],
    stdout: { write: () => {} },
    stderr: { write: (value) => stderr.push(value) },
    env,
    dispatchPreqRun: noopDispatch,
  });

  assert.equal(rejectedExitCode, 1);
  assert.match(stderr.join(""), /Hermes skill has local changes/);

  const stdout = [];
  const forcedExitCode = await runDispatcherCli({
    argv: ["sync", "hermes", "--force"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env,
    dispatchPreqRun: noopDispatch,
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(forcedExitCode, 0);
  assert.equal(result.action, "updated");
  assert.match(result.backup_file, /SKILL\.md\.bak-/u);
  assert.match(await fs.readFile(skillFile, "utf8"), /name: preqstation_dispatch/);
  assert.doesNotMatch(await fs.readFile(skillFile, "utf8"), /# local note/);
});

test("status hermes reports whether the installed skill is current", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-status-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const env = { HERMES_HOME: hermesHome };
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["status", "hermes"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env,
    dispatchPreqRun: async () => {
      throw new Error("status must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    target: "hermes",
    installed: false,
    current: false,
    user_modified: false,
    skill_file: path.join(
      hermesHome,
      "skills",
      "preqstation",
      "preqstation_dispatch",
      "SKILL.md",
    ),
    metadata_file: path.join(
      hermesHome,
      "skills",
      "preqstation",
      "preqstation_dispatch",
      ".preqstation-dispatcher.json",
    ),
  });
});

test("update refreshes installed surfaces without installing missing ones", async () => {
  const stdout = [];
  const runtimeCalls = [];
  const runtimeExecutableCalls = [];

  const exitCode = await runDispatcherCli({
    argv: ["update"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: false,
      current: false,
      user_modified: false,
      skill_file: "/tmp/hermes/SKILL.md",
      metadata_file: "/tmp/hermes/.preqstation-dispatcher.json",
    }),
    installOpenClawPluginFn: async ({ updateOnly }) => ({
      ok: true,
      target: "openclaw",
      action: updateOnly ? "updated" : "installed",
      installed_version: "0.1.20",
      package_version: "0.1.22",
      restart_command: "openclaw gateway restart",
    }),
    installRuntimeWorkerSupportFn: async ({ runtimes, installMissing }) => {
      runtimeCalls.push({ runtimes, installMissing });
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [{ ok: true, target: runtime, action: "already_current", installed_version: "0.1.38" }];
      }
      if (runtime === "codex") {
        return [{ ok: true, target: runtime, action: "updated", installed_version: "0.1.37", latest_version: "0.1.38" }];
      }
      return [{ ok: true, target: runtime, action: "not_installed", latest_version: "0.1.38" }];
    },
    inspectRuntimeExecutableHealthFn: async ({ runtimes, launchHosts }) => {
      runtimeExecutableCalls.push({ runtimes, launchHosts });
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "claude",
            resolved_path: "/Users/kendrick/.local/bin/claude",
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "codex",
            resolved_path: "/Users/kendrick/.local/bin/codex",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          category: "runtime_executable",
          action: "needs_attention",
          executable: "gemini",
          resolved_path: "/Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini",
          alternate_path: "/Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini",
          error:
            "OpenClaw, Hermes Agent dispatches may not inherit /Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini (session-scoped fnm path). Expose /Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini via /usr/local/bin/gemini or another stable PATH entry.",
        },
      ];
    },
    inspectRuntimeMcpServersFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "Connected",
            auth: null,
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "enabled",
            auth: "OAuth",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          action: "mcp_missing",
          server_url: null,
          mcp_url: null,
          connection_status: null,
          auth: null,
        },
      ];
    },
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    dispatchPreqRun: async () => {
      throw new Error("update must not dispatch");
    },
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(exitCode, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.host_targets, ["openclaw", "hermes"]);
  assert.deepEqual(result.runtime_engines, ["claude-code", "codex", "gemini-cli"]);
  assert.deepEqual(runtimeCalls, [
    { runtimes: ["claude-code"], installMissing: false },
    { runtimes: ["codex"], installMissing: false },
    { runtimes: ["gemini-cli"], installMissing: false },
  ]);
  assert.deepEqual(runtimeExecutableCalls, [
    { runtimes: ["claude-code"], launchHosts: ["openclaw", "hermes"] },
    { runtimes: ["codex"], launchHosts: ["openclaw", "hermes"] },
    { runtimes: ["gemini-cli"], launchHosts: ["openclaw", "hermes"] },
  ]);
  assert.deepEqual(
    result.results.map((entry) => ({ target: entry.target, action: entry.action })),
    [
      { target: "openclaw", action: "updated" },
      { target: "hermes", action: "not_installed" },
      { target: "claude-code", action: "already_current" },
      { target: "codex", action: "updated" },
      { target: "gemini-cli", action: "not_installed" },
      { target: "claude-code", action: "ready" },
      { target: "codex", action: "ready" },
      { target: "gemini-cli", action: "needs_attention" },
      { target: "claude-code", action: "mcp_configured" },
      { target: "codex", action: "mcp_configured" },
      { target: "gemini-cli", action: "mcp_missing" },
    ],
  );
  assert.equal(result.server_url, "https://preq.example.com");
  assert.equal(result.mcp_url, "https://preq.example.com/mcp");
});

test("update renders a friendly summary for interactive tty output", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["update"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 240 },
    stderr: { write: () => {} },
    env: { FORCE_COLOR: "1" },
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: true,
    }),
    syncHermesSkillFn: async () => ({
      ok: true,
      target: "hermes",
      action: "already_current",
      version: "0.1.22",
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "not_installed",
      package_version: "0.1.22",
    }),
    installRuntimeWorkerSupportFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [{ ok: true, target: runtime, action: "unavailable", error: "claude command not found" }];
      }
      if (runtime === "codex") {
        return [{ ok: true, target: runtime, action: "updated", installed_version: "0.1.37", latest_version: "0.1.38" }];
      }
      return [
        {
          ok: true,
          target: runtime,
          action: "not_enabled",
          installed_version: "0.1.38",
          latest_version: "0.1.38",
          configured_agents: ["Claude Code"],
        },
      ];
    },
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "claude",
            resolved_path: "/Users/kendrick/.local/bin/claude",
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "codex",
            resolved_path: "/Users/kendrick/.local/bin/codex",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          category: "runtime_executable",
          action: "needs_attention",
          executable: "gemini",
          resolved_path: "/Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini",
          alternate_path: "/Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini",
          error:
            "OpenClaw, Hermes Agent dispatches may not inherit /Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini (session-scoped fnm path). Expose /Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini via /usr/local/bin/gemini or another stable PATH entry.",
        },
      ];
    },
    inspectRuntimeMcpServersFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "Connected",
            auth: null,
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "enabled",
            auth: "OAuth",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          action: "mcp_configured",
          server_url: "https://preq.example.com",
          mcp_url: "https://preq.example.com/mcp",
          connection_status: "Disconnected",
          auth: null,
        },
      ];
    },
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    dispatchPreqRun: async () => {
      throw new Error("update must not dispatch");
    },
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);
  assert.equal(exitCode, 0);
  assert.match(plain, /Update summary/);
  assert.match(plain, /Update complete/);
  assert.match(plain, /Settings/);
  assert.match(plain, /Server URL\s+https:\/\/preq\.example\.com/);
  assert.match(plain, /MCP endpoint\s+https:\/\/preq\.example\.com\/mcp/);
  assert.match(plain, /Request entrypoints/);
  assert.match(plain, /OpenClaw\s+not installed/);
  assert.match(plain, /Hermes Agent\s+current\s+0\.1\.22/);
  assert.match(plain, /Agent runtimes/);
  assert.match(plain, /Claude Code\s+unavailable\s+claude command not found/);
  assert.match(plain, /Claude Code CLI\s+ready\s+\/Users\/kendrick\/\.local\/bin\/claude/);
  assert.match(plain, /Codex\s+updated\s+0\.1\.37 -> 0\.1\.38/);
  assert.match(plain, /Codex CLI\s+ready\s+\/Users\/kendrick\/\.local\/bin\/codex/);
  assert.match(plain, /Gemini CLI\s+not enabled\s+0\.1\.38, installed globally, not enabled for Gemini CLI/);
  assert.match(plain, /Gemini CLI\s+attention/);
  assert.match(plain, /\/Users\/kendrick\/\.local\/state\/fnm_multishells\/12345\/bin\/gemini/);
  assert.match(plain, /stable path: \/Users\/kendrick\/\.local\/share\/fnm\/node-versions\/v24\.13\.0\/installation\/bin\/gemini/);
  assert.match(plain, /OpenClaw, Hermes[\s\S]*Agent dispatches may not/);
  assert.match(plain, /MCP/);
  assert.match(plain, /Claude Code MCP\s+configured\s+https:\/\/preq\.example\.com\/mcp, status: Connected/);
  assert.match(plain, /Codex MCP\s+configured\s+https:\/\/preq\.example\.com\/mcp, status: enabled, auth: OAuth/);
  assert.match(plain, /Gemini CLI MCP\s+configured\s+https:\/\/preq\.example\.com\/mcp, status: Disconnected/);
  assert.match(rendered, /\u001B\[38;2;217;119;87mClaude Code\u001B\[0m/);
  assert.match(rendered, /\u001B\[38;2;71;150;227mGemini CLI\u001B\[0m/);
  assert.match(rendered, /\u001B\[33mattention\u001B\[0m/);
  assert.doesNotMatch(plain, /^\{/m);
});
