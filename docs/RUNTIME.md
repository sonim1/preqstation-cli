# Detached Runtime

Detached process artifacts live inside the worktree:

- `.preqstation-dispatch/<engine>.pid`
- `.preqstation-dispatch/<engine>.log`

Current detached Codex launch uses:

```bash
codex --ask-for-approval never exec --sandbox danger-full-access "Read and execute instructions from ./.preqstation-instructions.txt in the current workspace. Treat that file as the source of truth. If that file is missing, stop."
```

Claude Code and Gemini CLI use the same bootstrap idea with their own binaries.

During the compatibility window, dispatch also writes `.preqstation-prompt.txt` with identical content for older installed worker skills. New detached bootstrap commands read `.preqstation-instructions.txt`.

Generated instructions are CLI-first. Detached workers use the absolute CLI path rendered into `.preqstation-instructions.txt` for PREQ lifecycle reads and mutations.

Before launch, the dispatcher checks CLI auth readiness against the detached worker environment, including worker `HOME`, `~/.preqstation-dispatch/config.json`, `oauth.json`, `PREQSTATION_SERVER_URL`, and `PREQSTATION_TOKEN`. A custom `PREQSTATION_WORKER_HOME` or engine-specific worker home needs its own `preqstation auth login --server-url ...`, unless a token and server URL are passed through the environment.

PREQ native MCP is closed as much as each engine supports:

- Codex launches with `mcp_servers.preqstation.enabled=false`.
- Gemini CLI no longer allowlists the `preqstation` MCP server.
- Claude Code launches with `--strict-mcp-config` and an empty per-run MCP config file.

## Current Limitations

- Completion emergence back into the original chat thread is not wired yet.
- OpenClaw Task Flow tracking is OpenClaw-adapter only. Hermes runs use CLI output and detached log files.
- Detached process logs are written to the worktree and are not streamed live into Telegram.
