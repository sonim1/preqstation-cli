# `preqstation install` Flow

This document describes the current interactive `preqstation install` flow as implemented in the local repository.

Scope:
- interactive `preqstation install`
- direct host install commands such as `install openclaw` and `install hermes`
- runtime worker support setup for `claude-code`, `codex`, and `gemini-cli`
- remote PREQ MCP registration

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

At least one item must be selected in each prompt to continue.

## 3. PREQSTATION server URL resolution

If at least one runtime is selected, the wizard asks for:

```text
PREQSTATION server URL
```

The default value is resolved in this order:

1. `PREQSTATION_SERVER_URL`
2. `PREQSTATION_API_URL`
3. `~/.preqstation-dispatch/oauth.json`
4. existing runtime MCP registrations
5. fallback placeholder

Normalization rules:
- trim whitespace
- remove trailing slash
- require `https://`, except `http://localhost` for local development

The derived MCP endpoint is:

```text
<server-url>/mcp
```

## 4. Progress output structure

During interactive install the wizard prints sections in this order:

1. `PREQ MCP endpoint`
2. `Request entrypoints`
3. `Agent runtimes`
4. final `Install summary`

## 5. Request entrypoint installation

Each selected host is processed in sequence.

### Hermes Agent

Operation:
- sync the bundled `preqstation_dispatch` Hermes skill

Installed location:

```text
~/.hermes/skills/preqstation/preqstation_dispatch/
```

Rules:
- if installed content already matches the bundled version, return `already_current`
- if the local skill was modified, sync requires force in the explicit `sync hermes --force` path

### OpenClaw

Operation:
1. read the local package version from `package.json`
2. query npm for the published version of `@sonim1/preqstation`
3. inspect the installed OpenClaw plugin
4. install or force-reinstall from the current npm package if needed
5. re-inspect to verify the recorded plugin version actually changed

Commands used:

```bash
npm view @sonim1/preqstation version --json
openclaw plugins inspect preqstation-dispatcher
openclaw plugins install @sonim1/preqstation --dangerously-force-unsafe-install
openclaw plugins install @sonim1/preqstation --dangerously-force-unsafe-install --force
```

Status rules:
- if installed version matches npm latest, return `already_current`
- if install/reinstall succeeds and the recorded version matches the target, return `installed` or `reinstalled`
- if install/reinstall exits successfully but recorded version does not change to the target, return `failed`

This post-check is important because OpenClaw can report a successful update command while leaving the installed plugin at the previous version.

## 6. Runtime worker support setup

Each selected runtime is processed in sequence before MCP setup for that runtime.

### Claude Code

Implementation model:
- Claude plugin path

Version source:
- latest `preqstation-skill` version is fetched from the repository `package.json` on GitHub

Commands used:

```bash
claude plugin list
claude plugin marketplace list
claude plugin marketplace add https://github.com/sonim1/preqstation-skill
claude plugin install preqstation@preqstation
claude plugin marketplace update preqstation
claude plugin update preqstation@preqstation
```

Status rules:
- missing plugin during update-only mode: `not_installed`
- installed and latest: `already_current`
- installed but outdated: `updated`
- missing and install requested: `installed`

### Codex

Implementation model:
- worker skill path

Shared/global source skill:

```text
~/.agents/skills/preqstation
```

Agent-specific target path:

```text
~/.codex/skills/preqstation
```

Primary commands used:

```bash
npx skills ls -g --json
npx skills add sonim1/preqstation-skill -g -a codex -y
npx skills update preqstation -g -y
```

Status detection uses both:
- `npx skills ls -g --json`
- actual filesystem presence of `~/.codex/skills/preqstation/package.json`

Fallback behavior:
1. run `npx skills add` or `npx skills update`
2. inspect whether Codex is actually enabled
3. if not, copy the shared `preqstation` skill into `~/.codex/skills/preqstation`
4. inspect again

Status rules:
- installed and latest: `already_current`
- installed but outdated: `updated`
- missing and successfully added: `installed`
- shared skill exists but not enabled during update-only mode: `not_enabled`
- still not usable after `skills add` and fallback sync: `failed`

### Gemini CLI

Implementation model:
- worker skill path

Shared/global source skill:

```text
~/.agents/skills/preqstation
```

Agent-specific target path:

```text
~/.gemini/skills/preqstation
```

Primary commands used:

```bash
npx skills ls -g --json
npx skills add sonim1/preqstation-skill -g -a gemini-cli -y
npx skills update preqstation -g -y
```

Fallback behavior matches Codex:
1. try the `skills` CLI path
2. if the runtime still is not usable, copy the shared skill into the Gemini agent skill directory
3. inspect again

Status rules:
- same as Codex, but targeted at `Gemini CLI`

## 7. Why Codex and Gemini need fallback sync

Observed behavior:
- `npx skills add sonim1/preqstation-skill -g -a codex -y`
- `npx skills add sonim1/preqstation-skill -g -a gemini-cli -y`

can print success while only updating:

```text
~/.agents/skills/preqstation
```

without creating or enabling the runtime-specific skill copy.

The dispatcher therefore does not trust the CLI success message alone. It uses a post-check and, if necessary, synchronizes the runtime-specific skill directory itself.

## 8. Runtime MCP registration

After runtime worker support is processed, the dispatcher registers the PREQ MCP endpoint for that runtime.

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

Before registering, the dispatcher inspects the existing runtime MCP configuration. If the runtime already points at the requested PREQ MCP URL, it reports the runtime MCP as current/configured instead of re-registering it.

## 9. Intermediate runtime output

For each runtime, the wizard prints two rows:

- skill/plugin row
- MCP row

Examples:
- `Claude Code plugin   current`
- `Codex skill          installed`
- `Gemini CLI skill     failed`
- `Codex MCP            current`

## 10. Final summary generation

The final summary is partitioned into separate Clack boxes:

### Request entrypoints
- OpenClaw
- Hermes Agent

### Agent runtimes
- Claude Code
- Codex
- Gemini CLI

### MCP
- endpoint
- per-runtime MCP status
- connection/auth details when available

The CLI summary includes:
- version transitions such as `0.1.21 -> 0.1.25`
- restart hints such as `openclaw gateway restart`
- unpublished local repo hints when local source is ahead of npm
- failure details such as post-check errors

## 11. Overall success/failure rule

The interactive install result is considered successful only when:

```js
results.every((entry) => entry?.ok !== false)
```

That means any host/runtime/MCP result with `ok: false` causes:
- final `ok: false`
- non-zero CLI exit code

## 12. Current failure conditions

Examples of real failure conditions:

### OpenClaw
- update/install command exits successfully
- but `openclaw plugins inspect preqstation-dispatcher` still reports the wrong version

### Codex / Gemini CLI
- `npx skills add` reports success
- runtime still does not appear enabled
- fallback sync cannot produce a usable runtime-specific skill installation

### MCP
- runtime-specific MCP registration command fails
- or existing MCP inspection fails unexpectedly

## 13. Filesystem locations touched

### Shared dispatcher state

```text
~/.preqstation-dispatch/
~/.preqstation-dispatch/oauth.json
```

### Hermes

```text
~/.hermes/skills/preqstation/preqstation_dispatch/
```

### OpenClaw

```text
~/.openclaw/extensions/preqstation-dispatcher/
```

### Shared/global skill source

```text
~/.agents/skills/preqstation/
```

### Codex runtime skill

```text
~/.codex/skills/preqstation/
```

### Gemini runtime skill

```text
~/.gemini/skills/preqstation/
```

## 14. Short sequence summary

Interactive install currently behaves like this:

1. ask which hosts to install
2. ask which runtimes to set up
3. resolve a default PREQSTATION server URL
4. derive the PREQ MCP endpoint
5. install/sync selected hosts
6. install/update selected runtime worker support
7. verify runtime support really stuck
8. register runtime MCP endpoints
9. print summary
10. exit non-zero if any post-check failed

## 15. Reviewer notes

Two implementation details are intentionally strict:

### OpenClaw is post-checked
The dispatcher does not trust a successful `openclaw plugins update` by itself.

### Codex/Gemini are post-checked and may be force-synced
The dispatcher does not trust a successful `npx skills add ... -a codex/gemini-cli` by itself.

Those checks exist specifically to prevent false-positive `installed` and `updated` states.
