import test from "node:test";
import assert from "node:assert/strict";

import {
  assertDetachedWorkerCliAuthReady,
  buildDetachedLaunchPlan,
  buildDetachedProcessEnv,
  launchDetached,
  resolveWorkerHome,
} from "../src/detached-launch.mjs";
import { DispatchError } from "../src/dispatch-error.mjs";
import { createBeforeDispatchHandler } from "../index.mjs";

test("builds a detached codex launch plan that reads the instructions file", () => {
  const plan = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga",
    engine: "codex",
    platform: "darwin",
  });

  assert.equal(plan.command, "sh");
  assert.deepEqual(plan.logFile, "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.log");
  assert.deepEqual(plan.pidFile, "/tmp/worktree/proj/task-proj-327-browser-notification-chuga/.preqstation-dispatch/codex.pid");
  assert.match(plan.script, /env -u LC_ALL -u LANG -u LC_CTYPE LANG=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 codex --ask-for-approval never exec -c 'mcp_servers\.preqstation\.enabled=false' --sandbox danger-full-access/);
  assert.match(plan.script, /-c 'mcp_servers\.preqstation\.enabled=false'/);
  assert.match(plan.script, /Read and execute instructions from \.\/\.preqstation-instructions\.txt/);
  assert.doesNotMatch(plan.script, /\.preqstation-prompt\.txt/);
  assert.match(plan.script, /Do not stop after task get or task start/);
  assert.match(plan.script, /objective-specific final PREQ CLI command/);
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

  assert.match(plan.script, /GEMINI_SANDBOX=false gemini --skip-trust --yolo --extensions '' -p/);
  assert.doesNotMatch(plan.script, /--allowed-mcp-server-names preqstation/);
  assert.match(plan.script, /env -u LC_ALL -u LANG -u LC_CTYPE LANG=en_US.UTF-8 LC_CTYPE=en_US.UTF-8/);
});

test("adds model flags only when a detached model override is provided", () => {
  const codex = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-331-model",
    engine: "codex",
    model: "gpt-5.3-codex-spark",
    platform: "darwin",
  });
  assert.match(codex.script, /codex --ask-for-approval never exec -c 'mcp_servers\.preqstation\.enabled=false' --model 'gpt-5\.3-codex-spark' --sandbox danger-full-access/);

  const claude = buildDetachedLaunchPlan({
    cwd: "/tmp/worktree/proj/task-proj-331-model",
    engine: "claude-code",
    model: "claude-sonnet-4-6",
    platform: "darwin",
  });
  assert.match(claude.script, /claude --model 'claude-sonnet-4-6' --dangerously-skip-permissions --strict-mcp-config --mcp-config/);

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

  assert.match(plan.script, /env -u LC_ALL -u LANG -u LC_CTYPE LANG=C.UTF-8 LC_CTYPE=C.UTF-8 codex --ask-for-approval never exec -c 'mcp_servers\.preqstation\.enabled=false' --sandbox danger-full-access/);
});

test("detached CLI auth preflight rejects missing worker auth", async () => {
  await assert.rejects(
    assertDetachedWorkerCliAuthReady({
      engine: "codex",
      env: { HOME: "/Users/kendrick/.preq-workers/codex" },
      resolveServerUrl: async () => null,
      inspectAuth: async () => ({
        authenticated: false,
        auth_source: null,
        oauth_cache_exists: false,
      }),
    }),
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "worker_auth_unready");
      assert.equal(error.worker_home, "/Users/kendrick/.preq-workers/codex");
      assert.match(error.oauth_path, /oauth\.json$/);
      assert.match(error.commands[0], /preqstation auth login/);
      return true;
    },
  );
});

test("detached CLI auth preflight accepts worker env token and server URL", async () => {
  await assert.doesNotReject(
    assertDetachedWorkerCliAuthReady({
      engine: "codex",
      env: {
        HOME: "/Users/kendrick/.preq-workers/codex",
        PREQSTATION_SERVER_URL: "https://preq.example.com",
        PREQSTATION_TOKEN: "token",
      },
      resolveServerUrl: async () => "https://preq.example.com",
      inspectAuth: async () => ({
        authenticated: true,
        auth_source: "env_token",
        oauth_cache_exists: false,
      }),
    }),
  );
});

test("launchDetached wraps worker subprocess failures as typed dispatch errors", async () => {
  const calls = [];
  const cwd = "/tmp/worktree/proj/task-proj-327";

  await assert.rejects(
    launchDetached({
      cwd,
      engine: "codex",
      env: {
        HOME: "/Users/kendrick",
        PREQSTATION_SERVER_URL: "https://preq.example.com",
        PREQSTATION_TOKEN: "token",
      },
      exec: (command, args) => {
        calls.push({ command, args });
        throw new Error("codex binary missing");
      },
    }),
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "worker_launch_failed");
      assert.equal(error.engine, "codex");
      assert.equal(error.worktree_path, cwd);
      assert.equal(error.cause_message, "codex binary missing");
      assert.match(error.log_file, /codex\.log$/);
      assert.match(error.pid_file, /codex\.pid$/);
      return true;
    },
  );
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

test("before_dispatch formats typed stale branch failures with recovery commands", async () => {
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
        throw new DispatchError(
          "stale_dispatch_branch",
          "Dispatch branch task/proj-327 is stale relative to origin/main.",
          {
            branch_name: "task/proj-327",
            base_ref: "origin/main",
            worktree_path: "/tmp/worktrees/PROJ/task-proj-327",
            safe_to_delete: true,
            suggested_action: "delete_branch_and_retry",
            commands: ["git -C /tmp/project branch -D task/proj-327"],
          },
        );
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
  assert.match(result.text, /Reason \[stale_dispatch_branch\]: Dispatch branch task\/proj-327/);
  assert.match(result.text, /safe to delete/);
  assert.match(result.text, /git -C \/tmp\/project branch -D task\/proj-327/);
});
