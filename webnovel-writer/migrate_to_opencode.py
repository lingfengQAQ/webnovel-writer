#!/usr/bin/env python3
"""
Convert Claude Code skills/agents to OpenCode format.

Replacements:
- ${CLAUDE_PLUGIN_ROOT} -> ${OPENCODE_PLUGIN_ROOT}
- ${CLAUDE_PROJECT_DIR} -> ${OPENCODE_PROJECT_DIR:-$PWD}
- allowed-tools: -> tools: (in YAML frontmatter)

Usage:
    python migrate_to_opencode.py [--dry-run]
"""

import re
import shutil
from pathlib import Path

# Source and destination
PLUGIN_ROOT = Path(__file__).parent
SRC_SKILLS = PLUGIN_ROOT / "skills"
SRC_AGENTS = PLUGIN_ROOT / "agents"
DST_SKILLS = PLUGIN_ROOT / "opencode" / "skills"
DST_AGENTS = PLUGIN_ROOT / "opencode" / "agents"

# Replacement patterns
REPLACEMENTS = [
    # Environment variables
    (r'\$\{CLAUDE_PLUGIN_ROOT\}', '${OPENCODE_PLUGIN_ROOT}'),
    (r'\$CLAUDE_PLUGIN_ROOT', '$OPENCODE_PLUGIN_ROOT'),
    (r'\$\{CLAUDE_PROJECT_DIR:-\$PWD\}', '${OPENCODE_PROJECT_DIR:-$PWD}'),
    (r'\$\{CLAUDE_PROJECT_DIR\}', '${OPENCODE_PROJECT_DIR:-$PWD}'),
    (r'\$CLAUDE_PROJECT_DIR', '$OPENCODE_PROJECT_DIR'),
    # YAML frontmatter
    (r'^allowed-tools:', 'tools:'),
    # Comments/docs mentioning Claude
    (r'Claude Code', 'OpenCode'),
    (r'Claude 工作区', 'OpenCode 工作区'),
]


def convert_content(content: str) -> str:
    """Apply all replacements to content."""
    result = content
    for pattern, replacement in REPLACEMENTS:
        if pattern.startswith('^'):
            # Line-start pattern - use MULTILINE
            result = re.sub(pattern, replacement, result, flags=re.MULTILINE)
        else:
            result = result.replace(pattern.replace(r'\$', '$').replace(r'\{', '{').replace(r'\}', '}'), 
                                   replacement.replace(r'\$', '$').replace(r'\{', '{').replace(r'\}', '}'))
    return result


def convert_file(src: Path, dst: Path, dry_run: bool = False) -> int:
    """Convert a single file. Returns number of changes made."""
    content = src.read_text(encoding='utf-8')
    converted = convert_content(content)
    
    changes = 0
    for pattern, _ in REPLACEMENTS:
        clean_pattern = pattern.replace(r'\$', '$').replace(r'\{', '{').replace(r'\}', '}').lstrip('^')
        changes += content.count(clean_pattern)
    
    if not dry_run:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(converted, encoding='utf-8')
    
    return changes


def convert_directory(src_dir: Path, dst_dir: Path, dry_run: bool = False) -> dict:
    """Convert all .md files in a directory tree."""
    stats = {"files": 0, "changes": 0, "skipped": 0}
    
    if not src_dir.exists():
        print(f"  [SKIP] Source not found: {src_dir}")
        return stats
    
    for src_file in src_dir.rglob("*.md"):
        rel_path = src_file.relative_to(src_dir)
        dst_file = dst_dir / rel_path
        
        changes = convert_file(src_file, dst_file, dry_run)
        
        if changes > 0:
            stats["files"] += 1
            stats["changes"] += changes
            action = "[DRY]" if dry_run else "[OK]"
            print(f"  {action} {rel_path} ({changes} replacements)")
        else:
            stats["skipped"] += 1
    
    return stats


def main():
    import sys
    dry_run = "--dry-run" in sys.argv
    
    print(f"{'[DRY RUN] ' if dry_run else ''}Converting Claude Code -> OpenCode")
    print(f"Plugin root: {PLUGIN_ROOT}")
    print()
    
    # Convert skills
    print("Converting skills/...")
    skills_stats = convert_directory(SRC_SKILLS, DST_SKILLS, dry_run)
    
    # Convert agents
    print("\nConverting agents/...")
    agents_stats = convert_directory(SRC_AGENTS, DST_AGENTS, dry_run)
    
    # Summary
    total_files = skills_stats["files"] + agents_stats["files"]
    total_changes = skills_stats["changes"] + agents_stats["changes"]
    total_skipped = skills_stats["skipped"] + agents_stats["skipped"]
    
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Summary:")
    print(f"  Files converted: {total_files}")
    print(f"  Total replacements: {total_changes}")
    print(f"  Files unchanged: {total_skipped}")
    
    if dry_run:
        print("\nRun without --dry-run to apply changes.")


if __name__ == "__main__":
    main()
