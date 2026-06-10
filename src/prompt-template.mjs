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

function taskRef(taskKey) {
  return taskKey || "<task-id>";
}

function objectiveCompletionContract({ objective, taskKey, projectKey, commentId, cliCommand }) {
  const task = taskRef(taskKey);
  switch (objective) {
    case "plan":
      return `For User Objective plan, do not exit until the task plan CLI command succeeds with concrete plan markdown and acceptance criteria: ${cliCommand} task plan ${task} --plan-file plan.md.`;
    case "implement":
    case "resume":
      return `For User Objective ${objective}, do not exit until task complete succeeds after verified work, or task block succeeds with a concrete blocker: ${cliCommand} task complete ${task} --json-file result.json or ${cliCommand} task block ${task} --reason-file blocker.md.`;
    case "review":
      return `For User Objective review, do not exit until task review succeeds after verification, or task block succeeds with the verification failure: ${cliCommand} task review ${task} --json-file review.json.`;
    case "ask":
      return `For User Objective ask, do not exit until task note succeeds and task status clears run_state while preserving the current workflow status: ${cliCommand} task note ${task} --body-file note.md then ${cliCommand} task status ${task} --status <current-status> --clear-run-state.`;
    case "comment":
      return `For User Objective comment, do not exit until comment reply succeeds and comment state marks the target comment done, or failed with a concrete error: ${cliCommand} comment reply --comment-id ${commentId || "<comment-id>"} --body-file reply.md then ${cliCommand} comment state --comment-id ${commentId || "<comment-id>"} --state done.`;
    case "insight":
      return `For User Objective insight, do not exit until the required task create CLI commands are complete, or you have determined there is no non-duplicate task to create: ${cliCommand} task create --project ${projectKey || "<project-key>"} --json-file task.json.`;
    case "qa":
      return `For User Objective qa, do not exit until qa update records passed or failed with a report: ${cliCommand} qa update --run-id <qa-run-id> --json-file qa-report.json.`;
    default:
      return `For User Objective ${objective || "unknown"}, do not exit until the objective-specific PREQSTATION CLI lifecycle command succeeds, or a concrete failure/blocker is recorded.`;
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
        `3) If Task ID is present, run ${cliCommand} task get ${taskKey} first.`,
        `4) Immediately after fetching the task, run ${cliCommand} task start ${taskKey} --engine ${engine} before substantive work.`,
      ]
    : [
        "3) Task ID may be absent for project-level objectives such as insight or qa. Do not invent one.",
        "4) When Task ID is absent, skip task lifecycle mutations and operate at the project level only.",
      ];
  const completionContract = objectiveCompletionContract({
    objective,
    taskKey,
    projectKey,
    commentId,
    cliCommand,
  });

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
    `PREQ CLI: ${cliCommand}`,
    "",
    "Objective Completion Contract:",
    "- task get and task start are bootstrap only; they never count as completing the User Objective.",
    `- ${completionContract}`,
    "- In detached/headless runs, do not stop with a summary such as 'No additional actions were taken yet' or ask the user for confirmation before the final PREQ tool call.",
    "- Native PREQ MCP tools must not be used even if visible; use only the PREQSTATION CLI commands in these instructions for PREQ lifecycle reads and mutations.",
    "",
    "Execution Requirements:",
    `1) Work only inside ${cwd}.`,
    `2) Use branch ${branchName ?? "N/A"} for commits and pushes when needed.`,
    ...taskInstructions,
    `5) If User Objective is ask, update the task note, keep the workflow status unchanged, and run ${cliCommand} task note ${taskRef(taskKey)} --body-file note.md followed by ${cliCommand} task status ${taskRef(taskKey)} --status <current-status> --clear-run-state when finished.`,
    "6) Prototype-style asks may generate local artifacts. If an authenticated artifact provider is already available, attempt publication and keep private-or-skip by using authenticated workspace/share targets when possible. If share or quickshare-style temporary external links are available, create 7-day expiring reviewer links, record them with access=quickshare and expires=..., and do not create non-expiring anyone-with-the-link URLs. If the artifact is an HTML prototype or HTML mockup, generate at least one screenshot PNG and attempt to publish both the HTML source and screenshot. Pass published links or skip/local artifact results through the structured artifacts array in task note, task complete, or qa update JSON payloads; keep task notes/reports free of Artifacts: markdown blocks. If Ask Hint is present, treat it as optional note-rewrite guidance rather than a new workflow requirement.",
    `7) If User Objective is insight, inspect the current local project, run ${cliCommand} task list --project ${projectKey ?? "<project-key>"} --detail full, avoid duplicate work, and create Inbox tasks with ${cliCommand} task create --project ${projectKey ?? "<project-key>"} --json-file task.json.`,
    "8) If User Objective is insight, use Insight Prompt only as task-generation guidance and do not mutate existing tasks.",
    "9) If User Objective is qa, use QA Run ID and QA Task Keys from these instructions as the QA execution context. When QA Run ID is present, update the QA run lifecycle instead of inventing a task-scoped run.",
    `10) Use PREQSTATION CLI lifecycle commands as the source of truth for status transitions: task, comment, project, and qa subcommands all print JSON.`,
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
