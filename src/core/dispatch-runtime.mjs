import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_SHARED_MAPPING_PATH,
  resolveProjectCwdWithSources,
} from "../project-mapping.mjs";
import { renderPrompt } from "../prompt-template.mjs";
import { prepareWorktree } from "../worktree-runtime.mjs";
import { launchDetached } from "../detached-launch.mjs";
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

export async function dispatchPreqRun({
  rawMessage,
  parsed,
  configuredProjects,
  sharedMappingPath = DEFAULT_SHARED_MAPPING_PATH,
  memoryPath,
  worktreeRoot,
  dependencies = defaultDispatchDependencies,
}) {
  const projectCwd = await dependencies.resolveProjectCwd({
    rawMessage: parsed.rawMessage ?? rawMessage,
    projectKey: parsed.projectKey,
    configuredProjects,
    sharedMappingPath,
    memoryPath,
  });

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
  const launch = await dependencies.launchDetached({
    cwd: prepared.cwd,
    engine: parsed.engine,
    model: parsed.model,
  });

  return {
    projectCwd,
    prepared,
    prompt: instructions,
    instructions,
    launch,
  };
}
