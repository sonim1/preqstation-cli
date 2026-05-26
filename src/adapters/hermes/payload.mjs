const ENGINES = new Set(["claude-code", "codex", "gemini-cli"]);
const TASK_OBJECTIVES = new Set(["plan", "implement", "ask", "review", "qa", "comment"]);
const PROJECT_OBJECTIVES = new Set(["insight", "qa"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

const MODEL_ID_PATTERN = /^[a-zA-Z0-9._:/@+-]+$/u;

function normalizeModel(value) {
  const model = normalizeString(value);
  if (!model || model.toLowerCase() === "default") return null;
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`Invalid dispatch model: ${model}`);
  }
  return model;
}

function normalizeEngine(value) {
  const engine = normalizeString(value).toLowerCase();
  if (!ENGINES.has(engine)) {
    throw new Error(`Unsupported dispatch engine: ${engine || "(missing)"}`);
  }
  return engine;
}

function normalizeProjectKey(value) {
  const projectKey = normalizeString(value).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,19}$/u.test(projectKey)) {
    throw new Error("Project key is required for Hermes dispatch");
  }
  return projectKey;
}

function normalizeTaskKey(value) {
  const taskKey = normalizeString(value).toUpperCase();
  if (!taskKey) return null;
  if (!/^[A-Z][A-Z0-9]+-\d+$/u.test(taskKey)) {
    throw new Error(`Invalid task key: ${taskKey}`);
  }
  return taskKey;
}

function inferProjectKey(taskKey) {
  return taskKey ? taskKey.split("-", 1)[0] ?? null : null;
}

function normalizeObjective(value) {
  const objective = normalizeString(value).toLowerCase();
  if (!objective) {
    throw new Error("Dispatch objective is required");
  }
  if (!TASK_OBJECTIVES.has(objective) && !PROJECT_OBJECTIVES.has(objective)) {
    throw new Error(`Unsupported dispatch objective: ${objective}`);
  }
  return objective;
}

function quoteMetadataValue(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

function buildRawMessage({
  objective,
  projectKey,
  taskKey,
  engine,
  branchName,
  model,
  askHint,
  insightPromptB64,
  commentId,
}) {
  const subject = taskKey ?? projectKey;
  const metadata = [];
  if (branchName) metadata.push(`branch_name=${quoteMetadataValue(branchName)}`);
  if (model) metadata.push(`model=${quoteMetadataValue(model)}`);
  if (askHint) metadata.push(`ask_hint=${quoteMetadataValue(askHint)}`);
  if (insightPromptB64) {
    metadata.push(`insight_prompt_b64=${quoteMetadataValue(insightPromptB64)}`);
  }
  if (commentId) metadata.push(`comment_id=${quoteMetadataValue(commentId)}`);

  return [
    `preqstation ${objective} ${subject} using ${engine}`,
    metadata.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

export function parseHermesDispatchPayload(payload) {
  const dispatch = payload?.dispatch;
  if (!dispatch || typeof dispatch !== "object") {
    throw new Error("Hermes dispatch payload must include a dispatch object");
  }

  const engine = normalizeEngine(dispatch.engine);
  const taskKey = normalizeTaskKey(dispatch.task_key ?? dispatch.taskKey);
  const projectKeyInput = normalizeString(dispatch.project_key ?? dispatch.projectKey);
  const projectKey = projectKeyInput
    ? normalizeProjectKey(projectKeyInput)
    : inferProjectKey(taskKey);
  const objective = normalizeObjective(dispatch.objective);
  const branchName = normalizeString(dispatch.branch_name ?? dispatch.branchName) || null;
  const model = normalizeModel(dispatch.model);
  const askHint = normalizeString(dispatch.ask_hint ?? dispatch.askHint) || null;
  const insightPromptB64 =
    normalizeString(dispatch.insight_prompt_b64 ?? dispatch.insightPromptB64) || null;
  const commentId = normalizeString(dispatch.comment_id ?? dispatch.commentId) || null;

  if (TASK_OBJECTIVES.has(objective) && !taskKey) {
    throw new Error(`Task key is required for ${objective} dispatch`);
  }
  if (objective === "comment" && !commentId) {
    throw new Error("Comment ID is required for comment dispatch");
  }
  if (!projectKey) {
    throw new Error("Project key is required for Hermes dispatch");
  }
  if (!taskKey && !PROJECT_OBJECTIVES.has(objective)) {
    throw new Error(`Project-level ${objective} dispatch is not supported`);
  }
  if (taskKey && projectKey !== inferProjectKey(taskKey)) {
    throw new Error(`Task key ${taskKey} does not match project key ${projectKey}`);
  }

  return {
    engine,
    taskKey,
    projectKey,
    objective,
    branchName,
    model,
    askHint,
    insightPromptB64,
    ...(commentId ? { commentId } : {}),
    rawMessage: buildRawMessage({
      objective,
      projectKey,
      taskKey,
      engine,
      branchName,
      model,
      askHint,
      insightPromptB64,
      commentId,
    }),
  };
}
