#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_chapter_context.py - extract chapter writing context

Features:
- chapter outline snippet
- previous chapter summaries (prefers .webnovel/summaries)
- compact state summary
- ContextManager contract sections (reader_signal / genre_profile / writing_guidance)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

from chapter_outline_loader import load_chapter_outline

from runtime_compat import enable_windows_utf8_stdio

try:
    from chapter_paths import find_chapter_file
except ImportError:  # pragma: no cover
    from scripts.chapter_paths import find_chapter_file


def _ensure_scripts_path():
    scripts_dir = Path(__file__).resolve().parent
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


_RAG_TRIGGER_KEYWORDS = (
    "关系",
    "恩怨",
    "冲突",
    "敌对",
    "同盟",
    "师徒",
    "身份",
    "线索",
    "伏笔",
    "回收",
    "地点",
    "势力",
    "真相",
    "来历",
)


def find_project_root(start_path: Path | None = None) -> Path:
    """解析项目根目录；显式路径允许在 state 缺失时降级继续。"""
    from project_locator import resolve_project_root

    if start_path is None:
        return resolve_project_root()

    candidate = Path(start_path).expanduser()
    resolved_candidate = candidate.resolve()
    marker_exists = resolved_candidate.is_dir() and any(
        (resolved_candidate / marker).exists()
        for marker in (".webnovel", "正文", "大纲")
    )

    try:
        resolved = resolve_project_root(str(candidate))
        if marker_exists and resolved != resolved_candidate:
            return resolved_candidate
        return resolved
    except FileNotFoundError:
        if marker_exists:
            return resolved_candidate
        raise


def extract_chapter_outline(project_root: Path, chapter_num: int) -> str:
    """Extract chapter outline segment from volume outline file."""
    return load_chapter_outline(project_root, chapter_num, max_chars=1500)


def _load_summary_file(project_root: Path, chapter_num: int) -> str:
    """Load summary section from `.webnovel/summaries/chNNNN.md`."""
    summary_path = project_root / ".webnovel" / "summaries" / f"ch{chapter_num:04d}.md"
    if not summary_path.exists():
        return ""

    text = summary_path.read_text(encoding="utf-8")
    summary_match = re.search(r"##\s*剧情摘要\s*\r?\n(.+?)(?=\r?\n##|$)", text, re.DOTALL)
    if summary_match:
        return summary_match.group(1).strip()
    return ""


def extract_chapter_summary(project_root: Path, chapter_num: int) -> str:
    """Extract chapter summary, fallback to chapter body head."""
    summary = _load_summary_file(project_root, chapter_num)
    if summary:
        return summary

    chapter_file = find_chapter_file(project_root, chapter_num)
    if not chapter_file or not chapter_file.exists():
        return f"⚠️ 第{chapter_num}章文件不存在"

    content = chapter_file.read_text(encoding="utf-8")

    summary_match = re.search(r"##\s*本章摘要\s*\r?\n(.+?)(?=\r?\n##|$)", content, re.DOTALL)
    if summary_match:
        return summary_match.group(1).strip()

    stats_match = re.search(r"##\s*本章统计\s*\r?\n(.+?)(?=\r?\n##|$)", content, re.DOTALL)
    if stats_match:
        return f"[无摘要，仅统计]\n{stats_match.group(1).strip()}"

    lines = content.split("\n")
    text_lines = [line for line in lines if not line.startswith("#") and line.strip()]
    text = "\n".join(text_lines)[:500]
    return f"[自动截取前500字]\n{text}..."


def _safe_text(value: Any, default: str = "?") -> str:
    if isinstance(value, str):
        text = value.strip()
        return text or default
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def _extract_location(location: Any) -> str:
    """兼容 location 为字符串或对象（含嵌套 current/name）。"""
    if isinstance(location, str):
        text = location.strip()
        return text or "?"

    if not isinstance(location, dict):
        return "?"

    queue: List[Dict[str, Any]] = [location]
    visited: set[int] = set()
    while queue:
        node = queue.pop(0)
        marker = id(node)
        if marker in visited:
            continue
        visited.add(marker)

        for key in ("current", "name", "display", "value", "location"):
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                queue.append(value)

        for value in node.values():
            if isinstance(value, dict):
                queue.append(value)

    return "?"


def _load_state_payload(project_root: Path) -> tuple[Dict[str, Any], str]:
    state_file = project_root / ".webnovel" / "state.json"
    if not state_file.exists():
        return {}, f"⚠️ state.json 缺失: {state_file}"

    try:
        raw = json.loads(state_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {}, f"⚠️ state.json 解析失败({exc.__class__.__name__}): {state_file}"

    if not isinstance(raw, dict):
        return {}, f"⚠️ state.json 根结构异常（需为对象）: {state_file}"

    return raw, ""


def extract_state_snapshot(project_root: Path) -> Dict[str, Any]:
    """抽取状态快照（供 text/json 共用）。"""
    state, warning = _load_state_payload(project_root)

    progress = state.get("progress") if isinstance(state.get("progress"), dict) else {}
    protagonist_state = (
        state.get("protagonist_state")
        if isinstance(state.get("protagonist_state"), dict)
        else {}
    )
    power = protagonist_state.get("power") if isinstance(protagonist_state.get("power"), dict) else {}
    golden_finger = (
        protagonist_state.get("golden_finger")
        if isinstance(protagonist_state.get("golden_finger"), dict)
        else {}
    )

    history_rows = []
    tracker = state.get("strand_tracker")
    if isinstance(tracker, dict):
        raw_history = tracker.get("history")
        if isinstance(raw_history, list):
            history_rows = raw_history[-5:]

    history: List[Dict[str, Any]] = []
    for row in history_rows:
        if not isinstance(row, dict):
            continue
        history.append(
            {
                "chapter": row.get("chapter", "?"),
                "strand": _safe_text(row.get("strand") or row.get("dominant") or "unknown", "unknown"),
            }
        )

    urgent_foreshadowing: List[Dict[str, Any]] = []
    plot_threads = state.get("plot_threads")
    if isinstance(plot_threads, dict):
        foreshadowing_rows = plot_threads.get("foreshadowing")
        if isinstance(foreshadowing_rows, list):
            for row in foreshadowing_rows:
                if not isinstance(row, dict):
                    continue
                status = row.get("status")
                if status not in {"active", "未回收"}:
                    continue
                try:
                    urgency = float(row.get("urgency") or 0)
                except (TypeError, ValueError):
                    urgency = 0
                if urgency <= 50:
                    continue
                urgent_foreshadowing.append(
                    {
                        "content": _safe_text(row.get("content"), "?")[:30],
                        "urgency": row.get("urgency"),
                    }
                )
                if len(urgent_foreshadowing) >= 3:
                    break

    return {
        "warning": warning,
        "progress": {
            "current_chapter": progress.get("current_chapter", "?"),
            "total_words": progress.get("total_words", "?"),
        },
        "protagonist": {
            "realm": _safe_text(power.get("realm"), "?"),
            "layer": _safe_text(power.get("layer"), "?"),
            "location": _extract_location(protagonist_state.get("location")),
            "golden_finger_name": _safe_text(golden_finger.get("name"), "?"),
            "golden_finger_level": _safe_text(golden_finger.get("level"), "?"),
        },
        "strand_history": history,
        "urgent_foreshadowing": urgent_foreshadowing,
    }


def _render_state_snapshot(state_snapshot: Dict[str, Any]) -> str:
    summary_parts: List[str] = []
    warning = _safe_text(state_snapshot.get("warning"), "").strip()
    if warning:
        summary_parts.append(warning)

    progress = state_snapshot.get("progress") if isinstance(state_snapshot.get("progress"), dict) else {}
    summary_parts.append(
        f"**进度**: 第{progress.get('current_chapter', '?')}章 / {progress.get('total_words', '?')}字"
    )

    protagonist = (
        state_snapshot.get("protagonist")
        if isinstance(state_snapshot.get("protagonist"), dict)
        else {}
    )
    summary_parts.append(
        f"**主角实力**: {_safe_text(protagonist.get('realm'), '?')} {_safe_text(protagonist.get('layer'), '?')}层"
    )
    summary_parts.append(f"**当前位置**: {_safe_text(protagonist.get('location'), '?')}")
    summary_parts.append(
        f"**金手指**: {_safe_text(protagonist.get('golden_finger_name'), '?')} "
        f"Lv.{_safe_text(protagonist.get('golden_finger_level'), '?')}"
    )

    history = state_snapshot.get("strand_history")
    if isinstance(history, list) and history:
        items: List[str] = []
        for row in history:
            if not isinstance(row, dict):
                continue
            items.append(f"Ch{row.get('chapter', '?')}:{_safe_text(row.get('strand') or row.get('dominant'), 'unknown')}")
        if items:
            summary_parts.append(f"**近5章Strand**: {', '.join(items)}")

    urgent_foreshadowing = state_snapshot.get("urgent_foreshadowing")
    if isinstance(urgent_foreshadowing, list) and urgent_foreshadowing:
        urgent_items: List[str] = []
        for row in urgent_foreshadowing[:3]:
            if not isinstance(row, dict):
                continue
            urgent_items.append(
                f"{_safe_text(row.get('content'), '?')}... (紧急度:{_safe_text(row.get('urgency'), '?')})"
            )
        if urgent_items:
            summary_parts.append(f"**紧急伏笔**: {'; '.join(urgent_items)}")

    return "\n".join(summary_parts)


def extract_state_summary(project_root: Path) -> str:
    """Extract key fields from `.webnovel/state.json`."""
    return _render_state_snapshot(extract_state_snapshot(project_root))


def _normalize_outline_text(outline: str) -> str:
    text = str(outline or "")
    if not text or text.startswith("⚠️"):
        return ""
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _build_rag_query(outline: str, chapter_num: int, min_chars: int, max_chars: int) -> str:
    plain = _normalize_outline_text(outline)
    if not plain or len(plain) < min_chars:
        return ""

    if not any(keyword in plain for keyword in _RAG_TRIGGER_KEYWORDS):
        return ""

    if "关系" in plain or "师徒" in plain or "敌对" in plain or "同盟" in plain:
        topic = "人物关系与动机"
    elif "地点" in plain or "势力" in plain:
        topic = "地点势力与场景约束"
    elif "伏笔" in plain or "线索" in plain or "回收" in plain:
        topic = "伏笔与线索"
    else:
        topic = "剧情关键线索"

    clean_max = max(40, int(max_chars))
    return f"第{chapter_num}章 {topic}：{plain[:clean_max]}"


def _search_with_rag(
    project_root: Path,
    chapter_num: int,
    query: str,
    top_k: int,
) -> Dict[str, Any]:
    _ensure_scripts_path()
    from data_modules.config import DataModulesConfig
    from data_modules.rag_adapter import RAGAdapter

    config = DataModulesConfig.from_project_root(project_root)
    adapter = RAGAdapter(config)
    intent_payload = adapter.query_router.route_intent(query)
    center_entities = list(intent_payload.get("entities") or [])

    results = []
    mode = "auto"
    fallback_reason = ""
    has_embed_key = bool(str(getattr(config, "embed_api_key", "") or "").strip())
    if has_embed_key:
        try:
            results = asyncio.run(
                adapter.search(
                    query=query,
                    top_k=top_k,
                    strategy="auto",
                    chapter=chapter_num,
                    center_entities=center_entities,
                )
            )
        except Exception as exc:
            fallback_reason = f"auto_failed:{exc.__class__.__name__}"
            mode = "bm25_fallback"
            results = adapter.bm25_search(query=query, top_k=top_k, chapter=chapter_num)
    else:
        mode = "bm25_fallback"
        fallback_reason = "missing_embed_api_key"
        results = adapter.bm25_search(query=query, top_k=top_k, chapter=chapter_num)

    hits: List[Dict[str, Any]] = []
    for row in results:
        content = re.sub(r"\s+", " ", str(getattr(row, "content", "") or "")).strip()
        hits.append(
            {
                "chunk_id": str(getattr(row, "chunk_id", "") or ""),
                "chapter": int(getattr(row, "chapter", 0) or 0),
                "scene_index": int(getattr(row, "scene_index", 0) or 0),
                "score": round(float(getattr(row, "score", 0.0) or 0.0), 6),
                "source": str(getattr(row, "source", "") or mode),
                "source_file": str(getattr(row, "source_file", "") or ""),
                "content": content[:180],
            }
        )

    return {
        "invoked": True,
        "query": query,
        "mode": mode,
        "reason": fallback_reason or ("ok" if hits else "no_hit"),
        "intent": intent_payload.get("intent"),
        "needs_graph": bool(intent_payload.get("needs_graph")),
        "center_entities": center_entities,
        "hits": hits,
    }


def _load_rag_assist(project_root: Path, chapter_num: int, outline: str) -> Dict[str, Any]:
    _ensure_scripts_path()
    from data_modules.config import DataModulesConfig

    config = DataModulesConfig.from_project_root(project_root)
    enabled = bool(getattr(config, "context_rag_assist_enabled", True))
    top_k = max(1, int(getattr(config, "context_rag_assist_top_k", 4)))
    min_chars = max(20, int(getattr(config, "context_rag_assist_min_outline_chars", 40)))
    max_chars = max(40, int(getattr(config, "context_rag_assist_max_query_chars", 120)))
    base_payload = {"enabled": enabled, "invoked": False, "reason": "", "query": "", "hits": []}

    if not enabled:
        base_payload["reason"] = "disabled_by_config"
        return base_payload

    query = _build_rag_query(outline, chapter_num=chapter_num, min_chars=min_chars, max_chars=max_chars)
    if not query:
        base_payload["reason"] = "outline_not_actionable"
        return base_payload

    vector_db = config.vector_db
    if not vector_db.exists() or vector_db.stat().st_size <= 0:
        base_payload["reason"] = "vector_db_missing_or_empty"
        return base_payload

    try:
        rag_payload = _search_with_rag(project_root=project_root, chapter_num=chapter_num, query=query, top_k=top_k)
        rag_payload["enabled"] = True
        return rag_payload
    except Exception as exc:
        base_payload["reason"] = f"rag_error:{exc.__class__.__name__}"
        return base_payload


def _load_contract_context(project_root: Path, chapter_num: int) -> Dict[str, Any]:
    """Build context via ContextManager and return selected sections."""
    _ensure_scripts_path()
    from data_modules.config import DataModulesConfig
    from data_modules.context_manager import ContextManager

    config = DataModulesConfig.from_project_root(project_root)
    manager = ContextManager(config)
    payload = manager.build_context(
        chapter=chapter_num,
        template="plot",
        use_snapshot=True,
        save_snapshot=True,
        max_chars=8000,
    )

    sections = payload.get("sections", {})
    return {
        "context_contract_version": (payload.get("meta") or {}).get("context_contract_version"),
        "context_weight_stage": (payload.get("meta") or {}).get("context_weight_stage"),
        "reader_signal": (sections.get("reader_signal") or {}).get("content", {}),
        "genre_profile": (sections.get("genre_profile") or {}).get("content", {}),
        "writing_guidance": (sections.get("writing_guidance") or {}).get("content", {}),
    }


def _empty_rag_payload(reason: str) -> Dict[str, Any]:
    return {"enabled": False, "invoked": False, "reason": reason, "query": "", "hits": []}


def _ensure_target_chapter_exists(project_root: Path, chapter_num: int) -> bool:
    """检查目标章节文件是否存在。

    返回 True 表示文件存在，False 表示不存在（写作新章节时的正常状态）。
    不再抛出异常，由调用方决定如何处理。
    """
    chapter_file = find_chapter_file(project_root, chapter_num)
    return bool(chapter_file and chapter_file.exists())


def build_chapter_context_payload(project_root: Path, chapter_num: int) -> Dict[str, Any]:
    """Assemble full chapter context payload for text/json output."""
    outline = extract_chapter_outline(project_root, chapter_num)

    prev_summaries = []
    for prev_ch in range(max(1, chapter_num - 2), chapter_num):
        summary = extract_chapter_summary(project_root, prev_ch)
        prev_summaries.append(f"### 第{prev_ch}章摘要\n{summary}")

    state_snapshot = extract_state_snapshot(project_root)
    state_summary = _render_state_snapshot(state_snapshot)
    warnings: List[str] = []
    state_warning = _safe_text(state_snapshot.get("warning"), "").strip()
    if state_warning:
        warnings.append(state_warning)

    contract_context: Dict[str, Any]
    rag_assist: Dict[str, Any]
    if state_warning:
        contract_context = {}
        rag_assist = _empty_rag_payload("state_missing")
    else:
        try:
            contract_context = _load_contract_context(project_root, chapter_num)
        except Exception as exc:
            warnings.append(f"⚠️ Contract 上下文加载失败({exc.__class__.__name__})")
            contract_context = {}

        try:
            rag_assist = _load_rag_assist(project_root, chapter_num, outline)
        except Exception as exc:
            warnings.append(f"⚠️ RAG 辅助加载失败({exc.__class__.__name__})")
            rag_assist = _empty_rag_payload(f"rag_error:{exc.__class__.__name__}")

    return {
        "chapter": chapter_num,
        "outline": outline,
        "previous_summaries": prev_summaries,
        "state": state_snapshot,
        "state_summary": state_summary,
        "warnings": warnings,
        "context_contract_version": contract_context.get("context_contract_version"),
        "context_weight_stage": contract_context.get("context_weight_stage"),
        "reader_signal": contract_context.get("reader_signal", {}),
        "genre_profile": contract_context.get("genre_profile", {}),
        "writing_guidance": contract_context.get("writing_guidance", {}),
        "rag_assist": rag_assist,
    }


def _render_text(payload: Dict[str, Any]) -> str:
    chapter_num = payload.get("chapter")
    lines: List[str] = []

    lines.append(f"# 第 {chapter_num} 章创作上下文")
    lines.append("")

    lines.append("## 本章大纲")
    lines.append("")
    lines.append(str(payload.get("outline", "")))
    lines.append("")
    lines.append("---")
    lines.append("")

    lines.append("## 前文摘要")
    lines.append("")
    for item in payload.get("previous_summaries", []):
        lines.append(item)
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 当前状态")
    lines.append("")
    state_snapshot = payload.get("state")
    if isinstance(state_snapshot, dict):
        lines.append(_render_state_snapshot(state_snapshot))
    else:
        lines.append(str(payload.get("state_summary", "")))
    lines.append("")

    contract_version = payload.get("context_contract_version")
    if contract_version:
        lines.append(f"## Contract ({contract_version})")
        lines.append("")
        stage = payload.get("context_weight_stage")
        if stage:
            lines.append(f"- 上下文阶段权重: {stage}")
            lines.append("")

    writing_guidance = payload.get("writing_guidance") or {}
    guidance_items = writing_guidance.get("guidance_items") or []
    checklist = writing_guidance.get("checklist") or []
    checklist_score = writing_guidance.get("checklist_score") or {}
    methodology = writing_guidance.get("methodology") or {}
    if guidance_items or checklist:
        lines.append("## 写作执行建议")
        lines.append("")
        for idx, item in enumerate(guidance_items, start=1):
            lines.append(f"{idx}. {item}")

        if checklist:
            total_weight = 0.0
            required_count = 0
            for row in checklist:
                if isinstance(row, dict):
                    try:
                        total_weight += float(row.get("weight") or 0)
                    except (TypeError, ValueError):
                        pass
                    if row.get("required"):
                        required_count += 1

            lines.append("")
            lines.append("### 执行检查清单（可评分）")
            lines.append("")
            lines.append(f"- 项目数: {len(checklist)}")
            lines.append(f"- 总权重: {total_weight:.2f}")
            lines.append(f"- 必做项: {required_count}")
            lines.append("")

            for idx, row in enumerate(checklist, start=1):
                if not isinstance(row, dict):
                    lines.append(f"{idx}. {row}")
                    continue
                label = str(row.get("label") or "").strip() or "未命名项"
                weight = row.get("weight")
                required_tag = "必做" if row.get("required") else "可选"
                verify_hint = str(row.get("verify_hint") or "").strip()
                lines.append(f"{idx}. [{required_tag}][w={weight}] {label}")
                if verify_hint:
                    lines.append(f"   - 验收: {verify_hint}")

        if checklist_score:
            lines.append("")
            lines.append("### 执行评分")
            lines.append("")
            lines.append(f"- 评分: {checklist_score.get('score')}")
            lines.append(f"- 完成率: {checklist_score.get('completion_rate')}")
            lines.append(f"- 必做完成率: {checklist_score.get('required_completion_rate')}")

        lines.append("")

    if isinstance(methodology, dict) and methodology.get("enabled"):
        lines.append("## 长篇方法论策略")
        lines.append("")
        lines.append(f"- 框架: {methodology.get('framework')}")
        methodology_scope = methodology.get("genre_profile_key") or methodology.get("pilot") or "general"
        lines.append(f"- 适用题材: {methodology_scope}")
        lines.append(f"- 章节阶段: {methodology.get('chapter_stage')}")
        observability = methodology.get("observability") or {}
        if observability:
            lines.append(
                "- 指标: "
                f"next_reason={observability.get('next_reason_clarity')}, "
                f"anchor={observability.get('anchor_effectiveness')}, "
                f"rhythm={observability.get('rhythm_naturalness')}"
            )
        signals = methodology.get("signals") or {}
        risk_flags = list(signals.get("risk_flags") or [])
        if risk_flags:
            lines.append(f"- 风险标记: {', '.join(str(flag) for flag in risk_flags)}")
        lines.append("")

    reader_signal = payload.get("reader_signal") or {}
    review_trend = reader_signal.get("review_trend") or {}
    if review_trend:
        overall_avg = review_trend.get("overall_avg")
        lines.append("## 追读信号")
        lines.append("")
        lines.append(f"- 最近审查均分: {overall_avg}")
        low_ranges = reader_signal.get("low_score_ranges") or []
        if low_ranges:
            lines.append(f"- 低分区间数: {len(low_ranges)}")
        lines.append("")

    genre_profile = payload.get("genre_profile") or {}
    if genre_profile.get("genre"):
        lines.append("## 题材锚定")
        lines.append("")
        lines.append(f"- 题材: {genre_profile.get('genre')}")
        genres = genre_profile.get("genres") or []
        if len(genres) > 1:
            lines.append(f"- 复合题材: {' + '.join(str(token) for token in genres)}")
            composite_hints = genre_profile.get("composite_hints") or []
            for row in composite_hints[:2]:
                lines.append(f"- {row}")
        refs = genre_profile.get("reference_hints") or []
        for row in refs[:3]:
            lines.append(f"- {row}")
        lines.append("")

    rag_assist = payload.get("rag_assist") or {}
    hits = rag_assist.get("hits") or []
    if rag_assist.get("invoked") and hits:
        lines.append("## RAG 检索线索")
        lines.append("")
        lines.append(f"- 模式: {rag_assist.get('mode')}")
        lines.append(f"- 意图: {rag_assist.get('intent')}")
        lines.append(f"- 查询: {rag_assist.get('query')}")
        lines.append("")
        for idx, row in enumerate(hits[:5], start=1):
            chapter = row.get("chapter", "?")
            scene_index = row.get("scene_index", "?")
            score = row.get("score", 0)
            source = row.get("source", "unknown")
            content = row.get("content", "")
            lines.append(f"{idx}. [Ch{chapter}-S{scene_index}][{source}][score={score}] {content}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main():
    parser = argparse.ArgumentParser(description="提取章节创作所需的精简上下文")
    parser.add_argument(
        "--chapter",
        type=int,
        required=True,
        help="目标章节号（必须可在正文目录定位到对应章节文件）",
    )
    parser.add_argument(
        "--project-root",
        type=str,
        help="项目根目录（state.json 缺失时将给出警告并降级输出）",
    )
    parser.add_argument("--format", choices=["text", "json"], default="text", help="输出格式")

    args = parser.parse_args()

    try:
        project_root = (
            find_project_root(Path(args.project_root))
            if args.project_root
            else find_project_root()
        )
        # P0-1 修复：章节文件不存在是写作新章节时的正常状态，不崩溃，只记录警告
        chapter_exists = _ensure_target_chapter_exists(project_root, args.chapter)
        payload = build_chapter_context_payload(project_root, args.chapter)
        if not chapter_exists:
            chapters_dir = project_root / "正文"
            payload.setdefault("warnings", []).append(
                f"⚠️ 第{args.chapter}章文件尚未创建（{chapters_dir}），"
                "写作完成后 Data Agent 将更新状态。"
            )

        if args.format == "json":
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(_render_text(payload), end="")

    except Exception as exc:
        print(f"❌ 错误: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if sys.platform == "win32":
        enable_windows_utf8_stdio()
    main()

