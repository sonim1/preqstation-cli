# preqstation-dispatcher

PREQSTATION dispatcher with an OpenClaw adapter and a standalone CLI for Telegram hosts such as Hermes.

Current surface version is recorded in [VERSION](VERSION).

The npm package is `@sonim1/preqstation`. The OpenClaw plugin id is `preqstation-dispatcher`.

This repository is the durable public dispatcher surface for PREQSTATION. OpenClaw is the runtime host, while `preqstation-skill` remains the worker/runtime package used after dispatch.

- `src/core/` owns project mapping, git worktree preparation, prompt rendering, and detached engine launch
- `src/adapters/openclaw/` owns the OpenClaw `before_dispatch` hook and `/preqsetup`
- `src/adapters/hermes/` owns optional Hermes payload normalization for deferred webhook experiments
- `bin/preqstation.mjs` exposes a platform-neutral CLI

OpenClaw still loads this package through `openclaw.plugin.json` and root `index.mjs`.

`preqstation-skill` remains the worker lifecycle skill used by Claude Code, Codex CLI, and Gemini CLI after the dispatcher launches them.

## What It Does

The dispatcher receives PREQ intent, resolves a local project checkout on the dispatcher host, creates or reuses an isolated git worktree, writes `.preqstation-prompt.txt`, and launches the selected engine as a detached process.

Supported engines:

- `claude-code`
- `codex`
- `gemini-cli`

Hermes is not an engine. Hermes can be a Telegram host that wakes this dispatcher.

## OpenClaw Adapter

The OpenClaw plugin intercepts PREQ dispatch messages with the OpenClaw `before_dispatch` hook and handles them before the normal chat run.

Current flow:

1. parse a PREQ dispatch message such as `!/skill preqstation-dispatch plan PROJ-327 using codex`
2. resolve `project_cwd` from an explicit absolute path, OpenClaw plugin config, the shared `~/.preqstation-dispatch/projects.json` store, or legacy `MEMORY.md`
3. create or reuse an auxiliary git worktree
4. write `.preqstation-prompt.txt` into that worktree
5. create a managed Task Flow record and park it in waiting with detached process metadata
6. launch the selected CLI as a detached process

This is intentionally not the old PTY/background session model. The plugin does not rely on OpenClaw `background:true` exec or `process action:poll` / `process action:log` for the dispatched coding run.

### Install OpenClaw Adapter

Default install from npm:

```bash
openclaw plugins install @sonim1/preqstation --dangerously-force-unsafe-install
openclaw gateway restart
```

If the standalone CLI is already installed, it can run the plugin install command for you:

```bash
preqstation install openclaw
openclaw gateway restart
```

This plugin intentionally uses `child_process` to create git worktrees and launch detached coding CLIs, so current OpenClaw builds require `--dangerously-force-unsafe-install` even for the npm package.

Local linked install for active development:

```bash
openclaw plugins install --link --dangerously-force-unsafe-install /path/to/preqstation-dispatcher
openclaw gateway restart
```

Useful checks:

```bash
openclaw plugins inspect preqstation-dispatcher
openclaw status --all
```

### OpenClaw Setup

After install, prefer the OpenClaw-native bulk setup command:

```text
/preqsetup auto PROJ=https://github.com/example/project
```

Useful setup commands:

```text
/preqsetup
/preqsetup auto
/preqsetup import
/preqsetup set <PROJECT_KEY> <ABSOLUTE_PATH>
/preqsetup status
/preqsetup unset PROJ
```

`/preqsetup auto` scans local git repos under `PREQSTATION_REPO_ROOTS` when set, otherwise under `~/projects`, matches local git `origin` URLs against provided repo URLs, and stores successful matches in OpenClaw plugin config.

If another runtime already populated `~/.preqstation-dispatch/projects.json`, OpenClaw can reuse it with `/preqsetup import`.

## Standalone CLI

Install this package wherever the dispatcher host runs, then map each PREQ project to a local checkout.
For Hermes, these setup commands are run once on the Hermes host by the operator.
During real dispatch, Hermes Agent receives the Telegram message and calls this CLI through its terminal/tool execution.

```bash
npm install -g @sonim1/preqstation
preqstation install
preqstation install hermes
preqstation setup set PROJ /absolute/path/to/project
preqstation setup auto PROJ=https://github.com/example/project
preqstation setup status
```

`install` without a target opens an interactive wizard that can install the OpenClaw adapter, the Hermes skill, and optional PREQ worker support for Claude Code, Codex, and Gemini CLI. Automation should call `install hermes` or `install openclaw` directly.

Hermes must have terminal/tool execution enabled. A chat-only Hermes profile cannot create worktrees or launch local worker CLIs.

`install hermes` copies the bundled `preqstation_dispatch` Hermes skill into `~/.hermes/skills/preqstation/preqstation_dispatch/SKILL.md` and writes provenance metadata next to it. Existing legacy `preq_dispatch` installs are migrated automatically when they were previously managed by this package.

`install openclaw` runs:

```bash
openclaw plugins install @sonim1/preqstation --dangerously-force-unsafe-install
```

Then restart OpenClaw with `openclaw gateway restart`.

After upgrading the npm package, sync the installed Hermes skill:

```bash
npm update -g @sonim1/preqstation
preqstation sync hermes
preqstation status hermes
```

If the local Hermes skill was edited, `sync hermes` refuses to overwrite it. Use `preqstation sync hermes --force` to back up the current `SKILL.md` and replace it with the bundled version.

If you choose worker runtimes during the interactive `install` wizard, the wizard prompts for the current PREQSTATION server URL and then:

- installs or updates the PREQ Claude plugin for Claude Code
- installs or updates the global `preqstation` worker skill for Codex and Gemini CLI
- registers `preqstation` over the remote `/mcp` endpoint for each selected runtime

The wizard is idempotent. Existing runtime support is reported as `already current`, older installs are updated in place, and matching MCP endpoints are reported as `already configured`.

`setup auto` scans local git repos under `PREQSTATION_REPO_ROOTS` when set, otherwise under `~/projects`, matches local git `origin` URLs against the provided repo URLs, and stores successful matches in `~/.preqstation-dispatch/projects.json`.

Run a dispatch directly:

```bash
preqstation run \
  --project-key PROJ \
  --task-key PROJ-327 \
  --objective implement \
  --engine codex \
  --branch-name task/proj-327-example
```

Run from an optional webhook payload file for adapter smoke tests:

```bash
preqstation run-json --payload /path/to/preq-webhook-payload.json
```

Run from a legacy dispatch message:

```bash
preqstation run-message --message 'preqstation implement PROJ-327 using codex'
```

### Public Config Contract

The dispatcher host owns local paths. PREQ server payloads should only describe intent.

Environment variables:

- `PREQSTATION_DISPATCH_HOME`: default `~/.preqstation-dispatch`
- `PREQSTATION_PROJECTS_FILE`: default `~/.preqstation-dispatch/projects.json`
- `PREQSTATION_WORKTREE_ROOT`: default `~/.preqstation-dispatch/worktrees`
- `PREQSTATION_WORKER_HOME`: optional shared worker home used for detached Claude/Codex/Gemini launches
- `PREQSTATION_CLAUDE_HOME`: optional Claude-specific worker home override
- `PREQSTATION_CODEX_HOME`: optional Codex-specific worker home override
- `PREQSTATION_GEMINI_HOME`: optional Gemini-specific worker home override
- `PREQSTATION_MEMORY_PATH`: optional legacy markdown mapping fallback
- `PREQSTATION_REPO_ROOTS`: optional path-delimited roots for `setup auto`

Detached worker launches never inherit a Hermes profile home by accident. When no worker-home override is set, the dispatcher falls back to the owning user's real home so worker MCP auth can stay separate from Telegram-host profile state.

Shared mapping file shape:

```json
{
  "projects": {
    "PROJ": "/absolute/path/to/project"
  }
}
```

Do not commit this file. It belongs to the local dispatcher host.

## Hermes Telegram Host

Hermes can trigger the dispatcher by watching the same Telegram channel or group used for PREQ dispatch. See [docs/hermes.md](docs/hermes.md) for the recommended `preq-coder` profile and Telegram setup.

The Hermes Telegram flow is:

1. PREQSTATION sends a structured `/preqstation_dispatch@PreqHermesBot` message to Telegram
2. Hermes receives that message in its Telegram profile
3. Hermes invokes `preqstation`
4. the dispatcher creates the worktree and launches `claude-code`, `codex`, or `gemini-cli`
5. the launched worker updates PREQ through the normal `preqstation` lifecycle skill

Telegram messages must not include local project paths. Webhook support is deferred and should stay an advanced option until there is a deliberate public ingress plan.

## Command Shape

Supported trigger styles:

- `/skill preqstation-dispatch plan PROJ-327 using codex`
- `/skill preqstation-dispatch ask PROJ-328 using codex ask_hint="Acceptance criteria"`
- `!/skill preqstation-dispatch implement PROJ-327 using claude branch_name="task/proj-327-example"`
- `preqstation implement PROJ-327 with codex`
- `preqstation implement PROJ-327 in /absolute/path/to/repo with codex`

Parsed fields:

- engine
- task key
- project key
- objective
- optional `branch_name`
- optional `ask_hint`
- optional `insight_prompt_b64`

## Detached Runtime

Detached process artifacts live inside the worktree:

- `.preqstation-dispatch/<engine>.pid`
- `.preqstation-dispatch/<engine>.log`

Current detached Codex launch uses:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox "Read and execute instructions from ./.preqstation-prompt.txt in the current workspace. Treat that file as the source of truth. If that file is missing, stop."
```

Claude Code and Gemini CLI use the same bootstrap idea with their own binaries.

## Publishing

Pushes to `main` run `.github/workflows/publish.yml`, test the package, and publish to npm automatically.

Release behavior:

- if the current `package.json` version is not on npm yet, the workflow publishes it as-is
- if that version already exists on npm, the workflow automatically bumps a patch version, syncs [VERSION](VERSION), commits the bump back to `main`, and publishes the new version
- the follow-up run triggered by that bump commit is skipped because the actor is `github-actions[bot]`

One-time setup before the first release:

- add an `NPM_TOKEN` repository secret, or
- configure npm trusted publishing for this publishing repository and package

The workflow is ready for both: it grants `id-token: write` for trusted publishing and also passes `NODE_AUTH_TOKEN` when `NPM_TOKEN` is configured.

## Current Limitations

- Completion emergence back into the original chat thread is not wired yet.
- OpenClaw Task Flow tracking is OpenClaw-adapter only. Hermes runs use CLI output and detached log files.
- Detached process logs are written to the worktree and are not streamed live into Telegram.
