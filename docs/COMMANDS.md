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
