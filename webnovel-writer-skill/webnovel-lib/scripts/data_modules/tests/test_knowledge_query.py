#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""KnowledgeQuery 时序查询测试。"""
import json
import sqlite3
from pathlib import Path

import pytest

from data_modules.knowledge_query import KnowledgeQuery


@pytest.fixture
def setup_db(tmp_path):
    db_path = tmp_path / ".webnovel" / "index.db"
    db_path.parent.mkdir(parents=True)

    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            canonical_name TEXT,
            type TEXT DEFAULT '角色',
            current_json TEXT DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS state_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT,
            field TEXT,
            old_value TEXT,
            new_value TEXT,
            chapter INTEGER,
            created_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS relationship_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_entity TEXT,
            to_entity TEXT,
            relationship_type TEXT,
            description TEXT,
            chapter INTEGER,
            created_at TEXT
        )
    """)

    conn.execute(
        "INSERT INTO entities (id, canonical_name, current_json) VALUES (?, ?, ?)",
        ("hanli", "韩立", json.dumps({"realm": "筑基中期", "location": "乱星海"})),
    )
    conn.execute(
        "INSERT INTO state_changes (entity_id, field, old_value, new_value, chapter) VALUES (?, ?, ?, ?, ?)",
        ("hanli", "realm", "练气圆满", "筑基初期", 30),
    )
    conn.execute(
        "INSERT INTO state_changes (entity_id, field, old_value, new_value, chapter) VALUES (?, ?, ?, ?, ?)",
        ("hanli", "realm", "筑基初期", "筑基中期", 50),
    )
    conn.execute(
        "INSERT INTO relationship_events (from_entity, to_entity, relationship_type, chapter) VALUES (?, ?, ?, ?)",
        ("hanli", "陈巧倩", "同门", 20),
    )
    conn.execute(
        "INSERT INTO relationship_events (from_entity, to_entity, relationship_type, chapter) VALUES (?, ?, ?, ?)",
        ("hanli", "陈巧倩", "合作", 45),
    )
    conn.commit()
    conn.close()
    return tmp_path


def test_entity_state_at_chapter_before_first_change(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_state_at_chapter("hanli", 10)
    assert result["entity_id"] == "hanli"
    assert result["state_at_chapter"] == {}


def test_entity_state_at_chapter_after_first_breakthrough(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_state_at_chapter("hanli", 35)
    assert result["state_at_chapter"]["realm"] == "筑基初期"


def test_entity_state_at_chapter_after_second_breakthrough(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_state_at_chapter("hanli", 60)
    assert result["state_at_chapter"]["realm"] == "筑基中期"


def test_relationships_at_chapter_before_any(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_relationships_at_chapter("hanli", 10)
    assert result["relationships"] == []


def test_relationships_at_chapter_after_first(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_relationships_at_chapter("hanli", 25)
    assert len(result["relationships"]) == 1
    assert result["relationships"][0]["to_entity"] == "陈巧倩"
    assert result["relationships"][0]["relationship_type"] == "同门"


def test_relationships_at_chapter_after_update(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_relationships_at_chapter("hanli", 50)
    rels = result["relationships"]
    assert len(rels) == 1
    assert rels[0]["relationship_type"] == "合作"
