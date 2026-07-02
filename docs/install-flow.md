# `preqstation install` Flow

This document describes the current interactive `preqstation install` flow as implemented in this repository.

Scope:
- interactive `preqstation install`
- direct host install commands such as `install openclaw` and `install hermes`
- runtime CLI path verification for `claude-code`, `codex`, and `gemini-cli`
- optional legacy PREQ MCP registration with `--with-mcp`
- optional legacy worker skill inspection and cleanup in `status`, `doctor`, `update`, and `uninstall`

Primary code paths:
- [src/install-wizard.mjs](../src/install-wizard.mjs)
- [src/cli/preqstation-dispatcher.mjs](../src/cli/preqstation-dispatcher.mjs)
- [src/openclaw-installer.mjs](../src/openclaw-installer.mjs)
- [src/runtime-skill-installer.mjs](../src/runtime-skill-installer.mjs)
- [src/runtime-mcp-installer.mjs](../src/runtime-mcp-installer.mjs)
- [src/hermes-skill-installer.mjs](../src/hermes-skill-installer.mjs)

## 1. Entry points

### Interactive

```bash
preqstation install
```

This enters the install wizard and asks the user to select:
- request entrypoints
- agent runtimes
- PREQSTATION server URL

### Direct host install

```bash
preqstation install openclaw
preqstation install hermes
```

These bypass the wizard and install only the selected host.

## 2. Wizard selection phase

The wizard prompts for:

### Request entrypoints
- `OpenClaw`
- `Hermes Agent`

### Agent runtimes
- `Claude Code`
- `Codex`
- `Gemini CLI`

Runtime setup verifies executable paths only. It does not install worker skills.

## 3. PREQSTATION server URL resolution

If at least one runtime is selected, the wizard asks for:

```text
PREQSTATION server URL
```

The default value is resolved in this order:

1. `PREQSTATION_SERVER_URL`
2. `PREQSTATION_API_URL`
3. `~/.preqstation/oauth.json`
4. CLI config in `~/.preqstation/config.json`
5. legacy existing runtime MCP registrations
6. fallback placeholder

Normalization rules:
- trim whitespace
- remove trailing slash
- require `https://`, except `http://localhost` for local development

When `--with-mcp` is used, the derived legacy MCP endpoint is:

```text
<server-url>/mcp
```

## 4. Install plan rendering

Before mutating anything, the wizard renders the plan:

1. selected request entrypoints
2. selected agent runtimes
3. PREQSTATION server URL
4. optional `Legacy PREQ MCP endpoint` when `--with-mcp` is used

## 5. Request entrypoint install

### OpenClaw

The installer delegates to `openclaw plugins` and post-checks the installed plugin version. OpenClaw can report a successful install/update while leaving the old plugin in place, so the post-check is required.

### Hermes Agent

The installer syncs the bundled `preqstation_dispatch` Hermes skill entrypoint.

## 6. Runtime CLI path verification

Each selected runtime is checked in sequence:

- `Claude Code` -> `claude`
- `Codex` -> `codex`
- `Gemini CLI` -> `gemini`

The check records:
- resolved executable path
- whether the path is stable enough for detached OpenClaw/Hermes launches
- host-specific warnings for session-scoped paths such as `fnm` shims

The install wizard no longer installs or updates `preqstation-skill` for worker runtimes. Detached workers read `.preqstation-instructions.txt` and use the absolute `preqstation` CLI path rendered into those instructions.

## 7. Legacy runtime MCP registration

Runtime MCP registration is skipped unless `preqstation install --with-mcp` is used.

### Claude Code

```bash
claude mcp add -s user --transport http preqstation <mcp-url>
```

### Codex

```bash
codex mcp add preqstation --url <mcp-url>
```

### Gemini CLI

```bash
gemini mcp add --scope user --transport http preqstation <mcp-url>
```

Before registering, the dispatcher inspects the existing runtime MCP configuration. If the runtime already points at the requested PREQ MCP URL, it reports the runtime legacy MCP as current/configured instead of re-registering it.

## 8. Optional legacy worker skill inspection

`preqstation status`, `preqstation doctor`, and `preqstation update` may inspect installed legacy worker skills so users can see and clean up older test installations. These rows are marked optional/legacy and do not make an otherwise healthy install fail.

`preqstation uninstall <runtime>` removes both:
- legacy runtime MCP registration
- legacy worker support for that runtime

## 9. Final summary generation

The final summary is partitioned into separate Clack boxes:

### Request entrypoints
- OpenClaw
- Hermes Agent

### Agent runtimes
- Claude Code
- Codex
- Gemini CLI

### Legacy MCP
- endpoint
- per-runtime legacy MCP status
- connection/auth details when available

The CLI summary includes:
- version transitions such as `0.1.21 -> 0.1.25`
- restart hints such as `openclaw gateway restart` or `hermes gateway restart`
- unpublished local repo hints when local source is ahead of npm
- failure details such as post-check errors

## 10. Overall success/failure rule

The interactive install result is considered successful only when:

```js
results.every((entry) => entry?.ok !== false)
```

That means any request entrypoint, runtime CLI, or requested legacy MCP result with `ok: false` causes:
- final `ok: false`
- non-zero CLI exit code

Optional legacy worker skill inspection rows do not make `status`, `doctor`, or `update` fail unless the inspection itself fails unexpectedly.

## 11. Short sequence summary

Interactive install currently behaves like this:

1. ask which hosts to install
2. ask which runtimes to set up
3. resolve a default PREQSTATION server URL
4. derive the legacy PREQ MCP endpoint when `--with-mcp` is used
5. install/sync selected hosts
6. verify selected runtime CLI paths
7. register runtime MCP endpoints only when `--with-mcp` is used
8. run `setup auto`, opening browser OAuth when needed, to map PREQ projects to local git checkouts
9. print summary
10. exit non-zero if any required post-check failed

`preqstation update` follows the same summary shape without prompting:

1. refresh installed OpenClaw/Hermes entrypoints
2. inspect optional legacy worker skills
3. inspect runtime CLI and legacy MCP health
4. run `setup auto`
5. print the grouped update summary, including `Project Setup`

Interactive uninstall is the matching cleanup flow:

1. ask which hosts to uninstall
2. ask which runtimes to remove
3. remove selected OpenClaw/Hermes entrypoints
4. remove selected legacy runtime MCP registrations
5. remove selected legacy worker support
6. keep project mappings and OAuth cache data
7. print summary

## 12. Filesystem locations touched

### Shared dispatcher state

```text
~/.preqstation/
~/.preqstation/oauth.json
~/.preqstation/logs/error.log
```

### Hermes

```text
~/.hermes/skills/preqstation/preqstation_dispatch/
```

### OpenClaw

```text
~/.openclaw/extensions/preqstation-dispatcher/
```

### Legacy worker support cleanup targets

```text
~/.agents/skills/preqstation/
~/.codex/skills/preqstation/
~/.gemini/skills/preqstation/
```
