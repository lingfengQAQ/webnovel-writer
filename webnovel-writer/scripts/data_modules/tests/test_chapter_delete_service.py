#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


_ensure_scripts_on_path()

from data_modules.chapter_delete_service import ChapterDeleteError, ChapterDeleteService  # noqa: E402
from data_modules.config import DataModulesConfig  # noqa: E402
from data_modules.index_manager import IndexManager  # noqa: E402
from data_modules.memory.schema import MemoryItem, ScratchpadData  # noqa: E402
from data_modules.memory.store import ScratchpadManager  # noqa: E402


def test_parse_chapter_spec_supports_lists_ranges_and_chinese_separators(tmp_path):
    service = ChapterDeleteService(tmp_path)

    assert service.parse_chapter_spec(" 1，3; 5-7、3 ") == [1, 3, 5, 6, 7]


@pytest.mark.parametrize("spec", ["", "0", "3-1", "-1", "1,,x", "1--3"])
def test_parse_chapter_spec_rejects_invalid_input(tmp_path, spec):
    service = ChapterDeleteService(tmp_path)

    with pytest.raises(ChapterDeleteError):
        service.parse_chapter_spec(spec)


def test_apply_requires_yes_unless_dry_run(tmp_path):
    project_root = _build_delete_project(tmp_path)
    service = ChapterDeleteService(project_root)

    plan = service.apply([1], dry_run=True)
    assert plan["dry_run"] is True
    assert plan["applied"] is False

    with pytest.raises(ChapterDeleteError):
        service.apply([1])


def test_chapter_delete_service_dry_run_reports_without_mutating(tmp_path):
    project_root = _build_delete_project(tmp_path)
    service = ChapterDeleteService(project_root)

    result = service.apply(service.parse_chapter_spec("1"), dry_run=True)

    assert result["ok"] is not False if "ok" in result else True
    assert result["files"]["chapter_text"]
    assert result["sqlite"]["index_db"]["chapters"] == 1
    assert result["sqlite"]["vectors_db"]["chunks"] == 1
    assert result["memory"]["items_removed"] == 1
    assert result["state"]["current_chapter_before"] == 2
    assert result["state"]["current_chapter_after"] == 2
    assert (project_root / "正文" / "第0001章.md").exists()
    with sqlite3.connect(project_root / ".webnovel" / "index.db") as conn:
        assert conn.execute("SELECT COUNT(*) FROM chapters WHERE chapter = 1").fetchone()[0] == 1


def test_chapter_delete_service_deletes_related_artifacts_and_preserves_survivors(tmp_path):
    project_root = _build_delete_project(tmp_path)
    service = ChapterDeleteService(project_root)

    result = service.apply([1], yes=True)

    assert result["applied"] is True
    assert result["deleted"]["vectors_db"]["chunks"] == 1
    assert result["deleted"]["index_db"]["chapters"] == 1
    assert result["deleted"]["memory"]["items_removed"] == 1
    assert not (project_root / "正文" / "第0001章.md").exists()
    assert (project_root / "正文" / "第0002章.md").exists()
    assert not (project_root / ".story-system" / "chapters" / "chapter_001.json").exists()
    assert not (project_root / ".story-system" / "reviews" / "chapter_001.review.json").exists()
    assert not (project_root / ".story-system" / "commits" / "chapter_001.commit.json").exists()
    assert not (project_root / ".story-system" / "events" / "chapter_001.events.json").exists()
    assert not (project_root / ".webnovel" / "summaries" / "ch0001.md").exists()

    state = json.loads((project_root / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert state["progress"]["current_chapter"] == 2
    assert state["progress"]["total_words"] == len("第二章内容")
    assert "1" not in state["progress"]["chapter_status"]
    assert state["progress"]["chapter_status"]["2"] == "chapter_committed"
    assert state["strand_tracker"]["history"] == [{"chapter": 2, "dominant": "fire"}]
    assert "old_only" not in state["entity_state"]
    assert "shared" in state["entity_state"]

    memory = json.loads((project_root / ".webnovel" / "memory_scratchpad.json").read_text(encoding="utf-8"))
    source_chapters = [item["source_chapter"] for item in memory["story_facts"]]
    assert source_chapters == [2]

    with sqlite3.connect(project_root / ".webnovel" / "index.db") as conn:
        assert conn.execute("SELECT chapter FROM chapters ORDER BY chapter").fetchall() == [(2,)]
        assert conn.execute("SELECT entity_id, chapter FROM appearances ORDER BY entity_id").fetchall() == [("shared", 2)]
        assert conn.execute("SELECT id FROM entities ORDER BY id").fetchall() == [("shared",)]
        assert conn.execute("SELECT alias FROM aliases ORDER BY alias").fetchall() == [("共享",)]
        assert conn.execute("SELECT from_entity, to_entity, type, description, chapter FROM relationships").fetchall() == [
            ("shared", "ally", "同伴", "保留关系", 2)
        ]
        assert conn.execute("SELECT from_entity, to_entity, chapter FROM relationship_events").fetchall() == [("shared", "ally", 2)]
        assert conn.execute("SELECT chapter FROM story_events").fetchall() == [(2,)]
        assert conn.execute("SELECT start_chapter, end_chapter FROM review_metrics").fetchall() == [(2, 2)]

    with sqlite3.connect(project_root / ".webnovel" / "vectors.db") as conn:
        assert conn.execute("SELECT chunk_id, chapter FROM vectors").fetchall() == [("ch0002_s1", 2)]
        assert conn.execute("SELECT chunk_id FROM bm25_index").fetchall() == [("ch0002_s1",)]
        assert conn.execute("SELECT chunk_id FROM doc_stats").fetchall() == [("ch0002_s1",)]


def _build_delete_project(tmp_path: Path) -> Path:
    project_root = (tmp_path / "book").resolve()
    cfg = DataModulesConfig.from_project_root(project_root)
    cfg.ensure_dirs()
    IndexManager(cfg)

    (project_root / "正文").mkdir(parents=True, exist_ok=True)
    (project_root / "正文" / "第0001章.md").write_text("第一章内容", encoding="utf-8")
    (project_root / "正文" / "第0002章.md").write_text("第二章内容", encoding="utf-8")

    cfg.state_file.write_text(
        json.dumps(
            {
                "progress": {
                    "current_chapter": 2,
                    "total_words": 999,
                    "chapter_status": {"1": "chapter_committed", "2": "chapter_committed"},
                },
                "entity_state": {"old_only": {"name": "旧人"}, "shared": {"name": "共享"}},
                "strand_tracker": {
                    "history": [
                        {"chapter": 1, "strand": "quest"},
                        {"chapter": 2, "strand": "fire"},
                    ],
                    "current_dominant": "fire",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    for subdir, suffix in [
        ("chapters", "json"),
        ("reviews", "review.json"),
        ("commits", "commit.json"),
        ("events", "events.json"),
    ]:
        root = project_root / ".story-system" / subdir
        root.mkdir(parents=True, exist_ok=True)
        (root / f"chapter_001.{suffix}").write_text("{}", encoding="utf-8")
        (root / f"chapter_002.{suffix}").write_text("{}", encoding="utf-8")
    summary_dir = cfg.webnovel_dir / "summaries"
    summary_dir.mkdir(parents=True, exist_ok=True)
    (summary_dir / "ch0001.md").write_text("旧摘要", encoding="utf-8")
    (summary_dir / "ch0002.md").write_text("新摘要", encoding="utf-8")

    ScratchpadManager(cfg).save(
        ScratchpadData(
            story_facts=[
                MemoryItem(id="old", layer="episodic", category="story_fact", subject="old", field="fact", value="old", source_chapter=1),
                MemoryItem(id="keep", layer="episodic", category="story_fact", subject="keep", field="fact", value="keep", source_chapter=2),
            ]
        )
    )
    _seed_index(project_root)
    _seed_vectors(project_root)
    return project_root


def _seed_index(project_root: Path) -> None:
    db_path = project_root / ".webnovel" / "index.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO chapters(chapter, title, word_count) VALUES (1, '旧章', 4), (2, '新章', 4)")
        conn.execute("INSERT INTO scenes(chapter, scene_index) VALUES (1, 1), (2, 1)")
        conn.execute("INSERT INTO entities(id, type, canonical_name, first_appearance, last_appearance) VALUES ('old_only', '角色', '旧人', 1, 1)")
        conn.execute("INSERT INTO entities(id, type, canonical_name, first_appearance, last_appearance) VALUES ('shared', '角色', '共享', 1, 2)")
        conn.execute("INSERT INTO aliases(alias, entity_id, entity_type) VALUES ('旧人', 'old_only', '角色'), ('共享', 'shared', '角色')")
        conn.execute("INSERT INTO appearances(entity_id, chapter) VALUES ('old_only', 1), ('shared', 1), ('shared', 2)")
        conn.execute("INSERT INTO state_changes(entity_id, field, new_value, chapter) VALUES ('old_only', 'power', '旧', 1), ('shared', 'power', '低', 1), ('shared', 'power', '高', 2)")
        conn.execute("INSERT INTO relationships(from_entity, to_entity, type, description, chapter) VALUES ('old_only', 'shared', '敌对', '旧关系', 1)")
        conn.execute("INSERT INTO relationships(from_entity, to_entity, type, description, chapter) VALUES ('shared', 'ally', '同伴', '保留关系', 2)")
        conn.execute("INSERT INTO relationship_events(from_entity, to_entity, type, action, description, chapter) VALUES ('old_only', 'shared', '敌对', 'update', '旧关系', 1)")
        conn.execute("INSERT INTO relationship_events(from_entity, to_entity, type, action, description, chapter) VALUES ('shared', 'ally', '同伴', 'update', '保留关系', 2)")
        conn.execute("CREATE TABLE IF NOT EXISTS story_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, chapter INTEGER, event_type TEXT, subject TEXT, payload_json TEXT)")
        conn.execute("INSERT INTO story_events(event_id, chapter, event_type, subject) VALUES ('old', 1, 'x', 'old'), ('keep', 2, 'x', 'keep')")
        conn.execute("INSERT INTO review_metrics(start_chapter, end_chapter) VALUES (1, 1), (2, 2)")
        conn.commit()


def _seed_vectors(project_root: Path) -> None:
    db_path = project_root / ".webnovel" / "vectors.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE vectors (
                chunk_id TEXT PRIMARY KEY,
                chapter INTEGER,
                scene_index INTEGER,
                content TEXT,
                embedding BLOB,
                parent_chunk_id TEXT,
                chunk_type TEXT,
                source_file TEXT
            )
            """
        )
        conn.execute("CREATE TABLE bm25_index(term TEXT, chunk_id TEXT, tf INTEGER)")
        conn.execute("CREATE TABLE doc_stats(chunk_id TEXT PRIMARY KEY, doc_length INTEGER)")
        conn.execute("INSERT INTO vectors(chunk_id, chapter, source_file) VALUES ('ch0001_s1', 1, '正文/第0001章.md')")
        conn.execute("INSERT INTO vectors(chunk_id, chapter, source_file) VALUES ('ch0002_s1', 2, '正文/第0002章.md')")
        conn.execute("INSERT INTO bm25_index(term, chunk_id, tf) VALUES ('a', 'ch0001_s1', 1), ('b', 'ch0002_s1', 1)")
        conn.execute("INSERT INTO doc_stats(chunk_id, doc_length) VALUES ('ch0001_s1', 1), ('ch0002_s1', 1)")
        conn.commit()
