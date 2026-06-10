# Command Shape

Supported trigger styles:

- `/preqstation dispatch plan PROJ-327 using codex`
- `/preqstation dispatch ask PROJ-328 using codex ask_hint="Acceptance criteria"`
- `/preqstation dispatch implement PROJ-327 using codex model="gpt-5.3-codex-spark"`
- `!/preqstation dispatch implement PROJ-327 using claude branch_name="task/proj-327-example"`

Parsed fields:

- engine
- task key
- project key
- objective
- optional `branch_name`
- optional `ask_hint`
- optional `insight_prompt_b64`

CLI auth commands:

- `preqstation auth login --server-url https://your-preqstation-domain`
- `preqstation auth status`
- `preqstation auth logout`
- `preqstation whoami`

`auth login` and `auth status` print JSON. `whoami` is present as a CLI surface but currently returns a structured `auth_identity_unavailable` error until the PREQSTATION server exposes an identity endpoint or tool.

Legacy MCP cleanup:

- `preqstation mcp disable claude-code`
- `preqstation mcp disable codex`
- `preqstation mcp disable gemini-cli`

`mcp disable` removes only the native PREQ MCP registration for that runtime. Use `preqstation uninstall <runtime>` when you also want to remove legacy worker support or skills.

Lifecycle CLI commands:

- `preqstation task get PROJ-123`
- `preqstation task start PROJ-123 --engine codex`
- `preqstation task note PROJ-123 --body-file note.md`
- `preqstation task status PROJ-123 --status ready --clear-run-state`
- `preqstation task complete PROJ-123 --json-file result.json`
- `preqstation task block PROJ-123 --reason-file reason.md`
- `preqstation task plan PROJ-123 --plan-file plan.md`
- `preqstation task review PROJ-123 --json-file review.json`
- `preqstation task list --project PROJ --detail full`
- `preqstation task create --project PROJ --json-file task.json`
- `preqstation task delete PROJ-123`
- `preqstation qa update --run-id RUN-123 --json-file report.json`
- `preqstation comment list --task PROJ-123`
- `preqstation comment get --comment-id COMMENT-123`
- `preqstation comment reply --comment-id COMMENT-123 --body-file reply.md`
- `preqstation comment state --comment-id COMMENT-123 --state done`
- `preqstation project list`
- `preqstation project settings --project PROJ`
- `preqstation project activity --project PROJ --from 2026-01-01T00:00:00.000Z --to 2026-01-02T00:00:00.000Z`

Lifecycle command success prints `{ "ok": true, "result": ... }`. Failure prints `{ "ok": false, "error": { "code": ... } }`.
