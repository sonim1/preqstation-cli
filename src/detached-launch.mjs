import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { resolveDefaultUserHome } from "./project-mapping.mjs";

const BOOTSTRAP_PROMPT =
  "Read and execute instructions from ./.preqstation-prompt.txt in the current workspace. Treat that file as the source of truth. If that file is missing, stop.";
const PREQSTATION_MCP_NAME = "preqstation";
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
const MCP_PREFLIGHT_BY_ENGINE = {
  "claude-code": {
    command: "claude",
    args: ["mcp", "list"],
    installCommand:
      "claude mcp add -s user --transport http preqstation https://<your-domain>/mcp",
    matchLine: (line) => line.startsWith(`${PREQSTATION_MCP_NAME}:`),
    isReady: (line) => /✓\s+Connected/iu.test(line),
  },
  codex: {
    command: "codex",
    args: ["mcp", "list"],
    installCommand: "codex mcp add preqstation --url https://<your-domain>/mcp",
    matchLine: (line) => line.startsWith(`${PREQSTATION_MCP_NAME} `),
    isReady: (line) =>
      !/Not logged in|Needs authentication|Disconnected|Unauthorized/iu.test(line),
  },
  "gemini-cli": {
    // Gemini CLI 0.40.x prints `mcp list` output only in interactive TTYs.
    // In detached/non-interactive preflight, `gemini mcp list` can exit 0 with
    // empty stdout. `--debug` emits the same MCP status lines to stderr, so
    // merge stderr into stdout for execFileSync-based readiness parsing.
    command: "sh",
    args: ["-lc", "gemini mcp list --debug 2>&1"],
    installCommand:
      "gemini mcp add --scope user --transport http preqstation https://<your-domain>/mcp",
    matchLine: (line) => /\bpreqstation:/iu.test(line),
    isReady: (line) => /Connected/iu.test(line) && !/Disconnected/iu.test(line),
  },
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

function findPreqstationMcpLine(stdout, matcher) {
  const lines = String(stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => matcher(line)) ?? null;
}

export function assertDetachedWorkerMcpReady({
  engine,
  env = process.env,
  exec = execFileSync,
}) {
  const preflight = MCP_PREFLIGHT_BY_ENGINE[engine];
  if (!preflight) {
    return;
  }

  const workerHome = env?.HOME || resolveWorkerHome(env, engine);
  let stdout = "";
  try {
    stdout = exec(preflight.command, preflight.args, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(
      `Detached ${WORKER_LABEL_BY_ENGINE[engine] || engine} worker preflight failed while checking PREQ MCP from HOME ${workerHome}. ` +
        `Run \`${preflight.installCommand}\` and complete auth in that HOME, or set ${resolveWorkerHomeHint(engine)} to a home with working PREQ MCP auth.` +
        (detail ? `\nPreflight error: ${detail}` : ""),
    );
  }

  const line = findPreqstationMcpLine(stdout, preflight.matchLine);
  if (!line) {
    throw new Error(
      `Detached ${WORKER_LABEL_BY_ENGINE[engine] || engine} worker cannot find PREQ MCP from HOME ${workerHome}. ` +
        `Run \`${preflight.installCommand}\` there, or set ${resolveWorkerHomeHint(engine)} to a home with the configured PREQ MCP session.`,
    );
  }

  if (!preflight.isReady(line)) {
    throw new Error(
      `Detached ${WORKER_LABEL_BY_ENGINE[engine] || engine} worker sees PREQ MCP in HOME ${workerHome}, but it is not ready: ${line}. ` +
        `Complete MCP login in that HOME or point ${resolveWorkerHomeHint(engine)} at a ready worker home.`,
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

function buildEngineCommand(engine, platform = process.platform, model = null) {
  const envPrefix = buildDetachedLocalePrefix(platform);
  const modelFlag = buildModelFlag(model);
  switch (engine) {
    case "claude-code":
      return `${envPrefix} claude${modelFlag} --dangerously-skip-permissions ${shellQuote(BOOTSTRAP_PROMPT)}`;
    case "gemini-cli":
      return `${envPrefix} GEMINI_SANDBOX=false gemini${modelFlag} --skip-trust --yolo --allowed-mcp-server-names preqstation --extensions '' -p ${shellQuote(BOOTSTRAP_PROMPT)}`;
    case "codex":
    default:
      return `${envPrefix} codex exec${modelFlag} --dangerously-bypass-approvals-and-sandbox ${shellQuote(BOOTSTRAP_PROMPT)}`;
  }
}

export function buildDetachedLaunchPlan({ cwd, engine, model = null, platform = process.platform }) {
  const dispatchDir = path.join(cwd, ".preqstation-dispatch");
  const logFile = path.join(dispatchDir, `${engine}.log`);
  const pidFile = path.join(dispatchDir, `${engine}.pid`);
  const engineCommand = buildEngineCommand(engine, platform, model);
  const script = [
    `mkdir -p ${shellQuote(".preqstation-dispatch")}`,
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
  assertDetachedWorkerMcpReady({
    engine,
    env: detachedEnv,
    exec,
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
}
