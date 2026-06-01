#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .config import DataModulesConfig
from .story_contracts import StoryContractPaths, read_json_if_exists, write_json

try:
    from chapter_paths import find_chapter_file
except ImportError:  # pragma: no cover
    from scripts.chapter_paths import find_chapter_file


class ChapterDeleteError(ValueError):
    pass


_CHAPTER_SPLIT_RE = re.compile(r"[，,；;、\s]+")
_CHAPTER_RANGE_RE = re.compile(r"^(\d+)\s*-\s*(\d+)$")
_CHAPTER_SINGLE_RE = re.compile(r"^\d+$")


class ChapterDeleteService:
    def __init__(self, project_root: str | Path):
        self.project_root = Path(project_root).expanduser().resolve()
        self.config = DataModulesConfig.from_project_root(self.project_root)

    def parse_chapter_spec(self, spec: str) -> list[int]:
        text = str(spec or "").strip()
        if not text:
            raise ChapterDeleteError("章节参数不能为空")

        chapters: set[int] = set()
        for token in _CHAPTER_SPLIT_RE.split(text):
            token = token.strip()
            if not token:
                continue
            range_match = _CHAPTER_RANGE_RE.match(token)
            if range_match:
                start = int(range_match.group(1))
                end = int(range_match.group(2))
                if start <= 0 or end <= 0:
                    raise ChapterDeleteError(f"章节号必须为正整数: {token}")
                if start > end:
                    raise ChapterDeleteError(f"章节范围不能倒序: {token}")
                chapters.update(range(start, end + 1))
                continue
            if _CHAPTER_SINGLE_RE.match(token):
                chapter = int(token)
                if chapter <= 0:
                    raise ChapterDeleteError(f"章节号必须为正整数: {token}")
                chapters.add(chapter)
                continue
            raise ChapterDeleteError(f"无法解析章节参数: {token}")

        if not chapters:
            raise ChapterDeleteError("章节参数不能为空")
        return sorted(chapters)

    def build_plan(self, chapters: Iterable[int]) -> dict[str, Any]:
        chapter_list = sorted({int(ch) for ch in chapters if int(ch) > 0})
        if not chapter_list:
            raise ChapterDeleteError("章节列表不能为空")

        file_plan = self._build_file_plan(chapter_list)
        index_counts, impacted = self._inspect_index_db(chapter_list)
        vector_counts = self._inspect_vectors_db(chapter_list)
        memory_counts = self._inspect_memory(chapter_list)
        state_preview = self._preview_state(chapter_list)
        warnings = self._build_warnings(chapter_list, state_preview)

        return {
            "chapters": chapter_list,
            "mode": "tail_truncate" if self._is_tail_truncate(chapter_list, state_preview) else "non_tail_delete",
            "warnings": warnings,
            "files": file_plan,
            "sqlite": {
                "index_db": index_counts,
                "vectors_db": vector_counts,
            },
            "memory": memory_counts,
            "state": state_preview,
            "entities": impacted.get("entities", {}),
        }

    def apply(self, chapters: Iterable[int], *, dry_run: bool = False, yes: bool = False) -> dict[str, Any]:
        chapter_list = sorted({int(ch) for ch in chapters if int(ch) > 0})
        plan = self.build_plan(chapter_list)
        if dry_run:
            return {**plan, "dry_run": True, "applied": False}
        if not yes:
            raise ChapterDeleteError("删除是破坏性操作，请先 --dry-run，再使用 --yes 确认执行")

        result = {**plan, "dry_run": False, "applied": True, "deleted": {}}
        result["deleted"]["vectors_db"] = self._delete_vectors(chapter_list)
        result["deleted"]["index_db"] = self._delete_index_rows(chapter_list)
        result["deleted"]["memory"] = self._delete_memory(chapter_list)
        result["deleted"]["files"] = self._delete_files(plan["files"])
        result["deleted"]["state"] = self._update_state(chapter_list, plan["state"])
        return result

    def _build_file_plan(self, chapters: list[int]) -> dict[str, list[str]]:
        paths: dict[str, list[str]] = {
            "chapter_text": [],
            "summaries": [],
            "story_system": [],
            "review_reports": [],
            "missing_chapter_text": [],
        }
        contracts = StoryContractPaths.from_project_root(self.project_root)
        review_dir = self.project_root / "审查报告"

        for chapter in chapters:
            chapter_file = find_chapter_file(self.project_root, chapter)
            if chapter_file:
                paths["chapter_text"].append(str(chapter_file))
            else:
                paths["missing_chapter_text"].append(f"第{chapter:04d}章")

            summary_path = self.config.webnovel_dir / "summaries" / f"ch{chapter:04d}.md"
            if summary_path.exists():
                paths["summaries"].append(str(summary_path))

            candidates = [
                contracts.chapter_json(chapter),
                contracts.chapters_dir / f"chapter_{chapter:03d}.md",
                contracts.review_json(chapter),
                contracts.commit_json(chapter),
                contracts.event_json(chapter),
            ]
            paths["story_system"].extend(str(path) for path in candidates if path.exists())

            if review_dir.is_dir():
                patterns = [
                    f"第{chapter}章*.md",
                    f"第{chapter:03d}章*.md",
                    f"第{chapter:04d}章*.md",
                ]
                seen = set(paths["review_reports"])
                for pattern in patterns:
                    for path in sorted(review_dir.glob(pattern)):
                        if path.is_file() and str(path) not in seen:
                            paths["review_reports"].append(str(path))
                            seen.add(str(path))

        return paths

    def _inspect_index_db(self, chapters: list[int]) -> tuple[dict[str, int], dict[str, Any]]:
        counts: dict[str, int] = {}
        impacted = {"entities": {"delete_candidates": [], "recompute_candidates": []}}
        db_path = self.config.index_db
        if not db_path.exists():
            return counts, impacted

        with sqlite3.connect(str(db_path)) as conn:
            conn.row_factory = sqlite3.Row
            direct_tables = {
                "chapters": "chapter",
                "scenes": "chapter",
                "appearances": "chapter",
                "state_changes": "chapter",
                "relationships": "chapter",
                "relationship_events": "chapter",
                "story_events": "chapter",
                "chapter_reading_power": "chapter",
                "writing_checklist_scores": "chapter",
                "rag_query_log": "chapter",
                "tool_call_stats": "chapter",
                "invalid_facts": "chapter_discovered",
                "override_contracts": "chapter",
                "debt_events": "chapter",
            }
            for table, column in direct_tables.items():
                counts[table] = self._count_where_in(conn, table, column, chapters)

            counts["review_metrics"] = self._count_review_metrics(conn, chapters)
            counts["chase_debt"] = self._count_where_in(conn, "chase_debt", "source_chapter", chapters)

            impacted_ids = self._collect_impacted_entities(conn, chapters)
            for entity_id in impacted_ids:
                if self._entity_has_refs_after_delete(conn, entity_id, chapters):
                    impacted["entities"]["recompute_candidates"].append(entity_id)
                else:
                    impacted["entities"]["delete_candidates"].append(entity_id)
        return counts, impacted

    def _inspect_vectors_db(self, chapters: list[int]) -> dict[str, int]:
        db_path = self.config.vector_db
        if not db_path.exists():
            return {}
        with sqlite3.connect(str(db_path)) as conn:
            chunk_ids = self._vector_chunk_ids(conn, chapters)
            return {
                "vectors": self._count_where_in(conn, "vectors", "chapter", chapters),
                "bm25_index": self._count_chunks(conn, "bm25_index", chunk_ids, chapters),
                "doc_stats": self._count_chunks(conn, "doc_stats", chunk_ids, chapters),
                "chunks": len(chunk_ids),
            }

    def _inspect_memory(self, chapters: list[int]) -> dict[str, int]:
        try:
            from .memory.store import ScratchpadManager
            from .memory.schema import BUCKET_TO_CATEGORY
        except ImportError:  # pragma: no cover
            return {"items_removed": 0}

        manager = ScratchpadManager(self.config)
        data = manager.load()
        removed = 0
        for bucket in BUCKET_TO_CATEGORY:
            removed += sum(1 for item in getattr(data, bucket) if self._memory_item_matches(item, chapters))
        return {"items_removed": removed}

    def _preview_state(self, chapters: list[int]) -> dict[str, Any]:
        state = read_json_if_exists(self.config.state_file) or {}
        progress = state.get("progress") if isinstance(state, dict) else {}
        if not isinstance(progress, dict):
            progress = {}
        chapter_status = progress.get("chapter_status") if isinstance(progress, dict) else {}
        if not isinstance(chapter_status, dict):
            chapter_status = {}
        before_current = self._safe_int(progress.get("current_chapter"))
        before_total = self._safe_int(progress.get("total_words"))
        remaining_committed = self._remaining_committed_chapters(chapter_status, chapters)
        return {
            "chapter_status_removed": sum(1 for ch in chapters if str(ch) in chapter_status),
            "current_chapter_before": before_current,
            "current_chapter_after": max(remaining_committed, default=0),
            "total_words_before": before_total,
            "total_words_after": self._count_total_words(remaining_committed),
        }

    def _build_warnings(self, chapters: list[int], state_preview: dict[str, Any]) -> list[str]:
        warnings = []
        if not self._is_tail_truncate(chapters, state_preview):
            warnings.append("删除非末尾章节会留下章节号空缺，可能需要后续补写或修复连续性。")
        warnings.append("实体 canonical_name/tier/desc 不做历史回滚；仍有引用的实体仅回滚可由 state_changes 证明的状态字段。")
        return warnings

    def _is_tail_truncate(self, chapters: list[int], state_preview: dict[str, Any]) -> bool:
        current = self._safe_int(state_preview.get("current_chapter_before"))
        if current <= 0:
            return False
        deleted = set(chapters)
        start = min(deleted)
        return current in deleted and deleted == set(range(start, current + 1))

    def _delete_vectors(self, chapters: list[int]) -> dict[str, int]:
        db_path = self.config.vector_db
        if not db_path.exists():
            return {}
        with sqlite3.connect(str(db_path)) as conn:
            chunk_ids = self._vector_chunk_ids(conn, chapters)
            before = self._inspect_vectors_db(chapters)
            self._delete_chunk_rows(conn, "bm25_index", chunk_ids, chapters)
            self._delete_chunk_rows(conn, "doc_stats", chunk_ids, chapters)
            self._delete_where_in(conn, "vectors", "chapter", chapters)
            conn.commit()
            return before

    def _delete_index_rows(self, chapters: list[int]) -> dict[str, int]:
        db_path = self.config.index_db
        if not db_path.exists():
            return {}
        before, _ = self._inspect_index_db(chapters)
        with sqlite3.connect(str(db_path)) as conn:
            conn.row_factory = sqlite3.Row
            impacted_entities = self._collect_impacted_entities(conn, chapters)
            debt_ids = self._select_ids_where_in(conn, "chase_debt", "source_chapter", chapters)
            self._delete_where_in(conn, "debt_events", "debt_id", debt_ids)
            for table, column in [
                ("chapters", "chapter"),
                ("scenes", "chapter"),
                ("appearances", "chapter"),
                ("state_changes", "chapter"),
                ("relationships", "chapter"),
                ("relationship_events", "chapter"),
                ("story_events", "chapter"),
                ("chapter_reading_power", "chapter"),
                ("writing_checklist_scores", "chapter"),
                ("rag_query_log", "chapter"),
                ("tool_call_stats", "chapter"),
                ("invalid_facts", "chapter_discovered"),
                ("override_contracts", "chapter"),
                ("debt_events", "chapter"),
                ("chase_debt", "source_chapter"),
            ]:
                self._delete_where_in(conn, table, column, chapters)
            self._delete_review_metrics(conn, chapters)
            self._rebuild_relationship_snapshots(conn)
            self._cleanup_entities(conn, impacted_entities)
            conn.commit()
        return before

    def _delete_memory(self, chapters: list[int]) -> dict[str, int]:
        from .memory.store import ScratchpadManager
        from .memory.schema import BUCKET_TO_CATEGORY

        manager = ScratchpadManager(self.config)
        data = manager.load()
        removed = 0
        for bucket in BUCKET_TO_CATEGORY:
            rows = list(getattr(data, bucket))
            kept = [item for item in rows if not self._memory_item_matches(item, chapters)]
            removed += len(rows) - len(kept)
            setattr(data, bucket, kept)
        if removed:
            manager.save(data)
        return {"items_removed": removed}

    def _delete_files(self, files: dict[str, list[str]]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for category in ("story_system", "summaries", "review_reports", "chapter_text"):
            deleted = 0
            for raw in files.get(category) or []:
                path = Path(raw)
                try:
                    if path.is_file():
                        path.unlink()
                        deleted += 1
                except OSError:
                    continue
            counts[category] = deleted
        return counts

    def _update_state(self, chapters: list[int], before: dict[str, Any]) -> dict[str, Any]:
        state = read_json_if_exists(self.config.state_file) or {}
        if not isinstance(state, dict):
            state = {}
        progress = state.setdefault("progress", {})
        if not isinstance(progress, dict):
            progress = {}
            state["progress"] = progress
        chapter_status = progress.setdefault("chapter_status", {})
        if not isinstance(chapter_status, dict):
            chapter_status = {}
            progress["chapter_status"] = chapter_status

        for chapter in chapters:
            chapter_status.pop(str(chapter), None)

        remaining = self._remaining_committed_chapters(chapter_status, chapters=[])
        progress["current_chapter"] = max(remaining, default=0)
        progress["total_words"] = self._count_total_words(remaining)
        progress["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        self._update_strand_tracker(state, set(chapters))
        self._sync_state_entities(state)
        write_json(self.config.state_file, state)
        return {
            **before,
            "current_chapter_after": progress["current_chapter"],
            "total_words_after": progress["total_words"],
        }

    def _sync_state_entities(self, state: dict[str, Any]) -> None:
        db_path = self.config.index_db
        if not db_path.exists():
            return
        entity_state = state.get("entity_state")
        if not isinstance(entity_state, dict):
            return
        with sqlite3.connect(str(db_path)) as conn:
            if not self._table_exists(conn, "entities") or not self._column_exists(conn, "entities", "id"):
                return
            existing = {row[0] for row in conn.execute("SELECT id FROM entities").fetchall()}
        for entity_id in list(entity_state):
            if entity_id not in existing:
                entity_state.pop(entity_id, None)

    def _update_strand_tracker(self, state: dict[str, Any], deleted: set[int]) -> None:
        tracker = state.get("strand_tracker")
        if not isinstance(tracker, dict):
            return
        history = tracker.get("history")
        if not isinstance(history, list):
            return
        cleaned = []
        for row in history:
            if not isinstance(row, dict):
                continue
            chapter = self._safe_int(row.get("chapter"))
            strand = str(row.get("dominant") or row.get("strand") or "").strip().lower()
            if chapter <= 0 or chapter in deleted or not strand:
                continue
            cleaned.append({"chapter": chapter, "dominant": strand})
        cleaned.sort(key=lambda row: row["chapter"])
        tracker["history"] = cleaned
        valid = ("quest", "fire", "constellation")
        for name in valid:
            tracker[f"last_{name}_chapter"] = max((row["chapter"] for row in cleaned if row["dominant"] == name), default=0)
        if cleaned:
            current = cleaned[-1]["dominant"]
            tracker["current_dominant"] = current
            streak = 0
            for row in reversed(cleaned):
                if row["dominant"] != current:
                    break
                streak += 1
            tracker["chapters_since_switch"] = streak
        else:
            tracker["current_dominant"] = None
            tracker["chapters_since_switch"] = 0

    def _cleanup_entities(self, conn: sqlite3.Connection, entity_ids: set[str]) -> None:
        if not entity_ids or not self._table_exists(conn, "entities"):
            return
        for entity_id in sorted(entity_ids):
            if not self._entity_has_refs(conn, entity_id):
                self._execute_if_table(conn, "aliases", "DELETE FROM aliases WHERE entity_id = ?", (entity_id,))
                self._execute_if_table(conn, "entities", "DELETE FROM entities WHERE id = ?", (entity_id,))
                continue
            first_last = self._entity_first_last(conn, entity_id)
            if first_last:
                first, last = first_last
                assignments = []
                params: list[Any] = []
                for column, value in (
                    ("first_appearance", first),
                    ("last_appearance", last),
                    ("current_json", json.dumps(self._latest_entity_state(conn, entity_id), ensure_ascii=False)),
                ):
                    if self._column_exists(conn, "entities", column):
                        assignments.append(f"{column} = ?")
                        params.append(value)
                if self._column_exists(conn, "entities", "updated_at"):
                    assignments.append("updated_at = CURRENT_TIMESTAMP")
                if assignments:
                    params.append(entity_id)
                    conn.execute(f"UPDATE entities SET {', '.join(assignments)} WHERE id = ?", params)

    def _rebuild_relationship_snapshots(self, conn: sqlite3.Connection) -> None:
        if not self._table_exists(conn, "relationship_events") or not self._table_exists(conn, "relationships"):
            return
        required = ["from_entity", "to_entity", "type", "action", "description", "chapter"]
        if any(not self._column_exists(conn, "relationship_events", column) for column in required):
            return
        if any(not self._column_exists(conn, "relationships", column) for column in ["from_entity", "to_entity", "type", "description", "chapter"]):
            return
        rows = conn.execute(
            """
            SELECT * FROM relationship_events
            ORDER BY from_entity, to_entity, type, chapter DESC, id DESC
            """
        ).fetchall()
        latest: dict[tuple[str, str, str], sqlite3.Row] = {}
        for row in rows:
            key = (row["from_entity"], row["to_entity"], row["type"])
            latest.setdefault(key, row)
        conn.execute("DELETE FROM relationships")
        for row in latest.values():
            if str(row["action"] or "").strip().lower() == "remove":
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO relationships (from_entity, to_entity, type, description, chapter)
                VALUES (?, ?, ?, ?, ?)
                """,
                (row["from_entity"], row["to_entity"], row["type"], row["description"], row["chapter"]),
            )

    def _collect_impacted_entities(self, conn: sqlite3.Connection, chapters: list[int]) -> set[str]:
        ids: set[str] = set()
        for table, column in (("appearances", "entity_id"), ("state_changes", "entity_id")):
            if self._table_exists(conn, table):
                ids.update(str(row[0]) for row in self._select_column_where_in(conn, table, column, "chapter", chapters) if row[0])
        if self._table_exists(conn, "relationships"):
            for row in self._select_columns_where_in(conn, "relationships", ["from_entity", "to_entity"], "chapter", chapters):
                ids.update(str(value) for value in row if value)
        if self._table_exists(conn, "relationship_events"):
            for row in self._select_columns_where_in(conn, "relationship_events", ["from_entity", "to_entity"], "chapter", chapters):
                ids.update(str(value) for value in row if value)
        return ids

    def _entity_has_refs_after_delete(self, conn: sqlite3.Connection, entity_id: str, deleted: list[int]) -> bool:
        for table, clause, params in [
            ("appearances", "entity_id = ?", (entity_id,)),
            ("state_changes", "entity_id = ?", (entity_id,)),
            ("relationships", "from_entity = ? OR to_entity = ?", (entity_id, entity_id)),
            ("relationship_events", "from_entity = ? OR to_entity = ?", (entity_id, entity_id)),
        ]:
            if not self._table_exists(conn, table):
                continue
            rows = conn.execute(f"SELECT chapter FROM {table} WHERE {clause}", params).fetchall()
            if any(self._safe_int(row[0]) not in deleted for row in rows):
                return True
        return False

    def _entity_has_refs(self, conn: sqlite3.Connection, entity_id: str) -> bool:
        for table, clause, params in [
            ("appearances", "entity_id = ?", (entity_id,)),
            ("state_changes", "entity_id = ?", (entity_id,)),
            ("relationships", "from_entity = ? OR to_entity = ?", (entity_id, entity_id)),
            ("relationship_events", "from_entity = ? OR to_entity = ?", (entity_id, entity_id)),
        ]:
            if not self._table_exists(conn, table):
                continue
            row = conn.execute(f"SELECT 1 FROM {table} WHERE {clause} LIMIT 1", params).fetchone()
            if row:
                return True
        return False

    def _entity_first_last(self, conn: sqlite3.Connection, entity_id: str) -> tuple[int, int] | None:
        chapters: list[int] = []
        for table, clause, params in [
            ("appearances", "entity_id = ?", (entity_id,)),
            ("state_changes", "entity_id = ?", (entity_id,)),
            ("relationships", "from_entity = ? OR to_entity = ?", (entity_id, entity_id)),
            ("relationship_events", "from_entity = ? OR to_entity = ?", (entity_id, entity_id)),
        ]:
            if not self._table_exists(conn, table):
                continue
            chapters.extend(self._safe_int(row[0]) for row in conn.execute(f"SELECT chapter FROM {table} WHERE {clause}", params).fetchall())
        chapters = [chapter for chapter in chapters if chapter > 0]
        if not chapters:
            return None
        return min(chapters), max(chapters)

    def _latest_entity_state(self, conn: sqlite3.Connection, entity_id: str) -> dict[str, Any]:
        if not self._table_exists(conn, "state_changes"):
            return {}
        rows = conn.execute(
            "SELECT field, new_value FROM state_changes WHERE entity_id = ? ORDER BY chapter ASC, id ASC",
            (entity_id,),
        ).fetchall()
        state: dict[str, Any] = {}
        for field, value in rows:
            if not field:
                continue
            state[str(field)] = self._parse_jsonish(value)
        return state

    def _vector_chunk_ids(self, conn: sqlite3.Connection, chapters: list[int]) -> list[str]:
        if not self._table_exists(conn, "vectors"):
            return []
        ids = {str(row[0]) for row in self._select_column_where_in(conn, "vectors", "chunk_id", "chapter", chapters) if row[0]}
        for chapter in chapters:
            prefix = f"ch{chapter:04d}_%"
            for table in ("bm25_index", "doc_stats"):
                if self._table_exists(conn, table) and self._column_exists(conn, table, "chunk_id"):
                    ids.update(str(row[0]) for row in conn.execute(f"SELECT chunk_id FROM {table} WHERE chunk_id LIKE ?", (prefix,)).fetchall() if row[0])
        return sorted(ids)

    def _count_chunks(self, conn: sqlite3.Connection, table: str, chunk_ids: list[str], chapters: list[int]) -> int:
        if not self._table_exists(conn, table) or not self._column_exists(conn, table, "chunk_id"):
            return 0
        ids = set(chunk_ids)
        for chapter in chapters:
            prefix = f"ch{chapter:04d}_%"
            ids.update(str(row[0]) for row in conn.execute(f"SELECT chunk_id FROM {table} WHERE chunk_id LIKE ?", (prefix,)).fetchall() if row[0])
        if not ids:
            return 0
        placeholders = ",".join("?" for _ in ids)
        return int(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE chunk_id IN ({placeholders})", sorted(ids)).fetchone()[0] or 0)

    def _delete_chunk_rows(self, conn: sqlite3.Connection, table: str, chunk_ids: list[str], chapters: list[int]) -> None:
        if not self._table_exists(conn, table) or not self._column_exists(conn, table, "chunk_id"):
            return
        if chunk_ids:
            placeholders = ",".join("?" for _ in chunk_ids)
            conn.execute(f"DELETE FROM {table} WHERE chunk_id IN ({placeholders})", chunk_ids)
        for chapter in chapters:
            conn.execute(f"DELETE FROM {table} WHERE chunk_id LIKE ?", (f"ch{chapter:04d}_%",))

    def _count_review_metrics(self, conn: sqlite3.Connection, chapters: list[int]) -> int:
        if not self._table_exists(conn, "review_metrics"):
            return 0
        return sum(
            int(conn.execute("SELECT COUNT(*) FROM review_metrics WHERE start_chapter <= ? AND end_chapter >= ?", (chapter, chapter)).fetchone()[0] or 0)
            for chapter in chapters
        )

    def _delete_review_metrics(self, conn: sqlite3.Connection, chapters: list[int]) -> None:
        if not self._table_exists(conn, "review_metrics"):
            return
        for chapter in chapters:
            conn.execute("DELETE FROM review_metrics WHERE start_chapter <= ? AND end_chapter >= ?", (chapter, chapter))

    def _count_where_in(self, conn: sqlite3.Connection, table: str, column: str, values: list[int] | list[str]) -> int:
        if not values or not self._table_exists(conn, table) or not self._column_exists(conn, table, column):
            return 0
        placeholders = ",".join("?" for _ in values)
        return int(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {column} IN ({placeholders})", values).fetchone()[0] or 0)

    def _delete_where_in(self, conn: sqlite3.Connection, table: str, column: str, values: list[int] | list[str]) -> None:
        if not values or not self._table_exists(conn, table) or not self._column_exists(conn, table, column):
            return
        placeholders = ",".join("?" for _ in values)
        conn.execute(f"DELETE FROM {table} WHERE {column} IN ({placeholders})", values)

    def _select_ids_where_in(self, conn: sqlite3.Connection, table: str, column: str, values: list[int]) -> list[int]:
        return [self._safe_int(row[0]) for row in self._select_column_where_in(conn, table, "id", column, values)]

    def _select_column_where_in(self, conn: sqlite3.Connection, table: str, select_column: str, where_column: str, values: list[int]) -> list[sqlite3.Row]:
        if not values or not self._table_exists(conn, table) or not self._column_exists(conn, table, where_column) or not self._column_exists(conn, table, select_column):
            return []
        placeholders = ",".join("?" for _ in values)
        return conn.execute(f"SELECT {select_column} FROM {table} WHERE {where_column} IN ({placeholders})", values).fetchall()

    def _select_columns_where_in(self, conn: sqlite3.Connection, table: str, select_columns: list[str], where_column: str, values: list[int]) -> list[sqlite3.Row]:
        if not values or not self._table_exists(conn, table) or not self._column_exists(conn, table, where_column):
            return []
        if any(not self._column_exists(conn, table, column) for column in select_columns):
            return []
        placeholders = ",".join("?" for _ in values)
        columns = ", ".join(select_columns)
        return conn.execute(f"SELECT {columns} FROM {table} WHERE {where_column} IN ({placeholders})", values).fetchall()

    def _execute_if_table(self, conn: sqlite3.Connection, table: str, query: str, params: tuple[Any, ...]) -> None:
        if self._table_exists(conn, table):
            conn.execute(query, params)

    def _table_exists(self, conn: sqlite3.Connection, table: str) -> bool:
        row = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone()
        return bool(row)

    def _column_exists(self, conn: sqlite3.Connection, table: str, column: str) -> bool:
        if not self._table_exists(conn, table):
            return False
        return any(row[1] == column for row in conn.execute(f"PRAGMA table_info({table})").fetchall())

    def _memory_item_matches(self, item: Any, chapters: list[int]) -> bool:
        chapter_set = set(chapters)
        if self._safe_int(getattr(item, "source_chapter", 0)) in chapter_set:
            return True
        payload = getattr(item, "payload", {}) or {}
        for key in ("chapter", "source_chapter", "planted_chapter", "target_chapter", "resolved_chapter"):
            if self._safe_int(payload.get(key)) in chapter_set:
                return True
        evidence = "\n".join(str(value) for value in (getattr(item, "evidence", []) or []))
        return any(f":{chapter}" in evidence or f"ch{chapter:04d}" in evidence for chapter in chapter_set)

    def _remaining_committed_chapters(self, chapter_status: dict[str, Any], chapters: list[int]) -> list[int]:
        deleted = set(chapters)
        remaining = []
        for raw_chapter, status in chapter_status.items():
            chapter = self._safe_int(raw_chapter)
            if chapter <= 0 or chapter in deleted or status != "chapter_committed":
                continue
            if find_chapter_file(self.project_root, chapter):
                remaining.append(chapter)
        return sorted(remaining)

    def _count_total_words(self, chapters: list[int]) -> int:
        total = 0
        for chapter in chapters:
            path = find_chapter_file(self.project_root, chapter)
            if not path:
                continue
            try:
                total += len(re.sub(r"```[\s\S]*?```", "", path.read_text(encoding="utf-8")).strip())
            except OSError:
                continue
        return total

    def _parse_jsonish(self, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value

    def _safe_int(self, value: Any) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0
