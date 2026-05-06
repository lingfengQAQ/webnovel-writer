#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable

from chapter_paths import extract_chapter_num_from_filename, find_chapter_file
from runtime_compat import enable_windows_utf8_stdio

from data_modules.config import DataModulesConfig
from data_modules.event_log_store import EventLogStore
from data_modules.index_manager import IndexManager
from data_modules.index_projection_writer import IndexProjectionWriter
from data_modules.memory.schema import ScratchpadData
from data_modules.memory_projection_writer import MemoryProjectionWriter
from data_modules.override_ledger_service import (
    AmendProposalTrigger,
    ensure_override_ledger_columns,
    persist_amend_proposals,
)
from data_modules.state_projection_writer import StateProjectionWriter
from data_modules.story_contracts import read_json_if_exists, write_json
from data_modules.summary_projection_writer import SummaryProjectionWriter


FULL_REPLAY_TABLES = (
    "debt_events",
    "chase_debt",
    "override_contracts",
    "relationship_events",
    "relationships",
    "state_changes",
    "appearances",
    "scenes",
    "chapters",
    "aliases",
    "entities",
    "story_events",
)

TARGET_CHAPTER_TABLES = (
    ("chapter_reading_power", "chapter"),
    ("writing_checklist_scores", "chapter"),
    ("rag_query_log", "chapter"),
    ("tool_call_stats", "chapter"),
    ("invalid_facts", "chapter_discovered"),
)


def parse_chapter_spec(raw: str) -> list[int]:
    spec = str(raw or "").strip()
    if not spec:
        raise ValueError("章节参数不能为空")
    spec = (
        spec.replace("，", ",")
        .replace("；", ",")
        .replace("、", ",")
        .replace(";", ",")
        .replace("—", "-")
        .replace("–", "-")
    )
    parts = [part for part in re.split(r"[,\s]+", spec) if part]
    chapters: set[int] = set()
    for part in parts:
        if re.fullmatch(r"\d+", part):
            chapter = int(part)
            if chapter <= 0:
                raise ValueError(f"无效章节号: {part}")
            chapters.add(chapter)
            continue
        match = re.fullmatch(r"(\d+)-(\d+)", part)
        if not match:
            raise ValueError(f"无法解析章节范围: {part}")
        start, end = int(match.group(1)), int(match.group(2))
        if start <= 0 or end <= 0 or start > end:
            raise ValueError(f"无效章节范围: {part}")
        chapters.update(range(start, end + 1))
    return sorted(chapters)


def delete_chapters(
    project_root: Path | str,
    chapters: Iterable[int],
    *,
    mode: str = "delete",
    dry_run: bool = False,
) -> dict[str, Any]:
    root = Path(project_root).expanduser().resolve()
    targets = sorted({int(ch) for ch in chapters if int(ch) > 0})
    if not targets:
        raise ValueError("没有可删除的章节")
    target_set = set(targets)

    commits = _load_commit_payloads(root)
    remaining_commits = [
        payload for payload in commits if _payload_chapter(payload) not in target_set
    ]
    target_commit_count = len(commits) - len(remaining_commits)
    files = _collect_artifact_files(root, target_set)
    vector_chunks = _clean_vectors(root, target_set, dry_run=True)

    if dry_run:
        return {
            "ok": True,
            "mode": mode,
            "dry_run": True,
            "chapters": targets,
            "planned_file_count": len(files),
            "planned_files": [str(path) for path in files],
            "planned_vector_chunks": vector_chunks,
            "target_commits": target_commit_count,
            "commits_to_replay": len(remaining_commits),
        }

    removed_files, file_errors = _delete_files(files, root)
    cfg = DataModulesConfig.from_project_root(root)
    cfg.ensure_dirs()

    state_result = _reset_state(root, target_set)
    memory_result = _reset_memory(cfg)
    project_memory_result = _clean_project_memory(root, target_set)
    index_result = _reset_index(root, cfg, target_set)
    vector_chunks_removed = _clean_vectors(root, target_set, dry_run=False)
    observability_result = _clean_observability_jsonl(root, target_set)
    replay_result = _replay_commits(root, remaining_commits)

    return {
        "ok": not file_errors,
        "mode": mode,
        "dry_run": False,
        "chapters": targets,
        "removed_file_count": len(removed_files),
        "removed_files": [str(path) for path in removed_files],
        "file_errors": file_errors,
        "vector_chunks_removed": vector_chunks_removed,
        "target_commits": target_commit_count,
        "commits_replayed": replay_result["total"],
        "accepted_commits_replayed": replay_result["accepted"],
        "rejected_commits_replayed": replay_result["rejected"],
        "state": state_result,
        "memory": memory_result,
        "project_memory": project_memory_result,
        "index": index_result,
        "observability": observability_result,
    }


def _load_commit_payloads(project_root: Path) -> list[dict[str, Any]]:
    commit_dir = project_root / ".story-system" / "commits"
    if not commit_dir.is_dir():
        return []
    payloads: list[dict[str, Any]] = []
    for path in sorted(commit_dir.glob("chapter_*.commit.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"commit 不是 JSON 对象: {path}")
        chapter = _payload_chapter(payload)
        if chapter <= 0:
            chapter = _chapter_num_from_story_filename(path.name) or 0
            payload.setdefault("meta", {})["chapter"] = chapter
        payloads.append(payload)
    return sorted(payloads, key=_payload_chapter)


def _payload_chapter(payload: dict[str, Any]) -> int:
    try:
        return int((payload.get("meta") or {}).get("chapter") or 0)
    except (TypeError, ValueError):
        return 0


def _collect_artifact_files(project_root: Path, targets: set[int]) -> list[Path]:
    candidates: set[Path] = set()

    chapters_dir = project_root / "正文"
    for chapter in sorted(targets):
        _add_candidate(candidates, project_root, find_chapter_file(project_root, chapter))
    if chapters_dir.is_dir():
        for path in chapters_dir.rglob("*.md"):
            chapter = extract_chapter_num_from_filename(path.name)
            if chapter in targets:
                _add_candidate(candidates, project_root, path)

    summaries_dir = project_root / ".webnovel" / "summaries"
    for chapter in sorted(targets):
        for width in (3, 4):
            _add_candidate(candidates, project_root, summaries_dir / f"ch{chapter:0{width}d}.md")

    story_root = project_root / ".story-system"
    story_patterns = (
        ("commits", "commit.json"),
        ("events", "events.json"),
        ("chapters", "json"),
        ("reviews", "review.json"),
    )
    for chapter in sorted(targets):
        for subdir, suffix in story_patterns:
            _add_candidate(
                candidates,
                project_root,
                story_root / subdir / f"chapter_{chapter:03d}.{suffix}",
            )
        for subdir in ("commits", "events", "chapters", "reviews"):
            _add_candidate(candidates, project_root, story_root / subdir / f"chapter_{chapter:03d}.md")
            _add_candidate(
                candidates,
                project_root,
                story_root / subdir / f"chapter_{chapter:03d}.review.md",
            )
            _add_candidate(
                candidates,
                project_root,
                story_root / subdir / f"chapter_{chapter:03d}.commit.md",
            )
            _add_candidate(
                candidates,
                project_root,
                story_root / subdir / f"chapter_{chapter:03d}.events.md",
            )

    for subdir in ("commits", "events", "chapters", "reviews"):
        directory = story_root / subdir
        if not directory.is_dir():
            continue
        for path in directory.rglob("*"):
            if path.is_file() and _chapter_num_from_story_filename(path.name) in targets:
                _add_candidate(candidates, project_root, path)

    review_dir = project_root / "审查报告"
    if review_dir.is_dir():
        for path in review_dir.rglob("*.md"):
            chapter = extract_chapter_num_from_filename(path.name)
            if chapter in targets:
                _add_candidate(candidates, project_root, path)

    for path in _collect_review_report_files_from_db(project_root, targets):
        _add_candidate(candidates, project_root, path)

    tmp_dir = project_root / ".webnovel" / "tmp"
    if tmp_dir.is_dir():
        for path in tmp_dir.rglob("*"):
            if path.is_file() and _generic_filename_touches_chapter(path.name, targets):
                _add_candidate(candidates, project_root, path)

    return sorted(candidates, key=lambda path: str(path).lower())


def _collect_review_report_files_from_db(project_root: Path, targets: set[int]) -> list[Path]:
    db_path = project_root / ".webnovel" / "index.db"
    if not db_path.is_file():
        return []
    paths: list[Path] = []
    try:
        with sqlite3.connect(str(db_path)) as conn:
            if not _table_exists(conn, "review_metrics"):
                return []
            for chapter in sorted(targets):
                rows = conn.execute(
                    """
                    SELECT report_file FROM review_metrics
                    WHERE start_chapter <= ? AND end_chapter >= ?
                    """,
                    (chapter, chapter),
                ).fetchall()
                for row in rows:
                    raw = str(row[0] or "").strip()
                    if not raw:
                        continue
                    path = Path(raw)
                    if not path.is_absolute():
                        path = project_root / path
                    paths.append(path)
    except sqlite3.Error:
        return []
    return paths


def _add_candidate(candidates: set[Path], project_root: Path, path: Path | None) -> None:
    if path is None:
        return
    for candidate in _candidate_with_sidecars(path):
        resolved = candidate.expanduser().resolve(strict=False)
        if not _is_under(resolved, project_root):
            continue
        if resolved.is_file():
            candidates.add(resolved)


def _candidate_with_sidecars(path: Path) -> list[Path]:
    return [path, Path(str(path) + ".bak")]


def _delete_files(paths: Iterable[Path], project_root: Path) -> tuple[list[Path], list[dict[str, str]]]:
    removed: list[Path] = []
    errors: list[dict[str, str]] = []
    for path in sorted(paths, key=lambda item: str(item).lower()):
        resolved = path.expanduser().resolve(strict=False)
        if not _is_under(resolved, project_root):
            errors.append({"path": str(path), "error": "path_outside_project"})
            continue
        if not resolved.exists():
            continue
        if not resolved.is_file():
            errors.append({"path": str(resolved), "error": "not_a_file"})
            continue
        try:
            resolved.unlink()
            removed.append(resolved)
        except OSError as exc:
            errors.append({"path": str(resolved), "error": str(exc)})
    return removed, errors


def _reset_state(project_root: Path, targets: set[int]) -> dict[str, Any]:
    state_path = project_root / ".webnovel" / "state.json"
    state = read_json_if_exists(state_path) or {}
    if not isinstance(state, dict):
        state = {}

    progress = dict(state.get("progress") or {})
    progress["current_chapter"] = 0
    progress["total_words"] = 0
    progress["chapter_status"] = {}
    progress["last_updated"] = ""
    state["progress"] = progress

    protagonist = state.get("protagonist_state") if isinstance(state.get("protagonist_state"), dict) else {}
    kept_protagonist = {
        key: protagonist[key]
        for key in ("name", "entity_id", "id", "canonical_name")
        if key in protagonist
    }
    state["protagonist_state"] = kept_protagonist
    state["entity_state"] = {}
    state["strand_tracker"] = {
        "last_quest_chapter": 0,
        "last_fire_chapter": 0,
        "last_constellation_chapter": 0,
        "current_dominant": None,
        "chapters_since_switch": 0,
        "history": [],
    }

    for key in (
        "entities_v3",
        "alias_index",
        "structured_relationships",
        "relationships",
        "relationship_graph",
        "character_atlas",
        "characters",
        "state_changes",
    ):
        if key in state:
            state[key] = [] if isinstance(state.get(key), list) else {}

    if isinstance(state.get("chapter_meta"), dict):
        state["chapter_meta"] = {
            key: value
            for key, value in state["chapter_meta"].items()
            if _safe_int(key) not in targets
        }

    for key in ("disambiguation_warnings", "disambiguation_pending"):
        if isinstance(state.get(key), list):
            state[key] = [
                row for row in state[key] if not _row_touches_chapter(row, targets)
            ]

    if isinstance(state.get("review_checkpoints"), list):
        state["review_checkpoints"] = [
            row for row in state["review_checkpoints"]
            if not _row_touches_chapter(row, targets)
        ]

    plot_threads = state.get("plot_threads")
    if isinstance(plot_threads, dict) and isinstance(plot_threads.get("foreshadowing"), list):
        plot_threads["foreshadowing"] = [
            row
            for row in plot_threads["foreshadowing"]
            if not _row_touches_chapter(row, targets)
        ]

    write_json(state_path, state)
    return {"reset": True, "path": str(state_path)}


def _reset_memory(cfg: DataModulesConfig) -> dict[str, Any]:
    write_json(cfg.scratchpad_file, ScratchpadData.empty().to_dict())
    return {"reset": True, "path": str(cfg.scratchpad_file)}


def _clean_project_memory(project_root: Path, targets: set[int]) -> dict[str, Any]:
    path = project_root / ".webnovel" / "project_memory.json"
    payload = read_json_if_exists(path)
    if not isinstance(payload, dict):
        return {"path": str(path), "patterns_removed": 0}
    patterns = payload.get("patterns")
    if not isinstance(patterns, list):
        return {"path": str(path), "patterns_removed": 0}
    kept = [row for row in patterns if not _row_touches_chapter(row, targets)]
    removed = len(patterns) - len(kept)
    if removed:
        payload["patterns"] = kept
        write_json(path, payload)
    return {"path": str(path), "patterns_removed": removed}


def _reset_index(project_root: Path, cfg: DataModulesConfig, targets: set[int]) -> dict[str, Any]:
    manager = IndexManager(cfg)
    counts: dict[str, int] = {}
    with manager._get_conn() as conn:
        conn.execute("PRAGMA foreign_keys = OFF")
        for table in FULL_REPLAY_TABLES:
            counts[table] = _delete_all_rows(conn, table)
        for table, column in TARGET_CHAPTER_TABLES:
            counts[table] = _delete_rows_by_column(conn, table, column, targets)
        counts["review_metrics"] = _delete_review_metrics(conn, targets)
        conn.commit()
    return {"reset_tables": counts, "path": str(project_root / ".webnovel" / "index.db")}


def _clean_vectors(project_root: Path, targets: set[int], *, dry_run: bool) -> int:
    db_path = project_root / ".webnovel" / "vectors.db"
    if not db_path.is_file():
        return 0
    try:
        with sqlite3.connect(str(db_path)) as conn:
            if not _table_exists(conn, "vectors"):
                return 0
            rows = conn.execute(
                "SELECT chunk_id, chapter, source_file FROM vectors"
            ).fetchall()
            chunk_ids = [
                str(row[0])
                for row in rows
                if _vector_row_touches_chapter(
                    chunk_id=str(row[0] or ""),
                    chapter=row[1],
                    source_file=str(row[2] or ""),
                    targets=targets,
                )
            ]
            chunk_ids = sorted(set(chunk_ids))
            if dry_run or not chunk_ids:
                return len(chunk_ids)
            for batch in _batched(chunk_ids, 500):
                params = list(batch)
                placeholders = ",".join("?" for _ in params)
                if _table_exists(conn, "bm25_index"):
                    conn.execute(
                        f"DELETE FROM bm25_index WHERE chunk_id IN ({placeholders})",
                        params,
                    )
                if _table_exists(conn, "doc_stats"):
                    conn.execute(
                        f"DELETE FROM doc_stats WHERE chunk_id IN ({placeholders})",
                        params,
                    )
                conn.execute(
                    f"DELETE FROM vectors WHERE chunk_id IN ({placeholders})",
                    params,
                )
            conn.commit()
            return len(chunk_ids)
    except sqlite3.Error:
        return 0


def _clean_observability_jsonl(project_root: Path, targets: set[int]) -> dict[str, Any]:
    root = project_root / ".webnovel" / "observability"
    if not root.is_dir():
        return {"files_touched": 0, "lines_removed": 0}
    files_touched = 0
    lines_removed = 0
    for path in sorted(root.rglob("*.jsonl")):
        try:
            original = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        kept: list[str] = []
        for line in original:
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                kept.append(line)
                continue
            if isinstance(payload, dict) and _row_touches_chapter(payload, targets):
                lines_removed += 1
                continue
            kept.append(line)
        if len(kept) != len(original):
            path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
            files_touched += 1
    return {"files_touched": files_touched, "lines_removed": lines_removed}


def _replay_commits(project_root: Path, commits: list[dict[str, Any]]) -> dict[str, int]:
    state_writer = StateProjectionWriter(project_root)
    index_writer = IndexProjectionWriter(project_root)
    summary_writer = SummaryProjectionWriter(project_root)
    memory_writer = MemoryProjectionWriter(project_root)
    event_store = EventLogStore(project_root)
    proposal_trigger = AmendProposalTrigger()
    manager = IndexManager(DataModulesConfig.from_project_root(project_root))

    accepted = 0
    rejected = 0
    for payload in sorted(commits, key=_payload_chapter):
        status = str((payload.get("meta") or {}).get("status") or "").strip()
        if status == "accepted":
            accepted += 1
            state_writer.apply(payload)
            chapter = _payload_chapter(payload)
            events = payload.get("accepted_events") or []
            event_store.write_events(chapter, events)
            proposals = proposal_trigger.check(chapter, events)
            if proposals:
                with manager._get_conn() as conn:
                    ensure_override_ledger_columns(conn)
                    persist_amend_proposals(conn, chapter, proposals)
                    conn.commit()
            index_writer.apply(payload)
            summary_writer.apply(payload)
            memory_writer.apply(payload)
        elif status == "rejected":
            rejected += 1
            state_writer.apply(payload)
    return {"total": accepted + rejected, "accepted": accepted, "rejected": rejected}


def _delete_all_rows(conn: sqlite3.Connection, table: str) -> int:
    if not _table_exists(conn, table):
        return 0
    before = _table_count(conn, table)
    conn.execute(f"DELETE FROM {table}")
    return before


def _delete_rows_by_column(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    targets: set[int],
) -> int:
    if not targets or not _table_exists(conn, table):
        return 0
    before = _table_count(conn, table)
    for batch in _batched(sorted(targets), 500):
        placeholders = ",".join("?" for _ in batch)
        conn.execute(
            f"DELETE FROM {table} WHERE {column} IN ({placeholders})",
            list(batch),
        )
    after = _table_count(conn, table)
    return before - after


def _delete_review_metrics(conn: sqlite3.Connection, targets: set[int]) -> int:
    if not targets or not _table_exists(conn, "review_metrics"):
        return 0
    before = _table_count(conn, "review_metrics")
    for chapter in sorted(targets):
        conn.execute(
            """
            DELETE FROM review_metrics
            WHERE start_chapter <= ? AND end_chapter >= ?
            """,
            (chapter, chapter),
        )
    after = _table_count(conn, "review_metrics")
    return before - after


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def _table_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except sqlite3.Error:
        return 0


def _row_touches_chapter(row: Any, targets: set[int]) -> bool:
    if not isinstance(row, dict):
        return False
    start = _safe_int(row.get("start_chapter"))
    end = _safe_int(row.get("end_chapter"))
    if start > 0 and end > 0 and any(start <= chapter <= end for chapter in targets):
        return True
    for key, value in row.items():
        if "chapter" not in str(key).lower() and str(key) not in {"chapters"}:
            continue
        for chapter in _extract_chapter_numbers(value):
            if chapter in targets:
                return True
    return False


def _extract_chapter_numbers(value: Any) -> set[int]:
    if isinstance(value, int):
        return {value} if value > 0 else set()
    if isinstance(value, float):
        as_int = int(value)
        return {as_int} if as_int > 0 and as_int == value else set()
    if isinstance(value, list):
        result: set[int] = set()
        for item in value:
            result.update(_extract_chapter_numbers(item))
        return result
    if isinstance(value, dict):
        result: set[int] = set()
        for item in value.values():
            result.update(_extract_chapter_numbers(item))
        return result
    text = str(value or "").strip()
    if not text:
        return set()
    try:
        return set(parse_chapter_spec(text))
    except ValueError:
        result: set[int] = set()
        for match in re.finditer(r"\d+", text):
            number = int(match.group(0))
            if number > 0:
                result.add(number)
        return result


def _vector_row_touches_chapter(
    *,
    chunk_id: str,
    chapter: Any,
    source_file: str,
    targets: set[int],
) -> bool:
    chapter_num = _safe_int(chapter)
    if chapter_num in targets:
        return True
    return _generic_filename_touches_chapter(chunk_id, targets) or _generic_filename_touches_chapter(
        source_file,
        targets,
    )


def _generic_filename_touches_chapter(name: str, targets: set[int]) -> bool:
    text = str(name or "").lower()
    if not text:
        return False
    chinese = extract_chapter_num_from_filename(text)
    if chinese in targets:
        return True
    for pattern in (r"chapter[_-]?0*(\d+)", r"(?:^|[^a-z0-9])ch0*(\d+)(?=$|[^0-9])"):
        for match in re.finditer(pattern, text):
            if int(match.group(1)) in targets:
                return True
    return False


def _chapter_num_from_story_filename(name: str) -> int | None:
    match = re.search(r"chapter_0*(\d+)", str(name or ""))
    if not match:
        return None
    chapter = int(match.group(1))
    return chapter if chapter > 0 else None


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _batched(values: Iterable[Any], size: int) -> Iterable[list[Any]]:
    batch: list[Any] = []
    for value in values:
        batch.append(value)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _is_under(path: Path, project_root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(project_root.resolve(strict=False))
        return True
    except ValueError:
        return False


def _format_text(result: dict[str, Any]) -> str:
    chapters = ",".join(str(chapter) for chapter in result["chapters"])
    action = "重写前清理" if result.get("mode") == "rewrite" else "删除"
    if result.get("dry_run"):
        return "\n".join(
            [
                f"{action}章节: {chapters}",
                f"计划删除文件: {result.get('planned_file_count', 0)}",
                f"计划清理向量 chunk: {result.get('planned_vector_chunks', 0)}",
                f"将重放 commit: {result.get('commits_to_replay', 0)}",
            ]
        )
    return "\n".join(
        [
            f"{action}章节: {chapters}",
            f"删除文件: {result.get('removed_file_count', 0)}",
            f"清理向量 chunk: {result.get('vector_chunks_removed', 0)}",
            f"重建 commit 投影: {result.get('commits_replayed', 0)}",
            f"状态: {'完成' if result.get('ok') else '完成但有文件错误'}",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    enable_windows_utf8_stdio(skip_in_pytest=True)
    parser = argparse.ArgumentParser(description="删除章节及其派生 read-model")
    parser.add_argument("--project-root", required=True, help="书项目根目录")
    parser.add_argument("--chapters", required=True, help="章节号/范围，如 1,3,5-7")
    parser.add_argument("--mode", choices=["delete", "rewrite"], default="delete")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--format", choices=["json", "text"], default="json")
    args = parser.parse_args(argv)

    try:
        chapters = parse_chapter_spec(args.chapters)
        result = delete_chapters(
            Path(args.project_root),
            chapters,
            mode=args.mode,
            dry_run=bool(args.dry_run),
        )
    except Exception as exc:
        error = {"ok": False, "error": str(exc)}
        if args.format == "json":
            print(json.dumps(error, ensure_ascii=False, indent=2), file=sys.stderr)
        else:
            print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(_format_text(result))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
