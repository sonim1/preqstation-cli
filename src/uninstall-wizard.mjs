import {
  cancel,
  intro,
  isCancel,
  multiselect,
  note,
  tasks as clackTasks,
} from "@clack/prompts";

import { uninstallHermesSkill } from "./hermes-skill-installer.mjs";
import { uninstallOpenClawPlugin } from "./openclaw-installer.mjs";
import { uninstallRuntimeWorkerSupport } from "./runtime-skill-installer.mjs";
import { uninstallRuntimeMcpServers } from "./runtime-mcp-installer.mjs";

const UNINSTALL_TARGET_CHOICES = [
  {
    name: "OpenClaw",
    value: "openclaw",
    description: "Remove the OpenClaw plugin package",
  },
  {
    name: "Hermes Agent",
    value: "hermes",
    description: "Remove the bundled Hermes preqstation_dispatch skill",
  },
];

const RUNTIME_CHOICES = [
  {
    name: "Claude Code",
    value: "claude-code",
    description: "Remove the PREQ Claude plugin and MCP registration",
  },
  {
    name: "Codex",
    value: "codex",
    description: "Remove the PREQ worker skill and MCP registration",
  },
  {
    name: "Gemini CLI",
    value: "gemini-cli",
    description: "Remove the PREQ worker skill and MCP registration",
  },
];

const DEFAULT_CLACK_UI = {
  intro,
  note,
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
    cancel("Uninstall cancelled.", { output: outputStream });
    throw new Error("Uninstall cancelled.");
  }
  return value;
}

function shouldRenderClack(outputStream) {
  return Boolean(outputStream?.isTTY);
}

function describeTarget(target) {
  if (target === "openclaw") {
    return "OpenClaw";
  }
  if (target === "hermes") {
    return "Hermes Agent";
  }
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

function describeAction(action) {
  if (action === "mcp_removed") {
    return "MCP removed";
  }
  if (action === "mcp_not_configured") {
    return "MCP not configured";
  }
  if (action === "not_installed") {
    return "not installed";
  }
  if (action === "not_enabled") {
    return "not enabled";
  }
  if (action === "failed") {
    return "failed";
  }
  return "removed";
}

function createUninstallPlanNote(plan) {
  return [
    `Request entrypoints\n${plan.uninstallTargets.map(describeTarget).join(", ") || "None"}`,
    `Agent runtimes\n${plan.runtimeEngines.map(describeTarget).join(", ") || "None"}`,
    "Project mappings\nKept",
  ].join("\n\n");
}

async function runTaskGroup({ tasks, outputStream, clackUi }) {
  if (tasks.length === 0) {
    return [];
  }
  if (!shouldRenderClack(outputStream) || clackUi.tasks === clackTasks && typeof outputStream.on !== "function") {
    const results = [];
    for (const entry of tasks) {
      results.push(await entry.task());
    }
    return results;
  }

  return clackUi.tasks(tasks, { output: outputStream });
}

export async function promptUninstallPlan({
  inputStream = process.stdin,
  outputStream = process.stdout,
  multiselectPrompt = multiselect,
} = {}) {
  const uninstallTargets = await readPromptValue({
    promptFn: multiselectPrompt,
    outputStream,
    config: createMultiselectOptions({
      message: "Choose request entrypoints to uninstall",
      choices: UNINSTALL_TARGET_CHOICES,
      inputStream,
      outputStream,
    }),
  });

  const runtimeEngines = await readPromptValue({
    promptFn: multiselectPrompt,
    outputStream,
    config: createMultiselectOptions({
      message: "Choose agent runtimes to remove",
      choices: RUNTIME_CHOICES,
      inputStream,
      outputStream,
    }),
  });

  return {
    uninstallTargets,
    runtimeEngines,
  };
}

export async function runUninstallWizard({
  inputStream = process.stdin,
  outputStream = process.stdout,
  env = process.env,
  force = false,
  promptUninstallPlanFn = promptUninstallPlan,
  uninstallHermesSkillFn = uninstallHermesSkill,
  uninstallOpenClawPluginFn = uninstallOpenClawPlugin,
  uninstallRuntimeWorkerSupportFn = uninstallRuntimeWorkerSupport,
  uninstallRuntimeMcpServersFn = uninstallRuntimeMcpServers,
  clackUi = DEFAULT_CLACK_UI,
  runTaskGroupFn = runTaskGroup,
} = {}) {
  if (shouldRenderClack(outputStream)) {
    clackUi.intro("PREQSTATION uninstall", { output: outputStream });
  }

  const plan = await promptUninstallPlanFn({
    inputStream,
    outputStream,
    env,
  });
  const results = [];

  if (shouldRenderClack(outputStream)) {
    clackUi.note(createUninstallPlanNote(plan), "Uninstall plan", { output: outputStream });
  }

  const hostResults = [];
  const hostTasks = plan.uninstallTargets.map((target, index) => {
    if (target === "hermes") {
      return {
        title: "Remove Hermes Agent",
        task: async () => {
          const result = await uninstallHermesSkillFn({ env, force });
          hostResults[index] = result;
          return `${describeTarget(target)} ${describeAction(result.action)}`;
        },
      };
    }
    if (target === "openclaw") {
      return {
        title: "Remove OpenClaw",
        task: async () => {
          const result = await uninstallOpenClawPluginFn({ env });
          hostResults[index] = result;
          return `${describeTarget(target)} ${describeAction(result.action)}`;
        },
      };
    }
    throw new Error(`Unsupported uninstall target: ${target}`);
  });

  await runTaskGroupFn({
    tasks: hostTasks,
    outputStream,
    clackUi,
  });
  results.push(...hostResults.filter(Boolean));

  const runtimeResults = [];
  const runtimeTasks = plan.runtimeEngines.flatMap((runtime) => [
    {
      title: `Remove ${describeTarget(runtime)} MCP`,
      task: async () => {
        const [result] = await uninstallRuntimeMcpServersFn({ env, runtimes: [runtime] });
        runtimeResults.push(result);
        return `${describeTarget(runtime)} ${describeAction(result.action)}`;
      },
    },
    {
      title: `Remove ${describeTarget(runtime)} worker support`,
      task: async () => {
        const [result] = await uninstallRuntimeWorkerSupportFn({ env, runtimes: [runtime] });
        runtimeResults.push(result);
        return `${describeTarget(runtime)} ${describeAction(result.action)}`;
      },
    },
  ]);
  await runTaskGroupFn({
    tasks: runtimeTasks,
    outputStream,
    clackUi,
  });
  results.push(...runtimeResults);

  return {
    ok: results.every((entry) => entry?.ok !== false),
    action: "uninstalled",
    interactive: true,
    uninstall_targets: plan.uninstallTargets,
    runtime_engines: plan.runtimeEngines,
    results,
  };
}
