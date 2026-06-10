# CLI-First Documentation Sync Plan

## Purpose

Bring all PreqStation-facing docs, guide pages, and setup copy in sync with the new CLI-first dispatch runtime.

The current canonical contract is:

- `@sonim1/preqstation` is the user-facing npm package and `preqstation` is the runtime command.
- Hermes/OpenClaw/Telegram hosts launch work through `npx -y @sonim1/preqstation@latest run ...`.
- Detached workers use the PREQSTATION CLI lifecycle commands rendered into `.preqstation-instructions.txt`.
- Detached workers must not use native PREQ MCP lifecycle tools as the primary runtime path.
- Runtime state, config, OAuth cache, logs, mappings, and worktrees default to `~/.preqstation`.
- `~/.preqstation-dispatch` is legacy read/import fallback only.
- `preqstation-skill`, native runtime MCP registrations, and worker skills are legacy/manual/optional compatibility surfaces.
- Hermes skill install/update should tell operators to run `hermes gateway restart` when the skill changes.

## Non-Goals

- Do not remove the `/mcp` HTTP endpoint from the core app.
- Do not delete legacy docs without an explicit archive/deprecation decision.
- Do not edit local snapshot directories under `preqstation-prs` unless they are confirmed to feed an active PR.
- Do not rewrite historical retrospectives unless they present old behavior as current.

## Progress Log

- 2026-06-10: Phase 1 completed for `~/projects/preqstation-cli`.
  - Updated published package docs to describe CLI-first setup, `~/.preqstation` state, optional legacy MCP registration, legacy worker support cleanup, the canonical Hermes skill path, and `hermes gateway restart` after skill changes.
  - Reframed `MEMORY.md` as a legacy/sample fallback rather than the default mapping source.
  - Marked the OpenClaw retrospective as historical and updated current-flow mentions to `.preqstation-instructions.txt`.
  - Updated README/package metadata links from the old `preqstation-dispatcher` repository to `preqstation-cli`.
  - Public package safety issue found during testing: the plan file used maintainer-local absolute paths while `docs/` is included in npm package files. Fixed by switching repo paths to `~/projects/...`.
  - Verification: `rtk npm test` passed with 193 tests.
- 2026-06-10: Phase 2 completed for `~/projects/preqstation-skill`.
  - Preserved the repo's existing local command-surface changes and layered CLI-first wording on top.
  - Reframed the repository as legacy/manual direct-client MCP compatibility, not the default detached dispatch runtime.
  - Replaced `.preqstation-prompt.txt` with `.preqstation-instructions.txt` in the skill contract.
  - Updated helper command docs and installation docs to use `~/.preqstation/projects.json` as canonical, leaving `~/.preqstation-dispatch` only as legacy import fallback.
  - Updated OpenClaw migration guidance to point to `@sonim1/preqstation`.
  - Verification: `rtk npm test` passed with 11 tests.
- 2026-06-10: Phase 3 completed for `~/projects/preqstation`.
  - Updated core README, API, setup, install, and architecture docs around the CLI-first dispatch host contract.
  - Replaced current lifecycle guidance with PREQ CLI task commands and `.preqstation-instructions.txt`; kept `/mcp`, bearer tokens, and `preqstation-skill` as optional direct-client/legacy compatibility.
  - Updated onboarding readiness so recent dispatch work logs mark readiness, while active MCP clients are compatibility signals rather than primary worker readiness.
  - Updated OpenClaw/Hermes setup copy to emit `preqstation setup auto` and replaced GitHub MCP default wording with `gh auth` or authenticated GitHub integration copy.
  - Verification: `rtk npm run typecheck`, `rtk npm run lint`, and `rtk npm run test:unit` passed. Lint still reports two pre-existing unused-symbol warnings outside this work.
- 2026-06-10: Phase 4 completed for `~/projects/preqstation-lp`.
  - Updated public guide README links to point PREQ CLI at the canonical npm package and mark the worker skill as legacy.
  - Reframed Quick Start, PREQ CLI, setup, auth, API keys, security, troubleshooting, and environment docs around CLI-first operator-host setup.
  - Changed guide-visible CLI state and mapping defaults to `~/.preqstation`, while preserving task-worktree `.preqstation-dispatch/<engine>.log` as the detached process log path.
  - Reframed `preqstation-skill`, MCP tools, shell helpers, and bearer tokens as manual/direct-client/legacy compatibility, not detached dispatch runtime.
  - Updated Hermes guide pages to use `~/.preqstation/projects.json` and `hermes gateway restart` after install/update/sync prompts.
  - Mirrored the same changes across English and Korean guide pages.
  - Verification: `rtk node scripts/landing-content.test.mjs`, `rtk npm --prefix apps/guide run build`, `rtk npm --prefix apps/landing run build`, and `rtk pnpm build` passed. `rtk corepack enable pnpm` was needed locally so Turbo could find the pnpm shim.
- 2026-06-10: Phase 5 completed as audit-only.
  - `~/projects/preqstation-dispatcher-host-mcp-clean` is not a git repository and still contains the obsolete `@sonim1/preqstation-dispatcher`, `.preqstation-prompt.txt`, `~/.preqstation-dispatch`, and worker-skill runtime model throughout README, SKILL, Hermes docs, and source files.
  - `~/projects/preqstation-prs` is not a git repository and contains local snapshot copies of older `preqstation-cli`, `preqstation-lp`, and `preqstation-skill` work. These snapshots still contain pre-migration wording and should not be modernized as current source.
  - Recommendation: do not update either directory as part of current docs sync. Treat them as historical snapshots or delete/archive locally once no longer needed.
  - Verification: `rtk rg` confirmed the old references are confined to those obsolete/snapshot directories.

## Phase 1: Publish Package Docs

Target repo: `~/projects/preqstation-cli`

Status: completed on 2026-06-10.

Goal: make the published npm package docs match the runtime that users install today.

Files:

- `INSTALLATION.md`
- `docs/hermes.md`
- `SKILL.md`
- `MEMORY.md`
- `docs/install-flow.md`
- `docs/openclaw-dispatch-retrospective-2026-04-08.md`
- `package.json`

Required updates:

1. Replace default `~/.preqstation-dispatch/projects.json` references with `~/.preqstation/projects.json`.
2. Keep `~/.preqstation-dispatch` only as legacy fallback/import compatibility.
3. Fix Hermes skill path to `~/.hermes/skills/preqstation/preqstation_dispatch/SKILL.md`.
4. Use `npx -y @sonim1/preqstation@latest run ...` in Hermes profile/dispatch examples.
5. Add `hermes gateway restart` after Hermes skill install/update/sync when the CLI reports `restart_required`.
6. Describe runtime MCP registration as `preqstation install --with-mcp` legacy opt-in.
7. Describe runtime worker skills as legacy support that status/update/uninstall can inspect or clean up.
8. Relabel `MEMORY.md` as a legacy/sample fallback, not the default mapping source.
9. Mark retrospective sections as historical or update "current" wording to `.preqstation-instructions.txt`.

Verification:

```bash
rtk npm test
rtk rg "~/.preqstation-dispatch|.preqstation-prompt.txt|runtime MCP registrations|worker runtime support" README.md INSTALLATION.md SKILL.md docs -g '!docs/cli-first-*-plan.md'
```

## Phase 2: Worker Skill Deprecation Or Rewrite

Target repo: `~/projects/preqstation-skill`

Status: completed on 2026-06-10.

Goal: stop installed/manual worker docs from contradicting CLI-first detached dispatch.

Current risk:

- The repo has existing uncommitted local changes.
- `SKILL.md` and `skills/preqstation/SKILL.md` still tell agents to read `.preqstation-prompt.txt`.
- The skill still frames `preq_*` MCP tools as the normal lifecycle path.
- `commands/preqstation.md` treats `~/.preqstation-dispatch/projects.json` as canonical.

Decision needed:

1. Archive/deprecate this repo as legacy/manual MCP-only.
2. Or rewrite it as a safety/reference guide for CLI-first workers.

Recommended path:

- Make the README and docs say this repo is legacy/manual worker support.
- Point normal users to `npx -y @sonim1/preqstation@latest install`.
- Replace `.preqstation-prompt.txt` with `.preqstation-instructions.txt`.
- If keeping MCP docs, label them explicitly as manual direct-client compatibility, not detached dispatch runtime.
- Update mapping path to `~/.preqstation/projects.json`, with legacy fallback note.

Files:

- `README.md`
- `SKILL.md`
- `skills/preqstation/SKILL.md`
- `commands/preqstation.md`
- `docs/INSTALLATION.md`
- `docs/install-claude-plugin.md`
- `docs/install-claude-code.md`
- `docs/install-codex-gemini.md`
- `docs/shell-helper-mode.md`
- `docs/MCP_SURFACES.md`

Verification:

```bash
rtk rg ".preqstation-prompt.txt|~/.preqstation-dispatch|MCP Plugin Mode \\(Recommended\\)|worker \\+ remote MCP|npx skills add" .
```

## Phase 3: Core App Docs And Product Copy

Target repo: `~/projects/preqstation`

Status: completed on 2026-06-10.

Goal: make the product itself explain the same runtime contract that the CLI now uses.

High-priority files:

- `docs/architecture.md`
- `README.md`
- `docs/API.md`
- `docs/setup.md`
- `docs/INSTALLATION.md`
- `app/(workspace)/(onboarding)/onboarding/onboarding-wizard.tsx`
- `app/(workspace)/(onboarding)/onboarding/page.tsx`
- `app/components/openclaw-guide.tsx`
- `app/(workspace)/(main)/connections/page.tsx`
- `app/(workspace)/(main)/api-keys/api-key-create-form.tsx`

Required updates:

1. Reframe architecture around `@sonim1/preqstation` as the runtime contract.
2. Replace `preqstation-dispatcher` as the primary public runtime with "Telegram/Hermes/OpenClaw host adapter" language.
3. Replace `preq_*` lifecycle guidance with `preqstation task ...` lifecycle guidance.
4. Replace `.preqstation-prompt.txt` with `.preqstation-instructions.txt`.
5. Replace `~/.preqstation-dispatch` defaults with `~/.preqstation`.
6. Mark `/mcp`, `preqstation-skill`, and bearer tokens as optional compatibility/direct-client surfaces.
7. Update onboarding from "connect worker through MCP/API token" to "configure a PREQSTATION CLI dispatch host".
8. Stop using active MCP connection as the main worker-readiness signal.
9. Replace `preqstation-dispatcher setup auto` UI copy with current `preqstation setup auto`.
10. Prefer `gh auth` or CLI-supported GitHub auth wording over GitHub MCP as the default deploy path.

Verification:

```bash
rtk npm test
rtk npm run typecheck
rtk npm run lint
rtk rg "preqstation-dispatcher|preqstation-skill|.preqstation-prompt.txt|~/.preqstation-dispatch|preq_complete_task|preq_start_task|GitHub MCP" README.md docs app lib
```

## Phase 4: Public Guide And Landing Copy

Target repo: `~/projects/preqstation-lp`

Status: completed on 2026-06-10.

Note: there is no standalone `preqstation-guide` repo. The guide lives at `apps/guide`.

Goal: keep public docs, guide pages, and landing copy aligned for both English and Korean readers.

High-priority files:

- `README.md`
- `apps/guide/src/content/docs/index.mdx`
- `apps/guide/src/content/docs/getting-started/quick-start.mdx`
- `apps/guide/src/content/docs/getting-started/preq-cli.mdx`
- `apps/guide/src/content/docs/reference/environment-variables.mdx`
- `apps/guide/src/content/docs/reference/troubleshooting.mdx`
- `apps/guide/src/content/docs/skill/installation.mdx`
- `apps/guide/src/content/docs/skill/mcp-tools.mdx`
- `apps/guide/src/content/docs/skill/shell-helpers.mdx`
- `apps/guide/src/content/docs/web-app/telegram.mdx`
- Matching `apps/guide/src/content/docs/ko/...` pages
- `apps/landing/src/i18n/en.ts`
- `apps/landing/src/i18n/ko.ts`

Required updates:

1. Move Quick Start and PREQ CLI pages to pure CLI-first wording.
2. Stop saying the CLI prepares worker runtime support or runtime MCP registration by default.
3. Change mapping/state paths to `~/.preqstation`.
4. Make Worker Installation a legacy/manual fallback page.
5. Demote `npx skills add sonim1/preqstation-skill` to optional legacy/manual worker setup.
6. Keep remote `/mcp` docs, but label them direct-client compatibility rather than detached worker runtime.
7. Add or update Hermes maintenance flow: `preqstation update` or `preqstation sync hermes`, then `hermes gateway restart` when prompted.
8. Ensure English and Korean pages say the same thing.

Verification:

```bash
rtk npm test
rtk npm run build
rtk rg "~/.preqstation-dispatch|preqstation-skill|worker runtime support|remote MCP|MCP registration|preq-coder gateway restart" apps/guide apps/landing README.md
```

## Phase 5: Legacy Repo And Snapshot Cleanup

Targets:

- `~/projects/preqstation-dispatcher-host-mcp-clean`
- `~/projects/preqstation-prs`

Status: completed as audit-only on 2026-06-10.

Recommended actions:

1. Treat `preqstation-dispatcher-host-mcp-clean` as obsolete historical code.
2. Do not modernize or rename it into the CLI-first runtime.
3. Preserve any useful retrospective docs, then archive/delete the broken local worktree if no longer needed.
4. If an npm package or GitHub repo still points users to `@sonim1/preqstation-dispatcher`, deprecate it toward `@sonim1/preqstation`.
5. Treat `preqstation-prs` as local snapshots unless confirmed otherwise.

Verification:

```bash
rtk rg "@sonim1/preqstation-dispatcher|preqstation-dispatcher run|.preqstation-prompt.txt|~/.preqstation-dispatch" ~/projects/preqstation-dispatcher-host-mcp-clean ~/projects/preqstation-prs
```

## Suggested PR Split

1. `preqstation-cli`: docs-only sync for published CLI package.
2. `preqstation-skill`: deprecation or CLI-first rewrite, depending on product decision.
3. `preqstation`: architecture, onboarding, and UI copy sync.
4. `preqstation-lp`: guide and landing copy sync in English and Korean.
5. Legacy cleanup: archive/deprecate old dispatcher host snapshots.

## Done Criteria

- No current user-facing doc presents `preqstation-skill` as required for detached dispatch.
- No current user-facing doc presents native PREQ MCP tools as the detached worker lifecycle path.
- No current user-facing doc uses `.preqstation-prompt.txt` as the current instruction file.
- No current user-facing doc presents `~/.preqstation-dispatch` as the default state directory.
- Hermes docs and guide pages mention `hermes gateway restart` after skill changes.
- Guide English/Korean pages remain consistent.
- Each touched repo passes its docs/tests/build checks.
