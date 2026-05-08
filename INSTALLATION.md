# PREQSTATION Installation

Most users only need the default installer:

```bash
npx -y @sonim1/preqstation@latest install
```

After install, check the current machine:

```bash
npx -y @sonim1/preqstation@latest status
```

The installer is idempotent. Existing runtime support is reported as current, older installs are updated in place, matching MCP endpoints are reported as configured, and project setup shows which PREQ projects were mapped or unmatched.

## What Install Configures

`preqstation install` can configure:

- request entrypoints: OpenClaw and Hermes Agent
- worker runtime support: Claude Code, Codex, and Gemini CLI
- runtime MCP registrations for PREQSTATION
- local project mappings through MCP-backed `setup auto`

Hermes must have terminal/tool execution enabled. A chat-only Hermes profile cannot create worktrees or launch local worker CLIs.

## Global Install

If you prefer a persistent local command:

```bash
npm install -g @sonim1/preqstation
preqstation install
preqstation status
```

## Update

Refresh installed entrypoints and runtime support:

```bash
preqstation update
```

`preqstation update` refreshes only what is already installed. It does not install missing targets, but it does rerun MCP-backed `setup auto` so local project mappings stay in sync with PREQSTATION.

## Status And Doctor

`preqstation status` and `preqstation doctor` do not install, update, remove, or open OAuth. In an interactive terminal they show progress while checking the current host, then print grouped status for:

- PREQSTATION server URL and MCP endpoint
- OpenClaw and Hermes Agent entrypoints
- Claude Code, Codex, and Gemini CLI worker support
- CLI executable paths, including session-scoped `fnm` path warnings
- runtime MCP registrations
- shared project mappings and missing local paths

Use JSON output for scripts:

```bash
preqstation status --json
preqstation doctor --json
```

## Uninstall

Remove selected installed surfaces:

```bash
preqstation uninstall
```

`preqstation uninstall` opens the matching removal wizard. It removes selected request entrypoints, runtime MCP registrations, and runtime worker support, but keeps `~/.preqstation-dispatch/projects.json` and OAuth cache data.

Use targeted uninstall commands when needed:

```bash
preqstation uninstall openclaw
preqstation uninstall hermes
```

Use `preqstation uninstall hermes --force` only when you want to back up and remove a locally modified Hermes skill.

## OpenClaw

Prefer the default installer:

```bash
preqstation install
```

To install only the OpenClaw entrypoint:

```bash
preqstation install openclaw
openclaw gateway restart
```

That command runs:

```bash
openclaw plugins install @sonim1/preqstation --dangerously-force-unsafe-install
```

This plugin intentionally uses `child_process` to create git worktrees and launch detached coding CLIs, so current OpenClaw builds require `--dangerously-force-unsafe-install` even for the npm package.

Useful checks:

```bash
openclaw plugins inspect preqstation-dispatcher
openclaw status --all
```

### OpenClaw-Native Project Setup

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

## Hermes Agent

To install only the Hermes entrypoint:

```bash
preqstation install hermes
```

`preqstation install hermes` copies the bundled `preqstation_dispatch` Hermes skill into `~/.hermes/skills/preqstation/preqstation_dispatch/SKILL.md` and writes provenance metadata next to it. Existing legacy `preq_dispatch` installs are migrated automatically when they were previously managed by this package.

After upgrading the npm package, sync the installed Hermes skill when needed:

```bash
npm update -g @sonim1/preqstation
preqstation sync hermes
preqstation status hermes
```

If the local Hermes skill was edited, `sync hermes` refuses to overwrite it. Use `preqstation sync hermes --force` to back up the current `SKILL.md` and replace it with the bundled version.

## Project Setup

The default installer runs project setup for you. You can rerun it directly:

```bash
preqstation setup auto
```

`setup auto` without repo hints fetches PREQ projects from the configured remote `/mcp` endpoint with OAuth, then scans local git repos under `PREQSTATION_REPO_ROOTS` when set, otherwise under `~/projects`. It matches local git `origin` URLs against PREQ project repo URLs and stores successful matches in `~/.preqstation-dispatch/projects.json`.

Explicit repo hints are still supported:

```bash
preqstation setup auto PROJ=https://github.com/example/project
preqstation setup set PROJ /absolute/path/to/project
preqstation setup status
```

`setup auto PROJ=https://github.com/example/project` skips fetching the project list from PREQSTATION.

## Direct Dispatch

Direct dispatch bypasses OpenClaw and Hermes and launches the selected worker from the CLI.

```bash
preqstation run \
  --project-key PROJ \
  --task-key PROJ-327 \
  --objective implement \
  --engine codex \
  --branch-name task/proj-327-example
```

Message and JSON payload entrypoints are also available:

```bash
preqstation run-message --message 'preqstation implement PROJ-327 using codex'
preqstation run-json --payload /path/to/preq-webhook-payload.json
```

## Local Development

Install a local checkout into OpenClaw while working on this repository:

```bash
openclaw plugins install --link --dangerously-force-unsafe-install /path/to/preqstation-dispatcher
openclaw gateway restart
```
