import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { resolveDefaultUserHome } from "./project-mapping.mjs";
import { PREQSTATION_INSTRUCTIONS_FILE } from "./instruction-files.mjs";
import { DispatchError, isDispatchError } from "./dispatch-error.mjs";
import {
  getPreqstationConfigPath,
  getPreqstationOauthPath,
} from "./preqstation-config.mjs";
import { inspectPreqstationAuth } from "./preqstation-mcp-client.mjs";
import { resolveDefaultPreqstationServerUrl } from "./runtime-mcp-installer.mjs";

const BOOTSTRAP_PROMPT =
  `Read and execute instructions from ./${PREQSTATION_INSTRUCTIONS_FILE} in the current workspace. Treat that file as the source of truth. If that file is missing, stop. Execute the full User Objective to completion before exiting. Do not stop after task get or task start; those are bootstrap only. You must run the objective-specific final PREQ CLI command described in the instructions before exiting.`;
const WORKER_HOME_ENV_BY_ENGINE = {
  "claude-code": "PREQSTATION_CLAUDE_HOME",
  codex: "PREQSTATION_CODEX_HOME",
  "gemini-cli": "PREQSTATION_GEMINI_HOME",
};
const WORKER_LABEL_BY_ENGINE = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
};

export function resolveDetachedLocale(platform = process.platform) {
  return platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
}

export function buildDetachedLocalePrefix(platform = process.platform) {
  const locale = resolveDetachedLocale(platform);
  return `env -u LC_ALL -u LANG -u LC_CTYPE LANG=${locale} LC_CTYPE=${locale}`;
}

export function resolveWorkerHome(baseEnv = process.env, engine = null) {
  const runtimeHomeKey = engine ? WORKER_HOME_ENV_BY_ENGINE[engine] : null;
  const runtimeHome =
    runtimeHomeKey && typeof baseEnv?.[runtimeHomeKey] === "string"
      ? baseEnv[runtimeHomeKey].trim()
      : "";
  if (runtimeHome) {
    return runtimeHome;
  }

  const sharedWorkerHome =
    typeof baseEnv?.PREQSTATION_WORKER_HOME === "string"
      ? baseEnv.PREQSTATION_WORKER_HOME.trim()
      : "";
  if (sharedWorkerHome) {
    return sharedWorkerHome;
  }

  return resolveDefaultUserHome(baseEnv);
}

export function buildDetachedProcessEnv(
  baseEnv = process.env,
  platform = process.platform,
  engine = null,
) {
  const locale = resolveDetachedLocale(platform);
  const nextEnv = {
    ...baseEnv,
    HOME: resolveWorkerHome(baseEnv, engine),
    LANG: locale,
    LC_CTYPE: locale,
  };
  delete nextEnv.LC_ALL;
  return nextEnv;
}

function resolveWorkerHomeHint(engine) {
  const specific = WORKER_HOME_ENV_BY_ENGINE[engine];
  if (specific) {
    return `${specific} or PREQSTATION_WORKER_HOME`;
  }
  return "PREQSTATION_WORKER_HOME";
}

export async function assertDetachedWorkerCliAuthReady({
  engine,
  env = process.env,
  resolveServerUrl = resolveDefaultPreqstationServerUrl,
  inspectAuth = inspectPreqstationAuth,
}) {
  const workerHome = env?.HOME || resolveWorkerHome(env, engine);
  const oauthPath = getPreqstationOauthPath(env);
  const configPath = getPreqstationConfigPath(env);
  const [serverUrl, auth] = await Promise.all([
    resolveServerUrl({ env, runtimes: [] }).catch(() => null),
    inspectAuth({ oauthPath, env }),
  ]);

  if (!serverUrl || !auth.authenticated) {
    throw new DispatchError(
      "worker_auth_unready",
      `Detached ${WORKER_LABEL_BY_ENGINE[engine] || engine} worker CLI auth is not ready from HOME ${workerHome}. Run preqstation auth login in that HOME, or pass PREQSTATION_TOKEN and PREQSTATION_SERVER_URL into the worker environment.`,
      {
        engine,
        worker_home: workerHome,
        worker_home_hint: resolveWorkerHomeHint(engine),
        server_url: serverUrl,
        authenticated: auth.authenticated,
        auth_source: auth.auth_source,
        config_path: configPath,
        oauth_path: oauthPath,
        suggested_action: "run_cli_auth_login_for_worker_home_or_set_token",
        commands: [
          `HOME=${shellQuote(workerHome)} preqstation auth login --server-url https://<your-domain>`,
        ],
      },
    );
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function normalizeModel(value) {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model || model.toLowerCase() === "default") return null;
  if (!/^[a-zA-Z0-9._:/@+-]+$/u.test(model)) {
    throw new Error(`Invalid dispatch model: ${model}`);
  }
  return model;
}

function buildModelFlag(model) {
  const normalized = normalizeModel(model);
  return normalized ? ` --model ${shellQuote(normalized)}` : "";
}

function buildEngineCommand(engine, platform = process.platform, model = null, options = {}) {
  const envPrefix = buildDetachedLocalePrefix(platform);
  const modelFlag = buildModelFlag(model);
  switch (engine) {
    case "claude-code":
      return `${envPrefix} claude${modelFlag} --dangerously-skip-permissions --strict-mcp-config --mcp-config ${shellQuote(options.mcpConfigFile)} ${shellQuote(BOOTSTRAP_PROMPT)}`;
    case "gemini-cli":
      return `${envPrefix} GEMINI_SANDBOX=false gemini${modelFlag} --skip-trust --yolo --extensions '' -p ${shellQuote(BOOTSTRAP_PROMPT)}`;
    case "codex":
    default:
      return `${envPrefix} codex --ask-for-approval never exec -c ${shellQuote("mcp_servers.preqstation.enabled=false")}${modelFlag} --sandbox danger-full-access ${shellQuote(BOOTSTRAP_PROMPT)}`;
  }
}

export function buildDetachedLaunchPlan({ cwd, engine, model = null, platform = process.platform }) {
  const dispatchDir = path.join(cwd, ".preqstation-dispatch");
  const logFile = path.join(dispatchDir, `${engine}.log`);
  const pidFile = path.join(dispatchDir, `${engine}.pid`);
  const claudeMcpConfigFile = path.join(".preqstation-dispatch", "claude-mcp-config.json");
  const engineCommand = buildEngineCommand(engine, platform, model, {
    mcpConfigFile: claudeMcpConfigFile,
  });
  const script = [
    `mkdir -p ${shellQuote(".preqstation-dispatch")}`,
    ...(engine === "claude-code"
      ? [`printf '%s\\n' '{}' > ${shellQuote(claudeMcpConfigFile)}`]
      : []),
    `( nohup ${engineCommand} > ${shellQuote(path.relative(cwd, logFile))} 2>&1 < /dev/null & echo $! > ${shellQuote(path.relative(cwd, pidFile))} )`,
  ].join(" && ");

  return {
    command: "sh",
    args: ["-lc", script],
    script,
    logFile,
    pidFile,
  };
}

export async function launchDetached({ cwd, engine, model = null, env = process.env, exec = execFileSync }) {
  const plan = buildDetachedLaunchPlan({ cwd, engine, model });
  const detachedEnv = buildDetachedProcessEnv(env, process.platform, engine);
  try {
    await assertDetachedWorkerCliAuthReady({
      engine,
      env: detachedEnv,
    });
    exec(plan.command, plan.args, {
      cwd,
      env: detachedEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pid = Number((await fs.readFile(plan.pidFile, "utf8")).trim());
    return {
      pid,
      pidFile: plan.pidFile,
      logFile: plan.logFile,
    };
  } catch (error) {
    if (isDispatchError(error)) {
      throw error;
    }
    const message = String(error?.stderr || error?.message || error).trim();
    throw new DispatchError(
      "worker_launch_failed",
      `Failed to launch detached ${WORKER_LABEL_BY_ENGINE[engine] || engine} worker: ${message}`,
      {
        engine,
        worktree_path: cwd,
        log_file: plan.logFile,
        pid_file: plan.pidFile,
        cause_message: message,
        suggested_action: "check_worker_runtime_and_retry",
      },
    );
  }
}
