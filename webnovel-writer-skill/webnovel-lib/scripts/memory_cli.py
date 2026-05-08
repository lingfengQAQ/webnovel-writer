#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
memory_cli.py — MemoryContract CLI 入口。

提供 load-context / query-entity / query-rules / read-summary /
get-open-loops / get-timeline 六个子命令，输出 JSON。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from runtime_compat import enable_windows_utf8_stdio


def _ensure_scripts_path() -> None:
    scripts_dir = Path(__file__).resolve().parent
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


_ensure_scripts_path()

from data_modules.config import DataModulesConfig
from data_modules.memory_contract_adapter import MemoryContractAdapter


def _adapter(project_root: str) -> MemoryContractAdapter:
    cfg = DataModulesConfig.from_project_root(project_root)
    return MemoryContractAdapter(cfg)


def _json_out(data) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_load_context(args: argparse.Namespace) -> None:
    adapter = _adapter(args.project_root)
    pack = adapter.load_context(args.chapter)
    _json_out(pack.to_dict())


def cmd_query_entity(args: argparse.Namespace) -> None:
    adapter = _adapter(args.project_root)
    snap = adapter.query_entity(args.id)
    if snap is None:
        _json_out({"error": "not_found", "entity_id": args.id})
    else:
        _json_out(snap.to_dict())


def cmd_query_rules(args: argparse.Namespace) -> None:
    adapter = _adapter(args.project_root)
    rules = adapter.query_rules(domain=args.domain or "")
    _json_out([r.to_dict() for r in rules])


def cmd_read_summary(args: argparse.Namespace) -> None:
    adapter = _adapter(args.project_root)
    text = adapter.read_summary(args.chapter)
    _json_out({"chapter": args.chapter, "summary": text})


def cmd_get_open_loops(args: argparse.Namespace) -> None:
    adapter = _adapter(args.project_root)
    loops = adapter.get_open_loops(status=args.status or "active")
    _json_out([l.to_dict() for l in loops])


def cmd_get_timeline(args: argparse.Namespace) -> None:
    adapter = _adapter(args.project_root)
    events = adapter.get_timeline(args.from_ch, args.to_ch)
    _json_out([e.to_dict() for e in events])


def main() -> None:
    parser = argparse.ArgumentParser(description="MemoryContract CLI")
    parser.add_argument("--project-root", required=True, help="项目根目录")
    sub = parser.add_subparsers(dest="command")

    p_load = sub.add_parser("load-context", help="加载章节上下文基础包")
    p_load.add_argument("--chapter", type=int, required=True)

    p_entity = sub.add_parser("query-entity", help="查询实体快照")
    p_entity.add_argument("--id", required=True, help="实体 ID")

    p_rules = sub.add_parser("query-rules", help="查询世界规则")
    p_rules.add_argument("--domain", default="", help="按 domain 过滤")

    p_summary = sub.add_parser("read-summary", help="读取章节摘要")
    p_summary.add_argument("--chapter", type=int, required=True)

    p_loops = sub.add_parser("get-open-loops", help="查询未闭合伏笔")
    p_loops.add_argument("--status", default="active", help="状态过滤")

    p_timeline = sub.add_parser("get-timeline", help="查询时间线事件")
    p_timeline.add_argument("--from", type=int, required=True, dest="from_ch", help="起始章节")
    p_timeline.add_argument("--to", type=int, required=True, dest="to_ch", help="结束章节")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    dispatch = {
        "load-context": cmd_load_context,
        "query-entity": cmd_query_entity,
        "query-rules": cmd_query_rules,
        "read-summary": cmd_read_summary,
        "get-open-loops": cmd_get_open_loops,
        "get-timeline": cmd_get_timeline,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    if sys.platform == "win32":
        enable_windows_utf8_stdio()
    main()
