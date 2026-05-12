# Configuration

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
- `PREQSTATION_SERVER_URL` or `PREQSTATION_API_URL`: optional PREQSTATION server URL for `install`, `update`, and MCP-backed `setup auto`
- `PREQSTATION_TOKEN`: optional bearer token override for MCP-backed `setup auto`; otherwise `~/.preqstation-dispatch/oauth.json` is reused or created through browser OAuth

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
