# OpenCode Compatibility Layer

This folder contains OpenCode-compatible versions of the webnovel-writer skills and agents.

## Setup

### Option 1: Symlink to OpenCode skills directory

```bash
# Linux/macOS
ln -s "$(pwd)/webnovel-writer/opencode/skills/"* ~/.config/opencode/skills/

# Or copy
cp -r webnovel-writer/opencode/skills/* ~/.config/opencode/skills/
```

### Option 2: Set environment variable

Add to your shell profile or OpenCode config:

```bash
export OPENCODE_PLUGIN_ROOT="/path/to/webnovel-writer"
```

## Key Differences from Claude Code Version

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Plugin root var | `${CLAUDE_PLUGIN_ROOT}` | `${OPENCODE_PLUGIN_ROOT}` |
| Project dir var | `${CLAUDE_PROJECT_DIR}` | `${OPENCODE_PROJECT_DIR:-$PWD}` |
| Skills location | `.claude/skills/` | `.opencode/skills/` or `~/.config/opencode/skills/` |
| Agents location | `agents/*.md` | `agents/*.md` (same) |

## What's Converted

- `skills/` — All 8 slash commands with path variables updated
- `agents/` — All 8 checker agents with path variables updated

## Python Scripts (Shared)

The Python CLI (`scripts/webnovel.py`) works unchanged — it uses `--project-root` argument, not environment variables.

```bash
# Works the same for both Claude Code and OpenCode
python "${OPENCODE_PLUGIN_ROOT}/scripts/webnovel.py" --project-root ./my-novel where
```
