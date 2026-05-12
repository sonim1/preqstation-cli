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
  <a href="https://github.com/sonim1/preqstation-dispatcher">PREQ CLI</a> ·
  <a href="https://github.com/sonim1/preqstation-skill">Worker Skill</a>
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
- `src/core/` owns project mapping, git worktree preparation, prompt rendering, and detached engine launch
- `src/adapters/openclaw/` owns the OpenClaw `before_dispatch` hook and `/preqsetup`
- `src/adapters/hermes/` owns optional Hermes payload normalization for deferred webhook experiments

OpenClaw still loads this package through `openclaw.plugin.json` and root `index.mjs`. [`preqstation-skill`](https://github.com/sonim1/preqstation-skill) remains the worker lifecycle package used by Claude Code, Codex CLI, and Gemini CLI after dispatch.

## What It Does

The dispatcher receives PREQ intent, resolves a local project checkout on the dispatcher host, creates or reuses an isolated git worktree, writes `.preqstation-prompt.txt`, and launches the selected engine as a detached process.

Supported engines:

- `claude-code`
- `codex`
- `gemini-cli`

Hermes is not an engine. Hermes can be a Telegram host that wakes this dispatcher.

## Quick Start

```bash
npx -y @sonim1/preqstation@latest install
npx -y @sonim1/preqstation@latest status
```

`preqstation install` is the default setup path. It opens an interactive wizard for request entrypoints, agent runtimes, remote MCP registration, and MCP-backed project setup.

## Documentation

- [Installation and CLI Usage](docs/INSTALLATION.md) — install/update/uninstall, project setup, direct dispatch, and command reference
- [Configuration](docs/CONFIGURATION.md) — dispatcher host env vars and local project mapping file shape
- [OpenClaw Adapter](docs/OPENCLAW_ADAPTER.md) — `before_dispatch` flow and `/preqsetup` path
- [Hermes Telegram Host](docs/hermes.md) — Telegram-hosted dispatcher flow
- [Command Shape](docs/COMMANDS.md) — supported trigger styles and parsed fields
- [Detached Runtime](docs/RUNTIME.md) — process artifacts, launch model, and limitations
- [Publishing](docs/PUBLISHING.md) — npm release workflow
