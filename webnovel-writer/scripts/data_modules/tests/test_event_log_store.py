#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sqlite3
import sys
from pathlib import Path

import pytest

from data_modules.event_log_store import EventLogStore


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


def test_event_log_store_writes_per_chapter_file_and_sqlite_mirror(tmp_path):
    store = EventLogStore(tmp_path)
    store.write_events(
        3,
        [
            {
                "event_id": "evt-001",
                "chapter": 3,
                "event_type": "open_loop_created",
                "subject": "三年之约",
                "payload": {},
            }
        ],
    )
    assert (tmp_path / ".story-system" / "events" / "chapter_003.events.json").is_file()

    conn = sqlite3.connect(tmp_path / ".webnovel" / "index.db")
    try:
        row = conn.execute(
            "SELECT event_id, chapter, event_type FROM story_events"
        ).fetchone()
    finally:
        conn.close()
    assert row == ("evt-001", 3, "open_loop_created")


def test_event_log_store_generates_missing_event_id_and_chapter(tmp_path):
    store = EventLogStore(tmp_path)
    store.write_events(
        3,
        [
            {
                "event_type": "open_loop_created",
                "subject": "three_year_promise",
                "payload": {"content": "三年之约提及"},
            }
        ],
    )

    events = store.read_events(3)
    assert len(events) == 1
    assert events[0]["event_id"].startswith("evt-ch003-001-")
    assert events[0]["chapter"] == 3
    assert events[0]["event_type"] == "open_loop_created"
    assert events[0]["subject"] == "three_year_promise"


def test_event_log_store_normalizes_llm_alias_event_shape(tmp_path):
    store = EventLogStore(tmp_path)
    store.write_events(
        76,
        [
            {
                "type": "scene_open",
                "characters": ["xiaoyan"],
                "payload": {"content": "萧炎推开石门，新的悬念出现"},
            }
        ],
    )

    events = store.read_events(76)
    assert events[0]["event_type"] == "open_loop_created"
    assert events[0]["subject"] == "xiaoyan"
    assert events[0]["chapter"] == 76
    assert events[0]["event_id"].startswith("evt-ch076-001-")


def test_event_log_store_rejects_unknown_event_type_after_normalization(tmp_path):
    store = EventLogStore(tmp_path)

    with pytest.raises(ValueError, match="event_type"):
        store.write_events(
            3,
            [
                {
                    "event_id": "evt-unknown",
                    "event_type": "not_a_story_event",
                    "subject": "xiaoyan",
                    "payload": {},
                }
            ],
        )


def test_event_log_store_rejects_non_list_event_collection(tmp_path):
    store = EventLogStore(tmp_path)

    with pytest.raises(ValueError, match="accepted_events must be a list"):
        store.write_events(
            3,
            {
                "event_type": "open_loop_created",
                "subject": "three_year_promise",
                "payload": {},
            },
        )


def test_event_log_store_rejects_non_object_event_items(tmp_path):
    store = EventLogStore(tmp_path)

    with pytest.raises(ValueError, match=r"accepted_events\[0\]"):
        store.write_events(3, ["not-a-json-object"])


def test_event_log_store_rejects_blank_event_subject(tmp_path):
    store = EventLogStore(tmp_path)

    with pytest.raises(ValueError, match="subject"):
        store.write_events(
            3,
            [
                {
                    "event_type": "open_loop_created",
                    "subject": "   ",
                    "payload": {"content": "三年之约提及"},
                }
            ],
        )


def test_event_log_store_ignores_duplicate_event_id(tmp_path):
    store = EventLogStore(tmp_path)
    event = {
        "event_id": "evt-001",
        "chapter": 3,
        "event_type": "open_loop_created",
        "subject": "三年之约",
        "payload": {},
    }
    store.write_events(3, [event])
    store.write_events(3, [event])

    conn = sqlite3.connect(tmp_path / ".webnovel" / "index.db")
    try:
        count = conn.execute("SELECT COUNT(*) FROM story_events").fetchone()[0]
    finally:
        conn.close()
    assert count == 1


def test_event_log_store_recent_and_health_use_sqlite_mirror(tmp_path):
    store = EventLogStore(tmp_path)
    store.write_events(
        3,
        [
            {
                "event_id": "evt-003",
                "chapter": 3,
                "event_type": "promise_created",
                "subject": "救人承诺",
                "payload": {"target": "小医仙"},
            }
        ],
    )
    store.write_events(
        4,
        [
            {
                "event_id": "evt-004",
                "chapter": 4,
                "event_type": "promise_paid_off",
                "subject": "救人承诺",
                "payload": {"target": "小医仙"},
            }
        ],
    )

    recent = store.list_recent(limit=10)
    assert [item["event_id"] for item in recent] == ["evt-004", "evt-003"]
    chapter_only = store.list_recent(chapter=3, limit=10)
    assert chapter_only == [
        {
            "event_id": "evt-003",
            "chapter": 3,
            "event_type": "promise_created",
            "subject": "救人承诺",
            "payload": {"target": "小医仙"},
        }
    ]

    health = store.health()
    assert health["ok"] is True
    assert health["sqlite_rows"] == 2
    assert health["event_files"] == 2


def test_event_log_store_recent_and_health_without_table(tmp_path):
    store = EventLogStore(tmp_path)
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    sqlite3.connect(tmp_path / ".webnovel" / "index.db").close()

    assert store.list_recent() == []
    health = store.health()
    assert health["sqlite_rows"] == 0
    assert health["event_files"] == 0


def test_story_events_cli_reads_chapter_file(tmp_path, monkeypatch, capsys):
    _ensure_scripts_on_path()
    events_dir = tmp_path / ".story-system" / "events"
    events_dir.mkdir(parents=True, exist_ok=True)
    (events_dir / "chapter_003.events.json").write_text(
        '[{"event_id":"evt-001","chapter":3,"event_type":"open_loop_created","subject":"三年之约","payload":{}}]',
        encoding="utf-8",
    )

    from story_events import main

    monkeypatch.setattr(
        sys,
        "argv",
        ["story_events", "--project-root", str(tmp_path), "--chapter", "3"],
    )
    main()

    out = capsys.readouterr().out
    assert "open_loop_created" in out
