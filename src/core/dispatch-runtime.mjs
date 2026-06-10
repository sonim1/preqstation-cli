import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_SHARED_MAPPING_PATH,
  resolveProjectCwdWithSources,
} from "../project-mapping.mjs";
import { renderPrompt } from "../prompt-template.mjs";
import { prepareWorktree } from "../worktree-runtime.mjs";
import { launchDetached } from "../detached-launch.mjs";
import { DispatchError, isDispatchError } from "../dispatch-error.mjs";
import {
  PREQSTATION_INSTRUCTIONS_FILE,
  PREQSTATION_LEGACY_PROMPT_FILE,
} from "../instruction-files.mjs";

export {
  PREQSTATION_INSTRUCTIONS_FILE,
  PREQSTATION_LEGACY_PROMPT_FILE,
};

export async function writeInstructionsFile({ cwd, instructions }) {
  await Promise.all([
    fs.writeFile(path.join(cwd, PREQSTATION_INSTRUCTIONS_FILE), instructions, "utf8"),
    fs.writeFile(path.join(cwd, PREQSTATION_LEGACY_PROMPT_FILE), instructions, "utf8"),
  ]);
}

export async function writePromptFile({ cwd, prompt }) {
  await writeInstructionsFile({ cwd, instructions: prompt });
}

export const defaultDispatchDependencies = {
  resolveProjectCwd: resolveProjectCwdWithSources,
  prepareWorktree,
  renderPrompt,
  writeInstructionsFile,
  launchDetached,
};

function createProjectMappingError(error, { projectKey, sharedMappingPath, memoryPath }) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/No project path mapping found/u.test(message)) {
    return null;
  }

  return new DispatchError("project_mapping_missing", message, {
    project_key: projectKey,
    shared_mapping_path: sharedMappingPath,
    memory_path: memoryPath ?? null,
    suggested_action: "run_setup_auto_or_set_project_mapping",
    commands: [
      "preqstation setup auto",
      `preqstation setup set ${projectKey} /absolute/path/to/project`,
    ],
  });
}

export async function dispatchPreqRun({
  rawMessage,
  parsed,
  configuredProjects,
  sharedMappingPath = DEFAULT_SHARED_MAPPING_PATH,
  memoryPath,
  worktreeRoot,
  dependencies = defaultDispatchDependencies,
}) {
  let projectCwd;
  try {
    projectCwd = await dependencies.resolveProjectCwd({
      rawMessage: parsed.rawMessage ?? rawMessage,
      projectKey: parsed.projectKey,
      configuredProjects,
      sharedMappingPath,
      memoryPath,
    });
  } catch (error) {
    if (isDispatchError(error)) {
      throw error;
    }
    throw (
      createProjectMappingError(error, {
        projectKey: parsed.projectKey,
        sharedMappingPath,
        memoryPath,
      }) ?? error
    );
  }

  const prepared = await dependencies.prepareWorktree({
    projectCwd,
    projectKey: parsed.projectKey,
    taskKey: parsed.taskKey,
    objective: parsed.objective,
    branchName: parsed.branchName,
    worktreeRoot,
  });

  const instructions = dependencies.renderPrompt({
    taskKey: parsed.taskKey,
    projectKey: parsed.projectKey,
    branchName: prepared.branchName,
    objective: parsed.objective,
    engine: parsed.engine,
    cwd: prepared.cwd,
    projectCwd,
    askHint: parsed.askHint,
    insightPromptB64: parsed.insightPromptB64,
    qaRunId: parsed.qaRunId,
    qaTaskKeys: parsed.qaTaskKeys,
    ...(parsed.commentId ? { commentId: parsed.commentId } : {}),
  });

  const writeInstructions =
    dependencies.writeInstructionsFile &&
    dependencies.writeInstructionsFile !== defaultDispatchDependencies.writeInstructionsFile
      ? dependencies.writeInstructionsFile
      : dependencies.writePromptFile
        ? (params) =>
            dependencies.writePromptFile({
              cwd: params.cwd,
              prompt: params.instructions,
            })
        : dependencies.writeInstructionsFile;
  await writeInstructions({ cwd: prepared.cwd, instructions });
  let launch;
  try {
    launch = await dependencies.launchDetached({
      cwd: prepared.cwd,
      engine: parsed.engine,
      model: parsed.model,
    });
  } catch (error) {
    if (isDispatchError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DispatchError(
      "worker_launch_failed",
      `Failed to launch ${parsed.engine} worker: ${message}`,
      {
        engine: parsed.engine,
        worktree_path: prepared.cwd,
        cause_message: message,
        suggested_action: "check_worker_runtime_and_retry",
      },
    );
  }

  return {
    projectCwd,
    prepared,
    prompt: instructions,
    instructions,
    launch,
  };
}
