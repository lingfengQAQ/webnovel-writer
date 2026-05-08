#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Context ranker for Context Contract v2.

Goals:
- Prefer recency while keeping frequent entities stable.
- Prioritize high-signal hook/alert items.
- Keep output shape backward compatible (same keys, re-ordered lists).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from .config import get_config


class ContextRanker:
    """Rank context-pack sections with lightweight deterministic heuristics."""

    SUMMARY_HOOK_HINTS = ("?", "？", "悬念", "钩子", "反转", "冲突")

    def __init__(self, config=None):
        self.config = config or get_config()

    def rank_pack(self, pack: Dict[str, Any], chapter: int) -> Dict[str, Any]:
        ranked = dict(pack)

        core = dict(ranked.get("core") or {})
        core["recent_summaries"] = self.rank_recent_summaries(core.get("recent_summaries") or [], chapter)
        core["recent_meta"] = self.rank_recent_meta(core.get("recent_meta") or [], chapter)
        ranked["core"] = core

        scene = dict(ranked.get("scene") or {})
        scene["appearing_characters"] = self.rank_appearances(scene.get("appearing_characters") or [], chapter)
        ranked["scene"] = scene

        ranked["story_skeleton"] = self.rank_story_skeleton(ranked.get("story_skeleton") or [], chapter)

        alerts = dict(ranked.get("alerts") or {})
        alerts["disambiguation_warnings"] = self.rank_alerts(alerts.get("disambiguation_warnings") or [], chapter)
        alerts["disambiguation_pending"] = self.rank_alerts(alerts.get("disambiguation_pending") or [], chapter)
        ranked["alerts"] = alerts

        meta = dict(ranked.get("meta") or {})
        meta.setdefault("context_contract_version", "v2")
        meta["ranker"] = {
            "enabled": True,
            "recency_weight": float(self.config.context_ranker_recency_weight),
            "frequency_weight": float(self.config.context_ranker_frequency_weight),
            "hook_bonus": float(self.config.context_ranker_hook_bonus),
        }
        ranked["meta"] = meta
        return ranked

    def rank_recent_summaries(self, items: List[Dict[str, Any]], current_chapter: int) -> List[Dict[str, Any]]:
        scored = []
        for raw in items:
            item = dict(raw)
            chapter = self._as_int(item.get("chapter"))
            summary = str(item.get("summary") or "")

            recency = self._recency_score(chapter, current_chapter)
            frequency = self._length_score(summary)
            hook_bonus = float(self.config.context_ranker_hook_bonus) if self._has_hook_hint(summary) else 0.0
            score = self._combine_score(recency, frequency, hook_bonus)
            scored.append(self._with_debug_score(item, score, recency, frequency, hook_bonus))

        scored.sort(key=lambda row: row[0], reverse=True)
        return [row[1] for row in scored]

    def rank_recent_meta(self, items: List[Dict[str, Any]], current_chapter: int) -> List[Dict[str, Any]]:
        scored = []
        for raw in items:
            item = dict(raw)
            chapter = self._as_int(item.get("chapter"))
            hook = str(item.get("hook") or "")
            hook_bonus = float(self.config.context_ranker_hook_bonus) if hook else 0.0
            recency = self._recency_score(chapter, current_chapter)
            frequency = self._length_score(hook)
            score = self._combine_score(recency, frequency, hook_bonus)
            scored.append(self._with_debug_score(item, score, recency, frequency, hook_bonus))

        scored.sort(key=lambda row: row[0], reverse=True)
        return [row[1] for row in scored]

    def rank_appearances(self, items: List[Dict[str, Any]], current_chapter: int) -> List[Dict[str, Any]]:
        scored = []
        for raw in items:
            item = dict(raw)
            last_chapter = self._as_int(item.get("last_chapter") or item.get("chapter"))
            total = self._as_int(item.get("total")) or 0
            warning_penalty = 0.15 if item.get("warning") else 0.0

            recency = self._recency_score(last_chapter, current_chapter)
            frequency = self._frequency_score(total)
            score = self._combine_score(recency, frequency, 0.0) - warning_penalty
            scored.append(self._with_debug_score(item, score, recency, frequency, -warning_penalty))

        scored.sort(key=lambda row: row[0], reverse=True)
        return [row[1] for row in scored]

    def rank_story_skeleton(self, items: List[Dict[str, Any]], current_chapter: int) -> List[Dict[str, Any]]:
        scored = []
        for raw in items:
            item = dict(raw)
            chapter = self._as_int(item.get("chapter"))
            summary = str(item.get("summary") or "")
            recency = self._recency_score(chapter, current_chapter)
            frequency = self._length_score(summary)
            score = self._combine_score(recency, frequency, 0.0)
            scored.append(self._with_debug_score(item, score, recency, frequency, 0.0))

        scored.sort(key=lambda row: row[0], reverse=True)
        return [row[1] for row in scored]

    def rank_alerts(self, alerts: List[Any], current_chapter: int) -> List[Any]:
        scored = []
        keywords = tuple(self.config.context_ranker_alert_critical_keywords)

        for raw in alerts:
            if isinstance(raw, dict):
                item: Any = dict(raw)
                chapter = self._as_int(item.get("chapter"))
                text = str(item.get("message") or item.get("content") or json_safe(item))
                severity = str(item.get("severity") or "").lower()
                critical_bonus = 0.3 if severity in {"critical", "high"} else 0.0
            else:
                item = raw
                chapter = None
                text = str(raw)
                critical_bonus = 0.0

            recency = self._recency_score(chapter, current_chapter)
            keyword_bonus = 0.3 if any(word and word in text for word in keywords) else 0.0
            score = recency + critical_bonus + keyword_bonus

            if isinstance(item, dict):
                scored.append(self._with_debug_score(item, score, recency, critical_bonus, keyword_bonus))
            else:
                scored.append((score, item))

        scored.sort(key=lambda row: row[0], reverse=True)
        return [row[1] for row in scored]

    def _combine_score(self, recency: float, frequency: float, bonus: float) -> float:
        return (
            recency * float(self.config.context_ranker_recency_weight)
            + frequency * float(self.config.context_ranker_frequency_weight)
            + bonus
        )

    def _recency_score(self, source_chapter: Optional[int], current_chapter: int) -> float:
        if source_chapter is None:
            return 0.0
        gap = max(0, int(current_chapter) - int(source_chapter))
        return 1.0 / (1.0 + gap)

    def _frequency_score(self, total: int) -> float:
        if total <= 0:
            return 0.0
        # log scale to avoid over-favoring very frequent entities
        return min(1.0, math.log(1.0 + float(total)) / math.log(11.0))

    def _length_score(self, text: str) -> float:
        if not text:
            return 0.0
        ratio = min(len(text) / 1200.0, 1.0)
        cap = float(self.config.context_ranker_length_bonus_cap)
        return ratio * cap

    def _has_hook_hint(self, text: str) -> bool:
        return any(token in text for token in self.SUMMARY_HOOK_HINTS)

    def _as_int(self, value: Any) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _with_debug_score(
        self,
        item: Dict[str, Any],
        score: float,
        recency: float,
        frequency: float,
        bonus: float,
    ) -> tuple[float, Dict[str, Any]]:
        if getattr(self.config, "context_ranker_debug", False):
            item["_context_score"] = round(score, 6)
            item["_context_score_detail"] = {
                "recency": round(recency, 6),
                "frequency": round(frequency, 6),
                "bonus": round(bonus, 6),
            }
        return score, item


def json_safe(value: Any) -> str:
    try:
        import json

        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)

