# Configuration

The dispatcher host owns local paths. PREQ server payloads should only describe intent.

Environment variables:

- `PREQSTATION_DISPATCH_HOME`: default `~/.preqstation`
- `PREQSTATION_PROJECTS_FILE`: default `~/.preqstation/projects.json`
- `PREQSTATION_WORKTREE_ROOT`: default `~/.preqstation/worktrees`
- `PREQSTATION_WORKER_HOME`: optional shared worker home used for detached Claude/Codex/Gemini launches
- `PREQSTATION_CLAUDE_HOME`: optional Claude-specific worker home override
- `PREQSTATION_CODEX_HOME`: optional Codex-specific worker home override
- `PREQSTATION_GEMINI_HOME`: optional Gemini-specific worker home override
- `PREQSTATION_MEMORY_PATH`: optional legacy markdown mapping fallback
- `PREQSTATION_REPO_ROOTS`: optional path-delimited roots for `setup auto`
- `PREQSTATION_SERVER_URL` or `PREQSTATION_API_URL`: optional PREQSTATION server URL for `install`, `update`, and remote `setup auto`
- `PREQSTATION_TOKEN`: optional bearer token override for remote `setup auto`; otherwise `~/.preqstation/oauth.json` is reused or created through browser OAuth

CLI auth config:

- `preqstation auth login --server-url https://...` writes `~/.preqstation/config.json`
- `preqstation install` also persists the wizard server URL to that config file
- CLI failures append JSON lines to `~/.preqstation/logs/error.log`; pass `--debug` or set `PREQSTATION_DEBUG=1` to print the log path and stack trace.
- Server URL discovery order is env vars, shared `oauth.json`, CLI config, then legacy runtime MCP registrations. The OAuth issuer wins over stale config files.
- When `PREQSTATION_DISPATCH_HOME` is not explicit, reads fall back to legacy `~/.preqstation-dispatch` files if the new `~/.preqstation` file is absent.
- `preqstation auth status` reports the inspected home, dispatch home, config path, OAuth path, and auth source

Detached worker launches never inherit a Hermes profile home by accident. When no worker-home override is set, the dispatcher falls back to the owning user's real home so worker CLI auth can stay separate from Telegram-host profile state.

Shared mapping file shape:

```json
{
  "projects": {
    "PROJ": "/absolute/path/to/project"
  }
}
```

Do not commit this file. It belongs to the local dispatcher host.
