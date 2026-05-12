# Command Shape

Supported trigger styles:

- `/skill preqstation-dispatch plan PROJ-327 using codex`
- `/skill preqstation-dispatch ask PROJ-328 using codex ask_hint="Acceptance criteria"`
- `!/skill preqstation-dispatch implement PROJ-327 using claude branch_name="task/proj-327-example"`
- `preqstation implement PROJ-327 with codex`
- `preqstation implement PROJ-327 in /absolute/path/to/repo with codex`

Parsed fields:

- engine
- task key
- project key
- objective
- optional `branch_name`
- optional `ask_hint`
- optional `insight_prompt_b64`
