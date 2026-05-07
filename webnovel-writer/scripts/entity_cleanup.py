#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

from data_modules.config import DataModulesConfig

ASCII_SNAKE = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+){1,}$")


def _looks_dirty(entity_id: str, canonical_name: str) -> bool:
    eid = (entity_id or "").strip().lower()
    name = (canonical_name or "").strip().lower()
    return bool(ASCII_SNAKE.match(eid) or ASCII_SNAKE.match(name))


def main() -> None:
    parser = argparse.ArgumentParser(description="Cleanup dirty entities (snake_case pinyin/english)")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--format", choices=["json", "text"], default="json")
    parser.add_argument("--mark-invalid", action="store_true", help="write invalid_facts rows for dirty entities")
    parser.add_argument("--chapter", type=int, default=None)
    args = parser.parse_args()

    config = DataModulesConfig.from_project_root(Path(args.project_root))
    db_path = Path(config.index_db)
    rows = []
    with sqlite3.connect(str(db_path)) as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, type, canonical_name FROM entities")
        all_rows = cur.fetchall()
        for entity_id, entity_type, canonical_name in all_rows:
            if _looks_dirty(str(entity_id), str(canonical_name or "")):
                rows.append({"id": entity_id, "type": entity_type, "canonical_name": canonical_name})

        marked = 0
        if args.mark_invalid and rows:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS invalid_facts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    marked_by TEXT,
                    chapter INTEGER,
                    status TEXT DEFAULT 'pending',
                    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMP
                )
                """
            )
            for item in rows:
                cur.execute(
                    "INSERT INTO invalid_facts (source_type, source_id, reason, marked_by, chapter, status) VALUES (?, ?, ?, ?, ?, 'pending')",
                    ("entity", item["id"], "dirty_ascii_snake_entity", "entity_cleanup", args.chapter),
                )
                marked += 1
            conn.commit()

    payload = {"dirty_entities": rows, "count": len(rows), "marked_invalid": marked}
    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"dirty_entities={len(rows)} marked_invalid={marked}")
        for item in rows:
            print(f"- {item['id']} ({item['canonical_name']})")


if __name__ == "__main__":
    main()
