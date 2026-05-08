#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
quality_trend_report.py - 生成章节质量趋势报告（离线）

数据来源：
- index.db.review_metrics
- index.db.writing_checklist_scores
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from runtime_compat import enable_windows_utf8_stdio

try:
    from project_locator import resolve_project_root
except ImportError:  # pragma: no cover
    from scripts.project_locator import resolve_project_root

try:
    from data_modules.config import DataModulesConfig
    from data_modules.index_manager import IndexManager
except ImportError:  # pragma: no cover
    from scripts.data_modules.config import DataModulesConfig
    from scripts.data_modules.index_manager import IndexManager


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _percent(value: float) -> str:
    return f"{value * 100:.1f}%"


def _build_review_rows(records: List[Dict[str, Any]]) -> List[str]:
    if not records:
        return ["| - | - | - | - | - | - |", "| - | - | - | - | - | - |"]

    rows: List[str] = []
    sorted_records = sorted(
        records,
        key=lambda x: (_to_int(x.get("end_chapter")), _to_int(x.get("start_chapter"))),
    )
    for row in sorted_records:
        severities = row.get("severity_counts") or {}
        critical = _to_int(severities.get("critical"))
        high = _to_int(severities.get("high"))
        medium = _to_int(severities.get("medium"))
        low = _to_int(severities.get("low"))
        range_text = f"{_to_int(row.get('start_chapter'))}-{_to_int(row.get('end_chapter'))}"
        score = _to_float(row.get("overall_score"))
        rows.append(
            f"| {range_text} | {score:.1f} | {critical} | {high} | {medium} | {low} |"
        )
    return rows


def _build_checklist_rows(records: List[Dict[str, Any]]) -> List[str]:
    if not records:
        return ["| - | - | - | - |"]

    rows: List[str] = []
    sorted_records = sorted(records, key=lambda x: _to_int(x.get("chapter")))
    for row in sorted_records:
        chapter = _to_int(row.get("chapter"))
        score = _to_float(row.get("score"))
        completion = _to_float(row.get("completion_rate"))
        required_items = _to_int(row.get("required_items"))
        completed_required = _to_int(row.get("completed_required"))
        if required_items > 0:
            required_rate = completed_required / required_items
        else:
            required_rate = 1.0
        rows.append(
            f"| {chapter} | {score:.1f} | {_percent(completion)} | {_percent(required_rate)} |"
        )
    return rows


def _build_risk_flags(
    review_trend: Dict[str, Any],
    checklist_trend: Dict[str, Any],
) -> List[str]:
    flags: List[str] = []

    overall_avg = _to_float(review_trend.get("overall_avg"))
    if overall_avg < 75 and review_trend.get("count", 0) > 0:
        flags.append(f"审查均分偏低（{overall_avg:.1f}），建议优先回看低分区间。")

    severity_totals = review_trend.get("severity_totals") or {}
    critical_total = _to_int(severity_totals.get("critical"))
    high_total = _to_int(severity_totals.get("high"))
    if critical_total > 0:
        flags.append(f"存在 {critical_total} 个 critical 问题，建议设为最高修复优先级。")
    elif high_total >= 5:
        flags.append(f"high 问题累计 {high_total} 个，建议做批量修复专项。")

    score_avg = _to_float(checklist_trend.get("score_avg"))
    if checklist_trend.get("count", 0) > 0 and score_avg < 80:
        flags.append(f"写作清单平均分偏低（{score_avg:.1f}），建议加强执行清单落地。")

    completion_avg = _to_float(checklist_trend.get("completion_avg"))
    if checklist_trend.get("count", 0) > 0 and completion_avg < 0.7:
        flags.append(f"写作清单完成率仅 {_percent(completion_avg)}，建议减少每章可选项数量。")

    if not flags:
        flags.append("近期质量指标整体稳定，暂无高优先级风险。")

    return flags


def build_quality_report(
    project_root: Path,
    manager: IndexManager,
    *,
    limit: int,
) -> str:
    review_records = manager.get_recent_review_metrics(limit=limit)
    review_trend = manager.get_review_trend_stats(last_n=limit)
    checklist_records = manager.get_recent_writing_checklist_scores(limit=limit)
    checklist_trend = manager.get_writing_checklist_score_trend(last_n=limit)

    now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    overall_avg = _to_float(review_trend.get("overall_avg"))
    review_count = _to_int(review_trend.get("count"))
    checklist_count = _to_int(checklist_trend.get("count"))
    checklist_score_avg = _to_float(checklist_trend.get("score_avg"))
    checklist_completion_avg = _to_float(checklist_trend.get("completion_avg"))

    dimension_avg = review_trend.get("dimension_avg") or {}
    severity_totals = review_trend.get("severity_totals") or {}
    risk_flags = _build_risk_flags(review_trend, checklist_trend)

    lines: List[str] = []
    lines.append("# 质量趋势报告")
    lines.append("")
    lines.append(f"- 生成时间: {now_text}")
    lines.append(f"- 项目路径: `{project_root}`")
    lines.append(f"- 统计窗口: 最近 {limit} 条记录")
    lines.append("")
    lines.append("## 总览")
    lines.append("")
    lines.append(f"- 审查记录数: {review_count}")
    lines.append(f"- 审查均分: {overall_avg:.1f}")
    lines.append(f"- 清单评分记录数: {checklist_count}")
    lines.append(f"- 清单平均分: {checklist_score_avg:.1f}")
    lines.append(f"- 清单平均完成率: {_percent(checklist_completion_avg)}")
    lines.append("")

    lines.append("## 审查区间趋势")
    lines.append("")
    lines.append("| 区间 | 总分 | Critical | High | Medium | Low |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    lines.extend(_build_review_rows(review_records))
    lines.append("")

    lines.append("## 维度均分")
    lines.append("")
    lines.append("| 维度 | 平均分 |")
    lines.append("|---|---:|")
    if dimension_avg:
        for key in sorted(dimension_avg.keys()):
            lines.append(f"| {key} | {_to_float(dimension_avg.get(key)):.1f} |")
    else:
        lines.append("| - | - |")
    lines.append("")

    lines.append("## 严重级别汇总")
    lines.append("")
    lines.append("| 等级 | 数量 |")
    lines.append("|---|---:|")
    for level in ("critical", "high", "medium", "low"):
        lines.append(f"| {level} | {_to_int(severity_totals.get(level))} |")
    lines.append("")

    lines.append("## 写作清单趋势")
    lines.append("")
    lines.append("| 章节 | 分数 | 完成率 | 必做完成率 |")
    lines.append("|---:|---:|---:|---:|")
    lines.extend(_build_checklist_rows(checklist_records))
    lines.append("")

    lines.append("## 风险提示")
    lines.append("")
    for item in risk_flags:
        lines.append(f"- {item}")
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="生成离线质量趋势报告（基于 index.db）")
    parser.add_argument("--project-root", type=str, help="项目根目录（可选，不传则自动探测）")
    parser.add_argument("--limit", type=int, default=20, help="统计最近 N 条记录（默认 20）")
    parser.add_argument("--output", type=str, help="输出文件路径（默认 .webnovel/reports/quality-trend.md）")
    args = parser.parse_args()

    if args.project_root:
        # 允许传入“工作区根目录”，统一解析到真正的 book project_root
        project_root = resolve_project_root(args.project_root)
    else:
        project_root = resolve_project_root()

    cfg = DataModulesConfig.from_project_root(project_root)
    manager = IndexManager(cfg)

    limit = max(1, int(args.limit))
    output_path = (
        Path(args.output).expanduser().resolve()
        if args.output
        else (cfg.webnovel_dir / "reports" / "quality-trend.md")
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    report = build_quality_report(project_root, manager, limit=limit)
    output_path.write_text(report, encoding="utf-8")
    print(f"✅ 已生成质量趋势报告: {output_path}")


if __name__ == "__main__":
    import sys
    if sys.platform == "win32":
        enable_windows_utf8_stdio()
    main()
