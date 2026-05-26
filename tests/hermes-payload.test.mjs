import test from "node:test";
import assert from "node:assert/strict";

import { parseHermesDispatchPayload } from "../src/adapters/hermes/payload.mjs";

test("parses a Hermes task dispatch payload into a dispatcher request", () => {
  const parsed = parseHermesDispatchPayload({
    event_type: "preq.dispatch.requested",
    event_id: "dispatch_request:req-123",
    dispatch: {
      request_id: "req-123",
      objective: "implement",
      task_key: "proj-123",
      engine: "codex",
      branch_name: "task/proj-123-example",
      ask_hint: "",
    },
  });

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-123",
    projectKey: "PROJ",
    objective: "implement",
    branchName: "task/proj-123-example",
    model: null,
    askHint: null,
    insightPromptB64: null,
    rawMessage:
      'preqstation implement PROJ-123 using codex branch_name="task/proj-123-example"',
  });
});

test("infers project key from task key when Hermes task payload omits project_key", () => {
  const parsed = parseHermesDispatchPayload({
    event_type: "preq.dispatch.requested",
    dispatch: {
      objective: "review",
      task_key: "proj-456",
      engine: "codex",
    },
  });

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-456",
    projectKey: "PROJ",
    objective: "review",
    branchName: null,
    model: null,
    askHint: null,
    insightPromptB64: null,
    rawMessage: "preqstation review PROJ-456 using codex",
  });
});

test("parses a Hermes project insight payload without a task key", () => {
  const parsed = parseHermesDispatchPayload({
    event_type: "preq.dispatch.requested",
    dispatch: {
      objective: "insight",
      project_key: "PROJ",
      engine: "gemini-cli",
      insight_prompt_b64: "cHJvbXB0",
    },
  });

  assert.deepEqual(parsed, {
    engine: "gemini-cli",
    taskKey: null,
    projectKey: "PROJ",
    objective: "insight",
    branchName: null,
    model: null,
    askHint: null,
    insightPromptB64: "cHJvbXB0",
    rawMessage:
      'preqstation insight PROJ using gemini-cli insight_prompt_b64="cHJvbXB0"',
  });
});

test("parses a Hermes comment payload with comment id metadata", () => {
  const parsed = parseHermesDispatchPayload({
    event_type: "preq.dispatch.requested",
    dispatch: {
      objective: "comment",
      taskKey: "proj-789",
      engine: "codex",
      commentId: "comment-abc-123",
    },
  });

  assert.deepEqual(parsed, {
    engine: "codex",
    taskKey: "PROJ-789",
    projectKey: "PROJ",
    objective: "comment",
    branchName: null,
    model: null,
    askHint: null,
    insightPromptB64: null,
    commentId: "comment-abc-123",
    rawMessage:
      'preqstation comment PROJ-789 using codex comment_id="comment-abc-123"',
  });
});

test("parses Hermes model overrides and includes them in raw metadata", () => {
  const parsed = parseHermesDispatchPayload({
    event_type: "preq.dispatch.requested",
    dispatch: {
      objective: "implement",
      task_key: "proj-321",
      engine: "codex",
      model: "gpt-5.3-codex-spark",
    },
  });

  assert.equal(parsed.model, "gpt-5.3-codex-spark");
  assert.equal(
    parsed.rawMessage,
    'preqstation implement PROJ-321 using codex model="gpt-5.3-codex-spark"',
  );
});

test("omits default Hermes model overrides", () => {
  const parsed = parseHermesDispatchPayload({
    event_type: "preq.dispatch.requested",
    dispatch: {
      objective: "implement",
      task_key: "proj-321",
      engine: "codex",
      model: "default",
    },
  });

  assert.equal(parsed.model, null);
  assert.equal(parsed.rawMessage, "preqstation implement PROJ-321 using codex");
});

test("rejects comment dispatches without a comment id", () => {
  assert.throws(
    () =>
      parseHermesDispatchPayload({
        event_type: "preq.dispatch.requested",
        dispatch: {
          objective: "comment",
          task_key: "PROJ-789",
          engine: "codex",
        },
      }),
    /Comment ID is required for comment dispatch/,
  );
});

test("rejects hermes-agent as an engine because Hermes is a dispatch host", () => {
  assert.throws(
    () =>
      parseHermesDispatchPayload({
        event_type: "preq.dispatch.requested",
        dispatch: {
          objective: "implement",
          project_key: "PROJ",
          task_key: "PROJ-123",
          engine: "hermes-agent",
        },
      }),
    /Unsupported dispatch engine: hermes-agent/,
  );
});

test("rejects task objectives without a task key", () => {
  assert.throws(
    () =>
      parseHermesDispatchPayload({
        event_type: "preq.dispatch.requested",
        dispatch: {
          objective: "implement",
          project_key: "PROJ",
          engine: "codex",
        },
      }),
    /Task key is required for implement dispatch/,
  );
});

test("rejects mismatched project and task keys when both are provided", () => {
  assert.throws(
    () =>
      parseHermesDispatchPayload({
        event_type: "preq.dispatch.requested",
        dispatch: {
          objective: "implement",
          project_key: "MISS",
          task_key: "PROJ-123",
          engine: "codex",
        },
      }),
    /Task key PROJ-123 does not match project key MISS/,
  );
});
