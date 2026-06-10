import fs from "node:fs/promises";
import path from "node:path";

import {
  box as clackBox,
  log as clackLog,
  note as clackNote,
  outro as clackOutro,
  spinner as clackSpinner,
} from "@clack/prompts";

import { dispatchPreqRun as defaultDispatchPreqRun } from "../core/dispatch-runtime.mjs";
import { parseHermesDispatchPayload } from "../adapters/hermes/payload.mjs";
import { runInstallWizard as defaultRunInstallWizard } from "../install-wizard.mjs";
import { runUninstallWizard as defaultRunUninstallWizard } from "../uninstall-wizard.mjs";
import { resolveWorkerHome } from "../detached-launch.mjs";
import { parseDispatchMessage } from "../parse-dispatch-message.mjs";
import {
  callPreqstationMcpTool as defaultCallPreqstationMcpTool,
  fetchPreqstationProjectsFromMcp as defaultFetchPreqstationProjectsFromMcp,
  inspectPreqstationAuth as defaultInspectPreqstationAuth,
  loginPreqstation as defaultLoginPreqstation,
  logoutPreqstation as defaultLogoutPreqstation,
} from "../preqstation-mcp-client.mjs";
import {
  DispatchError,
  isDispatchError,
  serializeDispatchError,
} from "../dispatch-error.mjs";
import {
  getPreqstationConfigPath,
  getPreqstationDispatchHome,
  getPreqstationErrorLogPath,
  getPreqstationOauthPath,
  writePreqstationConfig as defaultWritePreqstationConfig,
} from "../preqstation-config.mjs";
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
  uninstallHermesSkill,
} from "../hermes-skill-installer.mjs";
import {
  inspectOpenClawPlugin,
  installOpenClawPlugin,
  uninstallOpenClawPlugin,
} from "../openclaw-installer.mjs";
import {
  inspectRuntimeExecutableHealth,
  inspectRuntimeWorkerSupport,
  uninstallRuntimeWorkerSupport,
} from "../runtime-skill-installer.mjs";
import {
  buildPreqstationMcpUrl,
  inspectRuntimeMcpServers,
  resolveDefaultPreqstationServerUrl,
  uninstallRuntimeMcpServers,
} from "../runtime-mcp-installer.mjs";

const UPDATE_HOST_TARGETS = ["openclaw", "hermes"];
const UPDATE_RUNTIME_TARGETS = ["claude-code", "codex", "gemini-cli"];
const WORKER_HOME_ENV_BY_RUNTIME = {
  "claude-code": "PREQSTATION_CLAUDE_HOME",
  codex: "PREQSTATION_CODEX_HOME",
  "gemini-cli": "PREQSTATION_GEMINI_HOME",
};
const PACKAGE_JSON_FILE = new URL("../../package.json", import.meta.url);
const CLI_COMMAND_NAME = "preqstation";
const DEFAULT_CLACK_SUMMARY_UI = {
  box: clackBox,
  log: clackLog,
  note: clackNote,
  outro: clackOutro,
  spinner: clackSpinner,
};
const PROGRESS_SPINNER_OPTIONS = {
  frames: ["-", "\\", "|", "/"],
  delay: 120,
};

const SUMMARY_SECTION_THEMES = {
  Settings: "#9EA1AA",
  "Request entrypoints": "#22D3EE",
  "Agent runtimes": "#10A37F",
  MCP: "#4796E3",
  "Legacy MCP": "#4796E3",
  "CLI Auth": "#10A37F",
  "Worker Auth": "#D97757",
  "Mapped Projects": "#10A37F",
  "Matched Projects": "#10A37F",
  "Unmatched Projects": "#F59E0B",
  "Next steps": "#F59E0B",
  "Install & Update": "#10A37F",
  "Project Setup": "#22D3EE",
  "Direct Dispatch (run without OpenClaw/Hermes)": "#D97757",
  Info: "#9EA1AA",
};

const SUMMARY_SERVICE_THEMES = [
  ["Hermes Agent", "#F37021"],
  ["Claude Code", "#D97757"],
  ["Gemini CLI", "#4796E3"],
  ["OpenClaw", "#22D3EE"],
  ["Codex", "#10A37F"],
];

const SUMMARY_ANSI = {
  reset: "\u001B[0m",
  green: "\u001B[32m",
  red: "\u001B[31m",
  yellow: "\u001B[33m",
};
const HELP_DESCRIPTION =
  "Local dispatcher for PREQSTATION requests across OpenClaw, Hermes Agent, and direct Codex/Claude/Gemini runs.";
const HELP_COMMAND_COLOR = "#10A37F";
const HELP_FLAG_COLOR = "#4796E3";
const HELP_VALUE_COLOR = "#F59E0B";
const HELP_ADVANCED_COLOR = "#A78BFA";
const HELP_SECTIONS = [
  {
    title: "Install & Update",
    commands: [`${CLI_COMMAND_NAME} install`, `${CLI_COMMAND_NAME} uninstall`, `${CLI_COMMAND_NAME} update`],
    advanced: [
      `${CLI_COMMAND_NAME} install --with-mcp`,
      `${CLI_COMMAND_NAME} install openclaw`,
      `${CLI_COMMAND_NAME} install hermes`,
      `${CLI_COMMAND_NAME} uninstall openclaw`,
      `${CLI_COMMAND_NAME} uninstall hermes`,
      `${CLI_COMMAND_NAME} mcp disable codex`,
      `${CLI_COMMAND_NAME} sync hermes`,
      `${CLI_COMMAND_NAME} status hermes`,
    ],
  },
  {
    title: "Project Setup",
    commands: [`${CLI_COMMAND_NAME} setup auto`],
    advanced: [
      `${CLI_COMMAND_NAME} setup set PROJ /absolute/path/to/project`,
      `${CLI_COMMAND_NAME} setup auto PROJ=https://github.com/example/project`,
      `${CLI_COMMAND_NAME} setup status`,
    ],
  },
  {
    title: "Direct Dispatch (run without OpenClaw/Hermes)",
    commands: [
      `${CLI_COMMAND_NAME} run --project-key PROJ --task-key PROJ-123 --objective implement --engine codex`,
      `${CLI_COMMAND_NAME} run-message --message 'preqstation implement PROJ-123 using codex'`,
      `${CLI_COMMAND_NAME} run-json --payload /path/to/payload.json`,
    ],
  },
  {
    title: "Auth",
    commands: [
      `${CLI_COMMAND_NAME} auth login --server-url https://your-preqstation-domain.vercel.app`,
      `${CLI_COMMAND_NAME} auth status`,
      `${CLI_COMMAND_NAME} auth logout`,
      `${CLI_COMMAND_NAME} whoami`,
    ],
  },
  {
    title: "Lifecycle",
    commands: [
      `${CLI_COMMAND_NAME} task get PROJ-123`,
      `${CLI_COMMAND_NAME} task complete PROJ-123 --json-file result.json`,
      `${CLI_COMMAND_NAME} comment reply --comment-id COMMENT_ID --body-file reply.md`,
      `${CLI_COMMAND_NAME} project settings --project PROJ`,
    ],
  },
  {
    title: "Info",
    commands: [
      `${CLI_COMMAND_NAME} status`,
      `${CLI_COMMAND_NAME} doctor`,
      `${CLI_COMMAND_NAME} help`,
      `${CLI_COMMAND_NAME} --version`,
    ],
    advanced: [`${CLI_COMMAND_NAME} --debug status`],
  },
];

function getDispatchHome(env) {
  return getPreqstationDispatchHome(env);
}

function getAuthHome(env) {
  return path.dirname(getPreqstationDispatchHome(env));
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

async function readTextFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function readPackageMetadata() {
  const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON_FILE, "utf8"));
  return {
    version: String(pkg?.version || "").trim(),
  };
}

async function readPackageVersion() {
  return (await readPackageMetadata()).version;
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
      model: options.model,
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

function colorizeHelpCommand(command, enabled) {
  if (!enabled) {
    return command;
  }

  return command
    .replaceAll(CLI_COMMAND_NAME, paintSummaryHex(CLI_COMMAND_NAME, HELP_COMMAND_COLOR, enabled))
    .replace(/\B--[a-z-]+/g, (match) => paintSummaryHex(match, HELP_FLAG_COLOR, enabled))
    .replace(
      /\b(PROJ-\d+|PROJ|BRANCH|COMMENT_ID)\b/g,
      (match) => paintSummaryHex(match, HELP_VALUE_COLOR, enabled),
    )
    .replace(
      /\/(?:absolute\/path\/to\/project|path\/to\/payload\.json)/g,
      (match) => paintSummaryHex(match, HELP_VALUE_COLOR, enabled),
    );
}

function formatHelpSection(section, { color = false } = {}) {
  const lines = section.commands.map((command) => `  ${colorizeHelpCommand(command, color)}`);
  if (section.advanced?.length) {
    lines.push(
      "",
      `  ${paintSummaryHex("Advanced:", HELP_ADVANCED_COLOR, color)}`,
      ...section.advanced.map((command) => `  ${colorizeHelpCommand(command, color)}`),
    );
  }
  return lines.join("\n");
}

function formatHelpText({ version }) {
  return [
    `PREQSTATION`,
    HELP_DESCRIPTION,
    `Version ${version}`,
    "",
    ...HELP_SECTIONS.flatMap((section) => [
      section.title,
      formatHelpSection(section),
      "",
    ]),
  ].join("\n");
}

function renderHelpBoxes({ stdout, version, env = process.env, clackUi = DEFAULT_CLACK_SUMMARY_UI }) {
  if (!stdout?.isTTY || typeof clackUi.box !== "function" || typeof clackUi.note !== "function") {
    return false;
  }

  clackUi.note(`${HELP_DESCRIPTION}\nVersion ${version}`, "PREQSTATION", { output: stdout });
  const color = supportsSummaryColor({ outputStream: stdout, env });
  for (const section of HELP_SECTIONS) {
    const sectionColor = SUMMARY_SECTION_THEMES[section.title] ?? "#9EA1AA";
    clackUi.box(formatHelpSection(section, { color }), section.title, {
      output: stdout,
      width: "auto",
      rounded: true,
      formatBorder: (text) => paintSummaryHex(text, sectionColor, color),
    });
  }
  return true;
}

function printUsage({ stdout, version, env }) {
  if (renderHelpBoxes({ stdout, version, env })) {
    return;
  }
  stdout.write(`${formatHelpText({ version })}\n`);
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

function describeRuntimeCliTarget(target) {
  const label = describeRuntimeTarget(target);
  return label.endsWith("CLI") ? label : `${label} CLI`;
}

function describeInstallResultLabel(result) {
  if (result.category === "runtime_executable") {
    return describeRuntimeCliTarget(result.target);
  }
  if (
    result.action === "mcp_installed" ||
    result.action === "mcp_already_configured" ||
    result.action === "mcp_configured" ||
    result.action === "mcp_missing" ||
    result.action === "mcp_removed" ||
    result.action === "mcp_not_configured"
  ) {
    return `${describeRuntimeTarget(result.target)} legacy MCP`;
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
  if (result.legacy_worker_skill) {
    if (result.action === "failed") {
      return "failed";
    }
    if (["not_installed", "not_enabled", "unavailable"].includes(result.action)) {
      return "optional";
    }
    return "legacy";
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
  if (result.action === "mcp_removed") {
    return "removed";
  }
  if (result.action === "mcp_not_configured") {
    return "not configured";
  }
  if (result.action === "removed") {
    return "removed";
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
  if (result.action === "needs_attention") {
    return "attention";
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

  if (
    (result.action === "updated" || result.action === "needs_attention") &&
    currentVersion &&
    nextVersion &&
    currentVersion !== nextVersion
  ) {
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

  if (result.action === "needs_attention" && currentVersion) {
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
  if (result.legacy) {
    details.push(result.action === "mcp_missing" ? "legacy optional" : "legacy");
  }
  if (result.legacy_worker_skill) {
    details.push("optional worker skill");
  }
  if (result.user_modified) {
    details.push("local changes");
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

function supportsSummaryColor({ outputStream, env = process.env }) {
  if (!outputStream?.isTTY) {
    return false;
  }
  if (env.NO_COLOR) {
    return false;
  }
  if (env.FORCE_COLOR === "0") {
    return false;
  }
  return true;
}

function parseHexColor(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    return null;
  }
  const value = match[1];
  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
}

function paintSummaryHex(text, hex, enabled) {
  const color = parseHexColor(hex);
  if (!enabled || !color) {
    return text;
  }
  return `\u001B[38;2;${color.red};${color.green};${color.blue}m${text}${SUMMARY_ANSI.reset}`;
}

function paintSummaryTone(text, tone, enabled) {
  return enabled ? `${tone}${text}${SUMMARY_ANSI.reset}` : text;
}

function colorizeSummaryStatuses(text, enabled) {
  return text.replace(
    /\b(current|ready|installed|registered|updated|configured|mapped|removed|attention|failed|unmatched|unavailable|not enabled|not installed|not configured)\b/g,
    (match) => {
      if (match === "failed") {
        return paintSummaryTone(match, SUMMARY_ANSI.red, enabled);
      }
      if (
        match === "attention" ||
        match === "unmatched" ||
        match === "unavailable" ||
        match === "not enabled" ||
        match === "not installed" ||
        match === "not configured"
      ) {
        return paintSummaryTone(match, SUMMARY_ANSI.yellow, enabled);
      }
      return paintSummaryTone(match, SUMMARY_ANSI.green, enabled);
    },
  );
}

function colorizeSummaryServices(text, enabled) {
  return SUMMARY_SERVICE_THEMES.reduce(
    (nextText, [label, color]) =>
      nextText.replaceAll(label, paintSummaryHex(label, color, enabled)),
    text,
  );
}

function colorizeSummaryText(text, { outputStream, env }) {
  const color = supportsSummaryColor({ outputStream, env });
  return colorizeSummaryServices(colorizeSummaryStatuses(text, color), color);
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

const SUMMARY_STATUS_PRIORITY = new Map([
  ["failed", 100],
  ["attention", 90],
  ["unavailable", 80],
  ["not enabled", 70],
  ["not installed", 70],
  ["not configured", 70],
  ["updated", 60],
  ["installed", 50],
  ["current", 40],
  ["ready", 40],
  ["registered", 30],
  ["configured", 30],
  ["removed", 20],
  ["legacy", 10],
  ["optional", 10],
]);

function isRuntimeTarget(target) {
  return UPDATE_RUNTIME_TARGETS.includes(target);
}

function isMcpResult(entry) {
  return (
    entry.action === "mcp_installed" ||
    entry.action === "mcp_already_configured" ||
    entry.action === "mcp_configured" ||
    entry.action === "mcp_missing" ||
    entry.action === "mcp_removed" ||
    entry.action === "mcp_not_configured"
  );
}

function isRuntimeWorkerSkillResult(entry) {
  return Boolean(
    entry &&
      isRuntimeTarget(entry.target) &&
      entry.category !== "runtime_executable" &&
      !isMcpResult(entry),
  );
}

function createSummaryRow(entry) {
  return {
    label: describeInstallResultLabel(entry),
    status: describeInstallResultAction(entry),
    details: describeInstallResultDetails(entry).join(", "),
  };
}

function selectMergedRuntimeStatus(rows) {
  return rows
    .filter(Boolean)
    .reduce((selected, row) => {
      if (!selected) {
        return row;
      }
      const selectedPriority = SUMMARY_STATUS_PRIORITY.get(selected.status) ?? 0;
      const rowPriority = SUMMARY_STATUS_PRIORITY.get(row.status) ?? 0;
      return rowPriority > selectedPriority ? row : selected;
    }, null)?.status ?? "ready";
}

function formatMergedRuntimeDetail(prefix, row) {
  if (!row) {
    return null;
  }
  return `${prefix} ${row.status}${row.details ? ` ${row.details}` : ""}`;
}

function mergeRuntimeSummaryRows({ supportRows, executableRows, runtimeOrder }) {
  return runtimeOrder.map((runtime) => {
    const supportRow = supportRows.get(runtime) ?? null;
    const executableRow = executableRows.get(runtime) ?? null;
    return {
      label: describeRuntimeTarget(runtime),
      status: selectMergedRuntimeStatus([supportRow, executableRow]),
      details: [
        formatMergedRuntimeDetail(runtime === "claude-code" ? "plugin" : "skill", supportRow),
        formatMergedRuntimeDetail("CLI", executableRow),
      ]
        .filter(Boolean)
        .join(", "),
    };
  });
}

function partitionSummaryRows(entries = []) {
  const hosts = [];
  const support = [];
  const mcp = [];
  const runtimeSupportRows = new Map();
  const runtimeExecutableRows = new Map();
  const runtimeOrder = [];

  const trackRuntime = (target) => {
    if (!runtimeOrder.includes(target)) {
      runtimeOrder.push(target);
    }
  };

  for (const entry of entries) {
    const row = createSummaryRow(entry);

    if (isMcpResult(entry)) {
      mcp.push(row);
      continue;
    }
    if (entry.target === "openclaw" || entry.target === "hermes") {
      hosts.push(row);
      continue;
    }
    if (isRuntimeTarget(entry.target)) {
      trackRuntime(entry.target);
      if (entry.category === "runtime_executable") {
        runtimeExecutableRows.set(entry.target, row);
      } else {
        runtimeSupportRows.set(entry.target, row);
      }
      continue;
    }
    support.push(row);
  }

  support.push(
    ...mergeRuntimeSummaryRows({
      supportRows: runtimeSupportRows,
      executableRows: runtimeExecutableRows,
      runtimeOrder,
    }),
  );

  return { hosts, support, mcp };
}

function joinSummarySections(title, sections) {
  return `${[title, ...sections.filter(Boolean)].join("\n\n")}\n`;
}

function formatInteractiveInstallSummary(result) {
  const { hosts, support, mcp } = partitionSummaryRows(result.results ?? []);
  const sections = [
    formatSummarySection("Request entrypoints", hosts),
    formatSummarySection("Agent runtimes", support),
    formatSummarySection(
      "Legacy MCP",
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
    ...formatProjectSetupSections(result.project_setup),
  ];
  return joinSummarySections("Install summary", sections);
}

function formatProjectSetupSections(projectSetup) {
  if (!projectSetup) {
    return [];
  }

  if (projectSetup.ok === false) {
    return [
      formatSummarySection("Project Setup", [
        {
          label: "setup auto",
          status: "failed",
          details: projectSetup.error || "",
        },
      ]),
    ];
  }

  const matchedEntries = Object.entries(projectSetup.matched ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const unmatchedCount = (projectSetup.unmatched ?? []).length;
  const details = [
    `${matchedEntries.length} matched`,
    ...(unmatchedCount > 0 ? [`${unmatchedCount} unmatched`] : []),
  ].join(", ");

  return [
    formatSummarySection("Project Setup", [
      {
        label: "PREQ projects",
        status: "configured",
        details,
      },
      {
        label: "Mapping file",
        status: "ready",
        details: projectSetup.mapping_file,
      },
    ]),
    formatSummarySection(
      "Matched Projects",
      matchedEntries.map(([projectKey, projectPath]) => ({
        label: projectKey,
        status: "mapped",
        details: projectPath,
      })),
    ),
    formatSummarySection(
      "Unmatched Projects",
      (projectSetup.unmatched ?? []).map((project) => ({
        label: project.projectKey || "UNKNOWN",
        status: "unmatched",
        details: project.repoUrl || "",
      })),
    ),
  ];
}

function formatInteractiveProjectSetupSummary(projectSetup) {
  return joinSummarySections("Project setup", formatProjectSetupSections(projectSetup));
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
        ...(result.mcp_url ? [{ label: "Legacy MCP endpoint", status: result.mcp_url, details: "" }] : []),
      ],
    ),
    formatSummarySection("Request entrypoints", hosts),
    formatSummarySection("Agent runtimes", support),
    formatSummarySection("Legacy MCP", mcp),
    ...formatProjectSetupSections(result.project_setup),
  ];
  return joinSummarySections("Update summary", sections);
}

function formatDoctorProjectMappingSections(projectMappings) {
  if (!projectMappings) {
    return [];
  }

  const projectEntries = Object.entries(projectMappings.projects ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return [
    formatSummarySection("Project Setup", [
      {
        label: "Project mappings",
        status: projectMappings.total > 0 ? "ready" : "not configured",
        details: projectMappings.mapping_file,
      },
      {
        label: "Mapped projects",
        status: projectMappings.total > 0 ? "ready" : "not configured",
        details: `${projectMappings.total} configured`,
      },
      ...(projectMappings.missing.length > 0
        ? [
            {
              label: "Missing paths",
              status: "attention",
              details: `${projectMappings.missing.length} missing`,
            },
          ]
        : []),
    ]),
    formatSummarySection(
      "Mapped Projects",
      projectEntries.map(([projectKey, projectPath]) => ({
        label: projectKey,
        status: projectMappings.missing.some((entry) => entry.project_key === projectKey)
          ? "attention"
          : "ready",
        details: projectPath,
      })),
    ),
  ];
}

function formatDoctorSummary(result) {
  const { hosts, support, mcp } = partitionSummaryRows(result.results ?? []);
  const sections = [
    formatSummarySection(
      "Settings",
      [
        {
          label: "Server URL",
          status: result.server_url || "not configured",
          details: "",
        },
        ...(result.mcp_url ? [{ label: "Legacy MCP endpoint", status: result.mcp_url, details: "" }] : []),
        ...(result.auth
          ? [
              {
                label: "CLI auth",
                status: result.auth.ok ? "ready" : "attention",
                details: result.auth.auth_source || result.auth.oauth_path || "",
              },
            ]
          : []),
      ],
    ),
    formatSummarySection("Request entrypoints", hosts),
    formatSummarySection("Agent runtimes", support),
    formatSummarySection("Legacy MCP", mcp),
    formatSummarySection(
      "Worker Auth",
      (result.worker_auth ?? []).map((entry) => ({
        label: describeRuntimeTarget(entry.target),
        status: entry.ok ? "ready" : "attention",
        details: [entry.worker_home, entry.auth_source || entry.oauth_path].filter(Boolean).join(" "),
      })),
    ),
    ...formatDoctorProjectMappingSections(result.project_mappings),
    formatSummarySection(
      "Next steps",
      result.recommendations.map((command) => ({
        label: "Run",
        status: command,
        details: "",
      })),
    ),
  ];
  return joinSummarySections("Doctor summary", sections);
}

function formatInteractiveUninstallSummary(result) {
  const { hosts, support, mcp } = partitionSummaryRows(result.results ?? []);
  const sections = [
    formatSummarySection("Request entrypoints", hosts),
    formatSummarySection("Agent runtimes", support),
    formatSummarySection("Legacy MCP", mcp),
    formatSummarySection("Settings", [
      {
        label: "Project mappings",
        status: "kept",
        details: result.projects_file || "",
      },
    ]),
  ];
  return joinSummarySections("Uninstall summary", sections);
}

function summaryBody(summary, title) {
  const trimmed = summary.trimEnd();
  const prefix = `${title}\n\n`;
  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length);
  }
  return trimmed;
}

function parseSummarySections(summary) {
  return summary
    .trimEnd()
    .split(/\n{2,}/)
    .map((block) => {
      const [sectionTitle, ...lines] = block.split("\n");
      return {
        title: sectionTitle,
        body: lines.join("\n"),
      };
    })
    .filter((section) => section.title && section.body);
}

function renderInteractiveSummaryBoxes({ stdout, title, summary, clackUi, env }) {
  const sections = parseSummarySections(summaryBody(summary, title));
  if (!stdout?.isTTY || typeof clackUi.box !== "function" || sections.length === 0) {
    return false;
  }

  if (typeof clackUi.log?.step === "function") {
    clackUi.log.step(title, { output: stdout });
  } else {
    stdout.write(`${title}\n`);
  }

  const color = supportsSummaryColor({ outputStream: stdout, env });
  for (const section of sections) {
    const sectionColor = SUMMARY_SECTION_THEMES[section.title] ?? "#9EA1AA";
    clackUi.box(
      colorizeSummaryText(section.body, { outputStream: stdout, env }),
      section.title,
      {
        output: stdout,
        width: 0.9,
        rounded: true,
        formatBorder: (text) => paintSummaryHex(text, sectionColor, color),
      },
    );
  }
  return true;
}

function renderInteractiveSummary({
  stdout,
  title,
  summary,
  completeMessage,
  env = process.env,
  clackUi = DEFAULT_CLACK_SUMMARY_UI,
}) {
  if (renderInteractiveSummaryBoxes({ stdout, title, summary, clackUi, env })) {
    clackUi.outro(completeMessage, { output: stdout });
    return;
  }
  clackUi.note(summaryBody(summary, title), title, { output: stdout });
  clackUi.outro(completeMessage, { output: stdout });
}

function canRenderProgress({ stdout, options, clackUi }) {
  return Boolean(
    stdout?.isTTY &&
      options.json !== "true" &&
      typeof clackUi?.spinner === "function" &&
      (clackUi.spinner !== clackSpinner || typeof stdout.on === "function"),
  );
}

function renderUpdatePlan({ stdout, options, clackUi }) {
  if (!stdout?.isTTY || options.json === "true" || typeof clackUi?.note !== "function") {
    return;
  }

  clackUi.note(
    [
      "Refresh installed request entrypoints",
      "Check optional legacy worker skills",
      "Check agent CLI paths and legacy MCP registrations",
      "Refresh project mappings from PREQ MCP",
    ].join("\n"),
    "Update plan",
    { output: stdout },
  );
}

async function runProgressStep({ stdout, clackUi, title, done, enabled, task }) {
  if (!enabled) {
    return task();
  }

  const progress = clackUi.spinner({ output: stdout, ...PROGRESS_SPINNER_OPTIONS });
  progress.start(title);
  try {
    const result = await task();
    progress.stop(done);
    return result;
  } catch (error) {
    progress.error?.(`${title} failed`);
    throw error;
  }
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

async function runSafeDoctorTarget(target, callback) {
  try {
    return await callback();
  } catch (error) {
    return {
      ok: false,
      target,
      action: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeHermesStatusForSummary(status) {
  return {
    ok: status?.ok !== false,
    target: "hermes",
    action:
      !status?.installed
        ? "not_installed"
        : status.current && !status.user_modified
          ? "already_current"
          : "needs_attention",
    installed_version: status?.installed_version ?? null,
    version: status?.installed_version ?? null,
    skill_file: status?.skill_file,
    metadata_file: status?.metadata_file,
    user_modified: Boolean(status?.user_modified),
  };
}

async function inspectCliAuthStatus({
  env,
  serverUrl,
  inspectPreqstationAuthFn,
}) {
  const paths = createAuthPaths(env);
  const auth = await inspectPreqstationAuthFn({
    oauthPath: paths.oauth_path,
    env,
  });
  return {
    ok: Boolean(serverUrl) && auth.authenticated,
    target: "cli-auth",
    action: Boolean(serverUrl) && auth.authenticated ? "ready" : "needs_attention",
    server_url: serverUrl,
    authenticated: auth.authenticated,
    auth_source: auth.auth_source,
    oauth_cache_exists: auth.oauth_cache_exists,
    ...paths,
  };
}

function hasWorkerHomeOverride(env, runtime) {
  const runtimeKey = WORKER_HOME_ENV_BY_RUNTIME[runtime];
  return Boolean(
    (runtimeKey && String(env?.[runtimeKey] || "").trim()) ||
      String(env?.PREQSTATION_WORKER_HOME || "").trim(),
  );
}

async function inspectWorkerAuthStatuses({
  env,
  runtimes,
  inspectPreqstationAuthFn,
  resolveDefaultPreqstationServerUrlFn,
}) {
  const entries = [];
  for (const runtime of runtimes) {
    if (!hasWorkerHomeOverride(env, runtime)) {
      continue;
    }
    const workerEnv = {
      ...env,
      HOME: resolveWorkerHome(env, runtime),
    };
    const serverUrl = await resolveDefaultPreqstationServerUrlFn({
      env: workerEnv,
      runtimes: [],
    }).catch(() => null);
    const status = await inspectCliAuthStatus({
      env: workerEnv,
      serverUrl,
      inspectPreqstationAuthFn,
    });
    entries.push({
      ...status,
      target: runtime,
      worker_home: workerEnv.HOME,
    });
  }
  return entries;
}

function markLegacyMcpResults(results) {
  return (Array.isArray(results) ? results : []).map((entry) =>
    isMcpResult(entry) ? { ...entry, legacy: true } : entry,
  );
}

function markLegacyWorkerSkillResults(results) {
  return (Array.isArray(results) ? results : []).map((entry) =>
    isRuntimeWorkerSkillResult(entry) ? { ...entry, legacy_worker_skill: true } : entry,
  );
}

async function inspectProjectMappings({ env }) {
  const mappingPath = getProjectsFile(env);
  const mappings = await readProjectMappings(mappingPath);
  const entries = Object.entries(mappings.projects ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const missing = [];

  for (const [projectKey, projectPath] of entries) {
    const stat = await fs.stat(projectPath).catch(() => null);
    if (!stat?.isDirectory()) {
      missing.push({
        project_key: projectKey,
        project_path: projectPath,
      });
    }
  }

  return {
    ok: entries.length > 0 && missing.length === 0,
    mapping_file: mappingPath,
    total: entries.length,
    missing,
    projects: Object.fromEntries(entries),
  };
}

function isDoctorEntryHealthy(entry) {
  if (entry?.ok === false) {
    return false;
  }
  if (entry?.legacy_worker_skill) {
    return true;
  }
  return !["failed", "unavailable", "needs_attention"].includes(entry?.action);
}

function buildDoctorRecommendations({ serverUrl, projectMappings, results, authStatus, workerAuth }) {
  const recommendations = [];
  const add = (command) => {
    if (!recommendations.includes(command)) {
      recommendations.push(command);
    }
  };

  if (
    !serverUrl ||
    results.some((entry) =>
      !isMcpResult(entry) &&
      !entry?.legacy_worker_skill &&
      ["not_installed", "not_enabled", "unavailable"].includes(entry?.action),
    )
  ) {
    add(`${CLI_COMMAND_NAME} install`);
  }
  if (authStatus && !authStatus.ok) {
    add(`${CLI_COMMAND_NAME} auth login --server-url ${serverUrl || "https://<your-domain>"}`);
  }
  if ((workerAuth ?? []).some((entry) => !entry.ok)) {
    add(`${CLI_COMMAND_NAME} auth login --server-url ${serverUrl || "https://<your-domain>"}`);
  }
  if (results.some((entry) => !entry?.legacy_worker_skill && entry?.action === "needs_attention")) {
    add(`${CLI_COMMAND_NAME} update`);
  }
  if (!projectMappings?.ok) {
    add(`${CLI_COMMAND_NAME} setup auto`);
  }

  return recommendations;
}

async function performSetupAuto({
  env,
  stderr,
  entries: initialEntries = [],
  invalid: initialInvalid = [],
  serverUrl = null,
  fetchPreqstationProjectsFn = defaultFetchPreqstationProjectsFromMcp,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
}) {
  const mappingPath = getProjectsFile(env);
  let entries = initialEntries;
  let invalid = initialInvalid;
  let projectSource = "arguments";

  if (entries.length === 0) {
    const resolvedServerUrl =
      serverUrl ||
      (await resolveDefaultPreqstationServerUrlFn({
        env,
      }));
    if (!resolvedServerUrl) {
      throw new Error(
        `Usage: ${CLI_COMMAND_NAME} setup auto PROJ=https://github.com/example/project, or run ${CLI_COMMAND_NAME} install to configure PREQ MCP first`,
      );
    }

    entries = await fetchPreqstationProjectsFn({
      serverUrl: resolvedServerUrl,
      oauthPath: path.join(getDispatchHome(env), "oauth.json"),
      env,
      onLoginUrl: (url) => {
        stderr?.write?.(`Open PREQSTATION login in your browser: ${url}\n`);
      },
    });
    invalid = [];
    projectSource = "preqstation_mcp";

    if (entries.length === 0) {
      throw new Error("No PREQ projects with repo URLs were returned by PREQSTATION MCP");
    }
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

  return {
    ok: true,
    mapping_file: mappingPath,
    matched: discovered.matched,
    unmatched: discovered.unmatched,
    invalid,
    projects: nextProjects,
    repo_roots: discovered.repoRoots,
    ...(projectSource === "preqstation_mcp" ? { project_source: projectSource } : {}),
  };
}

async function runInstallSetupAuto({
  installResult,
  env,
  stderr,
  fetchPreqstationProjectsFn,
  resolveDefaultPreqstationServerUrlFn,
}) {
  if (installResult?.ok === false) {
    return null;
  }

  const serverUrl =
    installResult?.preqstation_server_url ||
    (await resolveDefaultPreqstationServerUrlFn({
      env,
    }));
  if (!serverUrl) {
    return null;
  }

  return runMcpBackedSetupAuto({
    env,
    stderr,
    serverUrl,
    fetchPreqstationProjectsFn,
    resolveDefaultPreqstationServerUrlFn,
  });
}

async function persistInstallServerUrl({
  installResult,
  env,
  writePreqstationConfigFn,
}) {
  if (installResult?.ok === false || !installResult?.preqstation_server_url) {
    return null;
  }
  return writePreqstationConfigFn({
    env,
    serverUrl: installResult.preqstation_server_url,
  });
}

async function runMcpBackedSetupAuto({
  env,
  stderr,
  serverUrl,
  fetchPreqstationProjectsFn,
  resolveDefaultPreqstationServerUrlFn,
}) {
  try {
    return await performSetupAuto({
      env,
      stderr,
      entries: [],
      invalid: [],
      serverUrl,
      fetchPreqstationProjectsFn,
      resolveDefaultPreqstationServerUrlFn,
    });
  } catch (error) {
    return {
      ok: false,
      target: "setup-auto",
      action: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mergeInstallSetupAutoResult(installResult, setupAutoResult) {
  if (!setupAutoResult) {
    return installResult;
  }

  return {
    ...installResult,
    ok: installResult?.ok !== false && setupAutoResult.ok !== false,
    project_setup: setupAutoResult,
  };
}

async function handleSetup({
  args,
  stdout,
  stderr,
  env,
  fetchPreqstationProjectsFn = defaultFetchPreqstationProjectsFromMcp,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
}) {
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
    const { options, positional } = parseOptions(args.slice(1));
    const { entries, invalid } = parseAutoMappings(positional.join(" "));
    const result = await performSetupAuto({
      env,
      stderr,
      entries,
      invalid,
      serverUrl: options["server-url"] || null,
      fetchPreqstationProjectsFn,
      resolveDefaultPreqstationServerUrlFn,
    });
    if (stdout?.isTTY && options.json !== "true") {
      renderInteractiveSummary({
        stdout,
        title: "Project setup",
        summary: formatInteractiveProjectSetupSummary(result),
        completeMessage: result?.ok === false ? "Setup needs attention" : "Setup complete",
        env,
      });
      return;
    }
    stdout.write(`${JSON.stringify(result)}\n`);
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
  stderr,
  env,
  runInstallWizard = defaultRunInstallWizard,
  fetchPreqstationProjectsFn = defaultFetchPreqstationProjectsFromMcp,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
  writePreqstationConfigFn = defaultWritePreqstationConfig,
}) {
  const { options, positional } = parseOptions(args);
  const [target] = positional;

  if (!target) {
    const result = await runInstallWizard({
      inputStream: stdin,
      outputStream: stdout,
      env,
      force: options.force === "true",
      withMcp: options["with-mcp"] === "true",
    });
    await persistInstallServerUrl({
      installResult: result,
      env,
      writePreqstationConfigFn,
    });
    const setupAutoResult = await runInstallSetupAuto({
      installResult: result,
      env,
      stderr,
      fetchPreqstationProjectsFn,
      resolveDefaultPreqstationServerUrlFn,
    });
    const installResult = mergeInstallSetupAutoResult(result, setupAutoResult);
    if (stdout?.isTTY && result?.interactive && options.json !== "true") {
      renderInteractiveSummary({
        stdout,
        title: "Install summary",
        summary: formatInteractiveInstallSummary(installResult),
        completeMessage: installResult?.ok === false ? "Install needs attention" : "Install complete",
        env,
      });
      return installResult?.ok === false ? 1 : 0;
    }
    stdout.write(`${JSON.stringify(installResult)}\n`);
    return installResult?.ok === false ? 1 : 0;
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

async function handleUninstallCommand({
  args,
  stdin,
  stdout,
  stderr,
  env,
  runUninstallWizard = defaultRunUninstallWizard,
  uninstallHermesSkillFn = uninstallHermesSkill,
  uninstallOpenClawPluginFn = uninstallOpenClawPlugin,
  uninstallRuntimeWorkerSupportFn = uninstallRuntimeWorkerSupport,
  uninstallRuntimeMcpServersFn = uninstallRuntimeMcpServers,
}) {
  const { options, positional } = parseOptions(args);
  const [target] = positional;
  const force = options.force === "true";

  if (!target) {
    const result = await runUninstallWizard({
      inputStream: stdin,
      outputStream: stdout,
      env,
      force,
      uninstallHermesSkillFn,
      uninstallOpenClawPluginFn,
      uninstallRuntimeWorkerSupportFn,
      uninstallRuntimeMcpServersFn,
    });
    const uninstallResult = {
      ...result,
      projects_file: getProjectsFile(env),
    };
    if (stdout?.isTTY && result?.interactive && options.json !== "true") {
      renderInteractiveSummary({
        stdout,
        title: "Uninstall summary",
        summary: formatInteractiveUninstallSummary(uninstallResult),
        completeMessage: uninstallResult?.ok === false ? "Uninstall needs attention" : "Uninstall complete",
        env,
      });
      return uninstallResult?.ok === false ? 1 : 0;
    }
    stdout.write(`${JSON.stringify(uninstallResult)}\n`);
    return uninstallResult?.ok === false ? 1 : 0;
  }

  if (target === "hermes") {
    const result = await uninstallHermesSkillFn({ env, force });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result?.ok === false ? 1 : 0;
  }

  if (target === "openclaw") {
    const result = await uninstallOpenClawPluginFn({ env });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result?.ok === false ? 1 : 0;
  }

  if (["claude-code", "codex", "gemini-cli"].includes(target)) {
    const results = [
      ...markLegacyMcpResults(await uninstallRuntimeMcpServersFn({ env, runtimes: [target] })),
      ...(await uninstallRuntimeWorkerSupportFn({ env, runtimes: [target] })),
    ];
    const result = {
      ok: results.every((entry) => entry?.ok !== false),
      action: "uninstalled",
      runtime_engines: [target],
      projects_file: getProjectsFile(env),
      results,
    };
    stdout.write(`${JSON.stringify(result)}\n`);
    return result?.ok === false ? 1 : 0;
  }

  throw new Error(`Usage: ${CLI_COMMAND_NAME} uninstall [hermes|openclaw|claude-code|codex|gemini-cli]`);
}

async function handleDoctorCommand({
  args,
  stdout,
  env,
  clackUi = DEFAULT_CLACK_SUMMARY_UI,
  action = "doctor",
  usageCommand = "doctor",
  summaryTitle = "Doctor summary",
  cleanMessage = "Doctor clean",
  attentionMessage = "Doctor needs attention",
  inspectOpenClawPluginFn = inspectOpenClawPlugin,
  getHermesSkillStatusFn = getHermesSkillStatus,
  inspectRuntimeWorkerSupportFn = inspectRuntimeWorkerSupport,
  inspectRuntimeExecutableHealthFn = inspectRuntimeExecutableHealth,
  inspectRuntimeMcpServersFn = inspectRuntimeMcpServers,
  inspectPreqstationAuthFn = defaultInspectPreqstationAuth,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
}) {
  const { options, positional } = parseOptions(args);
  if (positional.length > 0) {
    throw new Error(`Usage: ${CLI_COMMAND_NAME} ${usageCommand} [--json]`);
  }

  const progressEnabled = canRenderProgress({ stdout, options, clackUi });
  const serverUrl = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking PREQSTATION server URL",
    done: "PREQSTATION server URL checked",
    task: () =>
      resolveDefaultPreqstationServerUrlFn({
        runtimes: UPDATE_RUNTIME_TARGETS,
        env,
      }).catch(() => null),
  });
  const projectMappings = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking project mappings",
    done: "Project mappings checked",
    task: () => inspectProjectMappings({ env }),
  });
  const authStatus = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking CLI auth",
    done: "CLI auth checked",
    task: () =>
      inspectCliAuthStatus({
        env,
        serverUrl,
        inspectPreqstationAuthFn,
      }),
  });
  const workerAuth = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking worker CLI auth",
    done: "Worker CLI auth checked",
    task: () =>
      inspectWorkerAuthStatuses({
        env,
        runtimes: UPDATE_RUNTIME_TARGETS,
        inspectPreqstationAuthFn,
        resolveDefaultPreqstationServerUrlFn,
      }),
  });
  const results = [];

  const entrypointResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking request entrypoints",
    done: "Request entrypoints checked",
    task: async () => [
      await runSafeDoctorTarget("openclaw", () =>
        inspectOpenClawPluginFn({
          env,
        }),
      ),
      await runSafeDoctorTarget("hermes", async () =>
        normalizeHermesStatusForSummary(await getHermesSkillStatusFn({ env })),
      ),
    ],
  });
  results.push(...entrypointResults);

  const workerSupportResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking optional legacy worker skills",
    done: "Optional legacy worker skills checked",
    task: () =>
      runSafeDoctorTarget("agent-runtimes", () =>
        inspectRuntimeWorkerSupportFn({
          runtimes: UPDATE_RUNTIME_TARGETS,
          env,
        }),
      ),
  });
  results.push(
    ...markLegacyWorkerSkillResults(
      Array.isArray(workerSupportResults)
        ? workerSupportResults
        : UPDATE_RUNTIME_TARGETS.map((target) => ({ ...workerSupportResults, target })),
    ),
  );

  const runtimeHealthResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking agent CLI paths",
    done: "Agent CLI paths checked",
    task: () =>
      runSafeDoctorTarget("runtime-executables", () =>
        inspectRuntimeExecutableHealthFn({
          runtimes: UPDATE_RUNTIME_TARGETS,
          env,
          launchHosts: UPDATE_HOST_TARGETS,
        }),
      ),
  });
  results.push(
    ...(Array.isArray(runtimeHealthResults)
      ? runtimeHealthResults
      : UPDATE_RUNTIME_TARGETS.map((target) => ({ ...runtimeHealthResults, target }))),
  );

  const mcpResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking legacy MCP registrations",
    done: "Legacy MCP registrations checked",
    task: () =>
      runSafeDoctorTarget("mcp", () =>
        inspectRuntimeMcpServersFn({
          runtimes: UPDATE_RUNTIME_TARGETS,
          env,
        }),
      ),
  });
  results.push(
    ...markLegacyMcpResults(
      Array.isArray(mcpResults)
        ? mcpResults
        : UPDATE_RUNTIME_TARGETS.map((target) => ({ ...mcpResults, target })),
    ),
  );

  const recommendations = buildDoctorRecommendations({
    serverUrl,
    projectMappings,
    results,
    authStatus,
    workerAuth,
  });
  const payload = {
    ok:
      projectMappings.ok &&
      authStatus.ok &&
      workerAuth.every((entry) => entry.ok) &&
      results.every(isDoctorEntryHealthy),
    action,
    server_url: serverUrl,
    mcp_url: serverUrl ? buildPreqstationMcpUrl(serverUrl) : null,
    auth: authStatus,
    worker_auth: workerAuth,
    project_mappings: projectMappings,
    recommendations,
    results,
  };

  if (stdout?.isTTY && options.json !== "true") {
    renderInteractiveSummary({
      stdout,
      title: summaryTitle,
      summary: formatDoctorSummary(payload).replace(/^Doctor summary/u, summaryTitle),
      completeMessage: payload.ok ? cleanMessage : attentionMessage,
      env,
      clackUi,
    });
  } else {
    stdout.write(`${JSON.stringify(payload)}\n`);
  }

  return payload.ok ? 0 : 1;
}

async function handleUpdateCommand({
  args,
  stdout,
  stderr,
  env,
  clackUi = DEFAULT_CLACK_SUMMARY_UI,
  getHermesSkillStatusFn = getHermesSkillStatus,
  syncHermesSkillFn = syncHermesSkill,
  installOpenClawPluginFn = installOpenClawPlugin,
  inspectRuntimeWorkerSupportFn = inspectRuntimeWorkerSupport,
  inspectRuntimeExecutableHealthFn = inspectRuntimeExecutableHealth,
  inspectRuntimeMcpServersFn = inspectRuntimeMcpServers,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
  fetchPreqstationProjectsFn = defaultFetchPreqstationProjectsFromMcp,
}) {
  const { options, positional } = parseOptions(args);
  if (positional.length > 0) {
    throw new Error(`Usage: ${CLI_COMMAND_NAME} update [--force] [--json]`);
  }

  renderUpdatePlan({ stdout, options, clackUi });
  const progressEnabled = canRenderProgress({ stdout, options, clackUi });
  const results = [];

  const entrypointResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Refreshing request entrypoints",
    done: "Request entrypoints refreshed",
    task: async () => [
      await runSafeUpdateTarget("openclaw", () =>
        installOpenClawPluginFn({
          env,
          updateOnly: true,
        }),
      ),
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
    ],
  });
  results.push(...entrypointResults);

  const workerSupportResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking optional legacy worker skills",
    done: "Optional legacy worker skills checked",
    task: async () => {
      const entries = [];
      for (const runtime of UPDATE_RUNTIME_TARGETS) {
        const result = await runSafeUpdateTarget(runtime, async () => {
          const [entry] = await inspectRuntimeWorkerSupportFn({
            runtimes: [runtime],
            env,
          });
          return entry;
        });
        entries.push(result);
      }
      return entries;
    },
  });
  results.push(...markLegacyWorkerSkillResults(workerSupportResults));

  const runtimeHealthResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking agent CLI paths",
    done: "Agent CLI paths checked",
    task: async () => {
      const entries = [];
      for (const runtime of UPDATE_RUNTIME_TARGETS) {
        const result = await runSafeUpdateTarget(runtime, async () => {
          const [entry] = await inspectRuntimeExecutableHealthFn({
            runtimes: [runtime],
            env,
            launchHosts: UPDATE_HOST_TARGETS,
          });
          return entry;
        });
        entries.push(result);
      }
      return entries;
    },
  });
  results.push(...runtimeHealthResults);

  const mcpResults = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Checking legacy MCP registrations",
    done: "Legacy MCP registrations checked",
    task: async () => {
      const entries = [];
      for (const runtime of UPDATE_RUNTIME_TARGETS) {
        const result = await runSafeUpdateTarget(runtime, async () => {
          const [entry] = await inspectRuntimeMcpServersFn({
            runtimes: [runtime],
            env,
          });
          return entry;
        });
        entries.push(result);
      }
      return entries;
    },
  });
  results.push(...markLegacyMcpResults(mcpResults));

  const serverUrl = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Resolving PREQSTATION server URL",
    done: "PREQSTATION server URL resolved",
    task: () =>
      resolveDefaultPreqstationServerUrlFn({
        runtimes: UPDATE_RUNTIME_TARGETS,
        env,
      }).catch(() => null),
  });
  const setupAutoResult = await runProgressStep({
    stdout,
    clackUi,
    enabled: progressEnabled,
    title: "Refreshing project mappings",
    done: "Project mappings refreshed",
    task: () =>
      runMcpBackedSetupAuto({
        env,
        stderr,
        serverUrl,
        fetchPreqstationProjectsFn,
        resolveDefaultPreqstationServerUrlFn,
      }),
  });

  const payload = {
    ok: results.every((entry) => entry?.ok !== false) && setupAutoResult?.ok !== false,
    action: "updated",
    interactive: true,
    host_targets: UPDATE_HOST_TARGETS,
    runtime_engines: UPDATE_RUNTIME_TARGETS,
    server_url: serverUrl,
    mcp_url: serverUrl ? buildPreqstationMcpUrl(serverUrl) : null,
    project_setup: setupAutoResult,
    results,
  };

  if (stdout?.isTTY && options.json !== "true") {
    renderInteractiveSummary({
      stdout,
      title: "Update summary",
      summary: formatInteractiveUpdateSummary(payload),
      completeMessage: payload.ok ? "Update complete" : "Update needs attention",
      env,
      clackUi,
    });
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

function parseMcpToolArguments(options) {
  const rawJson = options.json;
  if (!rawJson) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`Invalid --json payload: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--json payload must be a JSON object");
  }

  return parsed;
}

async function handleMcpCommand({
  args,
  stdout,
  env,
  callPreqstationMcpToolFn,
  resolveDefaultPreqstationServerUrlFn,
  uninstallRuntimeMcpServersFn,
}) {
  const { options, positional } = parseOptions(args);
  const [subcommand, toolName] = positional;
  if (subcommand === "disable") {
    const target = toolName;
    if (!UPDATE_RUNTIME_TARGETS.includes(target)) {
      throw new Error(
        `Usage: ${CLI_COMMAND_NAME} mcp disable <${UPDATE_RUNTIME_TARGETS.join("|")}>`,
      );
    }
    const results = await uninstallRuntimeMcpServersFn({
      env,
      runtimes: [target],
    });
    const payload = {
      ok: results.every((entry) => entry?.ok !== false),
      action: "mcp_disabled",
      runtime_engines: [target],
      results: markLegacyMcpResults(results),
    };
    stdout.write(`${JSON.stringify(payload)}\n`);
    return payload.ok ? 0 : 1;
  }

  if (subcommand !== "call" || !toolName) {
    throw new Error(
      `Usage: ${CLI_COMMAND_NAME} mcp call <tool-name> --json '{"taskId":"PROJ-123"}' or ${CLI_COMMAND_NAME} mcp disable <runtime>`,
    );
  }

  const serverUrl =
    options["server-url"] ||
    (await resolveDefaultPreqstationServerUrlFn({
      env,
    }));
  if (!serverUrl) {
    throw new Error(
      `PREQSTATION server URL is required. Run ${CLI_COMMAND_NAME} install or pass --server-url https://<your-domain>.`,
    );
  }

  const result = await callPreqstationMcpToolFn({
    serverUrl,
    oauthPath: getPreqstationOauthPath(env),
    toolName,
    toolArguments: parseMcpToolArguments(options),
    env,
  });
  stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

function createAuthPaths(env) {
  const dispatchHome = getPreqstationDispatchHome(env);
  return {
    home: getAuthHome(env),
    dispatch_home: dispatchHome,
    config_path: getPreqstationConfigPath(env),
    oauth_path: getPreqstationOauthPath(env),
  };
}

async function handleAuthCommand({
  args,
  stdout,
  stderr,
  env,
  resolveDefaultPreqstationServerUrlFn,
  loginPreqstationFn,
  inspectPreqstationAuthFn,
  logoutPreqstationFn,
  writePreqstationConfigFn,
}) {
  const { options, positional } = parseOptions(args);
  const [subcommand] = positional;
  const paths = createAuthPaths(env);

  if (subcommand === "status") {
    const [serverUrl, auth] = await Promise.all([
      resolveDefaultPreqstationServerUrlFn({ env }).catch(() => null),
      inspectPreqstationAuthFn({ oauthPath: paths.oauth_path, env }),
    ]);
    const payload = {
      ok: Boolean(serverUrl) && auth.authenticated,
      action: "auth_status",
      authenticated: auth.authenticated,
      auth_source: auth.auth_source,
      server_url: serverUrl,
      ...paths,
      oauth_cache_exists: auth.oauth_cache_exists,
    };
    stdout.write(`${JSON.stringify(payload)}\n`);
    return payload.ok ? 0 : 1;
  }

  if (subcommand === "login") {
    const discoveredServerUrl =
      options["server-url"] ||
      (await resolveDefaultPreqstationServerUrlFn({ env }).catch(() => null));
    if (!discoveredServerUrl) {
      throw new DispatchError(
        "worker_auth_unready",
        `PREQSTATION server URL is required. Run ${CLI_COMMAND_NAME} auth login --server-url https://<your-domain>.`,
        {
          suggested_action: "pass_server_url_to_auth_login",
          commands: [
            `${CLI_COMMAND_NAME} auth login --server-url https://<your-domain>`,
          ],
          ...paths,
        },
      );
    }

    const config = await writePreqstationConfigFn({
      env,
      serverUrl: discoveredServerUrl,
    });
    await loginPreqstationFn({
      serverUrl: config.server_url,
      oauthPath: paths.oauth_path,
      env,
      onLoginUrl: (loginUrl) => {
        stderr.write(`Open PREQSTATION login URL: ${loginUrl}\n`);
      },
    });

    stdout.write(
      `${JSON.stringify({
        ok: true,
        action: "logged_in",
        server_url: config.server_url,
        ...paths,
      })}\n`,
    );
    return 0;
  }

  if (subcommand === "logout") {
    await logoutPreqstationFn({ oauthPath: paths.oauth_path });
    stdout.write(
      `${JSON.stringify({
        ok: true,
        action: "logged_out",
        oauth_path: paths.oauth_path,
      })}\n`,
    );
    return 0;
  }

  throw new Error(`Usage: ${CLI_COMMAND_NAME} auth [login|status|logout]`);
}

function createWhoamiUnavailableError() {
  return new DispatchError(
    "auth_identity_unavailable",
    "preqstation whoami requires a PREQSTATION server identity endpoint or MCP tool, which is not available yet.",
    {
      suggested_action: "add_server_identity_endpoint_then_wire_whoami",
    },
  );
}

function requirePositional(positional, label) {
  const value = positional[0];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function inferProjectKeyFromTaskId(taskId) {
  const [projectKey] = String(taskId || "").split("-");
  return normalizeProjectKey(projectKey);
}

function parseOptionalInteger(options, name) {
  const value = options[name];
  if (typeof value === "undefined") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`--${name} must be an integer`);
  }
  return parsed;
}

function withOptionalEngine(payload, options) {
  if (options.engine) {
    return { ...payload, engine: options.engine };
  }
  return payload;
}

async function readJsonOption(options, name) {
  return readJsonFile(requireOption(options, name));
}

async function readTextOption(options, name) {
  return readTextFile(requireOption(options, name));
}

function lifecycleCall(toolName, toolArguments) {
  return { toolName, toolArguments };
}

async function buildTaskLifecycleCall(args) {
  const [subcommand, ...rest] = args;
  const { options, positional } = parseOptions(rest);

  if (subcommand === "get") {
    return lifecycleCall("preq_get_task", {
      taskId: requirePositional(positional, "task id"),
    });
  }

  if (subcommand === "start") {
    return lifecycleCall(
      "preq_start_task",
      withOptionalEngine({ taskId: requirePositional(positional, "task id") }, options),
    );
  }

  if (subcommand === "note") {
    return lifecycleCall(
      "preq_update_task_note",
      withOptionalEngine(
        {
          taskId: requirePositional(positional, "task id"),
          noteMarkdown: await readTextOption(options, "body-file"),
        },
        options,
      ),
    );
  }

  if (subcommand === "status") {
    const payload = withOptionalEngine(
      {
        taskId: requirePositional(positional, "task id"),
        status: requireOption(options, "status"),
      },
      options,
    );
    if (options["clear-run-state"] === "true") {
      payload.clearRunState = true;
    }
    return lifecycleCall("preq_update_task_status", payload);
  }

  if (subcommand === "complete") {
    return lifecycleCall("preq_complete_task", {
      taskId: requirePositional(positional, "task id"),
      ...(await readJsonOption(options, "json-file")),
    });
  }

  if (subcommand === "block") {
    return lifecycleCall(
      "preq_block_task",
      withOptionalEngine(
        {
          taskId: requirePositional(positional, "task id"),
          reason: await readTextOption(options, "reason-file"),
        },
        options,
      ),
    );
  }

  if (subcommand === "plan") {
    const taskId = requirePositional(positional, "task id");
    return lifecycleCall(
      "preq_plan_task",
      withOptionalEngine(
        {
          taskId,
          projectKey: options.project ? normalizeProjectKey(options.project) : inferProjectKeyFromTaskId(taskId),
          planMarkdown: await readTextOption(options, "plan-file"),
        },
        options,
      ),
    );
  }

  if (subcommand === "review") {
    return lifecycleCall(
      "preq_review_task",
      withOptionalEngine(
        {
          taskId: requirePositional(positional, "task id"),
          ...(await readJsonOption(options, "json-file")),
        },
        options,
      ),
    );
  }

  if (subcommand === "list") {
    const payload = {};
    if (options.project) payload.projectKey = normalizeProjectKey(options.project);
    if (options.status) payload.status = options.status;
    if (options.label) payload.label = options.label;
    if (options.engine) payload.engine = options.engine;
    if (options["run-state"]) payload.runState = options["run-state"];
    if (options["dispatch-target"]) payload.dispatchTarget = options["dispatch-target"];
    if (options.detail) payload.detail = options.detail;
    const limit = parseOptionalInteger(options, "limit");
    if (typeof limit === "number") payload.limit = limit;
    return lifecycleCall("preq_list_tasks", payload);
  }

  if (subcommand === "create") {
    const payload = await readJsonOption(options, "json-file");
    if (options.project) {
      payload.projectKey = normalizeProjectKey(options.project);
    }
    return lifecycleCall("preq_create_task", payload);
  }

  if (subcommand === "delete") {
    return lifecycleCall("preq_delete_task", {
      taskId: requirePositional(positional, "task id"),
    });
  }

  throw new Error(`Usage: ${CLI_COMMAND_NAME} task <get|start|note|status|complete|block|plan|review|list|create|delete>`);
}

async function buildQaLifecycleCall(args) {
  const [subcommand, ...rest] = args;
  const { options } = parseOptions(rest);
  if (subcommand !== "update") {
    throw new Error(`Usage: ${CLI_COMMAND_NAME} qa update --run-id RUN-123 --json-file report.json`);
  }
  return lifecycleCall("preq_update_qa_run", {
    runId: requireOption(options, "run-id"),
    ...(await readJsonOption(options, "json-file")),
  });
}

async function buildCommentLifecycleCall(args) {
  const [subcommand, ...rest] = args;
  const { options } = parseOptions(rest);

  if (subcommand === "list") {
    return lifecycleCall("preq_list_task_comments", {
      taskId: requireOption(options, "task"),
    });
  }

  if (subcommand === "get") {
    return lifecycleCall("preq_get_task_comment", {
      commentId: requireOption(options, "comment-id"),
    });
  }

  if (subcommand === "reply") {
    return lifecycleCall(
      "preq_reply_task_comment",
      withOptionalEngine(
        {
          commentId: requireOption(options, "comment-id"),
          body: await readTextOption(options, "body-file"),
        },
        options,
      ),
    );
  }

  if (subcommand === "state") {
    const payload = withOptionalEngine(
      {
        commentId: requireOption(options, "comment-id"),
        runState: requireOption(options, "state"),
      },
      options,
    );
    if (options["error-message"]) {
      payload.errorMessage = options["error-message"];
    }
    if (options["error-message-file"]) {
      payload.errorMessage = await readTextOption(options, "error-message-file");
    }
    return lifecycleCall("preq_update_task_comment_state", payload);
  }

  throw new Error(`Usage: ${CLI_COMMAND_NAME} comment <list|get|reply|state>`);
}

async function buildProjectLifecycleCall(args) {
  const [subcommand, ...rest] = args;
  const { options } = parseOptions(rest);

  if (subcommand === "list") {
    return lifecycleCall("preq_list_projects", {});
  }

  if (subcommand === "settings") {
    return lifecycleCall("preq_get_project_settings", {
      projectKey: normalizeProjectKey(requireOption(options, "project")),
    });
  }

  if (subcommand === "activity") {
    const payload = {
      from: requireOption(options, "from"),
      to: requireOption(options, "to"),
    };
    if (options.project) {
      payload.projectKeys = [normalizeProjectKey(options.project)];
    }
    const limit = parseOptionalInteger(options, "limit");
    if (typeof limit === "number") payload.limit = limit;
    if (options.cursor) payload.cursor = options.cursor;
    return lifecycleCall("preq_list_project_activity", payload);
  }

  throw new Error(`Usage: ${CLI_COMMAND_NAME} project <list|settings|activity>`);
}

async function buildLifecycleCall(command, args) {
  if (command === "task") {
    return buildTaskLifecycleCall(args);
  }
  if (command === "qa") {
    return buildQaLifecycleCall(args);
  }
  if (command === "comment") {
    return buildCommentLifecycleCall(args);
  }
  if (command === "project") {
    return buildProjectLifecycleCall(args);
  }
  throw new Error(`Unsupported lifecycle command: ${command}`);
}

async function handleLifecycleCommand({
  command,
  args,
  stdout,
  stderr,
  env,
  resolveDefaultPreqstationServerUrlFn,
  callPreqstationMcpToolFn,
}) {
  try {
    const { toolName, toolArguments } = await buildLifecycleCall(command, args);
    const serverUrl = await resolveDefaultPreqstationServerUrlFn({ env });
    if (!serverUrl) {
      throw new DispatchError(
        "worker_auth_unready",
        `PREQSTATION server URL is required. Run ${CLI_COMMAND_NAME} auth login --server-url https://<your-domain>.`,
        {
          suggested_action: "configure_cli_auth",
          commands: [
            `${CLI_COMMAND_NAME} auth login --server-url https://<your-domain>`,
          ],
        },
      );
    }
    const result = await callPreqstationMcpToolFn({
      serverUrl,
      oauthPath: getPreqstationOauthPath(env),
      toolName,
      toolArguments,
      env,
    });
    stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
    return 0;
  } catch (error) {
    const dispatchError = isDispatchError(error)
      ? error
      : new DispatchError(
          "preqstation_lifecycle_failed",
          error instanceof Error ? error.message : String(error),
        );
    writeDispatchFailure({ stdout, stderr, error: dispatchError });
    return 1;
  }
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

function writeDispatchFailure({ stdout, stderr, error }) {
  const serialized = serializeDispatchError(error);
  stdout.write(
    `${JSON.stringify({
      ok: false,
      error: serialized,
    })}\n`,
  );
  stderr.write(`error [${serialized.code}]: ${serialized.message}\n`);
}

function isDebugEnabled(env, argv) {
  const envValue = String(env?.PREQSTATION_DEBUG || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(envValue) || argv.includes("--debug");
}

function stripGlobalDebugFlag(argv) {
  return argv.filter((arg) => arg !== "--debug");
}

function createErrorLogEntry({ error, argv }) {
  const payload = {
    timestamp: new Date().toISOString(),
    argv,
  };

  if (isDispatchError(error)) {
    payload.error = serializeDispatchError(error);
  } else {
    payload.error = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (error instanceof Error && error.stack) {
    payload.stack = error.stack;
  }

  return `${JSON.stringify(payload)}\n`;
}

async function appendCliErrorLog({ error, env, argv }) {
  const logPath = getPreqstationErrorLogPath(env);
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, createErrorLogEntry({ error, argv }), "utf8");
    return logPath;
  } catch {
    return null;
  }
}

function writeDebugErrorDetails({ stderr, error, logPath, debugEnabled }) {
  if (!debugEnabled) {
    return;
  }
  if (logPath) {
    stderr.write(`debug: wrote error log to ${logPath}\n`);
  }
  if (error instanceof Error && error.stack) {
    stderr.write(`${error.stack}\n`);
  }
}

export async function runDispatcherCli({
  argv,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  clackUi = DEFAULT_CLACK_SUMMARY_UI,
  dispatchPreqRun = defaultDispatchPreqRun,
  runInstallWizard = defaultRunInstallWizard,
  runUninstallWizard = defaultRunUninstallWizard,
  inspectOpenClawPluginFn = inspectOpenClawPlugin,
  getHermesSkillStatusFn = getHermesSkillStatus,
  syncHermesSkillFn = syncHermesSkill,
  uninstallHermesSkillFn = uninstallHermesSkill,
  installOpenClawPluginFn = installOpenClawPlugin,
  uninstallOpenClawPluginFn = uninstallOpenClawPlugin,
  inspectRuntimeWorkerSupportFn = inspectRuntimeWorkerSupport,
  uninstallRuntimeWorkerSupportFn = uninstallRuntimeWorkerSupport,
  inspectRuntimeExecutableHealthFn = inspectRuntimeExecutableHealth,
  inspectRuntimeMcpServersFn = inspectRuntimeMcpServers,
  uninstallRuntimeMcpServersFn = uninstallRuntimeMcpServers,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
  fetchPreqstationProjectsFn = defaultFetchPreqstationProjectsFromMcp,
  callPreqstationMcpToolFn = defaultCallPreqstationMcpTool,
  loginPreqstationFn = defaultLoginPreqstation,
  inspectPreqstationAuthFn = defaultInspectPreqstationAuth,
  logoutPreqstationFn = defaultLogoutPreqstation,
  writePreqstationConfigFn = defaultWritePreqstationConfig,
}) {
  const originalArgv = Array.isArray(argv) ? argv : [];
  const debugEnabled = isDebugEnabled(env, originalArgv);
  const [command, ...args] = stripGlobalDebugFlag(originalArgv);

  try {
    if (!command || command === "--help" || command === "help") {
      printUsage({ stdout, version: await readPackageVersion(), env });
      return 0;
    }

    if (command === "--version" || command === "-v" || command === "version") {
      stdout.write(`${await readPackageVersion()}\n`);
      return 0;
    }

    if (command === "setup") {
      await handleSetup({
        args,
        stdout,
        stderr,
        env,
        fetchPreqstationProjectsFn,
        resolveDefaultPreqstationServerUrlFn,
      });
      return 0;
    }

    if (command === "install") {
      return handleInstallCommand({
        args,
        stdin,
        stdout,
        stderr,
        env,
        runInstallWizard,
        fetchPreqstationProjectsFn,
        resolveDefaultPreqstationServerUrlFn,
        writePreqstationConfigFn,
      });
    }

    if (command === "uninstall") {
      return handleUninstallCommand({
        args,
        stdin,
        stdout,
        stderr,
        env,
        runUninstallWizard,
        uninstallHermesSkillFn,
        uninstallOpenClawPluginFn,
        uninstallRuntimeWorkerSupportFn,
        uninstallRuntimeMcpServersFn,
      });
    }

    if (command === "doctor") {
      return handleDoctorCommand({
        args,
        stdout,
        env,
        clackUi,
        inspectOpenClawPluginFn,
        getHermesSkillStatusFn,
        inspectRuntimeWorkerSupportFn,
        inspectRuntimeExecutableHealthFn,
        inspectRuntimeMcpServersFn,
        inspectPreqstationAuthFn,
        resolveDefaultPreqstationServerUrlFn,
      });
    }

    if (command === "status") {
      const { positional } = parseOptions(args);
      if (positional[0] === "hermes") {
        await handlePlatformCommand({ command, args, stdout, env });
        return 0;
      }
      return handleDoctorCommand({
        args,
        stdout,
        env,
        clackUi,
        action: "status",
        usageCommand: "status",
        summaryTitle: "Status summary",
        cleanMessage: "Status clean",
        attentionMessage: "Status needs attention",
        inspectOpenClawPluginFn,
        getHermesSkillStatusFn,
        inspectRuntimeWorkerSupportFn,
        inspectRuntimeExecutableHealthFn,
        inspectRuntimeMcpServersFn,
        inspectPreqstationAuthFn,
        resolveDefaultPreqstationServerUrlFn,
      });
    }

    if (command === "update") {
      return handleUpdateCommand({
        args,
        stdout,
        stderr,
        env,
        clackUi,
        getHermesSkillStatusFn,
        syncHermesSkillFn,
        installOpenClawPluginFn,
        inspectRuntimeWorkerSupportFn,
        inspectRuntimeExecutableHealthFn,
        inspectRuntimeMcpServersFn,
        resolveDefaultPreqstationServerUrlFn,
        fetchPreqstationProjectsFn,
      });
    }

    if (command === "sync") {
      await handlePlatformCommand({ command, args, stdout, env });
      return 0;
    }

    if (command === "auth") {
      return handleAuthCommand({
        args,
        stdout,
        stderr,
        env,
        resolveDefaultPreqstationServerUrlFn,
        loginPreqstationFn,
        inspectPreqstationAuthFn,
        logoutPreqstationFn,
        writePreqstationConfigFn,
      });
    }

    if (command === "whoami") {
      throw createWhoamiUnavailableError();
    }

    if (["task", "qa", "comment", "project"].includes(command)) {
      return handleLifecycleCommand({
        command,
        args,
        stdout,
        stderr,
        env,
        resolveDefaultPreqstationServerUrlFn,
        callPreqstationMcpToolFn,
      });
    }

    if (command === "mcp") {
      return handleMcpCommand({
        args,
        stdout,
        env,
        callPreqstationMcpToolFn,
        resolveDefaultPreqstationServerUrlFn,
        uninstallRuntimeMcpServersFn,
      });
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
    const errorLogPath = await appendCliErrorLog({ error, env, argv: originalArgv });
    if (isDispatchError(error)) {
      writeDispatchFailure({ stdout, stderr, error });
      writeDebugErrorDetails({
        stderr,
        error,
        logPath: errorLogPath,
        debugEnabled,
      });
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`error: ${message}\n`);
    writeDebugErrorDetails({
      stderr,
      error,
      logPath: errorLogPath,
      debugEnabled,
    });
    return 1;
  }
}
