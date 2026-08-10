from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


PROMPT_VERSION = "writer-client/v1"
SYSTEM_PROMPT = """你是 Webnovel Writer 的小说创作模型层。你只生成文本或请求的 JSON，不能调用工具、不能声称写入文件。
必须遵守项目设定、卷合同、章合同和禁止项；动态任务位于最后一条用户消息。正文使用自然中文，避免模板腔和解释性前言。"""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).replace("\r\n", "\n")


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _read_text(path: Path, limit: int = 30_000) -> str:
    try:
        return path.read_text(encoding="utf-8")[:limit].replace("\r\n", "\n")
    except OSError:
        return ""


def build_common_context(project_root: str | Path, chapter: int | None = None) -> dict[str, Any]:
    root = Path(project_root).resolve()
    story = root / ".story-system"
    common: dict[str, Any] = {
        "prompt_version": PROMPT_VERSION,
        "master_setting": _read_json(story / "MASTER_SETTING.json"),
        "anti_patterns": _read_json(story / "anti_patterns.json"),
    }
    if chapter:
        try:
            from chapter_outline_loader import volume_num_for_chapter_from_state
            volume = volume_num_for_chapter_from_state(root, chapter) or ((chapter - 1) // 50 + 1)
        except Exception:
            volume = (chapter - 1) // 50 + 1
        common["volume_contract"] = _read_json(story / "volumes" / f"volume_{volume:03d}.json")
    style_candidates = sorted((root / "设定集").glob("*风格*.md")) if (root / "设定集").is_dir() else []
    common["style_guide"] = _read_text(style_candidates[0], 12_000) if style_candidates else ""
    return common


def prefix_id(model: str, common: dict[str, Any]) -> str:
    raw = f"{model}\n{canonical_json(common)}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def warmup_messages(common: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": "公共创作上下文如下。只回复 CACHE_READY，不要创作正文。\n" + canonical_json(common),
        },
    ]


def task_messages(common: dict[str, Any], acknowledgement: str, dynamic: dict[str, Any]) -> list[dict[str, str]]:
    messages = warmup_messages(common)
    messages.append({"role": "assistant", "content": acknowledgement})
    messages.append({"role": "user", "content": canonical_json(dynamic)})
    return messages


def latest_story_context(project_root: str | Path, chapter: int) -> dict[str, Any]:
    root = Path(project_root).resolve()
    payload: dict[str, Any] = {"chapter": chapter}
    try:
        import sys

        scripts = Path(__file__).resolve().parents[1] / "scripts"
        if str(scripts) not in sys.path:
            sys.path.insert(0, str(scripts))
        from extract_chapter_context import build_chapter_context_payload

        payload["chapter_context"] = build_chapter_context_payload(root, chapter)
    except Exception as exc:
        payload["context_warning"] = str(exc)
    return payload


def review_instruction(chapter: int, content: str) -> dict[str, Any]:
    return {
        "task": "review",
        "chapter": chapter,
        "requirements": "审查一致性、节奏、人物动机、章纲履约、文风和追读力。输出 JSON。blocking_count 必须等于 blocking=true 的问题数。",
        "json_schema": {
            "blocking_count": 0,
            "issues": [{"description": "", "severity": "low|medium|high|critical", "category": "", "location": "", "evidence": "", "fix_hint": "", "blocking": False}],
            "summary": "",
        },
        "content": content,
    }


def extraction_instruction(chapter: int, content: str) -> dict[str, Any]:
    return {
        "task": "extract_facts",
        "chapter": chapter,
        "requirements": "从已确认正文提取事实，禁止推测。输出严格 JSON。无内容的数组保持为空。accepted_events 中每项至少包含 event_type、subject、payload。",
        "json_schema": {
            "accepted_events": [], "state_deltas": [], "entity_deltas": [], "entities_appeared": [],
            "scenes": [], "chapter_meta": {}, "dominant_strand": "", "summary_text": "",
        },
        "content": content,
    }
