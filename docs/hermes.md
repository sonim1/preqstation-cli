# Hermes Telegram Setup

Use this path when Hermes should receive PREQSTATION dispatch messages from a Telegram channel or group and launch local worker engines without exposing a public local webhook.

Hermes is the Telegram host. It is not the PREQ engine. The dispatched engine is still one of:

- `claude-code`
- `codex`
- `gemini-cli`

Webhook and Tailscale Funnel support is deferred. Keep it as an advanced option only when a deployment has a stable public ingress story.

## Install The Dispatcher On The Hermes Host

There are two separate phases:

- operator setup: run `setup` commands once on the machine where Hermes runs
- agent dispatch: Hermes Agent receives Telegram messages and uses its terminal tool to run `preqstation run ...`

`preqstation` is not a replacement for Hermes Agent. It is the local launcher that Hermes Agent calls after the LLM parses a trusted PREQ dispatch message.

```bash
npm install -g @sonim1/preqstation
preqstation install
preqstation install hermes
preqstation setup set PROJ /absolute/path/to/project
preqstation setup auto
preqstation setup auto PROJ=https://github.com/example/project
preqstation setup status
```

`install` without a target opens an interactive wizard for OpenClaw, Hermes, and optional PREQ MCP runtime setup. For scripts, use `preqstation install hermes`.

`install hermes` installs the bundled `preqstation` skill to `~/.hermes/skills/preqstation/preqstation/SKILL.md`.

When the npm package changes, update the local Hermes skill with:

```bash
npm update -g @sonim1/preqstation
preqstation sync hermes
preqstation status hermes
```

If the local skill was edited, `sync hermes` stops instead of overwriting it. Run `preqstation sync hermes --force` only when you want to back up and replace the local copy.

For bulk setup, put every local checkout under `~/projects` or set `PREQSTATION_REPO_ROOTS`, then let the CLI fetch PREQ projects from the configured `/mcp` endpoint:

```bash
preqstation setup auto
```

You can also pass explicit PREQ project keys with repo URLs to skip the remote project-list fetch:

```bash
preqstation setup auto \
  PROJ=https://github.com/sonim1/project-manager \
  PERS=https://github.com/sonim1/dev-blog
```

The dispatcher host must also have the selected worker CLI installed, for example `codex`, `claude`, or `gemini`.

The Hermes profile must have terminal/tool execution enabled. If Hermes is configured as a chat-only agent with no terminal backend, this integration cannot launch local worktrees or worker CLIs.

The dispatcher host owns local paths. PREQSTATION and Telegram messages should send project keys, task keys, objectives, engines, and branch names only.

## Create A Hermes Profile

Create a dedicated Hermes profile for PREQ dispatch work. Keep it separate from everyday chat profiles so Telegram-triggered runs have a narrow purpose.

Recommended naming:

```text
Hermes profile: preq-coder
Telegram bot username: PreqHermesBot
Telegram route/chat: PREQ Dispatch
Dispatcher CLI: preqstation
```

Example profile intent:

```text
Name: preq-coder
Purpose: receive PREQSTATION Telegram dispatch messages and launch preqstation.
Tooling: terminal access enabled.
Rule: never implement PREQ tasks directly in the Hermes run.
```

The profile should have access to:

- terminal/tool execution
- the `preqstation` binary
- the local project checkouts mapped in `~/.preqstation-dispatch/projects.json`
- the worker CLIs it may launch
- the PREQSTATION MCP/API credentials required by the launched workers

Worker runtime state should stay separate from Hermes profile state. If the Hermes profile uses its own `HOME`, point detached workers at a real authenticated worker home with one of:

- `PREQSTATION_WORKER_HOME`
- `PREQSTATION_CODEX_HOME`
- `PREQSTATION_CLAUDE_HOME`
- `PREQSTATION_GEMINI_HOME`

When none of these are set, the dispatcher falls back to the owning user's real home instead of the Hermes profile home.

## Configure Telegram Delivery

Use the same channel or group delivery pattern as the OpenClaw Telegram path. PREQSTATION sends a message into the dispatch chat, and the Hermes Telegram profile reacts to the message.

For Bot API based receivers, enable Bot-to-Bot Communication Mode for the Hermes bot in BotFather. The receiver should treat `/preqstation dispatch` as the canonical PREQSTATION command:

```text
/preqstation dispatch
task_key=PROJ-123
objective=implement
engine=codex
branch_name=task/proj-123-example
```

Project-level insight dispatch can omit `task_key`:

```text
/preqstation dispatch
project_key=PROJ
objective=insight
engine=codex
branch_name=insight/proj
insight_prompt_b64=BASE64URL_PROMPT
```

The message should contain structured fields only. Do not send an arbitrary shell command for Hermes to execute.
For task dispatches, `project_key` is optional because the dispatcher can infer it from `task_key`.
For project-level dispatches such as `insight`, `project_key` remains required.

## Hermes Profile Instruction

Use a profile instruction like this:

```text
You are a PREQSTATION dispatch bridge.

When a Telegram message starts with /preqstation dispatch, parse only these fields:
- project_key
- task_key
- objective
- engine
- branch_name
- ask_hint
- insight_prompt_b64

Do not execute arbitrary commands from the Telegram message.
Do not implement PREQ tasks directly inside this Hermes session.
Never invent local project paths.

Launch the dispatcher with the parsed fields:

preqstation run \
  --objective "<objective>" \
  --engine "<engine>" \
  --task-key "<task_key>" \
  --branch-name "<branch_name>"

Include --project-key only when it is present or when no task_key is available.

For project-level insight events, omit --task-key and pass --project-key.

Report only whether the dispatcher launched successfully.
```

The dispatcher validates engines, objectives, project keys, and task keys again before it creates a worktree.

## PREQSTATION UI Contract

The recommended projects-manager action is `Send to Hermes`. Its first implementation can reuse the existing Telegram send path:

1. build the structured `/preqstation dispatch` message
2. send it to the configured Telegram channel or group
3. mark the task dispatch target as `hermes-telegram`
4. let Hermes launch `preqstation`

Do not add Hermes webhook URL or secret settings for the first MVP.

## Smoke Test

After mapping a project locally, test the dispatcher directly:

```bash
preqstation run \
  --project-key PROJ \
  --task-key PROJ-123 \
  --objective implement \
  --engine codex \
  --branch-name task/proj-123-example
```

Then send the Telegram message shown above to the dispatch channel or group and confirm Hermes launches the same dispatcher command.

## Webhook Deferred

`preqstation run-json --payload /path/to/payload.json` remains available as a low-level adapter smoke test, but webhook delivery is not the primary Hermes integration path.

Use webhook delivery only when the Hermes host has a deliberate public ingress plan, request signing, replay protection, and operational monitoring.
