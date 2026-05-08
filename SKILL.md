---
name: preqstation-dispatch
description: "PREQSTATION dispatcher companion guide. Use when dispatching PREQ work into a mapped project worktree with Claude Code, Codex CLI, or Gemini CLI through OpenClaw or a Telegram host such as Hermes."
metadata:
  { "openclaw": { "requires": { "anyBins": ["claude", "codex", "gemini"] } } }
---

# preqstation-dispatch

This skill documents the dispatcher-owned PREQ flow.

The dispatcher should:

1. parse the dispatch request
2. resolve the project path on the local dispatcher host
3. prepare an isolated git worktree
4. write `.preqstation-prompt.txt`
5. launch the selected engine as a detached process

Hermes is a dispatch host, not an engine. The engine remains one of:

- `claude-code`
- `codex`
- `gemini-cli`

## OpenClaw Trigger Examples

- `/skill preqstation-dispatch plan PROJ-327 using codex`
- `/skill preqstation-dispatch ask PROJ-328 using codex ask_hint="Acceptance criteria"`
- `!/skill preqstation-dispatch implement PROJ-327 using claude`
- `preqstation implement PROJ-327 with codex`

Setup command:

- `/preqsetup auto`
- `/preqsetup import`
- `/preqsetup set <PROJECT_KEY> <ABSOLUTE_PATH>`
- `/preqsetup status`

Recommended OpenClaw setup:

- Use `/preqsetup auto` with `PROJECT_KEY REPO_URL` lines when OpenClaw should manage project-path mappings itself.
- `auto` scans `PREQSTATION_REPO_ROOTS` when set, otherwise `~/projects`, and matches local git `origin` URLs against the provided repo URLs.
- Use `/preqsetup import` only as a compatibility shortcut when another runtime already populated `~/.preqstation-dispatch/projects.json`.

## Standalone Dispatcher CLI

Telegram hosts can launch the dispatcher without OpenClaw:

```bash
preqstation setup set PROJ /absolute/path/to/project
preqstation setup auto
preqstation run --project-key PROJ --task-key PROJ-327 --objective implement --engine codex
```

`preqstation setup auto` fetches PREQ projects from the configured `/mcp` endpoint with OAuth, scans local git repos under `PREQSTATION_REPO_ROOTS` or `~/projects`, and saves matched local paths to `~/.preqstation-dispatch/projects.json`.

Hermes Telegram messages should lead to `preqstation`; they should not implement the PREQ task inside the Hermes chat run.

## Hard Rules

1. Dispatcher only. Never implement the task inside the OpenClaw or Hermes trigger run.
2. Worktree isolation only. Never launch in the primary checkout.
3. Prompt via file only. Always write `.preqstation-prompt.txt` into the worktree first.
4. Detached launch only. Do not use `pty:true` / `background:true` for the coding run.
5. If dispatch fails after the message was clearly intended for PREQ, return a clear handled failure instead of falling back to a generic LLM reply.
6. Do not put local project paths into PREQ server payloads or Telegram messages. Local paths belong only to the dispatcher host.

## Path Resolution

The current dispatcher resolves `project_cwd` in this order:

1. explicit absolute path mentioned in a direct dispatch message
2. OpenClaw plugin config mapping saved by `/preqsetup`
3. shared `~/.preqstation-dispatch/projects.json`
4. optional legacy markdown mapping from `PREQSTATION_MEMORY_PATH` or configured `memoryPath`

Public payloads and Telegram dispatch messages should not include absolute local paths.

## Prompt Contract

The dispatched CLI reads `./.preqstation-prompt.txt` in the worktree and should:

1. call `preq_get_task("<task>")` first when a task key exists
2. call `preq_start_task("<task>", "<engine>")` before substantive work
3. if the objective is `ask`, update the task note, use `preq_update_task_note`, and clear `run_state` with `preq_update_task_status` while keeping workflow status unchanged
4. work only inside the resolved worktree
5. if launched from OpenClaw and `openclaw` is available, notify OpenClaw on completion with `openclaw system event --text "Done: <brief summary>" --mode now`

## Runtime Artifacts

Detached process artifacts live inside the worktree:

- `.preqstation-dispatch/<engine>.pid`
- `.preqstation-dispatch/<engine>.log`

This is the supported monitoring surface for now. The dispatcher no longer documents PTY session polling as the dispatch model.
