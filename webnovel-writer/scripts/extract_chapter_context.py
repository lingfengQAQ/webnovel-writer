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

from chapter_outline_loader import load_chapter_outline, load_chapter_plot_structure

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
    """解析真实书项目根（包含 `.webnovel/state.json` 的目录）。"""
    from project_locator import resolve_project_root

    if start_path is None:
        return resolve_project_root()
    return resolve_project_root(str(start_path))


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


def extract_state_summary(project_root: Path) -> str:
    """Extract key fields from `.webnovel/state.json`."""
    state_file = project_root / ".webnovel" / "state.json"
    if not state_file.exists():
        return "⚠️ state.json 不存在"

    state = json.loads(state_file.read_text(encoding="utf-8"))
    summary_parts: List[str] = []

    if "progress" in state:
        progress = state["progress"]
        summary_parts.append(
            f"**进度**: 第{progress.get('current_chapter', '?')}章 / {progress.get('total_words', '?')}字"
        )

    if "protagonist_state" in state:
        ps = state["protagonist_state"]
        power = ps.get("power", {})
        summary_parts.append(f"**主角实力**: {power.get('realm', '?')} {power.get('layer', '?')}层")
        summary_parts.append(f"**当前位置**: {ps.get('location', '?')}")
        golden_finger = ps.get("golden_finger", {})
        summary_parts.append(
            f"**金手指**: {golden_finger.get('name', '?')} Lv.{golden_finger.get('level', '?')}"
        )

    if "strand_tracker" in state:
        tracker = state["strand_tracker"]
        history = tracker.get("history", [])[-5:]
        if history:
            items: List[str] = []
            for row in history:
                if not isinstance(row, dict):
                    continue
                chapter = row.get("chapter", "?")
                strand = row.get("strand") or row.get("dominant") or "unknown"
                items.append(f"Ch{chapter}:{strand}")
            if items:
                summary_parts.append(f"**近5章Strand**: {', '.join(items)}")

    plot_threads = state.get("plot_threads", {}) if isinstance(state.get("plot_threads"), dict) else {}
    foreshadowing = plot_threads.get("foreshadowing", [])
    if isinstance(foreshadowing, list) and foreshadowing:
        active = [row for row in foreshadowing if row.get("status") in {"active", "未回收"}]
        urgent = [row for row in active if row.get("urgency", 0) > 50]
        if urgent:
            urgent_list = [
                f"{row.get('content', '?')[:30]}... (紧急度:{row.get('urgency')})"
                for row in urgent[:3]
            ]
            summary_parts.append(f"**紧急伏笔**: {'; '.join(urgent_list)}")

    return "\n".join(summary_parts)


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
        "story_contract": (sections.get("story_contract") or {}).get("content", {}),
        "runtime_status": (sections.get("runtime_status") or {}).get("content", {}),
        "latest_commit": (sections.get("latest_commit") or {}).get("content", {}),
        "prewrite_validation": (sections.get("prewrite_validation") or {}).get("content", {}),
        "reader_signal": (sections.get("reader_signal") or {}).get("content", {}),
        "genre_profile": (sections.get("genre_profile") or {}).get("content", {}),
        "writing_guidance": (sections.get("writing_guidance") or {}).get("content", {}),
        "plot_structure": (sections.get("plot_structure") or {}).get("content", {}),
        "long_term_memory": (sections.get("long_term_memory") or {}).get("content", {}),
        "scene": (sections.get("scene") or {}).get("content", {}),
        "core": (sections.get("core") or {}).get("content", {}),
    }


def build_chapter_context_payload(project_root: Path, chapter_num: int) -> Dict[str, Any]:
    """Assemble full chapter context payload for text/json output."""
    outline = extract_chapter_outline(project_root, chapter_num)

    prev_summaries = []
    for prev_ch in range(max(1, chapter_num - 2), chapter_num):
        summary = extract_chapter_summary(project_root, prev_ch)
        prev_summaries.append(f"### 第{prev_ch}章摘要\n{summary}")

    state_summary = extract_state_summary(project_root)
    contract_context = _load_contract_context(project_root, chapter_num)
    plot_structure = contract_context.get("plot_structure") or load_chapter_plot_structure(project_root, chapter_num)
    rag_assist = _load_rag_assist(project_root, chapter_num, outline)

    return {
        "chapter": chapter_num,
        "outline": outline,
        "previous_summaries": prev_summaries,
        "state_summary": state_summary,
        "context_contract_version": contract_context.get("context_contract_version"),
        "context_weight_stage": contract_context.get("context_weight_stage"),
        "story_contract": contract_context.get("story_contract", {}),
        "runtime_status": contract_context.get("runtime_status", {}),
        "latest_commit": contract_context.get("latest_commit", {}),
        "prewrite_validation": contract_context.get("prewrite_validation", {}),
        "reader_signal": contract_context.get("reader_signal", {}),
        "genre_profile": contract_context.get("genre_profile", {}),
        "writing_guidance": contract_context.get("writing_guidance", {}),
        "plot_structure": plot_structure,
        "long_term_memory": contract_context.get("long_term_memory", {}),
        "scene": contract_context.get("scene", {}),
        "core": contract_context.get("core", {}),
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

    runtime_status = payload.get("runtime_status") or {}
    latest_commit = payload.get("latest_commit") or {}
    if runtime_status or latest_commit:
        fallback_sources = runtime_status.get("fallback_sources") or ["none"]
        lines.append("## Runtime Status")
        lines.append("")
        lines.append(f"- 写后事实入口: {runtime_status.get('primary_write_source', 'unknown')}")
        lines.append(f"- Legacy Fallback: {', '.join(str(item) for item in fallback_sources)}")
        lines.append(f"- Latest Commit: {(latest_commit.get('meta') or {}).get('status', 'missing')}")
        lines.append("")

    story_contract = payload.get("story_contract") or {}
    review_contract = story_contract.get("review_contract") or {}
    prewrite_validation = payload.get("prewrite_validation") or {}
    if review_contract or prewrite_validation:
        lines.append("## Contract-First Runtime")
        lines.append("")
        lines.append(
            f"- Review blocking rules: {len(review_contract.get('blocking_rules') or [])}"
        )
        lines.append(f"- Prewrite blocking: {prewrite_validation.get('blocking')}")
        forbidden_zones = prewrite_validation.get("forbidden_zones") or []
        if forbidden_zones:
            lines.append(f"- Forbidden zones: {len(forbidden_zones)}")
        planned_nodes = (
            (prewrite_validation.get("fulfillment_seed") or {}).get("planned_nodes") or []
        )
        if planned_nodes:
            lines.append(f"- Planned nodes: {len(planned_nodes)}")
        lines.append("")

    plot_structure = payload.get("plot_structure") or {}
    if plot_structure:
        lines.append("## 情节结构")
        lines.append("")
        cbn = str(plot_structure.get("cbn") or "").strip()
        if cbn:
            lines.append(f"- CBN: {cbn}")
        for idx, item in enumerate(plot_structure.get("cpns") or [], start=1):
            lines.append(f"- CPN{idx}: {item}")
        cen = str(plot_structure.get("cen") or "").strip()
        if cen:
            lines.append(f"- CEN: {cen}")
        mandatory_nodes = plot_structure.get("mandatory_nodes") or []
        if mandatory_nodes:
            lines.append("- 必须覆盖节点: " + " | ".join(str(x) for x in mandatory_nodes))
        prohibitions = plot_structure.get("prohibitions") or []
        if prohibitions:
            lines.append("- 本章禁区: " + " | ".join(str(x) for x in prohibitions))
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

    long_term_memory = payload.get("long_term_memory") or {}
    if long_term_memory:
        lines.append("## 长期记忆")
        lines.append("")
        stats = long_term_memory.get("stats") or {}
        if stats:
            lines.append(
                f"- 注入条目: {stats.get('injected', 0)} / 总条目: {stats.get('total', 0)}"
            )
        active_constraints = long_term_memory.get("active_constraints") or []
        if active_constraints:
            lines.append("- 活跃约束:")
            for row in active_constraints[:5]:
                value = str(row.get("value", "") or "").strip()
                subject = str(row.get("subject", "") or "").strip()
                if subject:
                    lines.append(f"  - [{subject}] {value}")
                else:
                    lines.append(f"  - {value}")
        facts = long_term_memory.get("long_term_facts") or []
        if facts:
            lines.append("- 关键长期事实:")
            for row in facts[:5]:
                category = str(row.get("category", "") or "").strip()
                subject = str(row.get("subject", "") or "").strip()
                field = str(row.get("field", "") or "").strip()
                value = str(row.get("value", "") or "").strip()
                lines.append(f"  - ({category}) {subject}.{field} = {value}")
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
    parser.add_argument("--chapter", type=int, required=True, help="目标章节号")
    parser.add_argument("--project-root", type=str, help="项目根目录")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="输出格式")

    args = parser.parse_args()

    try:
        project_root = (
            find_project_root(Path(args.project_root))
            if args.project_root
            else find_project_root()
        )
        payload = build_chapter_context_payload(project_root, args.chapter)

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

