import test from "node:test";
import assert from "node:assert/strict";

import {
  promptInstallPlan,
  runInstallWizard,
} from "../src/install-wizard.mjs";

test("promptInstallPlan collects host and runtime selections with Clack prompt options", async () => {
  const multiselectCalls = [];
  const textCalls = [];

  const plan = await promptInstallPlan({
    inputStream: { isTTY: true },
    outputStream: { write: () => {}, isTTY: true },
    env: { FORCE_COLOR: "1" },
    multiselectPrompt: async (config) => {
      multiselectCalls.push(config);
      if (multiselectCalls.length === 1) {
        return ["openclaw", "hermes"];
      }
      return ["claude-code", "codex"];
    },
    textPrompt: async (config) => {
      textCalls.push(config);
      return "https://preq.example.com/";
    },
    resolveDefaultPreqstationServerUrlFn: async () => "https://saved-preq.example.com",
  });

  assert.deepEqual(plan, {
    installTargets: ["openclaw", "hermes"],
    runtimeEngines: ["claude-code", "codex"],
    preqstationServerUrl: "https://preq.example.com",
    mcpUrl: "https://preq.example.com/mcp",
  });
  assert.match(multiselectCalls[0].message, /request entrypoints/i);
  assert.equal(multiselectCalls[0].required, true);
  assert.deepEqual(multiselectCalls[0].options, [
    {
      label: "OpenClaw",
      value: "openclaw",
      hint: "Install the OpenClaw plugin package",
    },
    {
      label: "Hermes Agent",
      value: "hermes",
      hint: "Install the bundled Hermes preqstation skill",
    },
  ]);
  assert.match(multiselectCalls[1].message, /agent runtimes to set up/i);
  assert.equal(multiselectCalls[1].required, true);
  assert.deepEqual(multiselectCalls[1].options, [
      {
        label: "Claude Code",
        value: "claude-code",
        hint: "Verify the Claude Code CLI path",
      },
      {
        label: "Codex",
        value: "codex",
        hint: "Verify the Codex CLI path",
      },
      {
        label: "Gemini CLI",
        value: "gemini-cli",
        hint: "Verify the Gemini CLI path",
      },
  ]);
  assert.equal(multiselectCalls[0].input.isTTY, true);
  assert.equal(typeof multiselectCalls[0].output.write, "function");
  assert.match(textCalls[0].message, /PREQSTATION server URL/i);
  assert.equal(textCalls[0].placeholder, "https://saved-preq.example.com");
  assert.equal(textCalls[0].initialValue, "https://saved-preq.example.com");
});

test("promptInstallPlan falls back to the placeholder URL when no prior PREQ server URL is known", async () => {
  const inputCalls = [];

  await promptInstallPlan({
    outputStream: { write: () => {}, isTTY: true },
    multiselectPrompt: async () => ["codex"],
    textPrompt: async (config) => {
      inputCalls.push(config);
      return "https://preq.example.com";
    },
    resolveDefaultPreqstationServerUrlFn: async () => null,
  });

  assert.equal(
    inputCalls[0].placeholder,
    "https://your-preqstation-domain.vercel.app",
  );
});

test("runInstallWizard executes selected host installs and runtime CLI setup without MCP by default", async () => {
  const calls = [];
  const output = [];
  const taskGroups = [];
  const taskLabels = [];

  const result = await runInstallWizard({
    env: { PATH: process.env.PATH },
    force: true,
    outputStream: { write: (value) => output.push(value) },
    runTaskGroupFn: async ({ title, tasks }) => {
      taskGroups.push([title, tasks.map((entry) => entry.title)]);
      for (const entry of tasks) {
        taskLabels.push(await entry.task(() => {}));
      }
    },
    promptInstallPlanFn: async () => ({
      installTargets: ["openclaw", "hermes"],
      runtimeEngines: ["codex", "gemini-cli"],
      preqstationServerUrl: "https://preq.example.com",
      mcpUrl: "https://preq.example.com/mcp",
    }),
    installOpenClawPluginFn: async ({ env }) => {
      calls.push(["openclaw", env]);
      return { ok: true, target: "openclaw", action: "installed" };
    },
    syncHermesSkillFn: async ({ env, force }) => {
      calls.push(["hermes", env, force]);
      return { ok: true, target: "hermes", action: "installed" };
    },
    inspectRuntimeExecutableHealthFn: async ({ env, runtimes, launchHosts }) => {
      calls.push(["runtime-cli", env, runtimes, launchHosts]);
      return runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: runtime === "gemini-cli" ? "needs_attention" : "ready",
        executable: runtime === "gemini-cli" ? "gemini" : "codex",
        resolved_path:
          runtime === "gemini-cli"
            ? "/Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini"
            : "/Users/kendrick/.local/bin/codex",
        error:
          runtime === "gemini-cli"
            ? "OpenClaw dispatches may not inherit /Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini (session-scoped fnm path). Expose /Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini via /usr/local/bin/gemini or another stable PATH entry."
            : null,
      }));
    },
    installRuntimeMcpServersFn: async ({ env, runtimes, serverUrl }) => {
      calls.push(["mcp", env, runtimes, serverUrl]);
      return runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "mcp_installed",
      }));
    },
  });

  assert.deepEqual(calls, [
    ["openclaw", { PATH: process.env.PATH }],
    ["hermes", { PATH: process.env.PATH }, true],
    ["runtime-cli", { PATH: process.env.PATH }, ["codex"], ["openclaw", "hermes"]],
    ["runtime-cli", { PATH: process.env.PATH }, ["gemini-cli"], ["openclaw", "hermes"]],
  ]);
  assert.deepEqual(taskGroups, [
    [
      "Request entrypoints",
      ["Install OpenClaw", "Install Hermes Agent"],
    ],
    [
      "Agent runtimes",
      [
        "Check Codex CLI",
        "Check Gemini CLI",
      ],
    ],
  ]);
  assert.deepEqual(taskLabels, [
    "OpenClaw is installed",
    "Hermes Agent is installed",
    "Codex CLI is ready",
    "Gemini CLI needs attention",
  ]);
  assert.deepEqual(result.install_targets, ["openclaw", "hermes"]);
  assert.deepEqual(result.runtime_engines, ["codex", "gemini-cli"]);
  assert.equal(result.with_mcp, false);
  assert.equal(result.mcp_url, null);
  assert.equal(result.results.length, 4);
  assert.match(output.join(""), /PREQSTATION server URL/);
  assert.match(output.join(""), /https:\/\/preq\.example\.com/);
  assert.match(output.join(""), /Request entrypoints/);
  assert.match(output.join(""), /OpenClaw\s+installed/);
  assert.match(output.join(""), /Hermes Agent\s+installed/);
  assert.match(output.join(""), /Agent runtimes/);
  assert.doesNotMatch(output.join(""), /Codex skill\s+installed/);
  assert.match(output.join(""), /Codex CLI\s+ready/);
  assert.doesNotMatch(output.join(""), /Codex MCP\s+registered/);
  assert.doesNotMatch(output.join(""), /Gemini CLI skill\s+installed/);
  assert.match(output.join(""), /Gemini CLI\s+attention/);
  assert.match(output.join(""), /OpenClaw dispatches may not inherit/);
  assert.doesNotMatch(output.join(""), /Gemini CLI MCP\s+registered/);
});

test("runInstallWizard renders a Clack install surface for TTY output", async () => {
  const outputStream = { write: () => {}, isTTY: true };
  const uiEvents = [];
  const taskLogEvents = [];
  const spinnerEvents = [];
  const boxEvents = [];

  const result = await runInstallWizard({
    env: { PATH: process.env.PATH, NO_COLOR: "1" },
    outputStream,
    clackUi: {
      intro: (title, options) => uiEvents.push(["intro", title, options.output === outputStream]),
      note: (message, title, options) =>
        uiEvents.push(["note", title, message, options.output === outputStream]),
      tasks: async (tasks, options) => {
        uiEvents.push(["tasks", tasks.map(({ title }) => title), options.output === outputStream]);
        for (const entry of tasks) {
          await entry.task(() => {});
        }
      },
      taskLog: (options) => {
        taskLogEvents.push(["start", options.title, options.output === outputStream]);
        return {
          message: (message) => taskLogEvents.push(["message", message]),
          success: (message, options = {}) =>
            taskLogEvents.push(["success", message, options.showLog === true]),
        };
      },
      spinner: (options) => {
        spinnerEvents.push(["create", options.output === outputStream]);
        return {
          start: (message) => spinnerEvents.push(["start", message]),
          stop: (message) => spinnerEvents.push(["stop", message]),
          error: (message) => spinnerEvents.push(["error", message]),
        };
      },
      box: (message, title, options) =>
        boxEvents.push([
          title,
          message,
          options.output === outputStream,
          options.width,
          options.rounded,
          options.formatBorder("x"),
        ]),
    },
    promptInstallPlanFn: async () => ({
      installTargets: ["openclaw", "hermes"],
      runtimeEngines: ["codex"],
      preqstationServerUrl: "https://preq.example.com",
      mcpUrl: "https://preq.example.com/mcp",
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "installed",
    }),
    syncHermesSkillFn: async () => ({
      ok: true,
      target: "hermes",
      action: "already_current",
    }),
    inspectRuntimeExecutableHealthFn: async () => [
      {
        ok: true,
        target: "codex",
        category: "runtime_executable",
        action: "ready",
      },
    ],
    installRuntimeMcpServersFn: async () => [
      {
        ok: true,
        target: "codex",
        action: "mcp_installed",
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(uiEvents[0], ["intro", "PREQSTATION install", true]);
  assert.equal(uiEvents[1][0], "note");
  assert.equal(uiEvents[1][1], "Install plan");
  assert.match(uiEvents[1][2], /OpenClaw, Hermes Agent/);
  assert.match(uiEvents[1][2], /Codex/);
  assert.match(uiEvents[1][2], /https:\/\/preq\.example\.com/);
  assert.doesNotMatch(uiEvents[1][2], /\/mcp/);
  assert.match(uiEvents[1][2], /Request entrypoints/);
  assert.match(uiEvents[1][2], /Agent runtimes/);
  assert.deepEqual(taskLogEvents, [
    ["start", "Request entrypoints", true],
    ["success", "Request entrypoints complete", false],
    ["start", "Agent runtimes", true],
    ["success", "Agent runtimes complete", false],
  ]);
  assert.deepEqual(spinnerEvents, []);
  assert.deepEqual(boxEvents, [
    ["OpenClaw", "installed", true, "auto", true, "x"],
    ["Hermes Agent", "current", true, "auto", true, "x"],
    [
      "Codex",
      "CLI ready",
      true,
      "auto",
      true,
      "x",
    ],
  ]);
});

test("runInstallWizard themes service summary box borders", async () => {
  const outputStream = { write: () => {}, isTTY: true };
  const boxBorders = [];

  await runInstallWizard({
    env: { PATH: process.env.PATH, FORCE_COLOR: "1" },
    outputStream,
    clackUi: {
      intro: () => {},
      note: () => {},
      tasks: async () => {},
      taskLog: () => ({
        message: () => {},
        success: () => {},
      }),
      spinner: () => ({
        start: () => {},
        stop: () => {},
        error: () => {},
      }),
      box: (_message, title, options) =>
        boxBorders.push([title, options.formatBorder("x")]),
    },
    promptInstallPlanFn: async () => ({
      installTargets: ["openclaw", "hermes"],
      runtimeEngines: ["claude-code", "codex", "gemini-cli"],
      preqstationServerUrl: "https://preq.example.com",
      mcpUrl: "https://preq.example.com/mcp",
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "already_current",
      installed_version: "0.1.35",
    }),
    syncHermesSkillFn: async () => ({
      ok: true,
      target: "hermes",
      action: "already_current",
      version: "0.1.35",
    }),
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: "ready",
      })),
    installRuntimeMcpServersFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "mcp_already_configured",
        mcp_url: "https://preq.example.com/mcp",
      })),
  });

  assert.deepEqual(boxBorders, [
    [
      "\u001B[38;2;34;211;238mOpenClaw\u001B[0m",
      "\u001B[38;2;34;211;238mx\u001B[0m",
    ],
    [
      "\u001B[38;2;243;112;33mHermes Agent\u001B[0m",
      "\u001B[38;2;243;112;33mx\u001B[0m",
    ],
    [
      "\u001B[38;2;217;119;87mClaude Code\u001B[0m",
      "\u001B[38;2;217;119;87mx\u001B[0m",
    ],
    [
      "\u001B[38;2;16;163;127mCodex\u001B[0m",
      "\u001B[38;2;16;163;127mx\u001B[0m",
    ],
    [
      "\u001B[38;2;71;150;227mGemini CLI\u001B[0m",
      "\u001B[38;2;71;150;227mx\u001B[0m",
    ],
  ]);
});

test("runInstallWizard themes install plan service names", async () => {
  const outputStream = { write: () => {}, isTTY: true };
  const noteMessages = [];

  await runInstallWizard({
    env: { PATH: process.env.PATH, FORCE_COLOR: "1" },
    outputStream,
    clackUi: {
      intro: () => {},
      note: (message) => noteMessages.push(message),
      tasks: async () => {},
    },
    runTaskGroupFn: async ({ tasks }) => {
      for (const entry of tasks) {
        await entry.task(() => {});
      }
    },
    promptInstallPlanFn: async () => ({
      installTargets: ["openclaw", "hermes"],
      runtimeEngines: ["codex", "claude-code", "gemini-cli"],
      preqstationServerUrl: "https://preq.example.com",
      mcpUrl: "https://preq.example.com/mcp",
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "already_current",
    }),
    syncHermesSkillFn: async () => ({
      ok: true,
      target: "hermes",
      action: "already_current",
    }),
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: "ready",
      })),
    installRuntimeMcpServersFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "mcp_already_configured",
        mcp_url: "https://preq.example.com/mcp",
      })),
  });

  assert.match(noteMessages[0], /\u001B\[38;2;34;211;238mOpenClaw\u001B\[0m/);
  assert.match(noteMessages[0], /\u001B\[38;2;243;112;33mHermes Agent\u001B\[0m/);
  assert.match(noteMessages[0], /\u001B\[38;2;16;163;127mCodex\u001B\[0m/);
  assert.match(noteMessages[0], /\u001B\[38;2;217;119;87mClaude Code\u001B\[0m/);
  assert.match(noteMessages[0], /\u001B\[38;2;71;150;227mGemini CLI\u001B\[0m/);
});

test("runInstallWizard colorizes TTY task log statuses when color is enabled", async () => {
  const outputStream = { write: () => {}, isTTY: true };
  const taskLogMessages = [];

  await runInstallWizard({
    env: { PATH: process.env.PATH, FORCE_COLOR: "1" },
    outputStream,
    clackUi: {
      intro: () => {},
      note: () => {},
      tasks: async () => {},
      taskLog: () => ({
        message: (message) => taskLogMessages.push(message),
        success: () => {},
      }),
    },
    promptInstallPlanFn: async () => ({
      installTargets: ["openclaw"],
      runtimeEngines: [],
      preqstationServerUrl: null,
      mcpUrl: null,
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "already_current",
      installed_version: "0.1.35",
    }),
  });

  assert.match(taskLogMessages[0], /\u001B\[38;2;34;211;238mOpenClaw\u001B\[0m/);
  assert.match(taskLogMessages[0], /is /);
  assert.match(taskLogMessages[0], /\u001B\[32mcurrent\u001B\[0m/);
});

test("runInstallWizard reports when an MCP runtime is already configured", async () => {
  const output = [];

  await runInstallWizard({
    env: { PATH: process.env.PATH },
    withMcp: true,
    outputStream: { write: (value) => output.push(value) },
    promptInstallPlanFn: async () => ({
      installTargets: [],
      runtimeEngines: ["claude-code"],
      preqstationServerUrl: "https://preq.example.com",
      mcpUrl: "https://preq.example.com/mcp",
    }),
    inspectRuntimeExecutableHealthFn: async () => [
      {
        ok: true,
        target: "claude-code",
        category: "runtime_executable",
        action: "ready",
      },
    ],
    installRuntimeMcpServersFn: async () => [
      {
        ok: true,
        target: "claude-code",
        action: "mcp_already_configured",
      },
    ],
  });

  assert.doesNotMatch(output.join(""), /Claude Code plugin\s+current/);
  assert.match(output.join(""), /Claude Code CLI\s+ready/);
  assert.match(output.join(""), /Claude Code legacy MCP\s+current/);
});

test("runInstallWizard reports already current host installs without pretending they were reinstalled", async () => {
  const output = [];

  await runInstallWizard({
    env: { PATH: process.env.PATH },
    outputStream: { write: (value) => output.push(value) },
    promptInstallPlanFn: async () => ({
      installTargets: ["openclaw", "hermes"],
      runtimeEngines: [],
      preqstationServerUrl: null,
      mcpUrl: null,
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "already_current",
    }),
    syncHermesSkillFn: async () => ({
      ok: true,
      target: "hermes",
      action: "already_current",
    }),
  });

  assert.match(output.join(""), /OpenClaw\s+current/);
  assert.match(output.join(""), /Hermes Agent\s+current/);
});

test("runInstallWizard reports failure when runtime executable health fails", async () => {
  const output = [];

  const result = await runInstallWizard({
    env: { PATH: process.env.PATH },
    outputStream: { write: (value) => output.push(value) },
    promptInstallPlanFn: async () => ({
      installTargets: [],
      runtimeEngines: ["codex"],
      preqstationServerUrl: "https://preq.example.com",
      mcpUrl: "https://preq.example.com/mcp",
    }),
    inspectRuntimeExecutableHealthFn: async () => [
      {
        ok: false,
        target: "codex",
        category: "runtime_executable",
        action: "failed",
        executable: "codex",
        resolved_path: "/Users/kendrick/.local/bin/codex",
        error: "codex command failed",
      },
    ],
    installRuntimeMcpServersFn: async () => [
      {
        ok: true,
        target: "codex",
        action: "mcp_already_configured",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(output.join(""), /Codex CLI\s+failed/);
});
