# Installation and CLI Usage

Install this package wherever the dispatcher host runs. For Hermes, run the installer once on the Hermes host. During real dispatch, Hermes Agent receives the Telegram message and calls this CLI through its terminal/tool execution.

### Quick Start

```bash
npx -y @sonim1/preqstation@latest install
npx -y @sonim1/preqstation@latest auth status
npx -y @sonim1/preqstation@latest status
```

`preqstation install` is the default setup path. It opens an interactive wizard for request entrypoints, agent runtimes, remote MCP registration, CLI server URL config, and MCP-backed project setup. Run `preqstation auth status` and `preqstation status` afterward to verify the installed surface without changing anything.

### Command Reference

| Command | Use |
| --- | --- |
| `preqstation install` | Default interactive setup for entrypoints, runtimes, MCP, and project mappings. |
| `preqstation update` | Refresh installed entrypoints and runtime support, then rerun project setup. |
| `preqstation auth login --server-url https://...` | Persist the PREQSTATION server URL and create `oauth.json` through browser OAuth. |
| `preqstation auth status` | Read-only CLI auth status, including inspected home, config path, and OAuth path. |
| `preqstation auth logout` | Remove cached OAuth credentials without deleting project mappings or server URL config. |
| `preqstation whoami` | Reserved for server-side identity support; currently reports a structured unavailable error. |
| `preqstation task get PROJ-123` | Read task data as `ok: true` JSON. |
| `preqstation task complete PROJ-123 --json-file result.json` | Submit completion payload from a file. |
| `preqstation comment reply --comment-id ID --body-file reply.md` | Reply to a PREQ task comment from a file. |
| `preqstation project settings --project PROJ` | Fetch project settings as JSON. |
| `preqstation status` | Read-only installed-state summary for entrypoints, runtimes, MCP, and project mappings. |
| `preqstation doctor` | Read-only health check with the same status surface plus recommended next actions. |
| `preqstation uninstall` | Remove installed entrypoints, runtime MCP registrations, and worker support while keeping local project mappings. |
| `preqstation setup auto` | Fetch PREQ projects through MCP and map them to local git checkouts. |
| `preqstation run ...` | Dispatch directly without OpenClaw or Hermes. |

Configuration details live in [CONFIGURATION.md](CONFIGURATION.md).
