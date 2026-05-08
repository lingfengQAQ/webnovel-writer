#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
import sys

import pytest


def _write_csv(path, headers, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def test_story_system_persist_writes_master_chapter_and_anti_patterns(tmp_path, monkeypatch):
    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    csv_dir = tmp_path / "csv"
    csv_dir.mkdir()
    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "题材别名", "核心调性",
            "节奏策略", "强制禁忌/毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "write",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻退婚流",
                "意图与同义词": "退婚流",
                "适用题材": "玄幻",
                "大模型指令": "先压后爆",
                "核心摘要": "退婚起手",
                "详细展开": "",
                "题材/流派": "玄幻退婚流",
                "题材别名": "退婚流",
                "核心调性": "先压后爆",
                "节奏策略": "三章内反打",
                "强制禁忌/毒点": "打脸不能软收尾",
                "推荐基础检索表": "命名规则",
                "推荐动态检索表": "桥段套路",
                "默认查询词": "退婚|打脸",
            }
        ],
    )
    _write_csv(csv_dir / "命名规则.csv", ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"], [])
    _write_csv(csv_dir / "桥段套路.csv", ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "忌讳写法"], [])

    from story_system import main

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "story_system",
            "玄幻退婚流",
            "--project-root",
            str(project_root),
            "--chapter",
            "1",
            "--persist",
            "--csv-dir",
            str(csv_dir),
            "--format",
            "both",
        ],
    )
    main()

    story_root = project_root / ".story-system"
    assert (story_root / "MASTER_SETTING.json").is_file()
    assert (story_root / "MASTER_SETTING.md").is_file()
    assert (story_root / "anti_patterns.json").is_file()
    assert (story_root / "chapters" / "chapter_001.json").is_file()
    assert (story_root / "chapters" / "chapter_001.md").is_file()

    payload = json.loads((story_root / "MASTER_SETTING.json").read_text(encoding="utf-8"))
    assert payload["route"]["primary_genre"] == "玄幻退婚流"


def test_markdown_writer_preserves_manual_notes_outside_markers(tmp_path):
    from data_modules.story_contracts import write_marked_markdown

    target = tmp_path / "MASTER_SETTING.md"
    target.write_text(
        "# 手工说明\n手工备注\n<!-- STORY-SYSTEM:BEGIN -->\n旧内容\n<!-- STORY-SYSTEM:END -->\n",
        encoding="utf-8",
    )

    write_marked_markdown(target, "## Auto\n新内容\n")

    text = target.read_text(encoding="utf-8")
    assert "# 手工说明" in text
    assert "手工备注" in text
    assert "## Auto" in text
    assert "旧内容" not in text


def test_story_system_default_csv_dir_routes_real_genre_seed(tmp_path, monkeypatch, capsys):
    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    from story_system import main

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "story_system",
            "玄幻退婚流",
            "--project-root",
            str(project_root),
            "--format",
            "json",
        ],
    )
    main()

    payload = json.loads(capsys.readouterr().out)
    assert payload["master_setting"]["route"]["primary_genre"] == "玄幻退婚流"
    assert payload["master_setting"]["route"]["route_source"] != "empty_csv_fallback"


def test_story_system_warns_on_placeholder_query(tmp_path, monkeypatch, capsys):
    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    csv_dir = tmp_path / "csv"
    csv_dir.mkdir()
    _write_csv(csv_dir / "题材与调性推理.csv", ["编号", "关键词"], [])

    from story_system import main

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "story_system",
            "{章纲目标}",
            "--project-root",
            str(project_root),
            "--chapter",
            "1",
            "--csv-dir",
            str(csv_dir),
            "--format",
            "json",
        ],
    )
    with pytest.raises(SystemExit) as exc:
        main()

    assert exc.value.code == 2

    captured = capsys.readouterr()
    assert "placeholder" in captured.err
    assert "无法匹配 story-system 题材路由" in captured.err


def test_story_system_persist_unroutable_exits_without_contracts(tmp_path, monkeypatch, capsys):
    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    csv_dir = tmp_path / "csv"
    csv_dir.mkdir()
    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻退婚流",
                "意图与同义词": "退婚流",
                "适用题材": "玄幻",
                "大模型指令": "",
                "核心摘要": "",
                "详细展开": "",
                "题材/流派": "玄幻退婚流",
                "canonical_genre": "玄幻",
                "题材别名": "退婚流",
                "核心调性": "",
                "节奏策略": "",
                "毒点": "",
                "推荐基础检索表": "命名规则",
                "推荐动态检索表": "桥段套路",
                "默认查询词": "",
            }
        ],
    )

    from story_system import main

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "story_system",
            "rules-mystery",
            "--genre",
            "rules-mystery",
            "--project-root",
            str(project_root),
            "--persist",
            "--csv-dir",
            str(csv_dir),
            "--format",
            "json",
        ],
    )
    with pytest.raises(SystemExit) as exc:
        main()

    assert exc.value.code == 2
    captured = capsys.readouterr()
    assert "rules-mystery" in captured.err
    assert "规则怪谈" in captured.err
    assert not (project_root / ".story-system").exists()
