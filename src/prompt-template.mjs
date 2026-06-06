import { fileURLToPath } from "node:url";

function decodePromptMetadata(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }

  try {
    return Buffer.from(normalized, "base64").toString("utf8").trim();
  } catch {
    return normalized;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function defaultCliCommand() {
  return `${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL("../bin/preqstation.mjs", import.meta.url)))}`;
}

export function renderPrompt({
  taskKey,
  projectKey,
  branchName,
  objective,
  engine,
  cwd,
  projectCwd,
  askHint,
  insightPromptB64,
  qaRunId,
  qaTaskKeys,
  commentId,
  cliCommand = defaultCliCommand(),
}) {
  const insightPrompt = decodePromptMetadata(insightPromptB64);
  const qaTaskKeyList =
    Array.isArray(qaTaskKeys) && qaTaskKeys.length > 0
      ? qaTaskKeys.join(", ")
      : "N/A";
  const taskInstructions = taskKey
    ? [
        `3) If Task ID is present, call preq_get_task("${taskKey}") first.`,
        `4) Immediately after fetching the task, call preq_start_task("${taskKey}", "${engine}") before substantive work.`,
      ]
    : [
        "3) Task ID may be absent for project-level objectives such as insight or qa. Do not invent one.",
        "4) When Task ID is absent, skip task lifecycle mutations and operate at the project level only.",
      ];
  const geminiToolInstructions =
    engine === "gemini-cli"
      ? [
          "Gemini CLI tool naming:",
          "- Do not call activate_skill; the lifecycle instructions are already in this prompt.",
          "- PREQ MCP tools are exposed with the mcp_preqstation_ prefix in Gemini CLI.",
          "- Use mcp_preqstation_preq_get_task for preq_get_task.",
          "- Use mcp_preqstation_preq_start_task for preq_start_task.",
          "- Use mcp_preqstation_preq_update_task_note for preq_update_task_note.",
          "- Use mcp_preqstation_preq_update_task_status for preq_update_task_status.",
          "- Use the same mcp_preqstation_ prefix for other PREQ tools listed by the lifecycle instructions.",
        ]
      : [];

  return [
    `Task ID: ${taskKey ?? "N/A"}`,
    `Project Key: ${projectKey ?? "N/A"}`,
    `Branch Name: ${branchName ?? "N/A"}`,
    `Lifecycle Skill: preqstation`,
    `User Objective: ${objective}`,
    `Ask Hint: ${askHint ?? "N/A"}`,
    `Insight Prompt: ${insightPrompt || "N/A"}`,
    `QA Run ID: ${qaRunId ?? "N/A"}`,
    `QA Task Keys: ${qaTaskKeyList}`,
    `Comment ID: ${commentId ?? "N/A"}`,
    `MCP CLI Helper: ${cliCommand} mcp call`,
    "",
    "Execution Requirements:",
    `1) Work only inside ${cwd}.`,
    `2) Use branch ${branchName ?? "N/A"} for commits and pushes when needed.`,
    ...taskInstructions,
    ...geminiToolInstructions,
    "5) If User Objective is ask, update the task note, keep the workflow status unchanged, and use preq_update_task_note followed by preq_update_task_status with the current task status to clear run_state when finished.",
    "6) Prototype-style asks may generate local artifacts. If an authenticated artifact provider is already available, attempt publication and keep private-or-skip by using authenticated workspace/share targets when possible. If share or quickshare-style temporary external links are available, create 7-day expiring reviewer links, record them with access=quickshare and expires=..., and do not create non-expiring anyone-with-the-link URLs. If the artifact is an HTML prototype or HTML mockup, generate at least one screenshot PNG and attempt to publish both the HTML source and screenshot. Pass published links or skip/local artifact results through the structured artifacts array on preq_update_task_note, preq_complete_task, or preq_update_qa_run; keep task notes/reports free of Artifacts: markdown blocks. If Ask Hint is present, treat it as optional note-rewrite guidance rather than a new workflow requirement.",
    "7) If User Objective is insight, inspect the current local project, call preq_list_tasks(projectKey=..., detail=full), avoid duplicate work, and create Inbox tasks with preq_create_task.",
    "8) If User Objective is insight, use Insight Prompt only as task-generation guidance and do not mutate existing tasks.",
    "9) If User Objective is qa, use QA Run ID and QA Task Keys from this prompt as the QA execution context. When QA Run ID is present, update the QA run lifecycle instead of inventing a task-scoped run.",
    `10) Use the PREQSTATION lifecycle skill as the source of truth for status transitions. In detached/headless runs, prefer the MCP CLI helper over native MCP tool calls: ${cliCommand} mcp call <tool> --json '<json-object>'.`,
    "11) Do not create Markdown checkbox task-list syntax such as - [ ] or - [x] in AI-generated task notes, plans, acceptance criteria, QA reports, descriptions, or newly created task content unless the user explicitly requests checkboxes. Preserve user-authored checkboxes when rewriting existing content; otherwise use plain bullets or numbered lists.",
    "12) Treat task notes and acceptance criteria as the implementation source of truth. Comments are conversational requests only; they affect implementation only after a comment objective explicitly updates the task note.",
    "13) For comment objectives only, treat Comment ID as the primary request and fetch task comments as conversation history/reference, including previous agent replies. Use non-target comments only to understand conversation flow, not as independent actionable requirements.",
    "14) For implement, resume, review, plan, ask, insight, and qa objectives, do not read task comments as hidden implementation requirements or conversation context unless this prompt or the lifecycle skill explicitly says to handle a comment objective.",
    "15) If ./.preqstation-prompt.txt is missing, stop instead of improvising.",
    `16) When finished, clean up the worktree with: git -C ${projectCwd} worktree remove ${cwd} --force && git -C ${projectCwd} worktree prune`,
    "",
    "Task handling bootstrap:",
    'Read and execute instructions from ./.preqstation-prompt.txt in the current workspace. Treat that file as the source of truth. If that file is missing, stop.',
  ].join("\n");
}
