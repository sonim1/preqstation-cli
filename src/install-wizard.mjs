import {
  box as clackBox,
  cancel,
  intro,
  isCancel,
  multiselect,
  note,
  spinner as clackSpinner,
  taskLog as clackTaskLog,
  tasks as clackTasks,
  text,
} from "@clack/prompts";

import { syncHermesSkill } from "./hermes-skill-installer.mjs";
import { installOpenClawPlugin } from "./openclaw-installer.mjs";
import { inspectRuntimeExecutableHealth } from "./runtime-skill-installer.mjs";
import {
  buildPreqstationMcpUrl,
  installRuntimeMcpServers,
  normalizePreqstationServerUrl,
  resolveDefaultPreqstationServerUrl,
} from "./runtime-mcp-installer.mjs";

const INSTALL_TARGET_CHOICES = [
  {
    name: "OpenClaw",
    value: "openclaw",
    description: "Install the OpenClaw plugin package",
  },
  {
    name: "Hermes Agent",
    value: "hermes",
    description: "Install the bundled Hermes preqstation skill",
  },
];

const RUNTIME_CHOICES = [
  {
    name: "Claude Code",
    value: "claude-code",
    description: "Verify the Claude Code CLI path",
  },
  {
    name: "Codex",
    value: "codex",
    description: "Verify the Codex CLI path",
  },
  {
    name: "Gemini CLI",
    value: "gemini-cli",
    description: "Verify the Gemini CLI path",
  },
];

const INSTALL_GROUP_LABEL = "Request entrypoints";
const RUNTIME_GROUP_LABEL = "Agent runtimes";

const SERVICE_THEMES = {
  openclaw: {
    title: "OpenClaw",
    color: "#22D3EE",
  },
  hermes: {
    title: "Hermes Agent",
    color: "#F37021",
  },
  "claude-code": {
    title: "Claude Code",
    color: "#D97757",
  },
  codex: {
    title: "Codex",
    color: "#10A37F",
  },
  "gemini-cli": {
    title: "Gemini CLI",
    color: "#4796E3",
  },
};

const ANSI = {
  reset: "\u001B[0m",
  dim: "\u001B[2m",
  green: "\u001B[32m",
  red: "\u001B[31m",
  yellow: "\u001B[33m",
};

const DEFAULT_CLACK_UI = {
  box: clackBox,
  intro,
  note,
  spinner: clackSpinner,
  taskLog: clackTaskLog,
  tasks: clackTasks,
};

function createPromptIo({ inputStream, outputStream }) {
  return {
    input: inputStream,
    output: outputStream,
  };
}

function createMultiselectOptions({ message, choices, inputStream, outputStream }) {
  return {
    message,
    options: choices.map(({ name, value, description }) => ({
      label: name,
      value,
      hint: description,
    })),
    required: true,
    ...createPromptIo({ inputStream, outputStream }),
  };
}

async function readPromptValue({ promptFn, config, outputStream }) {
  const value = await promptFn(config);
  if (isCancel(value)) {
    cancel("Install cancelled.", { output: outputStream });
    throw new Error("Install cancelled.");
  }
  return value;
}

function writeProgress(outputStream, message) {
  outputStream.write(`${message}\n`);
}

function padCell(value, width) {
  return String(value || "").padEnd(width, " ");
}

function writeSection(outputStream, title) {
  writeProgress(outputStream, title);
}

function writeIndentedLine(outputStream, value) {
  writeProgress(outputStream, `  ${value}`);
}

function writeStatusRow(outputStream, label, status) {
  writeProgress(outputStream, `  ${padCell(label, 20)} ${status}`);
}

function shouldRenderClack(outputStream) {
  return Boolean(outputStream?.isTTY);
}

function supportsColor({ outputStream, env = process.env }) {
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

function paint(text, tone, enabled) {
  return enabled ? `${tone}${text}${ANSI.reset}` : text;
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

function paintHex(text, hex, enabled) {
  const color = parseHexColor(hex);
  if (!enabled || !color) {
    return text;
  }
  return `\u001B[38;2;${color.red};${color.green};${color.blue}m${text}${ANSI.reset}`;
}

function colorizeStatus(text, { outputStream, env }) {
  const color = supportsColor({ outputStream, env });
  const serviceColored = Object.values(SERVICE_THEMES).reduce(
    (nextText, theme) => nextText.replaceAll(theme.title, paintHex(theme.title, theme.color, color)),
    text,
  );
  return serviceColored.replace(
    /\b(current|ready|installed|registered|updated|attention|failed|unavailable|not enabled|not installed)\b/g,
    (match) => {
      if (match === "failed") {
        return paint(match, ANSI.red, color);
      }
      if (
        match === "attention" ||
        match === "unavailable" ||
        match === "not enabled" ||
        match === "not installed"
      ) {
        return paint(match, ANSI.yellow, color);
      }
      return paint(match, ANSI.green, color);
    },
  );
}

function describeInstallAction(action) {
  if (action === "updated") {
    return "updated";
  }
  if (action === "already_current") {
    return "current";
  }
  return "installed";
}

function describeTarget(target) {
  if (target === "openclaw") {
    return "OpenClaw";
  }
  if (target === "hermes") {
    return "Hermes Agent";
  }
  return target;
}

function describeRuntime(runtime) {
  if (runtime === "claude-code") {
    return "Claude Code";
  }
  if (runtime === "codex") {
    return "Codex";
  }
  if (runtime === "gemini-cli") {
    return "Gemini CLI";
  }
  return runtime;
}

function describeRuntimeCli(runtime) {
  const label = describeRuntime(runtime);
  return label.endsWith("CLI") ? label : `${label} CLI`;
}

function describeRuntimeSupportAction(action, runtime) {
  if (action === "ready") {
    return "ready";
  }
  if (action === "needs_attention") {
    return "attention";
  }
  if (action === "failed") {
    return "failed";
  }
  if (action === "unavailable") {
    return "unavailable";
  }
  if (action === "not_enabled") {
    return "not enabled";
  }
  if (action === "not_installed") {
    return "not installed";
  }
  if (runtime === "claude-code") {
    if (action === "already_current") {
      return "current";
    }
    if (action === "updated") {
      return "updated";
    }
    return "installed";
  }

  if (action === "already_current") {
    return "current";
  }
  if (action === "updated") {
    return "updated";
  }
  return "installed";
}

function describeResultVersion(result) {
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

function joinTaskLabel(label, status, details = []) {
  return [label, status, ...details.filter(Boolean)].join(" ");
}

function describeProgressStatus(status) {
  if (status === "attention") {
    return "needs attention";
  }
  if (status === "failed") {
    return "failed";
  }
  return `is ${status}`;
}

function joinProgressTaskLabel(label, status, details = []) {
  return [label, describeProgressStatus(status), ...details.filter(Boolean)].join(" ");
}

function formatHostTaskResult(target, result) {
  return joinProgressTaskLabel(describeTarget(target), describeInstallAction(result.action), [
    describeResultVersion(result),
  ]);
}

function formatHostSummaryResult(result) {
  return [describeInstallAction(result.action), describeResultVersion(result)]
    .filter(Boolean)
    .join(" ");
}

function formatRuntimeTaskResult({ runtime, kind, result, mcpUrl }) {
  if (kind === "executable") {
    return joinProgressTaskLabel(describeRuntimeCli(runtime), describeRuntimeSupportAction(result?.action, runtime));
  }
  return joinProgressTaskLabel(
    `${describeRuntime(runtime)} legacy MCP`,
    result?.action === "mcp_already_configured" ? "current" : "registered",
    [result?.mcp_url || mcpUrl],
  );
}

function formatRuntimeSummaryTaskResult({ runtime, kind, result, mcpUrl }) {
  if (kind === "executable") {
    return joinTaskLabel("CLI", describeRuntimeSupportAction(result?.action, runtime));
  }
  return joinTaskLabel(
    "legacy MCP",
    result?.action === "mcp_already_configured" ? "current" : "registered",
    [result?.mcp_url || mcpUrl],
  );
}

function describeSelection(values, describeFn) {
  return values.length > 0 ? values.map(describeFn).join(", ") : "None";
}

function describeThemedSelection(values, describeFn, { outputStream, env }) {
  const color = supportsColor({ outputStream, env });
  if (values.length === 0) {
    return "None";
  }
  return values
    .map((value) => {
      const theme = getServiceTheme(value);
      return paintHex(describeFn(value), theme.color, color);
    })
    .join(", ");
}

function createInstallPlanNote(plan, { outputStream, env }) {
  return [
    `${INSTALL_GROUP_LABEL}\n${describeThemedSelection(plan.installTargets, describeTarget, {
      outputStream,
      env,
    })}`,
    `${RUNTIME_GROUP_LABEL}\n${describeThemedSelection(plan.runtimeEngines, describeRuntime, {
      outputStream,
      env,
    })}`,
    ...(plan.preqstationServerUrl ? [`PREQSTATION server URL\n${plan.preqstationServerUrl}`] : []),
    ...(plan.withMcp && plan.mcpUrl ? [`Legacy PREQ MCP endpoint\n${plan.mcpUrl}`] : []),
  ].join("\n\n");
}

function getServiceTheme(key) {
  return SERVICE_THEMES[key] ?? { title: key, color: "#9EA1AA" };
}

function createSummaryGroup(key) {
  const theme = getServiceTheme(key);
  return {
    key,
    title: theme.title,
    color: theme.color,
  };
}

function renderSummaryBoxes({ summaryGroups, clackUi, outputStream, env }) {
  const color = supportsColor({ outputStream, env });
  for (const group of summaryGroups) {
    clackUi.box(group.lines.join("\n"), paintHex(group.title, group.color, color), {
      output: outputStream,
      width: "auto",
      rounded: true,
      formatBorder: (text) => paintHex(text, group.color, color),
    });
  }
}

function renderInstallIntro({ outputStream, clackUi }) {
  if (!shouldRenderClack(outputStream)) {
    return;
  }
  clackUi.intro("PREQSTATION install", { output: outputStream });
}

function renderInstallPlan({ plan, outputStream, clackUi, env }) {
  if (!shouldRenderClack(outputStream)) {
    return;
  }
  clackUi.note(createInstallPlanNote(plan, { outputStream, env }), "Install plan", { output: outputStream });
}

async function runClackTaskGroup({ title, tasks, outputStream, clackUi, env }) {
  if (!shouldRenderClack(outputStream)) {
    for (const entry of tasks) {
      await entry.task(() => {});
    }
    return;
  }

  if (
    typeof clackUi.taskLog === "function" &&
    (clackUi.taskLog !== clackTaskLog || typeof outputStream.on === "function")
  ) {
    const useSummaryBoxes =
      typeof clackUi.box === "function" &&
      (clackUi.box !== clackBox || typeof outputStream.on === "function");
    const summaryGroups = [];
    const summaryGroupsByKey = new Map();
    const log = clackUi.taskLog({
      title,
      limit: Math.max(tasks.length * 2 + 2, 8),
      retainLog: true,
      output: outputStream,
    });
    try {
      for (const entry of tasks) {
        let resultLabel;
        try {
          resultLabel = await entry.task(() => {});
        } catch (error) {
          throw error;
        }
        const logLabel = entry.getLogLabel?.() || resultLabel;
        const summaryLabel = entry.getSummaryLabel?.() || logLabel;
        if (!logLabel && !summaryLabel) {
          continue;
        }
        const renderedLogLabel = logLabel ? colorizeStatus(logLabel, { outputStream, env }) : null;
        const renderedSummaryLabel = summaryLabel
          ? colorizeStatus(summaryLabel, { outputStream, env })
          : renderedLogLabel;
        if (!useSummaryBoxes && renderedLogLabel) {
          log.message(renderedLogLabel);
        }
        if (entry.summaryGroup && renderedSummaryLabel) {
          let group = summaryGroupsByKey.get(entry.summaryGroup.key);
          if (!group) {
            group = {
              ...entry.summaryGroup,
              lines: [],
            };
            summaryGroupsByKey.set(entry.summaryGroup.key, group);
            summaryGroups.push(group);
          }
          group.lines.push(renderedSummaryLabel);
        }
      }
      const renderBoxes = useSummaryBoxes && summaryGroups.length > 0;
      log.success(`${title} complete`, { showLog: !renderBoxes });
      if (renderBoxes) {
        renderSummaryBoxes({ summaryGroups, clackUi, outputStream, env });
      }
    } catch (error) {
      log.error?.(`${title} failed`, { showLog: true });
      throw error;
    }
    return;
  }

  if (clackUi.tasks === clackTasks && typeof outputStream.on !== "function") {
    for (const entry of tasks) {
      await entry.task(() => {});
    }
    return;
  }

  await clackUi.tasks(tasks, { output: outputStream });
}

async function runTaskSteps({ title, steps, outputStream, clackUi, runTaskGroupFn, env }) {
  const values = [];
  const logLabels = [];
  const summaryLabels = [];
  const tasks = steps.map((step, index) => ({
    title: step.title,
    summaryGroup: step.summaryGroup,
    getLogLabel: () => logLabels[index],
    getSummaryLabel: () => summaryLabels[index],
    task: async (message) => {
      const value = await step.task(message);
      values[index] = value;
      logLabels[index] = step.logFormat?.(value) || step.format(value);
      summaryLabels[index] = step.summaryFormat?.(value) || logLabels[index];
      return step.format(value);
    },
  }));
  await runTaskGroupFn({ title, outputStream, clackUi, env, tasks });
  return values;
}

export async function promptInstallPlan({
  inputStream = process.stdin,
  outputStream = process.stdout,
  env = process.env,
  multiselectPrompt = multiselect,
  textPrompt = text,
  resolveDefaultPreqstationServerUrlFn = resolveDefaultPreqstationServerUrl,
} = {}) {
  const installTargets = await readPromptValue({
    promptFn: multiselectPrompt,
    outputStream,
    config: createMultiselectOptions({
      message: "Choose request entrypoints to install",
      choices: INSTALL_TARGET_CHOICES,
      inputStream,
      outputStream,
    }),
  });

  const runtimeEngines = await readPromptValue({
    promptFn: multiselectPrompt,
    outputStream,
    config: createMultiselectOptions({
      message: "Choose agent runtimes to set up",
      choices: RUNTIME_CHOICES,
      inputStream,
      outputStream,
    }),
  });

  let preqstationServerUrl = null;
  if (runtimeEngines.length > 0) {
    const defaultPreqstationServerUrl =
      (await resolveDefaultPreqstationServerUrlFn({
        runtimes: runtimeEngines,
        env,
      })) || "https://your-preqstation-domain.vercel.app";
    preqstationServerUrl = normalizePreqstationServerUrl(
      await readPromptValue({
        promptFn: textPrompt,
        outputStream,
        config: {
          message: "PREQSTATION server URL",
          placeholder: defaultPreqstationServerUrl,
          defaultValue: defaultPreqstationServerUrl,
          initialValue: defaultPreqstationServerUrl,
          ...createPromptIo({ inputStream, outputStream }),
        },
      }),
    );
  }

  return {
    installTargets,
    runtimeEngines,
    preqstationServerUrl,
    mcpUrl: preqstationServerUrl
      ? buildPreqstationMcpUrl(preqstationServerUrl)
      : null,
  };
}

export async function runInstallWizard({
  inputStream = process.stdin,
  outputStream = process.stdout,
  env = process.env,
  force = false,
  withMcp = false,
  promptInstallPlanFn = promptInstallPlan,
  syncHermesSkillFn = syncHermesSkill,
  installOpenClawPluginFn = installOpenClawPlugin,
  inspectRuntimeExecutableHealthFn = inspectRuntimeExecutableHealth,
  installRuntimeMcpServersFn = installRuntimeMcpServers,
  clackUi = DEFAULT_CLACK_UI,
  runTaskGroupFn = runClackTaskGroup,
} = {}) {
  renderInstallIntro({ outputStream, clackUi });

  const promptPlan = await promptInstallPlanFn({
    inputStream,
    outputStream,
    env,
  });
  const plan = {
    ...promptPlan,
    withMcp: Boolean(promptPlan?.withMcp ?? withMcp),
  };
  const results = [];
  const writePlainProgress = !shouldRenderClack(outputStream);

  renderInstallPlan({ plan, outputStream, clackUi, env });

  if (writePlainProgress && plan.runtimeEngines.length > 0) {
    writeSection(outputStream, "PREQSTATION server URL");
    writeIndentedLine(outputStream, plan.preqstationServerUrl);
    if (plan.withMcp && plan.mcpUrl) {
      writeSection(outputStream, "Legacy PREQ MCP endpoint");
      writeIndentedLine(outputStream, plan.mcpUrl);
    }
  }

  if (plan.installTargets.length > 0) {
    if (writePlainProgress && plan.runtimeEngines.length > 0) {
      writeProgress(outputStream, "");
    }
    if (writePlainProgress) {
      writeSection(outputStream, INSTALL_GROUP_LABEL);
    }

    const hostSteps = plan.installTargets.map((target) => {
      if (target === "hermes") {
        return {
          target,
          title: "Install Hermes Agent",
          summaryGroup: createSummaryGroup(target),
          task: () =>
            syncHermesSkillFn({
              env,
              force,
            }),
          format: (result) => formatHostTaskResult(target, result),
          logFormat: (result) => formatHostTaskResult(target, result),
          summaryFormat: (result) => formatHostSummaryResult(result),
        };
      }

      if (target === "openclaw") {
        return {
          target,
          title: "Install OpenClaw",
          summaryGroup: createSummaryGroup(target),
          task: () => installOpenClawPluginFn({ env }),
          format: (result) => formatHostTaskResult(target, result),
          logFormat: (result) => formatHostTaskResult(target, result),
          summaryFormat: (result) => formatHostSummaryResult(result),
        };
      }

      throw new Error(`Unsupported install target: ${target}`);
    });

    const hostResults = await runTaskSteps({
      title: INSTALL_GROUP_LABEL,
      steps: hostSteps,
      outputStream,
      clackUi,
      env,
      runTaskGroupFn,
    });

    for (const [index, result] of hostResults.entries()) {
      const target = hostSteps[index].target;
      results.push(result);
      if (writePlainProgress) {
        writeStatusRow(outputStream, describeTarget(target), describeInstallAction(result.action));
      }
    }
  }

  if (plan.runtimeEngines.length > 0) {
    if (writePlainProgress && plan.installTargets.length > 0) {
      writeProgress(outputStream, "");
    }
    if (writePlainProgress) {
      writeSection(outputStream, RUNTIME_GROUP_LABEL);
    }

    const runtimeSteps = [];
    for (const runtime of plan.runtimeEngines) {
      runtimeSteps.push({
        runtime,
        kind: "executable",
        title: `Check ${describeRuntimeCli(runtime)}`,
        summaryGroup: createSummaryGroup(runtime),
        task: () =>
          inspectRuntimeExecutableHealthFn({
            env,
            runtimes: [runtime],
            launchHosts: plan.installTargets,
          }),
        format: (runtimeExecutableResults) =>
          formatRuntimeTaskResult({
            runtime,
            kind: "executable",
            result: runtimeExecutableResults[0],
            mcpUrl: plan.mcpUrl,
          }),
        logFormat: (runtimeExecutableResults) =>
          formatRuntimeTaskResult({
            runtime,
            kind: "executable",
            result: runtimeExecutableResults[0],
            mcpUrl: plan.mcpUrl,
          }),
        summaryFormat: (runtimeExecutableResults) =>
          formatRuntimeSummaryTaskResult({
            runtime,
            kind: "executable",
            result: runtimeExecutableResults[0],
            mcpUrl: plan.mcpUrl,
          }),
      });

      if (plan.withMcp) {
        runtimeSteps.push({
          runtime,
          kind: "mcp",
          title: `Register ${describeRuntime(runtime)} legacy MCP`,
          summaryGroup: createSummaryGroup(runtime),
          task: () =>
            installRuntimeMcpServersFn({
              env,
              runtimes: [runtime],
              serverUrl: plan.preqstationServerUrl,
            }),
          format: (runtimeResults) =>
            formatRuntimeTaskResult({
              runtime,
              kind: "mcp",
              result: runtimeResults[0],
              mcpUrl: plan.mcpUrl,
            }),
          logFormat: (runtimeResults) =>
            formatRuntimeTaskResult({
              runtime,
              kind: "mcp",
              result: runtimeResults[0],
              mcpUrl: plan.mcpUrl,
            }),
          summaryFormat: (runtimeResults) =>
            formatRuntimeSummaryTaskResult({
              runtime,
              kind: "mcp",
              result: runtimeResults[0],
              mcpUrl: plan.mcpUrl,
            }),
        });
      }
    }

    const runtimeStepResults = await runTaskSteps({
      title: RUNTIME_GROUP_LABEL,
      steps: runtimeSteps,
      outputStream,
      clackUi,
      env,
      runTaskGroupFn,
    });

    for (const [index, runtimeResults] of runtimeStepResults.entries()) {
      const step = runtimeSteps[index];
      const [runtimeResult] = runtimeResults;
      results.push(...runtimeResults);
      if (!writePlainProgress) {
        continue;
      }

      if (step.kind === "executable") {
        writeStatusRow(
          outputStream,
          describeRuntimeCli(step.runtime),
          describeRuntimeSupportAction(runtimeResult?.action, step.runtime),
        );
      } else {
        writeStatusRow(
          outputStream,
          `${describeRuntime(step.runtime)} legacy MCP`,
          runtimeResult?.action === "mcp_already_configured" ? "current" : "registered",
        );
      }

      if (runtimeResult?.error) {
        writeIndentedLine(outputStream, runtimeResult.error);
      }
    }
  }

  return {
    ok: results.every((entry) => entry?.ok !== false),
    action: "installed",
    interactive: true,
    install_targets: plan.installTargets,
    runtime_engines: plan.runtimeEngines,
    preqstation_server_url: plan.preqstationServerUrl,
    with_mcp: plan.withMcp,
    mcp_url: plan.withMcp ? plan.mcpUrl : null,
    results,
  };
}
