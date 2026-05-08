import fs from "node:fs/promises";
import path from "node:path";

import { dispatchPreqRun as defaultDispatchPreqRun } from "../core/dispatch-runtime.mjs";
import { parseHermesDispatchPayload } from "../adapters/hermes/payload.mjs";
import { runInstallWizard as defaultRunInstallWizard } from "../install-wizard.mjs";
import { parseDispatchMessage } from "../parse-dispatch-message.mjs";
import {
  getDefaultRepoRoots,
  getDefaultSharedMappingPath,
  resolveDefaultUserHome,
  matchProjectsToRepoRoots,
  readRepoRoots,
} from "../project-mapping.mjs";
import { parseAutoMappings } from "../setup-command.mjs";
import {
  getHermesSkillStatus,
  syncHermesSkill,
} from "../hermes-skill-installer.mjs";
import { installOpenClawPlugin } from "../openclaw-installer.mjs";
import {
  inspectRuntimeExecutableHealth,
  installRuntimeWorkerSupport,
} from "../runtime-skill-installer.mjs";
import {
  buildPreqstationMcpUrl,
  inspectRuntimeMcpServers,
  resolveDefaultPreqstationServerUrl,
} from "../runtime-mcp-installer.mjs";

const UPDATE_HOST_TARGETS = ["openclaw", "hermes"];
const UPDATE_RUNTIME_TARGETS = ["claude-code", "codex", "gemini-cli"];
const PACKAGE_JSON_FILE = new URL("../../package.json", import.meta.url);
const CLI_COMMAND_NAME = "preqstation";

function getDispatchHome(env) {
  return (
    env.PREQSTATION_DISPATCH_HOME ||
    path.join(resolveDefaultUserHome(env), ".preqstation-dispatch")
  );
}

function getProjectsFile(env) {
  return env.PREQSTATION_PROJECTS_FILE || getDefaultSharedMappingPath(env);
}

function getRepoRoots(env) {
  return readRepoRoots(env.PREQSTATION_REPO_ROOTS || getDefaultRepoRoots(env));
}

function getWorktreeRoot(env) {
  return env.PREQSTATION_WORKTREE_ROOT || path.join(getDispatchHome(env), "worktrees");
}

function getMemoryPath(env) {
  return env.PREQSTATION_MEMORY_PATH || null;
}

function parseOptions(argv) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { options, positional };
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option: --${name}`);
  }
  return value.trim();
}

function normalizeProjectKey(value) {
  const projectKey = String(value || "").trim().toUpperCase();
  if (!projectKey) {
    throw new Error("Project key is required");
  }
  return projectKey;
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON_FILE, "utf8"));
  return String(pkg?.version || "").trim();
}

async function readProjectMappings(mappingPath) {
  const content = await fs.readFile(mappingPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  if (!content) {
    return { projects: {} };
  }

  const parsed = JSON.parse(content);
  return {
    projects:
      parsed?.projects && typeof parsed.projects === "object" ? parsed.projects : {},
  };
}

async function writeProjectMapping({ mappingPath, projectKey, projectPath }) {
  if (!path.isAbsolute(projectPath)) {
    throw new Error("Project path must be absolute");
  }

  const stat = await fs.stat(projectPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const mappings = await readProjectMappings(mappingPath);
  mappings.projects[normalizeProjectKey(projectKey)] = projectPath;
  await writeProjectMappings({ mappingPath, projects: mappings.projects });
}

async function writeProjectMappings({ mappingPath, projects }) {
  await fs.mkdir(path.dirname(mappingPath), { recursive: true });
  const mappings = { projects };
  await fs.writeFile(`${mappingPath}.tmp`, `${JSON.stringify(mappings, null, 2)}\n`, "utf8");
  await fs.rename(`${mappingPath}.tmp`, mappingPath);
}

function parseRunFlags(options) {
  return parseHermesDispatchPayload({
    event_type: "preq.dispatch.requested",
    dispatch: {
      project_key: options["project-key"],
      task_key: options["task-key"],
      objective: options.objective,
      engine: options.engine,
      branch_name: options["branch-name"],
      ask_hint: options["ask-hint"],
      insight_prompt_b64: options["insight-prompt-b64"],
      comment_id: options["comment-id"],
    },
  });
}

async function parseDispatchFromCommand(command, args) {
  const { options } = parseOptions(args);

  if (command === "run-json") {
    const payload = await readJsonFile(requireOption(options, "payload"));
    return parseHermesDispatchPayload(payload);
  }

  if (command === "run-message") {
    const parsed = parseDispatchMessage(requireOption(options, "message"));
    if (!parsed) {
      throw new Error("Message does not contain a PREQSTATION dispatch request");
    }
    return parsed;
  }

  if (command === "run") {
    return parseRunFlags(options);
  }

  throw new Error(`Unsupported command: ${command}`);
}

function printUsage(stdout) {
  stdout.write(
    [
      "Usage:",
      `  ${CLI_COMMAND_NAME} run --project-key PROJ --task-key PROJ-123 --objective implement --engine codex [--branch-name BRANCH] [--comment-id COMMENT_ID]`,
      `  ${CLI_COMMAND_NAME} run-json --payload /path/to/payload.json`,
      `  ${CLI_COMMAND_NAME} run-message --message 'preqstation implement PROJ-123 using codex'`,
      `  ${CLI_COMMAND_NAME} setup set PROJ /absolute/path/to/project`,
      `  ${CLI_COMMAND_NAME} setup auto PROJ=https://github.com/example/project`,
      `  ${CLI_COMMAND_NAME} setup status`,
      `  ${CLI_COMMAND_NAME} install [hermes|openclaw] [--json]`,
      `  ${CLI_COMMAND_NAME} install`,
      `  ${CLI_COMMAND_NAME} update [--force] [--json]`,
      `  ${CLI_COMMAND_NAME} sync hermes [--force]`,
      `  ${CLI_COMMAND_NAME} status hermes`,
      `  ${CLI_COMMAND_NAME} --version`,
      `  ${CLI_COMMAND_NAME} -v`,
      "",
    ].join("\n"),
  );
}

function describeInstallTarget(target) {
  if (target === "openclaw") {
    return "OpenClaw";
  }
  if (target === "hermes") {
    return "Hermes Agent";
  }
  return target;
}

function describeRuntimeTarget(target) {
  if (target === "claude-code") {
    return "Claude Code";
  }
  if (target === "codex") {
    return "Codex";
  }
  if (target === "gemini-cli") {
    return "Gemini CLI";
  }
  return target;
}

function describeInstallResultLabel(result) {
  if (result.category === "runtime_executable") {
    return `${describeRuntimeTarget(result.target)} CLI`;
  }
  if (
    result.action === "mcp_installed" ||
    result.action === "mcp_already_configured" ||
    result.action === "mcp_configured" ||
    result.action === "mcp_missing"
  ) {
    return `${describeRuntimeTarget(result.target)} MCP`;
  }
  if (result.target === "openclaw" || result.target === "hermes") {
    return describeInstallTarget(result.target);
  }
  return describeRuntimeTarget(result.target);
}

function describeInstallResultAction(result) {
  if (result.category === "runtime_executable") {
    if (result.action === "ready") {
      return "ready";
    }
    if (result.action === "needs_attention") {
      return "attention";
    }
  }
  if (result.action === "mcp_installed") {
    return "registered";
  }
  if (result.action === "mcp_already_configured") {
    return "configured";
  }
  if (result.action === "mcp_configured") {
    return "configured";
  }
  if (result.action === "mcp_missing") {
    return "not configured";
  }
  if (result.action === "not_installed") {
    return "not installed";
  }
  if (result.action === "not_enabled") {
    return "not enabled";
  }
  if (result.action === "unavailable") {
    return "unavailable";
  }
  if (result.action === "failed") {
    return "failed";
  }
  if (result.action === "already_current") {
    return "current";
  }
  if (result.action === "updated") {
    return "updated";
  }
  return "installed";
}

function describeInstallResultVersion(result) {
  const nextVersion = result.package_version ?? result.latest_version ?? result.version ?? null;
  const currentVersion = result.installed_version ?? null;

  if (result.action === "updated" && currentVersion && nextVersion && currentVersion !== nextVersion) {
    return `${currentVersion} -> ${nextVersion}`;
  }

  if (result.version) {
    return result.version;
  }

  if (result.action === "already_current" && currentVersion) {
    return currentVersion;
  }

  if (result.action === "not_enabled" && currentVersion) {
    return currentVersion;
  }

  if (result.action === "installed" && nextVersion) {
    return nextVersion;
  }

  return null;
}

function describeInstallResultDetails(result) {
  const details = [];
  const version = describeInstallResultVersion(result);
  if (version) {
    details.push(version);
  }
  if (result.category === "runtime_executable" && result.resolved_path) {
    details.push(result.resolved_path);
  }
  if (result.category === "runtime_executable" && result.alternate_path) {
    details.push(`stable path: ${result.alternate_path}`);
  }
  if (result.action === "not_enabled") {
    details.push(`installed globally, not enabled for ${describeRuntimeTarget(result.target)}`);
  }
  if (result.mcp_url) {
    details.push(result.mcp_url);
  }
  if (result.connection_status) {
    details.push(`status: ${result.connection_status}`);
  }
  if (result.auth) {
    details.push(`auth: ${result.auth}`);
  }
  if (result.restart_command) {
    details.push(`restart: ${result.restart_command}`);
  }
  if (
    result.local_package_version &&
    result.package_version &&
    result.local_package_version !== result.package_version
  ) {
    details.push(`local repo: ${result.local_package_version} unpublished`);
  }
  if (result.error) {
    details.push(result.error);
  }
  return details;
}

function padSummaryCell(value, width) {
  return String(value || "").padEnd(width, " ");
}

function formatSummarySection(title, rows) {
  if (!rows.length) {
    return null;
  }

  const labelWidth = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  const statusWidth = rows.reduce((max, row) => Math.max(max, row.status.length), 0);
  const lines = [title];
  for (const row of rows) {
    lines.push(
      `  ${padSummaryCell(row.label, labelWidth)}  ${padSummaryCell(row.status, statusWidth)}${
        row.details ? `  ${row.details}` : ""
      }`,
    );
  }
  return lines.join("\n");
}

function partitionSummaryRows(entries = []) {
  const hosts = [];
  const support = [];
  const mcp = [];

  for (const entry of entries) {
    const isMcpRow =
      entry.action === "mcp_installed" ||
      entry.action === "mcp_already_configured" ||
      entry.action === "mcp_configured" ||
      entry.action === "mcp_missing";
    const row = {
      label: describeInstallResultLabel(entry),
      status: describeInstallResultAction(entry),
      details: describeInstallResultDetails(entry).join(", "),
    };

    if (isMcpRow) {
      mcp.push(row);
      continue;
    }
    if (entry.target === "openclaw" || entry.target === "hermes") {
      hosts.push(row);
      continue;
    }
    support.push(row);
  }

  return { hosts, support, mcp };
}

function joinSummarySections(title, sections) {
  return `${[title, ...sections.filter(Boolean)].join("\n\n")}\n`;
}

function formatInteractiveInstallSummary(result) {
  const { hosts, support, mcp } = partitionSummaryRows(result.results ?? []);
  const sections = [
    formatSummarySection("Hosts", hosts),
    formatSummarySection("Worker Support", support),
    formatSummarySection(
      "MCP",
      [
        ...(result.mcp_url
          ? [
              {
                label: "Endpoint",
                status: result.mcp_url,
                details: "",
              },
            ]
          : []),
        ...mcp,
      ],
    ),
  ];
  return joinSummarySections("Install summary", sections);
}

function formatInteractiveUpdateSummary(result) {
  const { hosts, support, mcp } = partitionSummaryRows(result.results ?? []);
  const sections = [
    formatSummarySection(
      "Settings",
      [
        ...(result.server_url
          ? [{ label: "Server URL", status: result.server_url, details: "" }]
          : []),
        ...(result.mcp_url ? [{ label: "MCP endpoint", status: result.mcp_url, details: "" }] : []),
      ],
    ),
    formatSummarySection("Hosts", hosts),
    formatSummarySection("Worker Support", support),
    formatSummarySection("MCP", mcp),
  ];
  return joinSummarySections("Update summary", sections);
}

function isMissingExecutableError(error) {
  return error?.code === "ENOENT";
}

function formatMissingExecutableMessage(target, error) {
  const executable = error?.path || error?.spawnargs?.[0] || null;
  if (executable) {
    return `${executable} command not found`;
  }

  return `${target} command not available on this host`;
}

async function runSafeUpdateTarget(target, callback) {
  try {
    return await callback();
  } catch (error) {
    if (isMissingExecutableError(error)) {
      return {
        ok: true,
        target,
        action: "unavailable",
        error: formatMissingExecutableMessage(target, error),
      };
    }
    return {
      ok: false,
      target,
      action: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleSetup({ args, stdout, env }) {
  const [action, projectKey, projectPath] = args;
  const mappingPath = getProjectsFile(env);

  if (action === "set") {
    if (!projectKey || !projectPath) {
      throw new Error(`Usage: ${CLI_COMMAND_NAME} setup set PROJECT_KEY /absolute/path`);
    }
    await writeProjectMapping({ mappingPath, projectKey, projectPath });
    stdout.write(
      `${JSON.stringify({ ok: true, project_key: normalizeProjectKey(projectKey), mapping_file: mappingPath })}\n`,
    );
    return;
  }

  if (action === "auto") {
    const { entries, invalid } = parseAutoMappings(args.slice(1).join(" "));
    if (entries.length === 0) {
      throw new Error(
        `Usage: ${CLI_COMMAND_NAME} setup auto PROJ=https://github.com/example/project`,
      );
    }

    const mappings = await readProjectMappings(mappingPath);
    const discovered = await matchProjectsToRepoRoots(entries, getRepoRoots(env));
    const nextProjects = {
      ...mappings.projects,
      ...discovered.matched,
    };

    if (Object.keys(discovered.matched).length > 0) {
      await writeProjectMappings({ mappingPath, projects: nextProjects });
    }

    stdout.write(
      `${JSON.stringify({
        ok: true,
        mapping_file: mappingPath,
        matched: discovered.matched,
        unmatched: discovered.unmatched,
        invalid,
        projects: nextProjects,
        repo_roots: discovered.repoRoots,
      })}\n`,
    );
    return;
  }

  if (action === "status") {
    const mappings = await readProjectMappings(mappingPath);
    stdout.write(`${JSON.stringify({ ok: true, mapping_file: mappingPath, ...mappings })}\n`);
    return;
  }

  throw new Error(`Usage: ${CLI_COMMAND_NAME} setup set PROJECT_KEY /absolute/path`);
}

async function handleInstallCommand({
  args,
  stdin,
  stdout,
  env,
  runInstallWizard = defaultRunInstallWizard,
}) {
  const { options, positional } = parseOptions(args);
  const [target] = positional;

  if (!target) {
    const result = await runInstallWizard({
      inputStream: stdin,
      outputStream: stdout,
      env,
      force: options.force === "true",
    });
    if (stdout?.isTTY && result?.interactive && options.json !== "true") {
      stdout.write(formatInteractiveInstallSummary(result));
      return result?.ok === false ? 1 : 0;
    }
    stdout.write(`${JSON.stringify(result)}\n`);
    return result?.ok === false ? 1 : 0;
  }

  if (target === "hermes") {
    const result = await syncHermesSkill({
      env,
      force: options.force === "true",
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result?.ok === false ? 1 : 0;
  }

  if (target === "openclaw") {
    const result = await installOpenClawPlugin({ env });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result?.ok === false ? 1 : 0;
  }

  throw new Error(`Usage: ${CLI_COMMAND_NAME} install [hermes|openclaw]`);
}

async function handleUpdateCommand({
  args,
  stdout,
  env,
  getHermesSkillStatusFn = getHermesSkillStatus,
  syncHermesSkillFn = syncHermesSkill,
  installOpenClawPluginFn = installOpenClawPlugin,
  installRuntimeWorkerSupportFn = installRuntimeWorkerSupport,
  inspectRuntimeExecutableHealthFn = inspectRuntimeExecutableHealth,
  inspectRuntimeMcpServersFn = inspectRuntimeMcpServers,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
}) {
  const { options, positional } = parseOptions(args);
  if (positional.length > 0) {
    throw new Error(`Usage: ${CLI_COMMAND_NAME} update [--force] [--json]`);
  }

  const results = [];
  results.push(
    await runSafeUpdateTarget("openclaw", () =>
      installOpenClawPluginFn({
        env,
        updateOnly: true,
      }),
    ),
  );

  results.push(
    await runSafeUpdateTarget("hermes", async () => {
      const status = await getHermesSkillStatusFn({ env });
      if (!status.installed) {
        return {
          ok: true,
          target: "hermes",
          action: "not_installed",
          skill_file: status.skill_file,
          metadata_file: status.metadata_file,
        };
      }
      return syncHermesSkillFn({
        env,
        force: options.force === "true",
      });
    }),
  );

  for (const runtime of UPDATE_RUNTIME_TARGETS) {
    const result = await runSafeUpdateTarget(runtime, async () => {
      const [entry] = await installRuntimeWorkerSupportFn({
        runtimes: [runtime],
        env,
        installMissing: false,
      });
      return entry;
    });
    results.push(result);
  }

  for (const runtime of UPDATE_RUNTIME_TARGETS) {
    const result = await runSafeUpdateTarget(runtime, async () => {
      const [entry] = await inspectRuntimeExecutableHealthFn({
        runtimes: [runtime],
        env,
        launchHosts: UPDATE_HOST_TARGETS,
      });
      return entry;
    });
    results.push(result);
  }

  for (const runtime of UPDATE_RUNTIME_TARGETS) {
    const result = await runSafeUpdateTarget(runtime, async () => {
      const [entry] = await inspectRuntimeMcpServersFn({
        runtimes: [runtime],
        env,
      });
      return entry;
    });
    results.push(result);
  }

  const serverUrl = await resolveDefaultPreqstationServerUrlFn({
    runtimes: UPDATE_RUNTIME_TARGETS,
    env,
  }).catch(() => null);

  const payload = {
    ok: results.every((entry) => entry?.ok !== false),
    action: "updated",
    interactive: true,
    host_targets: UPDATE_HOST_TARGETS,
    runtime_engines: UPDATE_RUNTIME_TARGETS,
    server_url: serverUrl,
    mcp_url: serverUrl ? buildPreqstationMcpUrl(serverUrl) : null,
    results,
  };

  if (stdout?.isTTY && options.json !== "true") {
    stdout.write(formatInteractiveUpdateSummary(payload));
  } else {
    stdout.write(`${JSON.stringify(payload)}\n`);
  }

  return payload.ok ? 0 : 1;
}

async function handlePlatformCommand({ command, args, stdout, env }) {
  const { options, positional } = parseOptions(args);
  const [target] = positional;

  if (command === "status" && target === "hermes") {
    stdout.write(`${JSON.stringify(await getHermesSkillStatus({ env }))}\n`);
    return;
  }

  if (target !== "hermes") {
    throw new Error(`Usage: ${CLI_COMMAND_NAME} ${command} hermes`);
  }

  const result = await syncHermesSkill({
    env,
    force: options.force === "true",
  });
  stdout.write(`${JSON.stringify(result)}\n`);
}

function writeDispatchResult({ stdout, parsed, result }) {
  stdout.write(
    `${JSON.stringify({
      ok: true,
      project_key: parsed.projectKey,
      task_key: parsed.taskKey,
      engine: parsed.engine,
      cwd: result.prepared.cwd,
      branch_name: result.prepared.branchName,
      pid: result.launch.pid,
      log_file: result.launch.logFile,
      pid_file: result.launch.pidFile,
    })}\n`,
  );
}

export async function runDispatcherCli({
  argv,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  dispatchPreqRun = defaultDispatchPreqRun,
  runInstallWizard = defaultRunInstallWizard,
  getHermesSkillStatusFn = getHermesSkillStatus,
  syncHermesSkillFn = syncHermesSkill,
  installOpenClawPluginFn = installOpenClawPlugin,
  installRuntimeWorkerSupportFn = installRuntimeWorkerSupport,
  inspectRuntimeExecutableHealthFn = inspectRuntimeExecutableHealth,
  inspectRuntimeMcpServersFn = inspectRuntimeMcpServers,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
}) {
  const [command, ...args] = argv;

  try {
    if (!command || command === "--help" || command === "help") {
      printUsage(stdout);
      return 0;
    }

    if (command === "--version" || command === "-v" || command === "version") {
      stdout.write(`${await readPackageVersion()}\n`);
      return 0;
    }

    if (command === "setup") {
      await handleSetup({ args, stdout, env });
      return 0;
    }

    if (command === "install") {
      return handleInstallCommand({ args, stdin, stdout, env, runInstallWizard });
    }

    if (command === "update") {
      return handleUpdateCommand({
        args,
        stdout,
        env,
        getHermesSkillStatusFn,
        syncHermesSkillFn,
        installOpenClawPluginFn,
        installRuntimeWorkerSupportFn,
        inspectRuntimeExecutableHealthFn,
        inspectRuntimeMcpServersFn,
        resolveDefaultPreqstationServerUrlFn,
      });
    }

    if (command === "sync" || command === "status") {
      await handlePlatformCommand({ command, args, stdout, env });
      return 0;
    }

    const parsed = await parseDispatchFromCommand(command, args);
    const result = await dispatchPreqRun({
      rawMessage: parsed.rawMessage,
      parsed,
      configuredProjects: null,
      sharedMappingPath: getProjectsFile(env),
      memoryPath: getMemoryPath(env),
      worktreeRoot: getWorktreeRoot(env),
    });

    writeDispatchResult({ stdout, parsed, result });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`error: ${message}\n`);
    return 1;
  }
}
