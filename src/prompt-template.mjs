import { fileURLToPath } from "node:url";

import { PREQSTATION_INSTRUCTIONS_FILE } from "./instruction-files.mjs";

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

function objectiveCompletionContract(objective) {
  switch (objective) {
    case "plan":
      return "For User Objective plan, do not exit until preq_plan_task succeeds with concrete plan markdown and acceptance criteria.";
    case "implement":
    case "resume":
      return `For User Objective ${objective}, do not exit until preq_complete_task succeeds after verified work, or preq_block_task succeeds with a concrete blocker.`;
    case "review":
      return "For User Objective review, do not exit until preq_review_task succeeds after verification, or preq_block_task succeeds with the verification failure.";
    case "ask":
      return "For User Objective ask, do not exit until preq_update_task_note succeeds and preq_update_task_status clears run_state while preserving the current workflow status.";
    case "comment":
      return "For User Objective comment, do not exit until preq_reply_task_comment succeeds and preq_update_task_comment_state marks the target comment done, or failed with a concrete error.";
    case "insight":
      return "For User Objective insight, do not exit until the required preq_create_task calls are complete, or you have determined there is no non-duplicate task to create.";
    case "qa":
      return "For User Objective qa, do not exit until preq_update_qa_run records passed or failed with a report.";
    default:
      return `For User Objective ${objective || "unknown"}, do not exit until the lifecycle skill's objective-specific final PREQ tool succeeds, or a concrete failure/blocker is recorded.`;
  }
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
  const completionContract = objectiveCompletionContract(objective);

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
    "Objective Completion Contract:",
    "- preq_get_task and preq_start_task are bootstrap only; they never count as completing the User Objective.",
    `- ${completionContract}`,
    "- In detached/headless runs, do not stop with a summary such as 'No additional actions were taken yet' or ask the user for confirmation before the final PREQ tool call.",
    "- If native MCP tool calls fail authentication, continue with the MCP CLI helper using JSON keys exactly as documented, for example: mcp call preq_start_task --json '{\"taskId\":\"TASK-123\",\"engine\":\"codex\"}'.",
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
    "9) If User Objective is qa, use QA Run ID and QA Task Keys from these instructions as the QA execution context. When QA Run ID is present, update the QA run lifecycle instead of inventing a task-scoped run.",
    `10) Use the PREQSTATION lifecycle skill as the source of truth for status transitions. In detached/headless runs, prefer the MCP CLI helper over native MCP tool calls: ${cliCommand} mcp call <tool> --json '<json-object>'.`,
    "11) Do not create Markdown checkbox task-list syntax such as - [ ] or - [x] in AI-generated task notes, plans, acceptance criteria, QA reports, descriptions, or newly created task content unless the user explicitly requests checkboxes. Preserve user-authored checkboxes when rewriting existing content; otherwise use plain bullets or numbered lists.",
    "12) Treat task notes and acceptance criteria as the implementation source of truth. Comments are conversational requests only; they affect implementation only after a comment objective explicitly updates the task note.",
    "13) For comment objectives only, treat Comment ID as the primary request and fetch task comments as conversation history/reference, including previous agent replies. Use non-target comments only to understand conversation flow, not as independent actionable requirements.",
    "14) For implement, resume, review, plan, ask, insight, and qa objectives, do not read task comments as hidden implementation requirements or conversation context unless these instructions or the lifecycle skill explicitly says to handle a comment objective.",
    `15) If ./${PREQSTATION_INSTRUCTIONS_FILE} is missing, stop instead of improvising.`,
    `16) When finished, clean up the worktree with: git -C ${projectCwd} worktree remove ${cwd} --force && git -C ${projectCwd} worktree prune`,
    "",
    "Task handling bootstrap:",
    `Read and execute instructions from ./${PREQSTATION_INSTRUCTIONS_FILE} in the current workspace. Treat that file as the source of truth. If that file is missing, stop.`,
  ].join("\n");
}
