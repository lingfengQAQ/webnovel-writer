#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, List


PLACEHOLDER_PATTERNS = [
    re.compile(r"\[待[^\]]*\]"),
    re.compile(r"（暂名）|\(暂名\)|（待补充）|\(待补充\)"),
    re.compile(r"\{占位\}|<占位>"),
]


def _scan_file(path: Path, project_root: Path) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return results

    for line_no, line in enumerate(lines, start=1):
        for pattern in PLACEHOLDER_PATTERNS:
            for match in pattern.finditer(line):
                rel = path.relative_to(project_root).as_posix()
                results.append(
                    {
                        "file": rel,
                        "line": line_no,
                        "pattern": match.group(0),
                        "context": line.strip(),
                        "suggested_fill_phase": "plan" if rel.startswith("大纲/") else "setting_update",
                    }
                )
    return results


def scan_placeholders(project_root: str | Path) -> List[Dict[str, Any]]:
    root = Path(project_root).expanduser().resolve()
    targets: List[Path] = []
    for dirname in ("大纲", "设定集"):
        base = root / dirname
        if base.is_dir():
            targets.extend(sorted(base.rglob("*.md")))

    results: List[Dict[str, Any]] = []
    for path in targets:
        results.extend(_scan_file(path, root))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan outline/settings files for unresolved placeholders")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--format", choices=["json", "text"], default="json")
    args = parser.parse_args()

    results = scan_placeholders(args.project_root)
    if args.format == "json":
        print(json.dumps({"ok": not results, "placeholders": results}, ensure_ascii=False, indent=2))
        return
    if not results:
        print("OK no placeholders found")
        return
    for item in results:
        print(f"{item['file']}:{item['line']} {item['pattern']} {item['context']}")


if __name__ == "__main__":
    main()
