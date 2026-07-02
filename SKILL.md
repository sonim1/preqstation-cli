---
name: preqstation
description: "PREQSTATION dispatcher companion guide. Use when dispatching PREQ work into a mapped project worktree with Claude Code, Codex CLI, or Gemini CLI through OpenClaw or a Telegram host such as Hermes."
metadata:
  { "openclaw": { "requires": { "anyBins": ["claude", "codex", "gemini"] } } }
---

# preqstation

This skill documents the dispatcher-owned PREQ flow.

The dispatcher should:

1. parse the dispatch request
2. resolve the project path on the local dispatcher host
3. prepare an isolated git worktree
4. write `.preqstation-instructions.txt`
5. launch the selected engine as a detached process

Hermes is a dispatch host, not an engine. The engine remains one of:

- `claude-code`
- `codex`
- `gemini-cli`

## OpenClaw Trigger Examples

- `/preqstation dispatch plan PROJ-327 using codex`
- `/preqstation dispatch ask PROJ-328 using codex ask_hint="Acceptance criteria"`
- `!/preqstation dispatch implement PROJ-327 using claude`
- `/preqstation dispatch implement PROJ-327 using codex model="gpt-5.3-codex-spark"`

Setup command:

- `/preqstation setup auto`
- `/preqstation setup import`
- `/preqstation setup set <PROJECT_KEY> <ABSOLUTE_PATH>`
- `/preqstation setup status`

Recommended OpenClaw setup:

- Use `/preqstation setup auto` with `PROJECT_KEY REPO_URL` lines when OpenClaw should manage project-path mappings itself.
- `auto` scans `PREQSTATION_REPO_ROOTS` when set, otherwise `~/projects`, and matches local git `origin` URLs against the provided repo URLs.
- Use `/preqstation setup import` only as a compatibility shortcut when another runtime already populated `~/.preqstation/projects.json`; legacy `~/.preqstation-dispatch/projects.json` is an import fallback only.

## Standalone Dispatcher CLI

Telegram hosts can launch the dispatcher without OpenClaw:

```bash
preqstation setup set PROJ /absolute/path/to/project
preqstation setup auto
preqstation run --project-key PROJ --task-key PROJ-327 --objective implement --engine codex --model gpt-5.3-codex-spark
```

Model overrides are optional. Omit `model`/`--model`, or pass `default`, to preserve the runtime's configured default with no `--model` flag. Non-default model values are passed through to the selected engine as `--model <model>` and should use the exact CLI model id for that engine.

`preqstation setup auto` fetches PREQ projects from the configured PREQSTATION endpoint with OAuth, scans local git repos under `PREQSTATION_REPO_ROOTS` or `~/projects`, and saves matched local paths to `~/.preqstation/projects.json`.

Interactive `preqstation install` runs that setup automatically and persists the CLI server URL config.

`preqstation update` refreshes installed entrypoints, checks runtime CLI paths plus optional legacy worker skills, and then runs the same project setup.

Interactive `preqstation uninstall` removes selected request entrypoints, legacy runtime MCP registrations, and legacy worker support while keeping project mappings and OAuth cache data.

Hermes Telegram messages should lead to `preqstation`; they should not implement the PREQ task inside the Hermes chat run.

## Hard Rules

1. Dispatcher only. Never implement the task inside the OpenClaw or Hermes trigger run.
2. Worktree isolation only. Never launch in the primary checkout.
3. Instructions via file only. Always write `.preqstation-instructions.txt` into the worktree first.
4. Detached launch only. Do not use `pty:true` / `background:true` for the coding run.
5. If dispatch fails after the message was clearly intended for PREQ, return a clear handled failure instead of falling back to a generic LLM reply.
6. Do not put local project paths into PREQ server payloads or Telegram messages. Local paths belong only to the dispatcher host.

## Path Resolution

The current dispatcher resolves `project_cwd` in this order:

1. explicit absolute path mentioned in a direct dispatch message
2. OpenClaw plugin config mapping saved by `/preqstation setup`
3. shared `~/.preqstation/projects.json`
4. legacy `~/.preqstation-dispatch/projects.json` fallback when the new shared file is absent
5. optional legacy markdown mapping from `PREQSTATION_MEMORY_PATH` or configured `memoryPath`

Public payloads and Telegram dispatch messages should not include absolute local paths.

## Instruction Contract

The dispatched CLI reads `./.preqstation-instructions.txt` in the worktree and should:

1. run `preqstation task get <task>` first when a task key exists, using the absolute CLI path written into the instructions
2. run `preqstation task start <task> --engine <engine>` before substantive work
3. if the objective is `ask`, update the task note with `preqstation task note <task> --body-file note.md`, then clear `run_state` with `preqstation task status <task> --status <current-status> --clear-run-state` while keeping workflow status unchanged
4. work only inside the resolved worktree
5. if launched from OpenClaw and `openclaw` is available, notify OpenClaw on completion with `openclaw system event --text "Done: <brief summary>" --mode now`

Workers should not call native PREQ MCP tools even if they are visible. The dispatcher-generated instructions are the task-specific source of truth.

## Runtime Artifacts

Detached process artifacts live inside the worktree:

- `.preqstation-dispatch/<engine>.pid`
- `.preqstation-dispatch/<engine>.log`

This is the supported monitoring surface for now. The dispatcher no longer documents PTY session polling as the dispatch model.
