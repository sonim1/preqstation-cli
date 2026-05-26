import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_SHARED_MAPPING_PATH,
  resolveProjectCwdWithSources,
} from "../project-mapping.mjs";
import { renderPrompt } from "../prompt-template.mjs";
import { prepareWorktree } from "../worktree-runtime.mjs";
import { launchDetached } from "../detached-launch.mjs";

export async function writePromptFile({ cwd, prompt }) {
  await fs.writeFile(path.join(cwd, ".preqstation-prompt.txt"), prompt, "utf8");
}

export const defaultDispatchDependencies = {
  resolveProjectCwd: resolveProjectCwdWithSources,
  prepareWorktree,
  renderPrompt,
  writePromptFile,
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

  const prompt = dependencies.renderPrompt({
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

  await dependencies.writePromptFile({ cwd: prepared.cwd, prompt });
  const launch = await dependencies.launchDetached({
    cwd: prepared.cwd,
    engine: parsed.engine,
    model: parsed.model,
  });

  return {
    projectCwd,
    prepared,
    prompt,
    launch,
  };
}
