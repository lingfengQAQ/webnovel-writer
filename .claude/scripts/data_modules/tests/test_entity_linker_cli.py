#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EntityLinker extra tests + CLI
"""

import sys

import pytest

from data_modules.entity_linker import EntityLinker, main as linker_main
from data_modules.index_manager import IndexManager, EntityMeta


@pytest.fixture
def temp_project(tmp_path):
    from data_modules.config import DataModulesConfig
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    return cfg


def test_process_extraction_and_register_new_entities(temp_project):
    linker = EntityLinker(temp_project)
    idx = IndexManager(temp_project)
    idx.upsert_entity(
        EntityMeta(
            id="xiaoyan",
            type="角色",
            canonical_name="萧炎",
            current={},
            first_appearance=1,
            last_appearance=1,
        )
    )

    results, warnings = linker.process_extraction_result(
        [
            {
                "mention": "萧炎",
                "candidates": ["xiaoyan"],
                "suggested": "xiaoyan",
                "confidence": 0.7,
            },
            {
                "mention": "宗主",
                "candidates": ["zongzhu"],
                "suggested": "zongzhu",
                "confidence": 0.4,
            },
        ]
    )

    assert len(results) == 2
    assert len(warnings) == 2

    registered = linker.register_new_entities(
        [
            {
                "suggested_id": "hongyi",
                "name": "红衣女子",
                "type": "角色",
                "mentions": ["红衣", "女子"],
            }
        ]
    )
    assert registered == ["hongyi"]
    aliases = idx.get_entity_aliases("hongyi")
    assert "红衣女子" in aliases


def test_entity_linker_cli(temp_project, monkeypatch, capsys):
    idx = IndexManager(temp_project)
    idx.upsert_entity(
        EntityMeta(
            id="xiaoyan",
            type="角色",
            canonical_name="萧炎",
            current={},
            first_appearance=1,
            last_appearance=1,
        )
    )

    def run_cli(args):
        monkeypatch.setattr(sys, "argv", ["entity_linker"] + args)
        linker_main()

    root = str(temp_project.project_root)

    run_cli(["--project-root", root, "register-alias", "--entity", "xiaoyan", "--alias", "炎帝"])
    run_cli(["--project-root", root, "lookup", "--mention", "炎帝"])
    run_cli(["--project-root", root, "lookup", "--mention", "不存在"])
    run_cli(["--project-root", root, "lookup-all", "--mention", "炎帝"])
    run_cli(["--project-root", root, "list-aliases", "--entity", "xiaoyan"])

    capsys.readouterr()
