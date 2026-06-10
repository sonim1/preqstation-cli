# Making PREQSTATION Dispatch Work in OpenClaw

## Summary

This historical retrospective explains what was broken in the original OpenClaw PREQ dispatch flow, why it failed specifically in Telegram-driven runs, what we changed in the `preqstation-dispatcher` plugin, and how that model evolved.

This is written as a blog-ready retrospective and implementation note.

Current CLI-first dispatch uses `@sonim1/preqstation`, shared state under `~/.preqstation`, and `.preqstation-instructions.txt` as the worker instruction file. References below to `.preqstation-prompt.txt` describe the old implementation or the migration history, not the current worker contract.

## The Problem

We already had a working Claude Code side for PREQ dispatch, but the OpenClaw side was unstable.

The old OpenClaw dispatch path looked roughly like this:

1. a Telegram message triggered an OpenClaw chat run
2. that chat run created a git worktree
3. it wrote `.preqstation-prompt.txt`
4. it launched `codex exec` with OpenClaw-managed `background:true` and `pty:true`
5. the dispatched coding run was expected to continue independently

On paper that looked reasonable. In practice it broke in exactly the place we cared about most: after the worktree existed but before the PREQ task lifecycle actually started.

## The Failure Mode

The visible symptom was that PREQ tasks stayed in `queued` instead of moving to `working`.

Operationally we saw:

- worktree creation succeeded
- `.preqstation-prompt.txt` existed
- `codex exec` appeared to launch
- but `preq_start_task(...)` was never reached

The underlying OpenClaw error was:

```text
Agent listener invoked outside active run
```

The practical meaning was simple:

- Telegram triggered a normal chat run
- the child PTY process emitted output later
- OpenClaw tried to route that later output back into the already-finished current run
- the host rejected it

So the dispatch session was coupling a long-running coding process to the lifecycle of a short-lived chat turn. That coupling was the core bug.

## Why the Old Model Was Wrong

The old model treated detached coding work like a live extension of the current Telegram conversation.

That was the wrong abstraction.

What we actually needed was:

- Telegram as a trigger surface
- the plugin as the orchestration layer
- the coding CLI as a detached worker
- PREQ as the lifecycle source of truth

In other words, the chat run should start the work, not own the work.

## Design Goals

We set the following goals for the new implementation:

1. keep Telegram as the user-facing trigger
2. stop relying on OpenClaw `background:true` PTY lifecycle for dispatched coding runs
3. keep worktree isolation
4. preserve PREQ lifecycle expectations
5. make project-path setup manageable from OpenClaw itself
6. make the flow observable enough to debug without rebuilding the whole system

## What We Changed

### 1. Rebuilt `preqstation-dispatcher` as a real native OpenClaw plugin

Instead of leaving it as a loose skill/docs surface, we turned it into an actual plugin with:

- `openclaw.plugin.json`
- `index.mjs`
- `before_dispatch` interception
- a native OpenClaw command: `/preqstation`

This let the plugin intercept PREQ dispatch messages before the normal LLM run handled them.

### 2. Moved dispatch ownership into `before_dispatch`

The new plugin intercepts PREQ dispatch messages like:

```text
!/preqstation dispatch plan PROJ-328 using codex branch_name="task/proj-328/edit-task-isyu"
```

The plugin now owns:

- parsing the dispatch message
- resolving the project path
- creating or reusing the task worktree
- writing `.preqstation-prompt.txt`
- launching the selected engine

This means dispatch no longer depends on a normal Telegram chat run surviving long enough to host a background PTY process.

### 3. Added Task Flow tracking for detached dispatches

The plugin now creates a managed Task Flow record and parks it in a waiting state with detached process metadata.

This is not full end-to-end emergence yet, but it gives the host a durable place to remember:

- task key
- engine
- worktree path
- pid file
- log file

That is already a better fit than pretending the child process is just another live part of the current chat turn.

### 4. Replaced OpenClaw-managed background PTY execution with detached local CLI launch

The new model launches the coding CLI as a detached local process and writes artifacts into the worktree:

- `.preqstation-dispatch/<engine>.pid`
- `.preqstation-dispatch/<engine>.log`

This deliberately avoids:

- `background:true`
- `pty:true`
- `process action:poll`
- `process action:log`

for the actual dispatched coding run.

That was the key architectural shift.

### 5. Added OpenClaw-native project path setup

Originally the OpenClaw side depended too much on ad hoc mappings or sample `MEMORY.md` content.

We added `/preqstation setup` so OpenClaw can own path management itself.

Supported setup paths now include:

- `/preqstation setup set <PROJECT_KEY> <ABSOLUTE_PATH>`
- `/preqstation setup import`
- `/preqstation setup auto ...`

### 6. Added repo URL auto-matching

We then improved setup so OpenClaw can map projects in bulk from repo URLs.

The plugin can now scan local repositories under:

- `PREQSTATION_REPO_ROOTS`, or
- `~/projects` by default

and match local `git remote get-url origin` values against PREQ project repo URLs.

This made setup much closer to the Claude-side experience without making OpenClaw depend on Claude.

### 7. Changed the copied setup prompt format for Telegram compatibility

At first the web UI copied a multiline setup payload like:

```text
/preqstation setup auto
PROJ https://github.com/sonim1/project-manager
AGAL https://github.com/sonim1/aga-log
```

That looked clean, but Telegram/OpenClaw plugin command handling did not reliably preserve multiline slash-command payloads.

So we switched the actual copied format to a single line:

```text
/preqstation setup auto PROJ=https://github.com/sonim1/project-manager AGAL=https://github.com/sonim1/aga-log
```

The plugin now supports both:

- `KEY URL`
- `KEY=URL`

but the web UI emits the single-line `KEY=URL` form because it is more reliable for Telegram.

### 8. Fixed a detached shell launch bug

After moving to detached launch we hit another real bug:

```text
sh: -c: line 0: syntax error near unexpected token `&&'
```

The shell script was being generated with:

```sh
nohup ... & && echo $! > ...
```

which is invalid shell syntax.

We fixed that by wrapping the background launch and PID capture in a subshell so the launch script is valid and deterministic.

## What the Flow Looks Like Now

Today the OpenClaw side behaves like this:

1. Telegram receives a PREQ dispatch message
2. `preqstation-dispatcher` intercepts it in `before_dispatch`
3. the plugin resolves the project path
4. it creates or reuses the task worktree
5. it writes `.preqstation-instructions.txt`
6. it creates a managed Task Flow record
7. it launches the coding CLI as a detached local process
8. PREQ lifecycle calls happen inside the worker run through the CLI contract rendered into the instruction file

This is much closer to the actual mental model we wanted from the beginning:

- chat triggers dispatch
- plugin orchestrates dispatch
- detached worker does the coding work

## Setup and Usage Today

### Install the plugin

```bash
openclaw plugins install --link --dangerously-force-unsafe-install /path/to/preqstation-dispatcher
openclaw gateway restart
openclaw plugins inspect preqstation-dispatcher
```

### Bulk project setup from OpenClaw

```text
/preqstation setup auto PROJ=https://github.com/sonim1/project-manager AGAL=https://github.com/sonim1/aga-log
```

Then verify:

```text
/preqstation setup status
```

### Dispatch a task

```text
!/preqstation dispatch plan PROJ-328 using codex branch_name="task/proj-328/edit-task-isyu"
```

### What to inspect during debugging

When a dispatch starts, the main artifacts are:

- worktree under `~/.openclaw-preq-worktrees/...`
- `.preqstation-instructions.txt`
- `.preqstation-dispatch/<engine>.pid`
- `.preqstation-dispatch/<engine>.log`

Those files are now the most useful debugging surface.

## What This Fixes

This work fixes several separate classes of failure:

- worktree created but child run never truly detached
- Telegram-triggered runs dying before PREQ lifecycle started
- project-path setup depending on manual `MEMORY.md` editing
- OpenClaw setup depending too much on Claude-side mapping
- multiline setup prompts not surviving Telegram slash-command handling
- detached launch script syntax errors

## What It Does Not Fix Yet

A few things are still intentionally out of scope:

- completion emergence back into the original Telegram thread is still limited
- detached logs are not streamed live into Telegram
- OpenClaw does not yet auto-discover every project directly from PREQ without a prompt payload
- this is still optimized for stable dispatch first, richer UX second

That tradeoff was deliberate. The first priority was making dispatch actually survive the jump from Telegram to detached coding execution.

## Lessons Learned

### 1. A chat turn is not a job runner

Trying to treat a normal conversation turn like a durable background worker was the original mistake.

### 2. Detached work needs its own ownership model

The plugin needed to own orchestration directly rather than piggybacking on normal chat-run PTY behavior.

### 3. Setup UX matters as much as runtime architecture

Once dispatch moved into the plugin, path setup became the next bottleneck. Solving only the runtime problem would still have left the feature awkward to use.

### 4. Telegram constraints shape command design

A command format that looks nicer in a README is not automatically the right format for a real Telegram/OpenClaw command path.

## Historical Current State At Original Write-Up

At the time of the original write-up, the OpenClaw dispatch surface supported:

- native `before_dispatch` interception
- detached CLI launch
- worktree-based isolation
- OpenClaw-managed project mapping
- repo URL auto-matching
- single-line Telegram-safe setup payloads

This is a much stronger base than the earlier PTY-bound model, and it gives us a clean platform for later work such as richer emergence, better monitoring, and tighter PREQ/OpenClaw integration.
