import test from "node:test";
import assert from "node:assert/strict";

import { renderPrompt } from "../src/prompt-template.mjs";

test("renders preq dispatch prompt with task and workspace details", () => {
  const prompt = renderPrompt({
    taskKey: "PROJ-327",
    projectKey: "PROJ",
    branchName: "task/proj-327/browser-notification-chuga",
    objective: "plan",
    engine: "codex",
    cwd: "/tmp/worktree/proj/task-proj-327-browser-notification-chuga",
    projectCwd: "/tmp/project",
  });

  assert.match(prompt, /Task ID: PROJ-327/);
  assert.match(prompt, /Project Key: PROJ/);
  assert.match(prompt, /Branch Name: task\/proj-327\/browser-notification-chuga/);
  assert.match(prompt, /User Objective: plan/);
  assert.match(prompt, /Work only inside \/tmp\/worktree\/proj\/task-proj-327-browser-notification-chuga/);
  assert.match(prompt, /preq_start_task\("PROJ-327", "codex"\)/);
  assert.match(prompt, /notes and acceptance criteria as the implementation source of truth/i);
  assert.match(prompt, /Comments are conversational requests only/i);
  assert.match(prompt, /For comment objectives only/i);
  assert.match(prompt, /Comment ID as the primary request/i);
  assert.match(prompt, /previous agent replies/i);
  assert.match(prompt, /non-target comments only to understand conversation flow/i);
  assert.match(prompt, /do not read task comments as hidden implementation requirements or conversation context/i);
  assert.match(prompt, /Do not create Markdown checkbox task-list syntax/i);
  assert.match(prompt, /Preserve user-authored checkboxes/i);
  assert.doesNotMatch(prompt, /openclaw system event/i);
});

test("renders ask-specific note rewrite guidance", () => {
  const prompt = renderPrompt({
    taskKey: "PROJ-328",
    projectKey: "PROJ",
    branchName: "task/proj-328/edit-task-isyu",
    objective: "ask",
    engine: "codex",
    cwd: "/tmp/worktree/proj/task-proj-328-edit-task-isyu",
    projectCwd: "/tmp/project",
    askHint: "Summarize around acceptance criteria",
  });

  assert.match(prompt, /User Objective: ask/);
  assert.match(prompt, /Ask Hint: Summarize around acceptance criteria/);
  assert.match(prompt, /preq_update_task_note/);
  assert.match(prompt, /preq_update_task_status/);
  assert.match(prompt, /keep the workflow status unchanged/);
  assert.match(prompt, /prototype-style asks may generate local artifacts/i);
  assert.match(prompt, /authenticated artifact provider/i);
  assert.match(prompt, /private-or-skip/i);
  assert.match(prompt, /HTML prototype|HTML mockup/i);
  assert.match(prompt, /screenshot/i);
  assert.match(prompt, /structured artifacts array/i);
  assert.match(prompt, /preq_update_task_note/);
  assert.match(prompt, /preq_complete_task/);
  assert.match(prompt, /preq_update_qa_run/);
  assert.match(prompt, /free of Artifacts: markdown blocks/i);
  assert.match(prompt, /7-day expiring reviewer links/i);
  assert.match(prompt, /access=quickshare/i);
  assert.match(prompt, /expires=\.\.\./i);
  assert.match(prompt, /non-expiring anyone-with-the-link URLs/i);
});

test("renders insight-specific task generation guidance", () => {
  const prompt = renderPrompt({
    taskKey: null,
    projectKey: "PROJ",
    branchName: "preqstation/proj",
    objective: "insight",
    engine: "codex",
    cwd: "/tmp/worktree/proj/preqstation-proj",
    projectCwd: "/tmp/project",
    insightPromptB64:
      "QnJlYWsgZG93biB0aGUgQ29ubmVjdGlvbnMgcGFnZSByZWRlc2lnbgpBbHNvIHJldmlldyB0aGUgbW9iaWxlIGZsb3c=",
  });

  assert.match(prompt, /Task ID: N\/A/);
  assert.match(prompt, /User Objective: insight/);
  assert.match(prompt, /Insight Prompt: Break down the Connections page redesign/);
  assert.match(prompt, /Task ID may be absent for project-level objectives/);
  assert.match(prompt, /preq_list_tasks\(projectKey=\.\.\., detail=full\)/);
  assert.match(prompt, /preq_create_task/);
});

test("renders qa run metadata for project-level qa dispatches", () => {
  const prompt = renderPrompt({
    taskKey: null,
    projectKey: "PROJ",
    branchName: "main",
    objective: "qa",
    engine: "claude-code",
    cwd: "/tmp/worktree/proj/main",
    projectCwd: "/tmp/project",
    qaRunId: "run-123",
    qaTaskKeys: ["PROJ-1", "PROJ-2"],
  });

  assert.match(prompt, /User Objective: qa/);
  assert.match(prompt, /QA Run ID: run-123/);
  assert.match(prompt, /QA Task Keys: PROJ-1, PROJ-2/);
  assert.match(prompt, /Task ID may be absent for project-level objectives/);
  assert.match(prompt, /use QA Run ID and QA Task Keys from this prompt/i);
});

test("renders comment id metadata for comment dispatches", () => {
  const prompt = renderPrompt({
    taskKey: "PROJ-329",
    projectKey: "PROJ",
    branchName: "task/proj-329/comment",
    objective: "comment",
    engine: "codex",
    cwd: "/tmp/worktree/proj/task-proj-329-comment",
    projectCwd: "/tmp/project",
    commentId: "comment-abc-123",
  });

  assert.match(prompt, /User Objective: comment/);
  assert.match(prompt, /Comment ID: comment-abc-123/);
});

test("renders Gemini CLI MCP tool naming guidance", () => {
  const prompt = renderPrompt({
    taskKey: "PROJ-330",
    projectKey: "PROJ",
    branchName: "task/proj-330/gemini",
    objective: "ask",
    engine: "gemini-cli",
    cwd: "/tmp/worktree/proj/task-proj-330-gemini",
    projectCwd: "/tmp/project",
  });

  assert.match(prompt, /Gemini CLI tool naming/);
  assert.match(prompt, /Do not call activate_skill/);
  assert.match(prompt, /mcp_preqstation_preq_get_task/);
  assert.match(prompt, /mcp_preqstation_preq_start_task/);
  assert.match(prompt, /mcp_preqstation_preq_update_task_note/);
});
