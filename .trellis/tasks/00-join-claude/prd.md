# Joiner Onboarding Task

**You (the AI) are running this task. The developer does not read this file.**

`claude` just ran `trellis init` on a fresh clone, saw "Developer
initialized", and will now start asking you questions in chat. This joiner task
exists under `.trellis/tasks/`; when they want to work on it, they should
start it from a session that provides Trellis session identity.

Your job is to orient them to Trellis. Don't dump all of this at them — open
with a short greeting, ask where they want to start, and fill in the rest as
they engage.

---

## Topics to cover (adapt order to their questions)

### 1. What Trellis is + the workflow

Trellis is a workflow layer over Claude Code / Cursor / etc. that keeps AI
agents consistent with project-specific conventions instead of writing generic
code every session.

- **Three phases**: Plan (brainstorm → `prd.md`) → Execute (code + check) →
  Finish (capture + wrap). Full reference: `.trellis/workflow.md`.
- **Task lifecycle**: planning → in_progress → done → archive, under
  `.trellis/tasks/`.
- **Core slash commands**:
  - `/trellis:continue` — resume the current session's active task
  - `/trellis:finish-work` — wrap up a finished task
  - `/trellis:start` — session boot from scratch (not needed here; the
    SessionStart hook does its job automatically)

### 2. Runtime mechanics (explain when they ask "how does it know what to do")

- **SessionStart hook** runs `get_context.py` and injects identity, git
  status, session active task, active tasks, and workflow phase into the AI
  conversation at every session start.
- **`<workflow-state>` tag** is auto-injected with every user message,
  carrying the current task + phase hint.
- **`/trellis:continue`** loads the Phase Index, reads `prd.md` + recent
  activity, and routes to the right skill (`trellis-brainstorm` for planning,
  `trellis-implement` for coding, `trellis-check` for verification).
- **`trellis-implement` sub-agent** is spawned when code needs to be written.
  The platform hook reads `{TASK_DIR}/implement.jsonl` and auto-injects those
  spec files + `prd.md` into the sub-agent's prompt so it codes per project
  conventions.
- **`trellis-check` sub-agent** follows the same pattern with `check.jsonl`
  — reviews changes against specs, auto-fixes issues, runs lint/typecheck.

File layout (mention when they ask "where does what live"):
- `.trellis/.runtime/sessions/<session>.json` — session active-task state, gitignored
- `.trellis/tasks/<task>/{implement,check}.jsonl` — per-task context manifests
- `.trellis/spec/` — project-wide conventions (source of truth)
- `.trellis/workspace/claude/journal-*.md` — their session log,
  rotated at ~2000 lines

### 3. This project's actual conventions

- Summarize `.trellis/spec/` for them — what coding conventions this
  specific team enforces.
- Point at the last 5 entries in `.trellis/tasks/archive/` as a rhythm
  example of how people actually work here. **If archive is empty** (the
  project just started), skip this — don't invent examples.
- Not your job in this onboarding to teach them the business code itself —
  the README and their teammates handle that.

### 4. Their assigned work

- Check if `.trellis/workspace/claude/` already exists — if yes, it's
  their journal from another machine and worth mentioning.
- Run `python ./.trellis/scripts/task.py list --assignee claude` to
  show tasks assigned to them. (Quote the name if it contains spaces.)
- Remind them that the "My Tasks" section appears in the SessionStart context
  on every new session.

---

## Optional: walk through a small task end-to-end

If they want to practice before touching real work, offer to pick a tiny
P3 task or a typo fix and run the full cycle together: `/trellis:continue`
→ you implement via sub-agents → `/trellis:finish-work`.

---

## Completion

When they feel oriented (or after you've covered the four topics with
reasonable back-and-forth), guide them to run:

```bash
python ./.trellis/scripts/task.py finish
python ./.trellis/scripts/task.py archive 00-join-claude
```

---

## Suggested opening line

"Welcome! Your `trellis init` set me up to onboard you to this project. I
can walk you through the workflow, show you the runtime mechanics under the
hood, summarize the team's spec, or jump to what you're already curious about
— which would you prefer?"
