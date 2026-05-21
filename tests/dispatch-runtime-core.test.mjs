import test from "node:test";
import assert from "node:assert/strict";

import { dispatchPreqRun } from "../src/core/dispatch-runtime.mjs";

test("dispatchPreqRun resolves a project, prepares a worktree, writes a prompt, and launches the engine", async () => {
  const calls = [];
  const parsed = {
    rawMessage:
      '!/preqstation dispatch implement PROJ-123 using codex branch_name="task/proj-123-example"',
    engine: "codex",
    taskKey: "PROJ-123",
    projectKey: "PROJ",
    objective: "implement",
    branchName: "task/proj-123-example",
    askHint: null,
    insightPromptB64: null,
    qaRunId: null,
    qaTaskKeys: null,
  };

  const result = await dispatchPreqRun({
    rawMessage: parsed.rawMessage,
    parsed,
    configuredProjects: { PROJ: "/tmp/project" },
    sharedMappingPath: "/tmp/shared-projects.json",
    memoryPath: "/tmp/MEMORY.md",
    worktreeRoot: "/tmp/worktrees",
    dependencies: {
      resolveProjectCwd: async (params) => {
        calls.push(["resolveProjectCwd", params]);
        return "/tmp/project";
      },
      prepareWorktree: async (params) => {
        calls.push(["prepareWorktree", params]);
        return {
          cwd: "/tmp/worktrees/PROJ/task-proj-123-example",
          branchName: "task/proj-123-example",
        };
      },
      renderPrompt: (params) => {
        calls.push(["renderPrompt", params]);
        return "prompt text";
      },
      writePromptFile: async (params) => {
        calls.push(["writePromptFile", params]);
      },
      launchDetached: async (params) => {
        calls.push(["launchDetached", params]);
        return {
          pid: 4242,
          pidFile: "/tmp/worktrees/PROJ/task-proj-123-example/.preqstation-dispatch/codex.pid",
          logFile: "/tmp/worktrees/PROJ/task-proj-123-example/.preqstation-dispatch/codex.log",
        };
      },
    },
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "resolveProjectCwd",
      "prepareWorktree",
      "renderPrompt",
      "writePromptFile",
      "launchDetached",
    ],
  );
  assert.deepEqual(calls[0][1], {
    rawMessage: parsed.rawMessage,
    projectKey: "PROJ",
    configuredProjects: { PROJ: "/tmp/project" },
    sharedMappingPath: "/tmp/shared-projects.json",
    memoryPath: "/tmp/MEMORY.md",
  });
  assert.deepEqual(calls[1][1], {
    projectCwd: "/tmp/project",
    projectKey: "PROJ",
    taskKey: "PROJ-123",
    objective: "implement",
    branchName: "task/proj-123-example",
    worktreeRoot: "/tmp/worktrees",
  });
  assert.deepEqual(calls[2][1], {
    taskKey: "PROJ-123",
    projectKey: "PROJ",
    branchName: "task/proj-123-example",
    objective: "implement",
    engine: "codex",
    cwd: "/tmp/worktrees/PROJ/task-proj-123-example",
    projectCwd: "/tmp/project",
    askHint: null,
    insightPromptB64: null,
    qaRunId: null,
    qaTaskKeys: null,
  });
  assert.deepEqual(calls[3][1], {
    cwd: "/tmp/worktrees/PROJ/task-proj-123-example",
    prompt: "prompt text",
  });
  assert.deepEqual(calls[4][1], {
    cwd: "/tmp/worktrees/PROJ/task-proj-123-example",
    engine: "codex",
  });
  assert.equal(result.projectCwd, "/tmp/project");
  assert.deepEqual(result.prepared, {
    cwd: "/tmp/worktrees/PROJ/task-proj-123-example",
    branchName: "task/proj-123-example",
  });
  assert.deepEqual(result.launch, {
    pid: 4242,
    pidFile: "/tmp/worktrees/PROJ/task-proj-123-example/.preqstation-dispatch/codex.pid",
    logFile: "/tmp/worktrees/PROJ/task-proj-123-example/.preqstation-dispatch/codex.log",
  });
});
