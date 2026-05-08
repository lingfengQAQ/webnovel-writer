#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Writing guidance and checklist builders.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .genre_aliases import to_profile_key


GENRE_GUIDANCE_TEXT: dict[str, str] = {
    "xianxia": "题材加权：强化升级/对抗结果的可见反馈，术语解释后置。",
    "shuangwen": "题材加权：维持高爽点密度，主爽点外叠加一个副轴反差。",
    "urban-power": "题材加权：优先写社会反馈链（他人反应→资源变化→地位变化）。",
    "romance": "题材加权：每章推进关系位移，避免情绪原地打转。",
    "mystery": "题材加权：线索必须可回收，优先以规则冲突制造悬念。",
    "rules-mystery": "题材加权：规则先于解释，代价先于胜利。",
    "zhihu-short": "题材加权：压缩铺垫，优先反转与高强度结尾钩。",
    "substitute": "题材加权：强化误解-拉扯-决断链路，避免重复虐点。",
    "esports": "题材加权：每场对抗至少写清一个战术决策点与其后果。",
    "livestream": "题材加权：强化“外部反馈→主角反制→数据变化”即时闭环。",
    "cosmic-horror": "题材加权：恐怖来源于规则与代价，不依赖空泛惊悚形容。",
}


GENRE_METHOD_ANCHORS: dict[str, dict[str, str]] = {
    "xianxia": {
        "pressure_source": "资源争夺/境界压制",
        "release_target": "主角主动破局并拿到可见收益",
    },
    "urban-power": {
        "pressure_source": "阶层卡位/权力压制",
        "release_target": "主角通过资源博弈拿到地位与回报",
    },
    "romance": {
        "pressure_source": "关系误解/情感拉扯",
        "release_target": "关系位移落地并形成下一步承诺",
    },
    "mystery": {
        "pressure_source": "线索缺失/规则冲突",
        "release_target": "给出可验证的新线索并保留未知区",
    },
    "rules-mystery": {
        "pressure_source": "规则反噬/代价递增",
        "release_target": "用代价换突破并留下更高阶规则问题",
    },
    "zhihu-short": {
        "pressure_source": "信息落差/立场对撞",
        "release_target": "反转兑现并形成高强度尾钩",
    },
    "substitute": {
        "pressure_source": "身份误读/情绪对峙",
        "release_target": "误解链推进到明确决断",
    },
    "esports": {
        "pressure_source": "战术压制/节奏失衡",
        "release_target": "关键决策生效并转化为局势优势",
    },
    "livestream": {
        "pressure_source": "舆论波动/数据下滑",
        "release_target": "当场反制形成可见数据回弹",
    },
    "cosmic-horror": {
        "pressure_source": "认知失真/规则侵蚀",
        "release_target": "以明确代价换阶段性生存窗口",
    },
    "history-travel": {
        "pressure_source": "历史惯性/礼教阻力",
        "release_target": "知识优势兑现并引发新的连锁反应",
    },
    "game-lit": {
        "pressure_source": "系统规则限制/资源稀缺",
        "release_target": "数值突破并暴露更高层级威胁",
    },
}


def build_methodology_strategy_card(
    *,
    chapter: int,
    reader_signal: Dict[str, Any],
    genre_profile: Dict[str, Any],
    label: str = "digital-serial-v1",
) -> Dict[str, Any]:
    genre = str(genre_profile.get("genre") or "").strip()
    profile_key = to_profile_key(genre) or "general"

    hook_usage = reader_signal.get("hook_type_usage") or {}
    pattern_usage = reader_signal.get("pattern_usage") or {}
    review_trend = reader_signal.get("review_trend") or {}
    low_ranges = reader_signal.get("low_score_ranges") or []

    dominant_hook = ""
    if isinstance(hook_usage, dict) and hook_usage:
        dominant_hook = max(hook_usage.items(), key=lambda kv: kv[1])[0]

    dominant_pattern = ""
    if isinstance(pattern_usage, dict) and pattern_usage:
        dominant_pattern = max(pattern_usage.items(), key=lambda kv: kv[1])[0]

    overall_avg = float(review_trend.get("overall_avg") or 0.0)
    has_low_range = bool(low_ranges)
    hook_variety = len(hook_usage) if isinstance(hook_usage, dict) else 0
    pattern_variety = len(pattern_usage) if isinstance(pattern_usage, dict) else 0

    next_reason_clarity = 70.0 + (4.0 if has_low_range else 8.0)
    anchor_effectiveness = 68.0 + (6.0 if dominant_hook else 0.0) + (4.0 if overall_avg >= 75 else -4.0)
    rhythm_naturalness = 65.0 + min(10.0, float(hook_variety + pattern_variety) * 2.0)

    risk_flags: List[str] = []
    if has_low_range:
        risk_flags.append("low_score_recency")
    if dominant_pattern:
        risk_flags.append("pattern_overuse_watch")
    if overall_avg > 0 and overall_avg < 75:
        risk_flags.append("readability_guard")

    stage_mod = chapter % 5
    if stage_mod in {1, 2}:
        stage = "build_up"
    elif stage_mod in {3, 4}:
        stage = "confront"
    else:
        stage = "release"

    anchor_preset = GENRE_METHOD_ANCHORS.get(
        profile_key,
        {
            "pressure_source": "生存目标/资源竞争",
            "release_target": "主角完成阶段目标并留下新的行动理由",
        },
    )

    return {
        "enabled": True,
        "framework": label,
        "pilot": profile_key,
        "genre_profile_key": profile_key,
        "chapter_stage": stage,
        "emotion_anchor": {
            "pressure_source": anchor_preset["pressure_source"],
            "release_target": anchor_preset["release_target"],
            "position_hint": "前段设压，中后段释放，避免固定字位打点",
        },
        "long_arc_controls": {
            "map_transition": "阶段切换承接既有资产与关系账本，避免能力与收益归零",
            "power_guard": "关键胜利必须给机制理由（信息/资源/代价/策略）",
            "antagonist_model": "反派需具备目标-手段-代价三要素，避免工具人推进",
        },
        "serialization_ops": {
            "next_reason": "章末或后段给出可复述的下一章动机句",
            "interaction_note": "保留一个可讨论分歧点，便于连载互动反馈",
        },
        "observability": {
            "next_reason_clarity": round(max(0.0, min(100.0, next_reason_clarity)), 2),
            "anchor_effectiveness": round(max(0.0, min(100.0, anchor_effectiveness)), 2),
            "rhythm_naturalness": round(max(0.0, min(100.0, rhythm_naturalness)), 2),
        },
        "signals": {
            "dominant_hook": dominant_hook,
            "dominant_pattern": dominant_pattern,
            "risk_flags": risk_flags,
        },
    }


def build_methodology_guidance_items(strategy_card: Dict[str, Any]) -> List[str]:
    if not isinstance(strategy_card, dict) or not strategy_card.get("enabled"):
        return []

    observability = strategy_card.get("observability") or {}
    signals = strategy_card.get("signals") or {}
    risk_flags = list(signals.get("risk_flags") or [])
    stage = str(strategy_card.get("chapter_stage") or "build_up")
    genre_key = str(strategy_card.get("genre_profile_key") or strategy_card.get("pilot") or "general")

    stage_text = {
        "build_up": "本章以铺压为主，优先做威胁与代价的可感知铺垫。",
        "confront": "本章以正面对抗为主，确保破局路径清晰可复盘。",
        "release": "本章以释放与余波为主，给出实质收益并引出下一问。",
    }.get(stage, "本章保持压力-破局-余波的完整链路。")

    items = [
        f"方法论策略（通用/{genre_key}）：{stage_text}",
        "长线控制：换图承接旧资产，避免主角进入新地图后能力与资源归零。",
        "机制控制：关键胜利必须写出机制理由与代价，不用纯光环碾压。",
        (
            "连载互动：保留一个可讨论分歧点，强化下章追更动机。"
            f"（next_reason={observability.get('next_reason_clarity')}）"
        ),
    ]

    if "pattern_overuse_watch" in risk_flags:
        dominant_pattern = str(signals.get("dominant_pattern") or "").strip()
        if dominant_pattern:
            items.append(f"风险修正：近期“{dominant_pattern}”偏高频，本章补一个异质副轴避免疲劳。")
    if "readability_guard" in risk_flags:
        items.append("风险修正：近期审查均分偏低，本章优先保证段落动作-结果闭环与可读性。")

    return items


def build_guidance_items(
    *,
    chapter: int,
    reader_signal: Dict[str, Any],
    genre_profile: Dict[str, Any],
    low_score_threshold: float,
    hook_diversify_enabled: bool,
) -> Dict[str, Any]:
    guidance: List[str] = []

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
    if hook_usage and hook_diversify_enabled:
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

    guidance.append("网文节奏基线：章首300字内给出目标与阻力，章末保留未闭合问题。")
    guidance.append("兑现密度基线：每600-900字给一次微兑现，并确保本章至少1处可量化变化。")

    normalized_genre = to_profile_key(genre)
    genre_hint = GENRE_GUIDANCE_TEXT.get(normalized_genre)
    if genre_hint:
        guidance.append(genre_hint)

    composite_hints = genre_profile.get("composite_hints") or []
    if composite_hints:
        guidance.append(f"复合题材协同：{composite_hints[0]}")

    if not guidance:
        guidance.append("本章执行默认高可读策略：冲突前置、信息后置、段末留钩。")

    return {
        "guidance": guidance,
        "low_ranges": low_ranges,
        "hook_usage": hook_usage,
        "pattern_usage": pattern_usage,
        "genre": genre,
    }


def build_writing_checklist(
    *,
    guidance_items: List[str],
    reader_signal: Dict[str, Any],
    genre_profile: Dict[str, Any],
    strategy_card: Dict[str, Any] | None = None,
    min_items: int,
    max_items: int,
    default_weight: float,
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []

    def _add_item(
        item_id: str,
        label: str,
        *,
        weight: float | None = None,
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

    if isinstance(strategy_card, dict) and strategy_card.get("enabled"):
        _add_item(
            "methodology_next_reason",
            "方法论：下章动机需可复述（章末或后段均可）",
            weight=default_weight,
            required=False,
            source="methodology.next_reason",
            verify_hint="提炼一句“为什么要点下一章”的动机句。",
        )
        _add_item(
            "methodology_power_guard",
            "方法论：越级与破局给出机制理由与代价",
            weight=default_weight,
            required=False,
            source="methodology.power_guard",
            verify_hint="至少写清1个机制理由与1个代价。"
        )
        _add_item(
            "methodology_antagonist_pressure",
            "方法论：反派行动具备目标-手段-代价",
            weight=default_weight,
            required=False,
            source="methodology.antagonist",
            verify_hint="反派不是工具人推进，需有可解释行动逻辑。",
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


def is_checklist_item_completed(item: Dict[str, Any], reader_signal: Dict[str, Any]) -> bool:
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

    if source.startswith("methodology."):
        # 方法论条目当前作为软提示，仅做观察与引导，不参与扣分。
        return True

    return False
