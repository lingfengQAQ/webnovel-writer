#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from runtime_compat import enable_windows_utf8_stdio

from data_modules.runtime_contract_builder import RuntimeContractBuilder
from data_modules.story_contracts import persist_runtime_contracts, persist_story_seed
from data_modules.story_system_engine import StorySystemEngine, StorySystemRoutingError, is_placeholder_query
from chapter_outline_loader import load_chapter_execution_directive


def _default_csv_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "references" / "csv"


def _resolve_project_root(raw: str) -> Path:
    if raw:
        return Path(raw).expanduser().resolve()

    from project_locator import resolve_project_root

    return resolve_project_root()


def _render_output(format_name: str, contract: dict) -> str:
    if format_name == "json":
        return json.dumps(contract, ensure_ascii=False, indent=2)
    if format_name == "markdown":
        lines = [
            "# Story System",
            f"- 题材：{contract['master_setting']['route'].get('primary_genre', '')}",
        ]
        if contract.get("chapter_brief"):
            lines.append(
                f"- 章节焦点：{contract['chapter_brief']['override_allowed'].get('chapter_focus', '')}"
            )
        return "\n".join(lines)
    return json.dumps(
        {
            "master": contract["master_setting"].get("route", {}),
            "chapter": (contract.get("chapter_brief") or {}).get("override_allowed", {}),
            "anti_patterns": [row.get("text", "") for row in contract.get("anti_patterns", [])],
        },
        ensure_ascii=False,
        indent=2,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Story system seed generator")
    parser.add_argument("query", help="题材 / 需求描述")
    parser.add_argument("--project-root", default="")
    parser.add_argument("--genre", default="")
    parser.add_argument("--chapter", type=int, default=0)
    parser.add_argument("--persist", action="store_true")
    parser.add_argument("--emit-runtime-contracts", action="store_true")
    parser.add_argument("--csv-dir", default="")
    parser.add_argument("--format", choices=["json", "markdown", "both"], default="json")

    args = parser.parse_args()
    project_root = _resolve_project_root(args.project_root)
    csv_dir = Path(args.csv_dir).expanduser().resolve() if args.csv_dir else _default_csv_dir()
    if is_placeholder_query(args.query):
        print(
            "warning: story-system query appears to be a placeholder; parse the real chapter goal from the outline.",
            file=sys.stderr,
        )
    chapter_directive = (
        load_chapter_execution_directive(project_root, args.chapter)
        if args.chapter
        else {}
    )
    engine = StorySystemEngine(csv_dir=csv_dir)
    try:
        contract = engine.build(
            query=args.query,
            genre=args.genre or None,
            chapter=args.chapter or None,
            chapter_directive=chapter_directive,
        )
    except StorySystemRoutingError as exc:
        parser.exit(2, f"error: {exc}\n")

    if args.persist:
        persist_story_seed(
            project_root=project_root,
            master_payload=contract["master_setting"],
            chapter_payload=contract.get("chapter_brief"),
            anti_patterns=contract["anti_patterns"],
        )
    if args.emit_runtime_contracts:
        if not args.chapter:
            raise ValueError("--emit-runtime-contracts 需要 --chapter")
        volume_brief, review_contract = RuntimeContractBuilder(project_root).build_for_chapter(args.chapter)
        persist_runtime_contracts(project_root, args.chapter, volume_brief, review_contract)

    print(_render_output(args.format, contract))


if __name__ == "__main__":
    if sys.platform == "win32":
        enable_windows_utf8_stdio()
    main()
