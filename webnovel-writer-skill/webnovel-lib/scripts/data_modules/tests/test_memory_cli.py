#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""memory_cli.py 测试。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_scripts_dir = str(Path(__file__).resolve().parent.parent.parent)
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)


def _ensure_scripts_on_path():
    scripts_dir = Path(__file__).resolve().parent.parent.parent
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


def _make_project(tmp_path: Path):
    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)
    (webnovel_dir / "state.json").write_text("{}", encoding="utf-8")
    (webnovel_dir / "summaries").mkdir(exist_ok=True)
    return tmp_path


def test_load_context_cli(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "load-context", "--chapter", "1"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert output["chapter"] == 1
    assert "sections" in output


def test_query_entity_not_found(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "query-entity", "--id", "nobody"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert output["error"] == "not_found"


def test_query_entity_found(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    state = {
        "entities_v3": {
            "角色": {
                "xiaoyan": {"name": "萧炎", "tier": "核心", "aliases": [], "first_appearance": 1, "last_appearance": 10}
            }
        }
    }
    (project / ".webnovel" / "state.json").write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "query-entity", "--id", "xiaoyan"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert output["name"] == "萧炎"


def test_query_rules_empty(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "query-rules"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert output == []


def test_read_summary_missing(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "read-summary", "--chapter", "99"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert output["chapter"] == 99
    assert output["summary"] == ""


def test_read_summary_exists(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    (project / ".webnovel" / "summaries" / "ch0005.md").write_text("第5章摘要", encoding="utf-8")

    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "read-summary", "--chapter", "5"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert "第5章摘要" in output["summary"]


def test_get_open_loops_empty(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "get-open-loops"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert output == []


def test_get_timeline_empty(tmp_path, capsys):
    _ensure_scripts_on_path()
    import memory_cli

    project = _make_project(tmp_path)
    old_argv = sys.argv
    sys.argv = ["memory_cli", "--project-root", str(project), "get-timeline", "--from", "1", "--to", "100"]
    try:
        memory_cli.main()
    finally:
        sys.argv = old_argv

    output = json.loads(capsys.readouterr().out)
    assert output == []
