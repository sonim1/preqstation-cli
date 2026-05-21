import os from "node:os";
import path from "node:path";

import {
  defaultDispatchDependencies,
  dispatchPreqRun,
} from "../../core/dispatch-runtime.mjs";
import { parseDispatchMessage } from "../../parse-dispatch-message.mjs";
import { getDefaultSharedMappingPath } from "../../project-mapping.mjs";
import { createSetupCommandHandler } from "../../setup-command.mjs";

function resolveTaskFlowApi(runtime) {
  return runtime?.tasks?.flow ?? runtime?.taskFlow ?? null;
}

function resolveMemoryPath(api) {
  const configured = api.pluginConfig?.memoryPath;
  if (typeof configured === "string" && configured.length > 0) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(api.rootDir ?? process.cwd(), configured);
  }
  return path.join(api.rootDir ?? process.cwd(), "MEMORY.md");
}

function resolveWorktreeRoot(api) {
  const configured = api.pluginConfig?.worktreeRoot;
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  return process.env.OPENCLAW_WORKTREE_ROOT
    ? process.env.OPENCLAW_WORKTREE_ROOT
    : path.join(os.homedir(), ".openclaw-preq-worktrees");
}

function formatDispatchFailureText(parsed, message) {
  const target = parsed.taskKey ?? parsed.projectKey;
  const lines = [`failed to dispatch ${target} via ${parsed.engine}`, `Reason: ${message}`];

  if (/project path|project key|mapping|\/preqstation\s+setup|repo root|no local project/i.test(message)) {
    lines.push(
      "Next: fix the dispatcher project mapping on this host with /preqstation setup status or /preqstation setup auto, then resend the PREQ dispatch.",
    );
    return lines.join("\n");
  }

  if (/github|gh auth|pull request|auto[_ -]?pr/i.test(message)) {
    lines.push(
      "Next: configure GitHub access on the coding agent (`gh auth login` or GitHub MCP), then resend the PREQ dispatch.",
    );
    return lines.join("\n");
  }

  lines.push("Next: fix the dispatcher error on this host, then resend the PREQ dispatch.");
  return lines.join("\n");
}

function formatPreqstationHelp() {
  return [
    "PREQSTATION",
    "",
    "Usage: /preqstation <command> [args]",
    "",
    "Commands:",
    "  dispatch              Dispatch a PREQ task to Claude Code, Codex, or Gemini",
    "  setup                 Configure PREQ project path mappings",
    "  status                Show PREQ project path mappings",
    "  doctor                Show the terminal diagnostic command",
    "  update                Show the terminal update command",
    "  help                  Show this help",
    "",
    "Examples:",
    "  /preqstation dispatch implement PROJ-123 using codex",
    "  /preqstation dispatch qa PROJ using claude-code",
    "  /preqstation setup auto",
    "  /preqstation status",
  ].join("\n");
}

function splitCommandArgs(args) {
  const rawArgs = (args ?? "").trim();
  const firstSpace = rawArgs.search(/\s/u);
  const command =
    (firstSpace === -1 ? rawArgs : rawArgs.slice(0, firstSpace)).toLowerCase();
  const remainder = firstSpace === -1 ? "" : rawArgs.slice(firstSpace + 1).trim();
  return { command, remainder, rawArgs };
}

export function createPreqstationCommandHandler(api, overrides = {}) {
  const setupHandler = createSetupCommandHandler(api, overrides.setupOptions ?? {});
  const dispatchPreqRunFn = overrides.dispatchPreqRunFn ?? dispatchPreqRun;

  return async function handlePreqstationCommand(ctx = {}) {
    const { command, remainder, rawArgs } = splitCommandArgs(ctx.args);

    if (!command || command === "help") {
      return { text: formatPreqstationHelp() };
    }

    if (command === "setup") {
      return setupHandler({
        ...ctx,
        args: remainder,
        commandBody: `/preqstation setup${remainder ? ` ${remainder}` : ""}`,
      });
    }

    if (command === "status") {
      return setupHandler({
        ...ctx,
        args: "status",
        commandBody: "/preqstation status",
      });
    }

    if (command === "doctor") {
      return {
        text: "Run `preqstation doctor` in the dispatcher host terminal for full diagnostics.",
      };
    }

    if (command === "update") {
      return {
        text: "Run `preqstation update` in the dispatcher host terminal to refresh installed PREQSTATION support.",
      };
    }

    if (command === "dispatch") {
      const rawMessage = `/preqstation ${rawArgs}`;
      const parsed = parseDispatchMessage(rawMessage);
      if (!parsed) {
        return {
          text: [
            "Invalid PREQSTATION dispatch command.",
            "",
            formatPreqstationHelp(),
          ].join("\n"),
        };
      }

      const result = await dispatchPreqRunFn({
        rawMessage: parsed.rawMessage,
        parsed,
        configuredProjects: api.pluginConfig?.projects,
        sharedMappingPath: getDefaultSharedMappingPath(),
        memoryPath: resolveMemoryPath(api),
        worktreeRoot: resolveWorktreeRoot(api),
        dependencies: {
          ...defaultDispatchDependencies,
          ...(overrides.dispatchDependencies ?? {}),
        },
      });

      return {
        text: `dispatched ${parsed.taskKey ?? parsed.projectKey} via ${parsed.engine} at ${result.prepared.cwd}`,
      };
    }

    return {
      text: [
        `Unknown PREQSTATION command: ${command}`,
        "",
        formatPreqstationHelp(),
      ].join("\n"),
    };
  };
}

function trackDetachedDispatch({ api, event, ctx, parsed, prepared, launch }) {
  const taskFlowApi = resolveTaskFlowApi(api.runtime);
  if (!taskFlowApi || !ctx.sessionKey) {
    return;
  }

  const bound = taskFlowApi.bindSession({
    sessionKey: ctx.sessionKey,
    requesterOrigin: {
      channel: event.channel,
      accountId: ctx.accountId,
      to: ctx.conversationId,
    },
  });

  const created = bound.createManaged({
    controllerId: "preqstation-dispatcher/dispatch",
    goal: `Dispatch ${parsed.taskKey ?? parsed.projectKey} via ${parsed.engine}`,
    status: "running",
    currentStep: "launch_detached_engine",
    stateJson: {
      taskKey: parsed.taskKey,
      projectKey: parsed.projectKey,
      engine: parsed.engine,
      cwd: prepared.cwd,
      branchName: prepared.branchName,
    },
  });

  const child = bound.runTask({
    flowId: created.flowId,
    runtime: "cli",
    runId: `preqstation-dispatcher:${parsed.taskKey ?? parsed.projectKey}:${Date.now()}`,
    task: `Dispatch ${parsed.taskKey ?? parsed.projectKey} via ${parsed.engine}`,
    status: "running",
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    progressSummary: `Launched ${parsed.engine} in ${prepared.cwd}`,
  });

  const expectedRevision = child.created ? child.flow.revision : created.revision;

  bound.setWaiting({
    flowId: created.flowId,
    expectedRevision,
    currentStep: "await_detached_completion",
    stateJson: {
      taskKey: parsed.taskKey,
      projectKey: parsed.projectKey,
      engine: parsed.engine,
      cwd: prepared.cwd,
      branchName: prepared.branchName,
    },
    waitJson: {
      kind: "preqstation_dispatch",
      engine: parsed.engine,
      taskKey: parsed.taskKey,
      pid: launch.pid,
      cwd: prepared.cwd,
      logFile: launch.logFile,
      pidFile: launch.pidFile,
    },
  });
}

export function createBeforeDispatchHandler(api, overrides = {}) {
  return async function beforeDispatch(event, ctx) {
    const parsed = parseDispatchMessage(event.content);
    if (!parsed) {
      return undefined;
    }

    try {
      const result = await dispatchPreqRun({
        rawMessage: parsed.rawMessage,
        parsed,
        configuredProjects: api.pluginConfig?.projects,
        sharedMappingPath: getDefaultSharedMappingPath(),
        memoryPath: resolveMemoryPath(api),
        worktreeRoot: resolveWorktreeRoot(api),
        dependencies: {
          ...defaultDispatchDependencies,
          ...overrides,
        },
      });

      trackDetachedDispatch({
        api,
        event,
        ctx,
        parsed,
        prepared: result.prepared,
        launch: result.launch,
      });

      return {
        handled: true,
        text: `dispatched ${parsed.taskKey ?? parsed.projectKey} via ${parsed.engine} at ${result.prepared.cwd}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      api.logger?.error?.("Failed to dispatch PREQ task", {
        error: message,
        message: parsed.rawMessage,
      });
      return {
        handled: true,
        text: formatDispatchFailureText(parsed, message),
      };
    }
  };
}

const plugin = {
  id: "preqstation-dispatcher",
  name: "PREQSTATION OpenClaw Dispatch",
  description:
    "Intercept PREQSTATION dispatch messages and launch detached local coding runs for mapped projects.",
  register(api) {
    api.on("before_dispatch", createBeforeDispatchHandler(api));
    api.registerCommand({
      name: "preqstation",
      description: "PREQSTATION help, dispatch, and project setup.",
      acceptsArgs: true,
      handler: createPreqstationCommandHandler(api),
    });
  },
};

export default plugin;
