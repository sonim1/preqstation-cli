import test from "node:test";
import assert from "node:assert/strict";

import {
  assertDetachedWorkerMcpReady,
  buildDetachedLaunchPlan,
  buildDetachedProcessEnv,
  resolveWorkerHome,
} from "../src/detached-launch.mjs";
import { createBeforeDispatchHandler } from "../index.mjs";

test("builds a detached codex launch plan that reads the prompt file", () => {
  const plan = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga",
    engine: "codex",
    platform: "darwin",
  });

  assert.equal(plan.command, "sh");
  assert.deepEqual(plan.logFile, "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.log");
  assert.deepEqual(plan.pidFile, "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.pid");
  assert.match(plan.script, /env -u LC_ALL -u LANG -u LC_CTYPE LANG=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 codex exec --full-auto/);
  assert.match(plan.script, /Read and execute instructions from \.\/\.preqstation-prompt\.txt/);
  assert.doesNotMatch(plan.script, /C\.UTF-8/);
  assert.doesNotMatch(plan.script, /LC_CTYPE=UTF-8/);
  assert.doesNotMatch(plan.script, /& &&/);
  assert.match(plan.script, /\( nohup .*echo \$! >/);
});

test("builds a detached Gemini launch plan with non-interactive automation flags", () => {
  const plan = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-330-gemini",
    engine: "gemini-cli",
    platform: "darwin",
  });

  assert.match(plan.script, /GEMINI_SANDBOX=false gemini --skip-trust --yolo --allowed-mcp-server-names preqstation --extensions '' -p/);
  assert.match(plan.script, /env -u LC_ALL -u LANG -u LC_CTYPE LANG=en_US.UTF-8 LC_CTYPE=en_US.UTF-8/);
});

test("adds model flags only when a detached model override is provided", () => {
  const codex = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-331-model",
    engine: "codex",
    model: "gpt-5.3-codex-spark",
    platform: "darwin",
  });
  assert.match(codex.script, /codex exec --model 'gpt-5\.3-codex-spark' --full-auto/);

  const claude = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-331-model",
    engine: "claude-code",
    model: "claude-sonnet-4-6",
    platform: "darwin",
  });
  assert.match(claude.script, /claude --model 'claude-sonnet-4-6' --dangerously-skip-permissions/);

  const gemini = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-331-model",
    engine: "gemini-cli",
    model: "gemini-2.5-flash",
    platform: "darwin",
  });
  assert.match(gemini.script, /gemini --model 'gemini-2.5-flash' --skip-trust/);
});

test("sanitizes detached process locale for macOS", () => {
  const env = buildDetachedProcessEnv(
    {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      LC_CTYPE: "UTF-8",
    },
    "darwin",
  );

  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal(env.LC_CTYPE, "en_US.UTF-8");
  assert.equal("LC_ALL" in env, false);
});

test("uses the owning user home for detached runs launched from Hermes profiles", () => {
  const env = buildDetachedProcessEnv(
    {
      HOME: "/Users/kendrick/.hermes/profiles/preq-coder/home",
      HERMES_HOME: "/Users/kendrick/.hermes/profiles/preq-coder",
    },
    "darwin",
  );

  assert.equal(env.HOME, "/Users/kendrick");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal(env.LC_CTYPE, "en_US.UTF-8");
});

test("uses a shared PREQ worker home when configured", () => {
  assert.equal(
    resolveWorkerHome(
      {
        HOME: "/Users/kendrick/.hermes/profiles/preq-coder/home",
        PREQSTATION_WORKER_HOME: "/Users/kendrick/.preq-workers/shared",
      },
      "codex",
    ),
    "/Users/kendrick/.preq-workers/shared",
  );
});

test("uses runtime-specific worker homes before the shared worker home", () => {
  assert.equal(
    resolveWorkerHome(
      {
        HOME: "/Users/kendrick/.hermes/profiles/preq-coder/home",
        PREQSTATION_WORKER_HOME: "/Users/kendrick/.preq-workers/shared",
        PREQSTATION_CODEX_HOME: "/Users/kendrick/.preq-workers/codex",
      },
      "codex",
    ),
    "/Users/kendrick/.preq-workers/codex",
  );
});

test("keeps C.UTF-8 as the detached locale on non-macOS hosts", () => {
  const plan = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga",
    engine: "codex",
    platform: "linux",
  });

  assert.match(plan.script, /env -u LC_ALL -u LANG -u LC_CTYPE LANG=C.UTF-8 LC_CTYPE=C.UTF-8 codex exec --full-auto/);
});

test("codex detached preflight rejects preqstation MCP sessions that are not logged in", () => {
  assert.throws(
    () =>
      assertDetachedWorkerMcpReady({
        engine: "codex",
        env: { HOME: "/Users/kendrick/.hermes/profiles/preq-coder/home" },
        exec: () => `
Name         Url                        Bearer Token Env Var  Status   Auth
preqstation  https://pm.sonim1.com/mcp  -                     enabled  Not logged in
`,
      }),
    /PREQSTATION_CODEX_HOME or PREQSTATION_WORKER_HOME/,
  );
});

test("codex detached preflight accepts authenticated preqstation MCP sessions", () => {
  assert.doesNotThrow(() =>
    assertDetachedWorkerMcpReady({
      engine: "codex",
      env: { HOME: "/Users/kendrick" },
      exec: () => `
Name         Url                        Bearer Token Env Var  Status   Auth
preqstation  https://pm.sonim1.com/mcp  -                     enabled  OAuth
`,
    }),
  );
});

test("claude detached preflight rejects preqstation MCP sessions that still need auth", () => {
  assert.throws(
    () =>
      assertDetachedWorkerMcpReady({
        engine: "claude-code",
        env: { HOME: "/Users/kendrick/.preq-workers/claude" },
        exec: () => "preqstation: https://pm.sonim1.com/mcp (HTTP) - ! Needs authentication\n",
      }),
    /PREQSTATION_CLAUDE_HOME or PREQSTATION_WORKER_HOME/,
  );
});

test("gemini detached preflight rejects disconnected preqstation MCP sessions", () => {
  assert.throws(
    () =>
      assertDetachedWorkerMcpReady({
        engine: "gemini-cli",
        env: { HOME: "/Users/kendrick/.preq-workers/gemini" },
        exec: () => "✗ preqstation: https://pm.sonim1.com/mcp (http) - Disconnected\n",
      }),
    /PREQSTATION_GEMINI_HOME or PREQSTATION_WORKER_HOME/,
  );
});

test("gemini detached preflight uses debug output so non-interactive MCP list is visible", () => {
  const calls = [];

  assert.doesNotThrow(() =>
    assertDetachedWorkerMcpReady({
      engine: "gemini-cli",
      env: { HOME: "/Users/kendrick" },
      exec: (command, args) => {
        calls.push({ command, args });
        return "✓ preqstation: https://pm.sonim1.com/mcp (http) - Connected\n";
      },
    }),
  );

  assert.deepEqual(calls, [
    { command: "sh", args: ["-lc", "gemini mcp list --debug 2>&1"] },
  ]);
});

test("before_dispatch handles matched preq messages and parks task flow in waiting", async () => {
  const calls = [];
  const taskFlow = {
    bindSession() {
      return {
        createManaged(params) {
          calls.push(["createManaged", params]);
          return { flowId: "flow-1", revision: 1 };
        },
        runTask(params) {
          calls.push(["runTask", params]);
          return { created: true, flow: { flowId: "flow-1", revision: 1 }, task: { taskId: "task-1" } };
        },
        setWaiting(params) {
          calls.push(["setWaiting", params]);
          return { applied: true, flow: { flowId: "flow-1", revision: 2 } };
        },
      };
    },
  };

  const handler = createBeforeDispatchHandler(
    {
      runtime: { taskFlow },
      pluginConfig: {},
      rootDir: "/tmp/preqstation-dispatcher",
      logger: { info() {}, error() {} },
    },
    {
      resolveProjectCwd: async () => "/tmp/project",
      prepareWorktree: async () => ({
        cwd: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga",
        branchName: "task/proj-327/browser-notification-chuga",
      }),
      writePromptFile: async () => {},
      launchDetached: async () => ({
        pid: 4242,
        pidFile: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.pid",
        logFile: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.log",
      }),
    },
  );

  const result = await handler(
    {
      content:
        '!/preqstation dispatch plan PROJ-327 using codex branch_name="task/proj-327/browser-notification-chuga"',
      channel: "telegram",
      sessionKey: "agent:main",
    },
    {
      accountId: "telegram:default",
      conversationId: "chat-1",
      sessionKey: "agent:main",
      senderId: "user-1",
    },
  );

  assert.deepEqual(result, {
    handled: true,
    text: "dispatched PROJ-327 via codex at /tmp/worktree/proj/task-proj-327-browser-notification-chuga",
  });

  assert.equal(calls[0][0], "createManaged");
  assert.equal(calls[1][0], "runTask");
  assert.equal(calls[2][0], "setWaiting");
  assert.deepEqual(calls[2][1].waitJson, {
    kind: "preqstation_dispatch",
    engine: "codex",
    taskKey: "PROJ-327",
    pid: 4242,
    cwd: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga",
    logFile: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.log",
    pidFile: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.pid",
  });
});

test("before_dispatch ignores unrelated messages", async () => {
  const handler = createBeforeDispatchHandler(
    {
      runtime: {},
      pluginConfig: {},
      rootDir: "/tmp/preqstation-dispatcher",
      logger: { info() {}, error() {} },
    },
    {},
  );

  assert.equal(
    await handler(
      { content: "hello there", channel: "telegram" },
      { sessionKey: "agent:main" },
    ),
    undefined,
  );
});

test("before_dispatch returns an actionable Telegram reply when dispatch fails", async () => {
  const handler = createBeforeDispatchHandler(
    {
      runtime: {},
      pluginConfig: {},
      rootDir: "/tmp/preqstation-dispatcher",
      logger: { info() {}, error() {} },
    },
    {
      resolveProjectCwd: async () => "/tmp/project",
      prepareWorktree: async () => {
        throw new Error("GitHub access missing on the coding agent: run gh auth login before auto PR.");
      },
    },
  );

  const result = await handler(
    {
      content: "/preqstation dispatch implement PROJ-327 using codex",
      channel: "telegram",
    },
    {
      sessionKey: "agent:main",
      accountId: "telegram:default",
      conversationId: "chat-1",
    },
  );

  assert.equal(result.handled, true);
  assert.match(result.text, /Reason: GitHub access missing on the coding agent/);
  assert.match(result.text, /gh auth login/);
  assert.match(result.text, /resend the PREQ dispatch/);
});
