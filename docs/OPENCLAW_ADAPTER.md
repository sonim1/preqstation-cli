# OpenClaw Adapter

The OpenClaw plugin intercepts PREQ dispatch messages with the OpenClaw `before_dispatch` hook and handles them before the normal chat run.

Current flow:

1. parse a PREQ dispatch message such as `!/preqstation dispatch plan PROJ-327 using codex`
2. resolve `project_cwd` from an explicit absolute path, OpenClaw plugin config, the shared `~/.preqstation-dispatch/projects.json` store, or legacy `MEMORY.md`
3. create or reuse an auxiliary git worktree
4. write `.preqstation-prompt.txt` into that worktree
5. create a managed Task Flow record and park it in waiting with detached process metadata
6. launch the selected CLI as a detached process

This is intentionally not the old PTY/background session model. The plugin does not rely on OpenClaw `background:true` exec or `process action:poll` / `process action:log` for the dispatched coding run.

### Installation

Most users should install through the PREQSTATION CLI:

```bash
npx -y @sonim1/preqstation@latest install
```

The installer configures request entrypoints, worker runtime support, MCP registrations, and local project mappings. See [INSTALLATION.md](INSTALLATION.md) for direct OpenClaw/Hermes install commands, local development links, and troubleshooting notes.
