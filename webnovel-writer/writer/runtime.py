from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    temp = Path(raw)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_text(path, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def apply_plan(project_root: str | Path, payload: dict[str, Any]) -> dict[str, Any]:
    from data_modules.runtime_contract_builder import RuntimeContractBuilder
    from data_modules.story_contracts import (
        StoryContractPaths,
        persist_runtime_contracts,
        render_chapter_markdown,
        write_json,
        write_marked_markdown,
    )
    from data_modules.story_system_engine import StorySystemEngine

    root = Path(project_root).resolve()
    volume = int(payload["volume"])
    start = int(payload["start_chapter"])
    end = int(payload["end_chapter"])
    queries = {int(key): str(value) for key, value in (payload.get("chapter_queries") or {}).items()}
    if start > end or any(chapter not in queries for chapter in range(start, end + 1)):
        raise ValueError("章节范围无效，或 chapter_queries 未覆盖全部章节")
    outline_dir = root / "大纲"
    outline_path = outline_dir / f"第{volume}卷-详细大纲.md"
    _atomic_text(outline_path, str(payload["volume_outline_markdown"]).strip() + "\n")

    state = json.loads((root / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    info = state.get("project_info") or state.get("project") or {}
    genre = str(info.get("genre") or "")
    engine = StorySystemEngine(csv_dir=Path(__file__).resolve().parents[1] / "references" / "csv")
    built: list[int] = []
    for chapter in range(start, end + 1):
        contract = engine.build(query=queries[chapter], genre=genre or None, chapter=chapter)
        chapter_payload = contract.get("chapter_brief")
        if not chapter_payload:
            raise ValueError(f"第 {chapter} 章合同生成失败")
        paths = StoryContractPaths.from_project_root(root)
        paths.chapters_dir.mkdir(parents=True, exist_ok=True)
        write_json(paths.chapter_json(chapter), chapter_payload)
        write_marked_markdown(paths.chapter_json(chapter).with_suffix(".md"), render_chapter_markdown(chapter_payload))
        volume_brief, review_contract = RuntimeContractBuilder(root).build_for_chapter(chapter)
        persist_runtime_contracts(root, chapter, volume_brief, review_contract)
        built.append(chapter)
    return {"outline_path": str(outline_path), "contracts_built": built}


def initialize_project(workspace_root: str | Path, payload: dict[str, Any], selected_idea: dict[str, Any]) -> dict[str, Any]:
    from init_project import init_project
    from data_modules.story_contracts import persist_story_seed
    from data_modules.story_system_engine import StorySystemEngine
    title = str(payload.get("title") or selected_idea.get("title") or "").strip()
    if not title:
        raise ValueError("缺少书名")
    slug = re.sub(r'[\\/:*?"<>|]+', "", title)
    slug = re.sub(r"\s+", "-", slug).strip("-. ")[:80]
    if not slug or slug.startswith("."):
        slug = "proj-" + (slug.lstrip(".") or "novel")
    workspace = Path(workspace_root).expanduser().resolve()
    plugin_root = Path(__file__).resolve().parents[1]
    try:
        workspace.relative_to(plugin_root)
    except ValueError:
        pass
    else:
        raise ValueError("不能在插件源码目录内创建小说项目")
    workspace.mkdir(parents=True, exist_ok=True)
    project_root = workspace / slug
    if project_root.exists() and any(project_root.iterdir()):
        raise ValueError(f"目标目录已存在且非空: {project_root}")
    allowed = {
        "protagonist_name", "target_words", "target_chapters", "golden_finger_name", "golden_finger_type",
        "golden_finger_style", "core_selling_points", "protagonist_structure", "heroine_config", "heroine_names",
        "heroine_role", "co_protagonists", "co_protagonist_roles", "antagonist_tiers", "world_scale", "factions",
        "power_system_type", "social_class", "resource_distribution", "gf_visibility", "gf_irreversible_cost",
        "protagonist_desire", "protagonist_flaw", "protagonist_archetype", "antagonist_level", "target_reader",
        "platform", "currency_system", "currency_exchange", "sect_hierarchy", "cultivation_chain", "cultivation_subtiers",
    }
    kwargs = {key: value for key, value in payload.items() if key in allowed and value not in (None, "")}
    init_project(
        str(project_root), title, str(payload.get("genre") or "都市"),
        update_project_pointer=False, **kwargs,
    )
    idea_path = project_root / ".webnovel" / "idea_bank.json"
    _atomic_json(idea_path, {"selected_idea": selected_idea, "constraints_inherited": selected_idea})
    genre = str(payload.get("genre") or "都市")
    contract = StorySystemEngine(csv_dir=Path(__file__).resolve().parents[1] / "references" / "csv").build(
        query=str(selected_idea.get("one_liner") or genre), genre=genre, chapter=None
    )
    persist_story_seed(project_root, contract["master_setting"], None, contract["anti_patterns"])
    return {"project_root": str(project_root), "title": title, "idea_path": str(idea_path)}


def finalize_draft(
    project_root: str | Path,
    *,
    chapter: int,
    content: str,
    review: dict[str, Any],
    artifacts: dict[str, Any],
) -> dict[str, Any]:
    from backup_manager import GitBackupManager
    from chapter_paths import default_chapter_draft_path, find_chapter_file
    from data_modules.artifact_validator import validate_commit_artifact_files
    from data_modules.chapter_commit_service import ChapterCommitService
    from data_modules.run_ledger import record_write_step
    from data_modules.write_gates import run_write_gate

    root = Path(project_root).resolve()
    if int(review.get("blocking_count") or 0) > 0:
        raise ValueError("审查仍有 blocking issue，不能定稿")
    extraction = dict(artifacts.get("extraction") or {})
    fulfillment = {
        "planned_nodes": list(artifacts.get("planned_nodes") or []),
        "covered_nodes": list(artifacts.get("covered_nodes") or []),
        "missed_nodes": list(artifacts.get("missed_nodes") or []),
        "extra_nodes": list(artifacts.get("extra_nodes") or []),
    }
    disambiguation = {"pending": list(artifacts.get("pending_disambiguation") or [])}
    if fulfillment["missed_nodes"] or disambiguation["pending"]:
        raise ValueError("存在未履约节点或待消歧实体，不能定稿")

    chapter_path = find_chapter_file(root, chapter) or default_chapter_draft_path(root, chapter)
    _atomic_text(chapter_path, content.strip() + "\n")
    tmp = root / ".webnovel" / "tmp"
    paths = {
        "review_result": tmp / "review_results.json",
        "fulfillment_result": tmp / "fulfillment_result.json",
        "disambiguation_result": tmp / "disambiguation_result.json",
        "extraction_result": tmp / "extraction_result.json",
    }
    _atomic_json(paths["review_result"], review)
    _atomic_json(paths["fulfillment_result"], fulfillment)
    _atomic_json(paths["disambiguation_result"], disambiguation)
    _atomic_json(paths["extraction_result"], extraction)
    validation = validate_commit_artifact_files(**paths)
    if not validation["ok"]:
        raise ValueError("提交产物校验失败: " + json.dumps(validation["errors"], ensure_ascii=False))

    record_write_step(root, chapter=chapter, step="draft", status="completed", outputs={"chapter_file": chapter_path})
    record_write_step(root, chapter=chapter, step="review", status="completed", inputs={"chapter_file": chapter_path}, outputs={"review_result": paths["review_result"]})
    record_write_step(root, chapter=chapter, step="data", status="completed", inputs={"chapter_file": chapter_path}, outputs={key: path for key, path in paths.items() if key != "review_result"})
    gate = run_write_gate(root, chapter=chapter, stage="precommit")
    if not gate["ok"]:
        raise ValueError("precommit gate 未通过: " + json.dumps(gate["errors"], ensure_ascii=False))

    service = ChapterCommitService(root)
    commit = service.build_commit(chapter, review, fulfillment, disambiguation, extraction)
    service.persist_commit(commit)
    commit = service.apply_projections(commit)
    record_write_step(root, chapter=chapter, step="commit", status="completed")
    record_write_step(root, chapter=chapter, step="projection", status="completed")
    post = run_write_gate(root, chapter=chapter, stage="postcommit")
    backup_ok = GitBackupManager(str(root)).backup(chapter)
    record_write_step(root, chapter=chapter, step="backup", status="completed" if backup_ok else "failed")
    return {
        "chapter_file": str(chapter_path), "commit_status": (commit.get("meta") or {}).get("status"),
        "projection_status": commit.get("projection_status") or {}, "postcommit": post, "backup_ok": backup_ok,
    }
