import test from "node:test";
import assert from "node:assert/strict";

import { parseDispatchMessage } from "../src/parse-dispatch-message.mjs";

test("parses telegram relay dispatch syntax", () => {
  const parsed = parseDispatchMessage(
    '!/preqstation dispatch plan PROJ-327 using codex branch_name="task/proj-327/browser-notification-chuga"',
  );

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-327",
    projectKey: "PROJ",
    objective: "plan",
    branchName: "task/proj-327/browser-notification-chuga",
    askHint: null,
    insightPromptB64: null,
    qaRunId: null,
    qaTaskKeys: null,
    rawMessage:
      '!/preqstation dispatch plan PROJ-327 using codex branch_name="task/proj-327/browser-notification-chuga"',
  });
});

test("parses explicit preqstation dispatch text", () => {
  const parsed = parseDispatchMessage(
    "/preqstation dispatch implement PROJ-12 with codex",
  );

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-12",
    projectKey: "PROJ",
    objective: "implement",
    branchName: null,
    askHint: null,
    insightPromptB64: null,
    qaRunId: null,
    qaTaskKeys: null,
    rawMessage: "/preqstation dispatch implement PROJ-12 with codex",
  });
});

test("parses ask objective with ask_hint metadata", () => {
  const parsed = parseDispatchMessage(
    '!/preqstation dispatch ask PROJ-328 using codex ask_hint="Summarize around acceptance criteria"',
  );

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-328",
    projectKey: "PROJ",
    objective: "ask",
    branchName: null,
    askHint: "Summarize around acceptance criteria",
    insightPromptB64: null,
    qaRunId: null,
    qaTaskKeys: null,
    rawMessage:
      '!/preqstation dispatch ask PROJ-328 using codex ask_hint="Summarize around acceptance criteria"',
  });
});

test("parses project-level insight commands without a task key", () => {
  const parsed = parseDispatchMessage(
    '!/preqstation dispatch insight PROJ using codex insight_prompt_b64="cHJvbXB0LWJhc2U2NA=="',
  );

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: null,
    projectKey: "PROJ",
    objective: "insight",
    branchName: null,
    askHint: null,
    insightPromptB64: "cHJvbXB0LWJhc2U2NA==",
    qaRunId: null,
    qaTaskKeys: null,
    rawMessage:
      '!/preqstation dispatch insight PROJ using codex insight_prompt_b64="cHJvbXB0LWJhc2U2NA=="',
  });
});

test("parses project-level qa metadata without treating qa_task_keys as the primary task", () => {
  const parsed = parseDispatchMessage(
    '!/preqstation dispatch qa PROJ using claude-code branch_name="main" qa_run_id="run-123" qa_task_keys="PROJ-1,PROJ-2"',
  );

  assert.deepEqual(parsed, {
    engine: "claude-code",
    taskKey: null,
    projectKey: "PROJ",
    objective: "qa",
    branchName: "main",
    askHint: null,
    insightPromptB64: null,
    qaRunId: "run-123",
    qaTaskKeys: ["PROJ-1", "PROJ-2"],
    rawMessage:
      '!/preqstation dispatch qa PROJ using claude-code branch_name="main" qa_run_id="run-123" qa_task_keys="PROJ-1,PROJ-2"',
  });
});

test("parses task-level qa commands with a real task key", () => {
  const parsed = parseDispatchMessage(
    '!/preqstation dispatch qa PROJ-328 using codex',
  );

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-328",
    projectKey: "PROJ",
    objective: "qa",
    branchName: null,
    askHint: null,
    insightPromptB64: null,
    qaRunId: null,
    qaTaskKeys: null,
    rawMessage: '!/preqstation dispatch qa PROJ-328 using codex',
  });
});

test("parses comment objective with comment_id metadata", () => {
  const parsed = parseDispatchMessage(
    '!/preqstation dispatch comment PROJ-329 using codex comment_id="comment-abc-123"',
  );

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-329",
    projectKey: "PROJ",
    objective: "comment",
    branchName: null,
    askHint: null,
    insightPromptB64: null,
    qaRunId: null,
    qaTaskKeys: null,
    commentId: "comment-abc-123",
    rawMessage:
      '!/preqstation dispatch comment PROJ-329 using codex comment_id="comment-abc-123"',
  });
});

test("parses comment objective with camelCase commentId metadata", () => {
  const parsed = parseDispatchMessage(
    "/preqstation dispatch comment PROJ-330 using claude-code commentId=comment-def-456",
  );

  assert.equal(parsed.commentId, "comment-def-456");
});

test("bare preqstation is help-only and not parsed as dispatch", () => {
  assert.equal(parseDispatchMessage("/preqstation"), null);
  assert.equal(parseDispatchMessage("/preqstation help"), null);
});

test("rejects removed legacy dispatch commands", () => {
  assert.equal(parseDispatchMessage("preqstation implement PROJ-12 with codex"), null);
  assert.equal(parseDispatchMessage("!/skill preqstation-dispatch plan PROJ-327 using codex"), null);
  assert.equal(parseDispatchMessage("!/skill preqstation_dispatch plan PROJ-327 using codex"), null);
});

test("returns null for unrelated messages", () => {
  assert.equal(
    parseDispatchMessage("what is the current weather in toronto"),
    null,
  );
});
