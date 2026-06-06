# Detached Runtime

Detached process artifacts live inside the worktree:

- `.preqstation-dispatch/<engine>.pid`
- `.preqstation-dispatch/<engine>.log`

Current detached Codex launch uses:

```bash
codex --ask-for-approval never exec --sandbox danger-full-access "Read and execute instructions from ./.preqstation-prompt.txt in the current workspace. Treat that file as the source of truth. If that file is missing, stop."
```

Claude Code and Gemini CLI use the same bootstrap idea with their own binaries.

## Current Limitations

- Completion emergence back into the original chat thread is not wired yet.
- OpenClaw Task Flow tracking is OpenClaw-adapter only. Hermes runs use CLI output and detached log files.
- Detached process logs are written to the worktree and are not streamed live into Telegram.
