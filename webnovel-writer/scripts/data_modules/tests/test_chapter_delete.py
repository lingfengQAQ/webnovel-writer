#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


_ensure_scripts_on_path()

from chapter_delete import delete_chapters, parse_chapter_spec  # noqa: E402
from data_modules.config import DataModulesConfig  # noqa: E402
from data_modules.event_log_store import EventLogStore  # noqa: E402
from data_modules.index_manager import IndexManager  # noqa: E402
from data_modules.index_projection_writer import IndexProjectionWriter  # noqa: E402
from data_modules.memory_projection_writer import MemoryProjectionWriter  # noqa: E402
from data_modules.state_projection_writer import StateProjectionWriter  # noqa: E402
from data_modules.summary_projection_writer import SummaryProjectionWriter  # noqa: E402


def test_parse_chapter_spec_supports_commas_and_ranges():
    assert parse_chapter_spec("1, 3，5-7") == [1, 3, 5, 6, 7]


def test_delete_chapters_removes_artifacts_and_rebuilds_read_models(tmp_path):
    project_root = (tmp_path / "book").resolve()
    cfg = DataModulesConfig.from_project_root(project_root)
    cfg.ensure_dirs()

    (project_root / ".webnovel" / "state.json").write_text(
        json.dumps(
            {
                "progress": {
                    "current_chapter": 2,
                    "total_words": 99,
                    "chapter_status": {"1": "chapter_committed", "2": "chapter_committed"},
                    "volumes_planned": [{"volume": 1, "chapters_range": "1-20"}],
                },
                "protagonist_state": {
                    "name": "陆鸣",
                    "entity_id": "luming",
                    "power": {"realm": "旧境界"},
                },
                "entity_state": {"luming": {"power": {"realm": "旧境界"}}},
                "chapter_meta": {"1": {"title": "旧章"}, "2": {"title": "保留章"}},
                "plot_threads": {
                    "foreshadowing": [
                        {"id": "old", "planted_chapter": 1},
                        {"id": "keep", "planted_chapter": 2},
                    ]
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    chapters_dir = project_root / "正文"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter1_file = chapters_dir / "第0001章.md"
    chapter2_file = chapters_dir / "第0002章.md"
    chapter1_file.write_text("第一章内容", encoding="utf-8")
    chapter2_file.write_text("第二章内容", encoding="utf-8")

    commits_dir = project_root / ".story-system" / "commits"
    chapters_contract_dir = project_root / ".story-system" / "chapters"
    reviews_dir = project_root / ".story-system" / "reviews"
    commits_dir.mkdir(parents=True, exist_ok=True)
    chapters_contract_dir.mkdir(parents=True, exist_ok=True)
    reviews_dir.mkdir(parents=True, exist_ok=True)

    commit1 = _commit_payload(1, "炼气一层", "旧关系")
    commit2 = _commit_payload(2, "炼气二层", "新关系")
    (commits_dir / "chapter_001.commit.json").write_text(
        json.dumps(commit1, ensure_ascii=False),
        encoding="utf-8",
    )
    (commits_dir / "chapter_002.commit.json").write_text(
        json.dumps(commit2, ensure_ascii=False),
        encoding="utf-8",
    )
    (chapters_contract_dir / "chapter_001.json").write_text("{}", encoding="utf-8")
    (reviews_dir / "chapter_001.review.json").write_text("{}", encoding="utf-8")

    for payload in (commit1, commit2):
        StateProjectionWriter(project_root).apply(payload)
        EventLogStore(project_root).write_events(
            int(payload["meta"]["chapter"]),
            payload.get("accepted_events") or [],
        )
        IndexProjectionWriter(project_root).apply(payload)
        SummaryProjectionWriter(project_root).apply(payload)
        MemoryProjectionWriter(project_root).apply(payload)

    report_dir = project_root / "审查报告"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "第1章.md").write_text("旧审查", encoding="utf-8")

    tmp_dir = project_root / ".webnovel" / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    (tmp_dir / "review_ch0001.json").write_text("{}", encoding="utf-8")

    _seed_auxiliary_tables(project_root)
    _seed_vectors(project_root)
    _seed_project_memory(project_root)
    _seed_observability(project_root)

    result = delete_chapters(project_root, [1])

    assert result["ok"] is True
    assert result["vector_chunks_removed"] == 1
    assert result["commits_replayed"] == 1

    assert not chapter1_file.exists()
    assert chapter2_file.exists()
    assert not (commits_dir / "chapter_001.commit.json").exists()
    assert (commits_dir / "chapter_002.commit.json").exists()
    assert not (project_root / ".story-system" / "events" / "chapter_001.events.json").exists()
    assert (project_root / ".story-system" / "events" / "chapter_002.events.json").exists()
    assert not (chapters_contract_dir / "chapter_001.json").exists()
    assert not (reviews_dir / "chapter_001.review.json").exists()
    assert not (project_root / ".webnovel" / "summaries" / "ch0001.md").exists()
    assert (project_root / ".webnovel" / "summaries" / "ch0002.md").exists()
    assert not (report_dir / "第1章.md").exists()
    assert not (tmp_dir / "review_ch0001.json").exists()

    state = json.loads((project_root / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert state["progress"]["current_chapter"] == 2
    assert "1" not in state["progress"]["chapter_status"]
    assert state["progress"]["chapter_status"]["2"] == "chapter_committed"
    assert state["protagonist_state"]["power"]["realm"] == "炼气二层"
    assert "1" not in state.get("chapter_meta", {})
    assert state["plot_threads"]["foreshadowing"] == [{"id": "keep", "planted_chapter": 2}]

    memory = json.loads((project_root / ".webnovel" / "memory_scratchpad.json").read_text(encoding="utf-8"))
    source_chapters = {
        item.get("source_chapter")
        for bucket, rows in memory.items()
        if isinstance(rows, list)
        for item in rows
        if isinstance(item, dict)
    }
    assert 1 not in source_chapters
    assert 2 in source_chapters

    project_memory = json.loads((project_root / ".webnovel" / "project_memory.json").read_text(encoding="utf-8"))
    assert [row["source_chapter"] for row in project_memory["patterns"]] == [2]

    with sqlite3.connect(project_root / ".webnovel" / "index.db") as conn:
        assert conn.execute("SELECT chapter FROM chapters").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM scenes").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM appearances").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM state_changes").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM story_events").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM relationships").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM chapter_reading_power").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM writing_checklist_scores").fetchall() == [(2,)]
        assert conn.execute("SELECT start_chapter, end_chapter FROM review_metrics").fetchall() == [(2, 2)]
        assert conn.execute("SELECT chapter FROM rag_query_log").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter FROM tool_call_stats").fetchall() == [(2,)]
        assert conn.execute("SELECT chapter_discovered FROM invalid_facts").fetchall() == [(2,)]

    with sqlite3.connect(project_root / ".webnovel" / "vectors.db") as conn:
        assert conn.execute("SELECT chunk_id, chapter FROM vectors").fetchall() == [("ch0002_s1", 2)]
        assert conn.execute("SELECT chunk_id FROM bm25_index").fetchall() == [("ch0002_s1",)]
        assert conn.execute("SELECT chunk_id FROM doc_stats").fetchall() == [("ch0002_s1",)]

    observability = (project_root / ".webnovel" / "observability" / "trace.jsonl").read_text(encoding="utf-8")
    assert '"chapter": 1' not in observability
    assert '"chapter": 2' in observability


def _commit_payload(chapter: int, realm: str, relation_description: str) -> dict:
    return {
        "meta": {
            "schema_version": "story-system/v1",
            "chapter": chapter,
            "status": "accepted",
        },
        "state_deltas": [
            {
                "entity_id": "luming",
                "field": "power.realm",
                "old": "",
                "new": realm,
                "reason": "test",
                "chapter": chapter,
            }
        ],
        "entity_deltas": [
            {
                "entity_id": "luming",
                "canonical_name": "陆鸣",
                "type": "角色",
                "tier": "主角",
                "is_protagonist": True,
                "current": {"power.realm": realm},
                "chapter": chapter,
            },
            {
                "from_entity": "luming",
                "to_entity": "yaolao",
                "relationship_type": relation_description,
                "description": relation_description,
                "chapter": chapter,
            },
        ],
        "entities_appeared": [
            {"entity_id": "luming", "mentions": ["陆鸣"], "confidence": 1.0},
        ],
        "scenes": [
            {
                "scene_index": 1,
                "start_line": 1,
                "end_line": 2,
                "location": f"地点{chapter}",
                "summary": f"事件{chapter}",
                "characters": ["luming"],
            }
        ],
        "chapter_meta": {
            "title": f"第{chapter}章",
            "word_count": 4,
            "characters": ["luming"],
            "hook": f"钩子{chapter}",
        },
        "accepted_events": [
            {
                "event_id": f"evt-{chapter}-state",
                "chapter": chapter,
                "event_type": "character_state_changed",
                "subject": "luming",
                "payload": {
                    "entity_id": "luming",
                    "field": "power.realm",
                    "old": "",
                    "new": realm,
                },
            }
        ],
        "summary_text": f"第{chapter}章摘要",
        "projection_status": {},
    }


def _seed_auxiliary_tables(project_root: Path) -> None:
    manager = IndexManager(DataModulesConfig.from_project_root(project_root))
    with manager._get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO chapter_reading_power(chapter, hook_type) VALUES (1, 'old'), (2, 'keep')"
        )
        conn.execute(
            "INSERT OR REPLACE INTO writing_checklist_scores(chapter, template) VALUES (1, 'old'), (2, 'keep')"
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO review_metrics(start_chapter, end_chapter, overall_score, report_file)
            VALUES (1, 1, 50, '审查报告/第1章.md'), (2, 2, 90, '审查报告/第2章.md')
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO rag_query_log(id, query, chapter) VALUES (1, 'old', 1), (2, 'keep', 2)"
        )
        conn.execute(
            "INSERT OR REPLACE INTO tool_call_stats(id, tool_name, chapter) VALUES (1, 'old', 1), (2, 'keep', 2)"
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO invalid_facts(id, source_type, source_id, reason, marked_by, chapter_discovered)
            VALUES (1, 'entity', 'old', 'bad', 'test', 1), (2, 'entity', 'keep', 'bad', 'test', 2)
            """
        )
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
                source_file TEXT,
                created_at TEXT
            )
            """
        )
        conn.execute("CREATE TABLE bm25_index(term TEXT, chunk_id TEXT, tf INTEGER)")
        conn.execute("CREATE TABLE doc_stats(chunk_id TEXT PRIMARY KEY, doc_length INTEGER)")
        conn.execute(
            "INSERT INTO vectors(chunk_id, chapter, source_file) VALUES ('ch0001_s1', 1, '正文/第0001章.md')"
        )
        conn.execute(
            "INSERT INTO vectors(chunk_id, chapter, source_file) VALUES ('ch0002_s1', 2, '正文/第0002章.md')"
        )
        conn.execute("INSERT INTO bm25_index(term, chunk_id, tf) VALUES ('a', 'ch0001_s1', 1), ('b', 'ch0002_s1', 1)")
        conn.execute("INSERT INTO doc_stats(chunk_id, doc_length) VALUES ('ch0001_s1', 1), ('ch0002_s1', 1)")
        conn.commit()


def _seed_project_memory(project_root: Path) -> None:
    (project_root / ".webnovel" / "project_memory.json").write_text(
        json.dumps(
            {
                "patterns": [
                    {"id": "old", "source_chapter": 1},
                    {"id": "keep", "source_chapter": 2},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _seed_observability(project_root: Path) -> None:
    path = project_root / ".webnovel" / "observability" / "trace.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"chapter": 1, "msg": "old"}, ensure_ascii=False)
        + "\n"
        + json.dumps({"chapter": 2, "msg": "keep"}, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
