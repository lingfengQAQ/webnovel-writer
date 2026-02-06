#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ContextManager - assemble context packs with weighted priorities.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import get_config
from .index_manager import IndexManager, WritingChecklistScoreMeta
from .context_ranker import ContextRanker
from .snapshot_manager import SnapshotManager, SnapshotVersionMismatch


class ContextManager:
    DEFAULT_TEMPLATE = "plot"
    TEMPLATE_WEIGHTS = {
        "plot": {"core": 0.40, "scene": 0.35, "global": 0.25},
        "battle": {"core": 0.35, "scene": 0.45, "global": 0.20},
        "emotion": {"core": 0.45, "scene": 0.35, "global": 0.20},
        "transition": {"core": 0.50, "scene": 0.25, "global": 0.25},
    }

    TEMPLATE_WEIGHTS_DYNAMIC = {
        "early": {
            "plot": {"core": 0.48, "scene": 0.39, "global": 0.13},
            "battle": {"core": 0.42, "scene": 0.50, "global": 0.08},
            "emotion": {"core": 0.52, "scene": 0.38, "global": 0.10},
            "transition": {"core": 0.56, "scene": 0.28, "global": 0.16},
        },
        "mid": {
            "plot": {"core": 0.40, "scene": 0.35, "global": 0.25},
            "battle": {"core": 0.35, "scene": 0.45, "global": 0.20},
            "emotion": {"core": 0.45, "scene": 0.35, "global": 0.20},
            "transition": {"core": 0.50, "scene": 0.25, "global": 0.25},
        },
        "late": {
            "plot": {"core": 0.36, "scene": 0.29, "global": 0.35},
            "battle": {"core": 0.31, "scene": 0.39, "global": 0.30},
            "emotion": {"core": 0.41, "scene": 0.29, "global": 0.30},
            "transition": {"core": 0.46, "scene": 0.21, "global": 0.33},
        },
    }
    EXTRA_SECTIONS = {
        "story_skeleton",
        "memory",
        "preferences",
        "alerts",
        "reader_signal",
        "genre_profile",
        "writing_guidance",
    }
    SECTION_ORDER = [
        "core",
        "scene",
        "global",
        "reader_signal",
        "genre_profile",
        "writing_guidance",
        "story_skeleton",
        "memory",
        "preferences",
        "alerts",
    ]
    SUMMARY_SECTION_RE = re.compile(r"##\s*剧情摘要\s*\r?\n(.*?)(?=\r?\n##|\Z)", re.DOTALL)

    def __init__(self, config=None, snapshot_manager: Optional[SnapshotManager] = None):
        self.config = config or get_config()
        self.snapshot_manager = snapshot_manager or SnapshotManager(self.config)
        self.index_manager = IndexManager(self.config)
        self.context_ranker = ContextRanker(self.config)

    def _is_snapshot_compatible(self, cached: Dict[str, Any], template: str) -> bool:
        """判断快照是否可用于当前模板。"""
        if not isinstance(cached, dict):
            return False

        meta = cached.get("meta")
        if not isinstance(meta, dict):
            # 兼容旧快照：未记录 template 时仅允许默认模板复用
            return template == self.DEFAULT_TEMPLATE

        cached_template = meta.get("template")
        if not isinstance(cached_template, str):
            return template == self.DEFAULT_TEMPLATE

        return cached_template == template

    def build_context(
        self,
        chapter: int,
        template: str | None = None,
        use_snapshot: bool = True,
        save_snapshot: bool = True,
        max_chars: Optional[int] = None,
    ) -> Dict[str, Any]:
        template = template or self.DEFAULT_TEMPLATE
        self._active_template = template
        if template not in self.TEMPLATE_WEIGHTS:
            template = self.DEFAULT_TEMPLATE
            self._active_template = template

        if use_snapshot:
            try:
                cached = self.snapshot_manager.load_snapshot(chapter)
                if cached and self._is_snapshot_compatible(cached, template):
                    return cached.get("payload", cached)
            except SnapshotVersionMismatch:
                # Snapshot incompatible; rebuild below.
                pass

        pack = self._build_pack(chapter)
        if getattr(self.config, "context_ranker_enabled", True):
            pack = self.context_ranker.rank_pack(pack, chapter)
        assembled = self.assemble_context(pack, template=template, max_chars=max_chars)

        if save_snapshot:
            meta = {"template": template}
            self.snapshot_manager.save_snapshot(chapter, assembled, meta=meta)

        return assembled

    def assemble_context(
        self,
        pack: Dict[str, Any],
        template: str = DEFAULT_TEMPLATE,
        max_chars: Optional[int] = None,
    ) -> Dict[str, Any]:
        chapter = int((pack.get("meta") or {}).get("chapter") or 0)
        weights = self._resolve_template_weights(template=template, chapter=chapter)
        max_chars = max_chars or 8000
        extra_budget = int(self.config.context_extra_section_budget or 0)

        sections = {}
        for section_name in self.SECTION_ORDER:
            if section_name in pack:
                sections[section_name] = pack[section_name]

        assembled: Dict[str, Any] = {"meta": pack.get("meta", {}), "sections": {}}
        for name, content in sections.items():
            weight = weights.get(name, 0.0)
            if weight > 0:
                budget = int(max_chars * weight)
            elif name in self.EXTRA_SECTIONS and extra_budget > 0:
                budget = extra_budget
            else:
                budget = None
            text = self._compact_json_text(content, budget)
            assembled["sections"][name] = {"content": content, "text": text, "budget": budget}

        assembled["template"] = template
        assembled["weights"] = weights
        if chapter > 0:
            assembled.setdefault("meta", {})["context_weight_stage"] = self._resolve_context_stage(chapter)
        return assembled

    def filter_invalid_items(self, items: List[Dict[str, Any]], source_type: str, id_key: str) -> List[Dict[str, Any]]:
        confirmed = self.index_manager.get_invalid_ids(source_type, status="confirmed")
        pending = self.index_manager.get_invalid_ids(source_type, status="pending")
        result = []
        for item in items:
            item_id = str(item.get(id_key, ""))
            if item_id in confirmed:
                continue
            if item_id in pending:
                item = dict(item)
                item["warning"] = "pending_invalid"
            result.append(item)
        return result

    def apply_confidence_filter(self, items: List[Dict[str, Any]], min_confidence: float) -> List[Dict[str, Any]]:
        filtered: List[Dict[str, Any]] = []
        for item in items:
            conf = item.get("confidence")
            if conf is None or conf >= min_confidence:
                filtered.append(item)
        return filtered

    def _build_pack(self, chapter: int) -> Dict[str, Any]:
        state = self._load_state()
        core = {
            "chapter_outline": self._load_outline(chapter),
            "protagonist_snapshot": state.get("protagonist_state", {}),
            "recent_summaries": self._load_recent_summaries(
                chapter,
                window=self.config.context_recent_summaries_window,
            ),
            "recent_meta": self._load_recent_meta(
                state,
                chapter,
                window=self.config.context_recent_meta_window,
            ),
        }

        scene = {
            "location_context": state.get("protagonist_state", {}).get("location", {}),
            "appearing_characters": self._load_recent_appearances(
                limit=self.config.context_max_appearing_characters,
            ),
        }
        scene["appearing_characters"] = self.filter_invalid_items(
            scene["appearing_characters"], source_type="entity", id_key="entity_id"
        )

        global_ctx = {
            "worldview_skeleton": self._load_setting("世界观"),
            "power_system_skeleton": self._load_setting("力量体系"),
            "style_contract_ref": self._load_setting("风格契约"),
        }

        preferences = self._load_json_optional(self.config.webnovel_dir / "preferences.json")
        memory = self._load_json_optional(self.config.webnovel_dir / "project_memory.json")
        story_skeleton = self._load_story_skeleton(chapter)
        alert_slice = max(0, int(self.config.context_alerts_slice))
        reader_signal = self._load_reader_signal(chapter)
        genre_profile = self._load_genre_profile(state)
        writing_guidance = self._build_writing_guidance(chapter, reader_signal, genre_profile)

        return {
            "meta": {"chapter": chapter},
            "core": core,
            "scene": scene,
            "global": global_ctx,
            "reader_signal": reader_signal,
            "genre_profile": genre_profile,
            "writing_guidance": writing_guidance,
            "story_skeleton": story_skeleton,
            "preferences": preferences,
            "memory": memory,
            "alerts": {
                "disambiguation_warnings": (
                    state.get("disambiguation_warnings", [])[-alert_slice:] if alert_slice else []
                ),
                "disambiguation_pending": (
                    state.get("disambiguation_pending", [])[-alert_slice:] if alert_slice else []
                ),
            },
        }

    def _load_reader_signal(self, chapter: int) -> Dict[str, Any]:
        if not getattr(self.config, "context_reader_signal_enabled", True):
            return {}

        recent_limit = max(1, int(getattr(self.config, "context_reader_signal_recent_limit", 5)))
        pattern_window = max(1, int(getattr(self.config, "context_reader_signal_window_chapters", 20)))
        review_window = max(1, int(getattr(self.config, "context_reader_signal_review_window", 5)))
        include_debt = bool(getattr(self.config, "context_reader_signal_include_debt", False))

        recent_power = self.index_manager.get_recent_reading_power(limit=recent_limit)
        pattern_stats = self.index_manager.get_pattern_usage_stats(last_n_chapters=pattern_window)
        hook_stats = self.index_manager.get_hook_type_stats(last_n_chapters=pattern_window)
        review_trend = self.index_manager.get_review_trend_stats(last_n=review_window)

        low_score_ranges: List[Dict[str, Any]] = []
        for row in review_trend.get("recent_ranges", []):
            score = row.get("overall_score")
            if isinstance(score, (int, float)) and float(score) < 75:
                low_score_ranges.append(
                    {
                        "start_chapter": row.get("start_chapter"),
                        "end_chapter": row.get("end_chapter"),
                        "overall_score": score,
                    }
                )

        signal: Dict[str, Any] = {
            "recent_reading_power": recent_power,
            "pattern_usage": pattern_stats,
            "hook_type_usage": hook_stats,
            "review_trend": review_trend,
            "low_score_ranges": low_score_ranges,
            "next_chapter": chapter,
        }

        if include_debt:
            signal["debt_summary"] = self.index_manager.get_debt_summary()

        return signal

    def _load_genre_profile(self, state: Dict[str, Any]) -> Dict[str, Any]:
        if not getattr(self.config, "context_genre_profile_enabled", True):
            return {}

        fallback = str(getattr(self.config, "context_genre_profile_fallback", "shuangwen") or "shuangwen")
        genre_raw = str((state.get("project") or {}).get("genre") or fallback)
        genres = self._parse_genre_tokens(genre_raw)
        if not genres:
            genres = [fallback]
        max_genres = max(1, int(getattr(self.config, "context_genre_profile_max_genres", 2)))
        genres = genres[:max_genres]

        primary_genre = genres[0]
        secondary_genres = genres[1:]
        composite = len(genres) > 1
        profile_path = self.config.project_root / ".claude" / "references" / "genre-profiles.md"
        taxonomy_path = self.config.project_root / ".claude" / "references" / "reading-power-taxonomy.md"

        profile_text = profile_path.read_text(encoding="utf-8") if profile_path.exists() else ""
        taxonomy_text = taxonomy_path.read_text(encoding="utf-8") if taxonomy_path.exists() else ""

        profile_excerpt = self._extract_genre_section(profile_text, primary_genre)
        taxonomy_excerpt = self._extract_genre_section(taxonomy_text, primary_genre)

        secondary_profiles: List[str] = []
        secondary_taxonomies: List[str] = []
        for extra in secondary_genres:
            secondary_profiles.append(self._extract_genre_section(profile_text, extra))
            secondary_taxonomies.append(self._extract_genre_section(taxonomy_text, extra))

        refs = self._extract_markdown_refs(
            "\n".join([profile_excerpt] + secondary_profiles),
            max_items=int(getattr(self.config, "context_genre_profile_max_refs", 8)),
        )

        composite_hints = self._build_composite_genre_hints(genres, refs)

        return {
            "genre": primary_genre,
            "genre_raw": genre_raw,
            "genres": genres,
            "composite": composite,
            "secondary_genres": secondary_genres,
            "profile_excerpt": profile_excerpt,
            "taxonomy_excerpt": taxonomy_excerpt,
            "secondary_profile_excerpts": secondary_profiles,
            "secondary_taxonomy_excerpts": secondary_taxonomies,
            "reference_hints": refs,
            "composite_hints": composite_hints,
        }

    def _build_writing_guidance(
        self,
        chapter: int,
        reader_signal: Dict[str, Any],
        genre_profile: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not getattr(self.config, "context_writing_guidance_enabled", True):
            return {}

        guidance: List[str] = []
        limit = max(1, int(getattr(self.config, "context_writing_guidance_max_items", 6)))
        low_score_threshold = float(
            getattr(self.config, "context_writing_guidance_low_score_threshold", 75.0)
        )

        low_ranges = reader_signal.get("low_score_ranges") or []
        if low_ranges:
            worst = min(
                low_ranges,
                key=lambda row: float(row.get("overall_score", 9999)),
            )
            guidance.append(
                f"第{chapter}章优先修复近期低分段问题：参考{worst.get('start_chapter')}-{worst.get('end_chapter')}章，强化冲突推进与结尾钩子。"
            )

        hook_usage = reader_signal.get("hook_type_usage") or {}
        if hook_usage and getattr(self.config, "context_writing_guidance_hook_diversify", True):
            dominant_hook = max(hook_usage.items(), key=lambda kv: kv[1])[0]
            guidance.append(
                f"近期钩子类型“{dominant_hook}”使用偏多，本章建议做钩子差异化，避免连续同构。"
            )

        pattern_usage = reader_signal.get("pattern_usage") or {}
        if pattern_usage:
            top_pattern = max(pattern_usage.items(), key=lambda kv: kv[1])[0]
            guidance.append(
                f"爽点模式“{top_pattern}”近期高频，本章可保留主爽点但叠加一个新爽点副轴。"
            )

        review_trend = reader_signal.get("review_trend") or {}
        overall_avg = review_trend.get("overall_avg")
        if isinstance(overall_avg, (int, float)) and float(overall_avg) < low_score_threshold:
            guidance.append(
                f"最近审查均分{overall_avg:.1f}低于阈值{low_score_threshold:.1f}，建议先保稳：减少跳场、每段补动作结果闭环。"
            )

        genre = str(genre_profile.get("genre") or "").strip()
        refs = genre_profile.get("reference_hints") or []
        if genre:
            guidance.append(f"题材锚定：按“{genre}”叙事主线推进，保持题材读者预期稳定兑现。")
        if refs:
            guidance.append(f"题材策略可执行提示：{refs[0]}")

        composite_hints = genre_profile.get("composite_hints") or []
        if composite_hints:
            guidance.append(f"复合题材协同：{composite_hints[0]}")

        if not guidance:
            guidance.append("本章执行默认高可读策略：冲突前置、信息后置、段末留钩。")

        checklist = self._build_writing_checklist(
            chapter=chapter,
            guidance_items=guidance,
            reader_signal=reader_signal,
            genre_profile=genre_profile,
        )

        checklist_score = self._compute_writing_checklist_score(
            chapter=chapter,
            checklist=checklist,
            reader_signal=reader_signal,
        )

        if getattr(self.config, "context_writing_score_persist_enabled", True):
            self._persist_writing_checklist_score(checklist_score)

        return {
            "chapter": chapter,
            "guidance_items": guidance[:limit],
            "checklist": checklist,
            "checklist_score": checklist_score,
            "signals_used": {
                "has_low_score_ranges": bool(low_ranges),
                "hook_types": list(hook_usage.keys())[:3],
                "top_patterns": sorted(
                    pattern_usage,
                    key=pattern_usage.get,
                    reverse=True,
                )[:3],
                "genre": genre,
            },
        }

    def _compute_writing_checklist_score(
        self,
        chapter: int,
        checklist: List[Dict[str, Any]],
        reader_signal: Dict[str, Any],
    ) -> Dict[str, Any]:
        total_items = len(checklist)
        required_items = 0
        completed_items = 0
        completed_required = 0
        total_weight = 0.0
        completed_weight = 0.0
        pending_labels: List[str] = []

        for item in checklist:
            if not isinstance(item, dict):
                continue
            required = bool(item.get("required"))
            weight = float(item.get("weight") or 1.0)
            total_weight += weight
            if required:
                required_items += 1

            completed = self._is_checklist_item_completed(item, reader_signal)
            if completed:
                completed_items += 1
                completed_weight += weight
                if required:
                    completed_required += 1
            else:
                pending_labels.append(str(item.get("label") or item.get("id") or "未命名项"))

        completion_rate = (completed_items / total_items) if total_items > 0 else 1.0
        weighted_rate = (completed_weight / total_weight) if total_weight > 0 else completion_rate
        required_rate = (completed_required / required_items) if required_items > 0 else 1.0

        score = 100.0 * (0.5 * weighted_rate + 0.3 * required_rate + 0.2 * completion_rate)

        if getattr(self.config, "context_writing_score_include_reader_trend", True):
            trend_window = max(1, int(getattr(self.config, "context_writing_score_trend_window", 10)))
            trend = self.index_manager.get_writing_checklist_score_trend(last_n=trend_window)
            baseline = float(trend.get("score_avg") or 0.0)
            if baseline > 0:
                score += max(-10.0, min(10.0, (score - baseline) * 0.1))

        score = round(max(0.0, min(100.0, score)), 2)

        return {
            "chapter": chapter,
            "score": score,
            "completion_rate": round(completion_rate, 4),
            "weighted_completion_rate": round(weighted_rate, 4),
            "required_completion_rate": round(required_rate, 4),
            "total_items": total_items,
            "required_items": required_items,
            "completed_items": completed_items,
            "completed_required": completed_required,
            "total_weight": round(total_weight, 2),
            "completed_weight": round(completed_weight, 2),
            "pending_items": pending_labels,
            "trend_window": int(getattr(self.config, "context_writing_score_trend_window", 10)),
        }

    def _is_checklist_item_completed(self, item: Dict[str, Any], reader_signal: Dict[str, Any]) -> bool:
        item_id = str(item.get("id") or "")
        if item_id in {"fix_low_score_range", "readability_loop"}:
            review_trend = reader_signal.get("review_trend") or {}
            overall = review_trend.get("overall_avg")
            return isinstance(overall, (int, float)) and float(overall) >= 75.0

        if item_id == "hook_diversification":
            hook_usage = reader_signal.get("hook_type_usage") or {}
            return len(hook_usage) >= 2

        if item_id == "coolpoint_combo":
            pattern_usage = reader_signal.get("pattern_usage") or {}
            return len(pattern_usage) >= 2

        if item_id == "genre_anchor_consistency":
            return True

        source = str(item.get("source") or "")
        if source.startswith("fallback"):
            return True

        return False

    def _persist_writing_checklist_score(self, checklist_score: Dict[str, Any]) -> None:
        if not checklist_score:
            return
        try:
            self.index_manager.save_writing_checklist_score(
                WritingChecklistScoreMeta(
                    chapter=int(checklist_score.get("chapter") or 0),
                    template=str(getattr(self, "_active_template", self.DEFAULT_TEMPLATE) or self.DEFAULT_TEMPLATE),
                    total_items=int(checklist_score.get("total_items") or 0),
                    required_items=int(checklist_score.get("required_items") or 0),
                    completed_items=int(checklist_score.get("completed_items") or 0),
                    completed_required=int(checklist_score.get("completed_required") or 0),
                    total_weight=float(checklist_score.get("total_weight") or 0.0),
                    completed_weight=float(checklist_score.get("completed_weight") or 0.0),
                    completion_rate=float(checklist_score.get("completion_rate") or 0.0),
                    score=float(checklist_score.get("score") or 0.0),
                    score_breakdown={
                        "weighted_completion_rate": checklist_score.get("weighted_completion_rate"),
                        "required_completion_rate": checklist_score.get("required_completion_rate"),
                        "trend_window": checklist_score.get("trend_window"),
                    },
                    pending_items=list(checklist_score.get("pending_items") or []),
                    source="context_manager",
                )
            )
        except Exception:
            pass

    def _resolve_context_stage(self, chapter: int) -> str:
        early = max(1, int(getattr(self.config, "context_dynamic_budget_early_chapter", 30)))
        late = max(early + 1, int(getattr(self.config, "context_dynamic_budget_late_chapter", 120)))
        if chapter <= early:
            return "early"
        if chapter >= late:
            return "late"
        return "mid"

    def _resolve_template_weights(self, template: str, chapter: int) -> Dict[str, float]:
        template_key = template if template in self.TEMPLATE_WEIGHTS else self.DEFAULT_TEMPLATE
        base = dict(self.TEMPLATE_WEIGHTS.get(template_key, self.TEMPLATE_WEIGHTS[self.DEFAULT_TEMPLATE]))
        if not getattr(self.config, "context_dynamic_budget_enabled", True):
            return base

        stage = self._resolve_context_stage(chapter)
        staged = self.TEMPLATE_WEIGHTS_DYNAMIC.get(stage, {}).get(template_key)
        if staged:
            return dict(staged)

        return base

    def _parse_genre_tokens(self, genre_raw: str) -> List[str]:
        text = str(genre_raw or "").strip()
        if not text:
            return []
        if not getattr(self.config, "context_genre_profile_support_composite", True):
            return [text]

        separators = getattr(self.config, "context_genre_profile_separators", ("+", "/", "|", ",", "，", "、"))
        pattern = "|".join(re.escape(str(token)) for token in separators if str(token))
        if not pattern:
            return [text]

        tokens = [chunk.strip() for chunk in re.split(pattern, text) if chunk and chunk.strip()]
        deduped: List[str] = []
        seen = set()
        for token in tokens:
            lower = token.lower()
            if lower in seen:
                continue
            seen.add(lower)
            deduped.append(token)
        return deduped or [text]

    def _build_composite_genre_hints(self, genres: List[str], refs: List[str]) -> List[str]:
        if len(genres) <= 1:
            return []

        primary = genres[0]
        secondaries = genres[1:]
        hints: List[str] = []
        hints.append(
            f"以“{primary}”作为主引擎推进主线，每章至少保留1处“{'/'.join(secondaries)}”特征表达。"
        )
        if refs:
            hints.append(f"复合题材执行参考：{refs[0]}")
        hints.append("主辅题材冲突时，优先保证主题材读者承诺，辅题材用于制造新鲜感。")
        return hints

    def _build_writing_checklist(
        self,
        chapter: int,
        guidance_items: List[str],
        reader_signal: Dict[str, Any],
        genre_profile: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not getattr(self.config, "context_writing_checklist_enabled", True):
            return []

        min_items = max(1, int(getattr(self.config, "context_writing_checklist_min_items", 3)))
        max_items = max(min_items, int(getattr(self.config, "context_writing_checklist_max_items", 6)))
        default_weight = float(getattr(self.config, "context_writing_checklist_default_weight", 1.0))
        if default_weight <= 0:
            default_weight = 1.0

        items: List[Dict[str, Any]] = []

        def _add_item(
            item_id: str,
            label: str,
            *,
            weight: Optional[float] = None,
            required: bool = False,
            source: str = "writing_guidance",
            verify_hint: str = "",
        ) -> None:
            if len(items) >= max_items:
                return
            if any(row.get("id") == item_id for row in items):
                return

            item_weight = float(weight if weight is not None else default_weight)
            if item_weight <= 0:
                item_weight = default_weight

            items.append(
                {
                    "id": item_id,
                    "label": label,
                    "weight": round(item_weight, 2),
                    "required": bool(required),
                    "source": source,
                    "verify_hint": verify_hint,
                }
            )

        low_ranges = reader_signal.get("low_score_ranges") or []
        if low_ranges:
            worst = min(low_ranges, key=lambda row: float(row.get("overall_score", 9999)))
            span = f"{worst.get('start_chapter')}-{worst.get('end_chapter')}"
            _add_item(
                "fix_low_score_range",
                f"修复低分区间问题（参考第{span}章）",
                weight=max(default_weight, 1.4),
                required=True,
                source="reader_signal.low_score_ranges",
                verify_hint="至少完成1处冲突升级，并在段末留下钩子。",
            )

        hook_usage = reader_signal.get("hook_type_usage") or {}
        if hook_usage:
            dominant_hook = max(hook_usage.items(), key=lambda kv: kv[1])[0]
            _add_item(
                "hook_diversification",
                f"钩子差异化（避免继续单一“{dominant_hook}”）",
                weight=max(default_weight, 1.2),
                required=True,
                source="reader_signal.hook_type_usage",
                verify_hint="结尾钩子类型与近20章主类型至少有一处差异。",
            )

        pattern_usage = reader_signal.get("pattern_usage") or {}
        if pattern_usage:
            top_pattern = max(pattern_usage.items(), key=lambda kv: kv[1])[0]
            _add_item(
                "coolpoint_combo",
                f"主爽点+副爽点组合（主爽点：{top_pattern}）",
                weight=default_weight,
                required=False,
                source="reader_signal.pattern_usage",
                verify_hint="新增至少1个副爽点，并与主爽点形成因果链。",
            )

        review_trend = reader_signal.get("review_trend") or {}
        overall_avg = review_trend.get("overall_avg")
        if isinstance(overall_avg, (int, float)):
            _add_item(
                "readability_loop",
                "段落可读性闭环（动作→结果→情绪）",
                weight=max(default_weight, 1.1),
                required=True,
                source="reader_signal.review_trend",
                verify_hint="抽查3段，均包含动作结果闭环。",
            )

        genre = str(genre_profile.get("genre") or "").strip()
        if genre:
            _add_item(
                "genre_anchor_consistency",
                f"题材锚定一致性（{genre}）",
                weight=max(default_weight, 1.1),
                required=True,
                source="genre_profile.genre",
                verify_hint="主冲突与题材核心承诺保持一致。",
            )

        for idx, text in enumerate(guidance_items, start=1):
            if len(items) >= max_items:
                break
            label = str(text).strip()
            if not label:
                continue
            _add_item(
                f"guidance_item_{idx}",
                label,
                weight=default_weight,
                required=False,
                source="writing_guidance.guidance_items",
                verify_hint="完成后可在正文中定位对应段落。",
            )

        fallback_items = [
            (
                "opening_conflict",
                "开篇300字内给出冲突触发",
                "开头段出现明确目标与阻力。",
            ),
            (
                "scene_goal_block",
                "场景目标与阻力清晰",
                "每个场景至少有1个可验证目标。",
            ),
            (
                "ending_hook",
                "段末留钩并引出下一问",
                "结尾出现未解问题或下一步行动。",
            ),
        ]
        for item_id, label, verify_hint in fallback_items:
            if len(items) >= min_items or len(items) >= max_items:
                break
            _add_item(
                item_id,
                label,
                weight=default_weight,
                required=False,
                source="fallback",
                verify_hint=verify_hint,
            )

        return items[:max_items]

    def _compact_json_text(self, content: Any, budget: Optional[int]) -> str:
        raw = json.dumps(content, ensure_ascii=False)
        if budget is None or len(raw) <= budget:
            return raw
        if not getattr(self.config, "context_compact_text_enabled", True):
            return raw[:budget]

        min_budget = max(1, int(getattr(self.config, "context_compact_min_budget", 120)))
        if budget <= min_budget:
            return raw[:budget]

        head_ratio = float(getattr(self.config, "context_compact_head_ratio", 0.65))
        head_budget = int(budget * max(0.2, min(0.9, head_ratio)))
        tail_budget = max(0, budget - head_budget - 10)
        compact = f"{raw[:head_budget]}…[TRUNCATED]{raw[-tail_budget:] if tail_budget else ''}"
        return compact[:budget]

    def _extract_genre_section(self, text: str, genre: str) -> str:
        if not text:
            return ""
        lines = text.splitlines()
        capture: List[str] = []
        active = False
        target = genre.strip().lower()

        for line in lines:
            normalized = line.strip().lower()
            if normalized.startswith("## "):
                if active:
                    break
                active = target in normalized
                if active:
                    capture.append(line)
                continue
            if active:
                capture.append(line)

        if capture:
            return "\n".join(capture).strip()

        return "\n".join(lines[:80]).strip()

    def _extract_markdown_refs(self, text: str, max_items: int = 8) -> List[str]:
        if not text:
            return []
        refs: List[str] = []
        for line in text.splitlines():
            row = line.strip().lstrip("-*").strip()
            if not row or row.startswith("#"):
                continue
            refs.append(row)
            if len(refs) >= max(1, max_items):
                break
        return refs

    def _load_state(self) -> Dict[str, Any]:
        path = self.config.state_file
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def _load_outline(self, chapter: int) -> str:
        outline_dir = self.config.outline_dir
        patterns = [
            f"第{chapter}章*.md",
            f"第{chapter:02d}章*.md",
            f"第{chapter:03d}章*.md",
            f"第{chapter:04d}章*.md",
        ]
        for pattern in patterns:
            matches = list(outline_dir.glob(pattern))
            if matches:
                return matches[0].read_text(encoding="utf-8")
        return f"[大纲未找到: 第{chapter}章]"

    def _load_recent_summaries(self, chapter: int, window: int = 3) -> List[Dict[str, Any]]:
        summaries = []
        for ch in range(max(1, chapter - window), chapter):
            summary = self._load_summary_text(ch)
            if summary:
                summaries.append(summary)
        return summaries

    def _load_recent_meta(self, state: Dict[str, Any], chapter: int, window: int = 3) -> List[Dict[str, Any]]:
        meta = state.get("chapter_meta", {}) or {}
        results = []
        for ch in range(max(1, chapter - window), chapter):
            for key in (f"{ch:04d}", str(ch)):
                if key in meta:
                    results.append({"chapter": ch, **meta.get(key, {})})
                    break
        return results

    def _load_recent_appearances(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        appearances = self.index_manager.get_recent_appearances(limit=limit)
        return appearances or []

    def _load_setting(self, keyword: str) -> str:
        settings_dir = self.config.settings_dir
        candidates = [
            settings_dir / f"{keyword}.md",
        ]
        for path in candidates:
            if path.exists():
                return path.read_text(encoding="utf-8")
        # fallback: any file containing keyword
        matches = list(settings_dir.glob(f"*{keyword}*.md"))
        if matches:
            return matches[0].read_text(encoding="utf-8")
        return f"[{keyword}设定未找到]"

    def _extract_summary_excerpt(self, text: str, max_chars: int) -> str:
        if not text:
            return ""
        match = self.SUMMARY_SECTION_RE.search(text)
        excerpt = match.group(1).strip() if match else text.strip()
        if max_chars > 0 and len(excerpt) > max_chars:
            return excerpt[:max_chars].rstrip()
        return excerpt

    def _load_summary_text(self, chapter: int, snippet_chars: Optional[int] = None) -> Optional[Dict[str, Any]]:
        summary_path = self.config.webnovel_dir / "summaries" / f"ch{chapter:04d}.md"
        if not summary_path.exists():
            return None
        text = summary_path.read_text(encoding="utf-8")
        if snippet_chars:
            summary_text = self._extract_summary_excerpt(text, snippet_chars)
        else:
            summary_text = text
        return {"chapter": chapter, "summary": summary_text}

    def _load_story_skeleton(self, chapter: int) -> List[Dict[str, Any]]:
        interval = max(1, int(self.config.context_story_skeleton_interval))
        max_samples = max(0, int(self.config.context_story_skeleton_max_samples))
        snippet_chars = int(self.config.context_story_skeleton_snippet_chars)

        if max_samples <= 0 or chapter <= interval:
            return []

        samples: List[Dict[str, Any]] = []
        cursor = chapter - interval
        while cursor >= 1 and len(samples) < max_samples:
            summary = self._load_summary_text(cursor, snippet_chars=snippet_chars)
            if summary and summary.get("summary"):
                samples.append(summary)
            cursor -= interval

        samples.reverse()
        return samples

    def _load_json_optional(self, path: Path) -> Dict[str, Any]:
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}


def main():
    import argparse
    from .cli_output import print_success, print_error

    parser = argparse.ArgumentParser(description="Context Manager CLI")
    parser.add_argument("--project-root", type=str, help="项目根目录")
    parser.add_argument("--chapter", type=int, required=True)
    parser.add_argument("--template", type=str, default=ContextManager.DEFAULT_TEMPLATE)
    parser.add_argument("--no-snapshot", action="store_true")
    parser.add_argument("--max-chars", type=int, default=8000)

    args = parser.parse_args()

    config = None
    if args.project_root:
        from .config import DataModulesConfig

        config = DataModulesConfig.from_project_root(args.project_root)

    manager = ContextManager(config)
    try:
        payload = manager.build_context(
            chapter=args.chapter,
            template=args.template,
            use_snapshot=not args.no_snapshot,
            save_snapshot=True,
            max_chars=args.max_chars,
        )
        print_success(payload, message="context_built")
        try:
            manager.index_manager.log_tool_call("context_manager:build", True, chapter=args.chapter)
        except Exception:
            pass
    except Exception as exc:
        print_error("CONTEXT_BUILD_FAILED", str(exc), suggestion="请检查项目结构与依赖文件")
        try:
            manager.index_manager.log_tool_call(
                "context_manager:build", False, error_code="CONTEXT_BUILD_FAILED", error_message=str(exc), chapter=args.chapter
            )
        except Exception:
            pass


if __name__ == "__main__":
    import sys
    if sys.platform == "win32":
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")
    main()
