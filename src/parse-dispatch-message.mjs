const TASK_KEY_PATTERN = /^([A-Z][A-Z0-9]+-\d+)$/u;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_-]{0,19}$/u;

function normalizeDispatchCommand(message) {
  const normalized = message.replace(/^!\s*/u, "").trim();
  const match = normalized.match(/^\/preqstation(?:@[A-Za-z0-9_]+)?\s+dispatch(?:\s+|$)/iu);
  if (!match) {
    return null;
  }
  return normalized.slice(match[0].length).trim();
}

function tokenizeCommand(message) {
  const normalized = normalizeDispatchCommand(message);
  return normalized ? normalized.split(/\s+/u).filter(Boolean) : [];
}

function normalizeEngine(message) {
  if (/\bclaude(?:-code)?\b/i.test(message)) {
    return "claude-code";
  }
  if (/\bcodex\b/i.test(message)) {
    return "codex";
  }
  if (/\bgemini(?:-cli)?\b/i.test(message)) {
    return "gemini-cli";
  }
  return "claude-code";
}

function parseMetadataValue(message, key) {
  const quotedMatch = message.match(new RegExp(`\\b${key}=(["'])(.*?)\\1`, "i"));
  if (quotedMatch) {
    return quotedMatch[2].trim() || null;
  }

  const bareMatch = message.match(new RegExp(`\\b${key}=([^\\s]+)`, "i"));
  return bareMatch ? bareMatch[1].trim() : null;
}

function parseBranchName(message) {
  return parseMetadataValue(message, "branch(?:_name)?");
}

function parseAskHint(message) {
  return parseMetadataValue(message, "ask_hint");
}

function parseInsightPromptB64(message) {
  return parseMetadataValue(message, "insight_prompt_b64");
}

function parseQaRunId(message) {
  return parseMetadataValue(message, "qa_run_id");
}

const MODEL_ID_PATTERN = /^[a-zA-Z0-9._:/@+-]+$/u;

function parseModel(message) {
  const model = parseMetadataValue(message, "model");
  if (!model || model.toLowerCase() === "default") {
    return null;
  }
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`Invalid dispatch model: ${model}`);
  }
  return model;
}

function parseQaTaskKeys(message) {
  const rawValue = parseMetadataValue(message, "qa_task_keys");
  if (!rawValue) {
    return null;
  }

  const taskKeys = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return taskKeys.length > 0 ? taskKeys : null;
}

function parseCommentId(message) {
  return parseMetadataValue(message, "comment_id") ?? parseMetadataValue(message, "commentId");
}

function parseObjective(tokens) {
  return tokens[0] || "implement";
}

function parseTaskKey(subjectToken) {
  if (!subjectToken) {
    return null;
  }

  const match = subjectToken.match(TASK_KEY_PATTERN);
  return match ? match[1] : null;
}

function parseProjectKey(objective, taskKey, subjectToken) {
  if (taskKey) {
    const [projectKey] = taskKey.split("-");
    return projectKey;
  }

  if (objective !== "insight" && objective !== "qa") {
    return null;
  }

  const projectKey = subjectToken?.trim().toUpperCase() ?? "";
  return PROJECT_KEY_PATTERN.test(projectKey) ? projectKey : null;
}

export function parseDispatchMessage(message) {
  if (normalizeDispatchCommand(message) === null) {
    return null;
  }

  const tokens = tokenizeCommand(message);
  const objective = parseObjective(tokens);
  const subjectToken = tokens[1] ?? null;
  const taskKey = parseTaskKey(subjectToken);
  const projectKey = parseProjectKey(objective, taskKey, subjectToken);

  if (!taskKey && !projectKey) {
    return null;
  }

  const commentId = parseCommentId(message);

  return {
    engine: normalizeEngine(message),
    taskKey,
    projectKey,
    objective,
    branchName: parseBranchName(message),
    askHint: parseAskHint(message),
    model: parseModel(message),
    insightPromptB64: parseInsightPromptB64(message),
    qaRunId: parseQaRunId(message),
    qaTaskKeys: parseQaTaskKeys(message),
    ...(commentId ? { commentId } : {}),
    rawMessage: message,
  };
}
