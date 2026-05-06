#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from runtime_compat import enable_windows_utf8_stdio
from data_modules.chapter_delete_service import ChapterDeleteError, ChapterDeleteService


def _format_text(result: dict[str, Any]) -> str:
    chapters = ",".join(str(chapter) for chapter in result.get("chapters", []))
    lines = [
        f"目标章节: {chapters}",
        f"模式: {result.get('mode', '')}",
        f"dry-run: {bool(result.get('dry_run'))}",
    ]
    warnings = result.get("warnings") or []
    if warnings:
        lines.append("警告:")
        lines.extend(f"- {item}" for item in warnings)

    files = result.get("files") or {}
    if files:
        lines.append("计划删除文件:")
        for key in ("chapter_text", "summaries", "story_system", "review_reports"):
            lines.append(f"- {key}: {len(files.get(key) or [])}")
        missing = files.get("missing_chapter_text") or []
        if missing:
            lines.append(f"- missing_chapter_text: {', '.join(missing)}")

    sqlite = result.get("sqlite") or {}
    index_counts = sqlite.get("index_db") or {}
    vector_counts = sqlite.get("vectors_db") or {}
    if index_counts:
        lines.append(f"index.db 计划清理行数: {sum(int(v or 0) for v in index_counts.values())}")
    if vector_counts:
        lines.append(f"vectors.db 计划清理 chunk: {vector_counts.get('chunks', 0)}")

    memory = result.get("memory") or {}
    lines.append(f"记忆条目计划移除: {memory.get('items_removed', 0)}")

    state = result.get("state") or {}
    if state:
        lines.append(
            "state: "
            f"current_chapter {state.get('current_chapter_before', 0)} -> {state.get('current_chapter_after', 0)}, "
            f"total_words {state.get('total_words_before', 0)} -> {state.get('total_words_after', 0)}"
        )

    if result.get("applied"):
        deleted = result.get("deleted") or {}
        lines.append("已执行删除:")
        for key, value in deleted.items():
            if isinstance(value, dict):
                numeric_values = [int(v or 0) for v in value.values() if isinstance(v, int)]
                lines.append(f"- {key}: {sum(numeric_values) if numeric_values else json.dumps(value, ensure_ascii=False)}")
            else:
                lines.append(f"- {key}: {value}")
    elif result.get("dry_run"):
        lines.append("未执行删除。确认无误后追加 --yes。")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    enable_windows_utf8_stdio(skip_in_pytest=True)
    parser = argparse.ArgumentParser(description="删除章节及其相关数据")
    parser.add_argument("--project-root", required=True, help="书项目根目录")
    parser.add_argument("chapters", nargs="?", help="章节号、列表或范围，如 1,3,7-9")
    parser.add_argument("--chapters", dest="chapters_option", help="兼容参数：章节号、列表或范围")
    parser.add_argument("--dry-run", action="store_true", help="仅打印删除计划")
    parser.add_argument("--yes", action="store_true", help="确认执行删除")
    parser.add_argument("--format", choices=["json", "text"], default="text", help="输出格式")
    args = parser.parse_args(argv)

    try:
        raw_chapters = args.chapters_option or args.chapters
        service = ChapterDeleteService(Path(args.project_root))
        chapters = service.parse_chapter_spec(raw_chapters or "")
        result = service.apply(chapters, dry_run=args.dry_run or not args.yes, yes=args.yes)
    except (ChapterDeleteError, OSError, ValueError) as exc:
        error = {"ok": False, "error": str(exc)}
        if args.format == "json":
            print(json.dumps(error, ensure_ascii=False, indent=2), file=sys.stderr)
        else:
            print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    result = {"ok": True, **result}
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(_format_text(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
