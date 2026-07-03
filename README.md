<p align="center">
  <a href="https://preqstation.com">
    <img src="https://raw.githubusercontent.com/sonim1/preqstation-landingpage/main/apps/landing/public/brand/logo.webp" alt="PreqStation" width="96" />
  </a>
</p>

<h1 align="center">PreqStation PREQ CLI / Dispatcher</h1>

<p align="center">
  <strong>Operator-host setup, project mapping, health checks, and direct or integration-based agent dispatch.</strong>
</p>

<p align="center">
  <a href="https://preqstation.com">Website</a> ·
  <a href="https://preqstation.com/guide">Guide</a> ·
  <a href="https://github.com/sonim1/preqstation">Core App</a> ·
  <a href="https://github.com/sonim1/preqstation-cli">PREQ CLI</a> ·
  <a href="https://github.com/sonim1/preqstation-skill">Legacy Worker Skill</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sonim1/preqstation"><img alt="npm @sonim1/preqstation" src="https://img.shields.io/npm/v/@sonim1/preqstation?label=%40sonim1%2Fpreqstation" /></a>
  <a href="https://nodejs.org"><img alt="Node 22" src="https://img.shields.io/badge/Node-22-green.svg" /></a>
</p>

---

Current surface version is recorded in [VERSION](VERSION).

The npm package is [`@sonim1/preqstation`](https://www.npmjs.com/package/@sonim1/preqstation), and the installed command is `preqstation`. The OpenClaw plugin id is `preqstation-dispatcher`.

## What this repo owns

This repository is the durable public PREQ CLI and dispatcher surface for PreqStation. It prepares an operator host, configures request entrypoints, maps local projects, runs health checks, and can launch Claude Code, Codex, or Gemini directly or through integrations such as OpenClaw and Hermes.

- `bin/preqstation.mjs` exposes the platform-neutral CLI
- `src/core/` owns project mapping, git worktree preparation, instruction rendering, and detached engine launch
- `src/adapters/openclaw/` owns the OpenClaw `before_dispatch` hook and `/preqstation`
- `src/adapters/hermes/` owns optional Hermes payload normalization for deferred webhook experiments

OpenClaw still loads this package through `openclaw.plugin.json` and root `index.mjs`. Worker lifecycle actions now run through the `preqstation` CLI rendered into `.preqstation-instructions.txt`; [`preqstation-skill`](https://github.com/sonim1/preqstation-skill) is legacy optional worker support that `status`, `doctor`, `update`, and `uninstall` can inspect or clean up.

## Work Graph Boundary

`preqstation` is the dispatcher command owned by this package. It prepares the local checkout,
renders instructions, and launches the selected engine.

Dispatched agents record v2 execution in the core app's Work Graph through the core package's
`preqstation-agent` lifecycle CLI or through MCP tools. `preqstation-agent` owns commands such as
`agent guide`, `graph node create`, `graph node complete`, `graph evidence attach`, and
`graph memory append`; it also accepts `--metadata-file` so a harness can store
`metadata.workflow_profile` with `resolved`, `resolved_command`, and `resolved_reason`.

The Work Graph is the primary task execution view in the core app. The Kanban board remains the
workflow-position view. See the core
[Work Graph API documentation](https://github.com/sonim1/preqstation/blob/main/docs/API.md#work-graph-api-v2)
for the route, MCP, and `preqstation-agent` contract.

## What It Does

The dispatcher receives PREQ intent, resolves a local project checkout on the dispatcher host, creates or reuses an isolated git worktree, writes `.preqstation-instructions.txt`, and launches the selected engine as a detached process, including detached Codex runs. This is intentionally not the old PTY/background session model: it does not rely on OpenClaw `background:true` exec or `process action:poll` / `process action:log` for the dispatched coding run.

Supported engines:

- `claude-code`
- `codex`
- `gemini-cli`

Hermes is not an engine. Hermes can be a Telegram host that wakes this dispatcher.

## Usage

### Quick Start

```bash
npx -y @sonim1/preqstation@latest install
npx -y @sonim1/preqstation@latest status
```

`preqstation install` is the default setup path. It opens an interactive wizard for request entrypoints, agent runtimes, CLI server URL config, and project setup. Native PREQ runtime MCP registration is now a legacy opt-in via `preqstation install --with-mcp`. See [INSTALLATION.md](INSTALLATION.md) for detailed install, update, uninstall, project setup, and local development flows.

### Command Reference

| Command | Description |
| --- | --- |
| `preqstation install` | Interactive setup for entrypoints, agent runtimes, CLI config, and project mappings. |
| `preqstation install --with-mcp` | Legacy opt-in for native PREQ runtime MCP registration. |
| `preqstation status` | Read-only installed-state summary for entrypoints, runtimes, CLI auth, legacy MCP, and project mappings. |
| `preqstation doctor` | Read-only health check for dispatcher configuration and runtime availability. |
| `preqstation auth login` | Store the PREQSTATION server URL and create the shared OAuth cache. |
| `preqstation auth status` | Read-only CLI auth readiness check, including the inspected home and OAuth path. |
| `preqstation task get PROJ-123` | Read task lifecycle data through the CLI JSON contract. |
| `preqstation comment reply --comment-id ID --body-file reply.md` | Reply to task comments without native MCP tool calls. |
| `preqstation project settings --project PROJ` | Read deployment/project settings through the CLI JSON contract. |
| `preqstation setup auto` | Discover local projects and save shared PREQ project mappings. |
| `preqstation mcp disable codex` | Remove only a legacy PREQ MCP registration for a runtime. |
| `preqstation run` | Dispatch a PREQ task or project objective directly from the CLI. |
| `preqstation uninstall` | Remove installed entrypoints, legacy worker support, legacy MCP, or project mappings. |

## Documentation

- [Installation and CLI Usage](docs/INSTALLATION.md) — install/update/uninstall, project setup, direct dispatch, and extended command reference
- [Configuration](docs/CONFIGURATION.md) — dispatcher host env vars and local project mapping file shape
- [OpenClaw Adapter](docs/OPENCLAW_ADAPTER.md) — `before_dispatch` flow and `/preqstation` path
- [Hermes Telegram Host](docs/hermes.md) — Telegram-hosted dispatcher flow
- [Command Shape](docs/COMMANDS.md) — supported trigger styles and parsed fields
- [Detached Runtime](docs/RUNTIME.md) — process artifacts, launch model, and limitations
- [Publishing](docs/PUBLISHING.md) — npm release workflow
