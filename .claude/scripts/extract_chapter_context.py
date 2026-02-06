#!/usr/bin/env python3
"""
extract_chapter_context.py - 提取章节创作所需的精简上下文

功能：
- 提取当前章节的大纲片段（~500字）
- 提取前2章的摘要（优先 .webnovel/summaries）
- 提取 state.json 关键字段（~300字）

用法：
    python extract_chapter_context.py --chapter 7
    python extract_chapter_context.py --chapter 7 --project-root ./webnovel-project
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from chapter_paths import find_chapter_file
except ImportError:  # pragma: no cover
    from scripts.chapter_paths import find_chapter_file


def find_project_root(start_path: Path = None) -> Path:
    """查找包含 .webnovel 目录的项目根目录"""
    if start_path is None:
        start_path = Path.cwd()

    search_paths = [
        start_path,
        start_path / "webnovel-project",
        start_path.parent,
    ]

    for path in search_paths:
        if (path / ".webnovel").exists():
            return path

    raise FileNotFoundError("未找到 .webnovel 目录，请确认项目路径")


def extract_chapter_outline(project_root: Path, chapter_num: int) -> str:
    """从大纲文件中提取指定章节的大纲片段"""
    volume_num = (chapter_num - 1) // 50 + 1
    outline_file = project_root / "大纲" / f"第{volume_num}卷-详细大纲.md"

    if not outline_file.exists():
        return f"⚠️ 大纲文件不存在: {outline_file}"

    content = outline_file.read_text(encoding="utf-8")

    # 匹配章节大纲块
    # 格式：### 第 N 章：标题 或 ### 第 N 章: 标题
    pattern = rf"###\s*第\s*{chapter_num}\s*章[：:]\s*(.+?)(?=###\s*第\s*\d+\s*章|##\s|$)"
    match = re.search(pattern, content, re.DOTALL)

    if match:
        outline = match.group(0).strip()
        # 限制长度
        if len(outline) > 1500:
            outline = outline[:1500] + "\n...(已截断)"
        return outline

    # 尝试另一种格式：### 第 1 章：标题（无空格）
    pattern2 = rf"###\s*第{chapter_num}章[：:]\s*(.+?)(?=###\s*第\d+章|##\s|$)"
    match2 = re.search(pattern2, content, re.DOTALL)

    if match2:
        outline = match2.group(0).strip()
        if len(outline) > 1500:
            outline = outline[:1500] + "\n...(已截断)"
        return outline

    return f"⚠️ 未找到第 {chapter_num} 章的大纲"


def _load_summary_file(project_root: Path, chapter_num: int) -> str:
    """从 .webnovel/summaries/chNNNN.md 提取剧情摘要"""
    summary_path = project_root / ".webnovel" / "summaries" / f"ch{chapter_num:04d}.md"
    if not summary_path.exists():
        return ""

    text = summary_path.read_text(encoding="utf-8")
    summary_match = re.search(r"##\s*剧情摘要\s*\r?\n(.+?)(?=\r?\n##|$)", text, re.DOTALL)
    if summary_match:
        return summary_match.group(1).strip()
    return ""


def extract_chapter_summary(project_root: Path, chapter_num: int) -> str:
    """提取指定章节摘要（优先 summaries/，再降级正文）"""
    summary = _load_summary_file(project_root, chapter_num)
    if summary:
        return summary

    chapter_file = find_chapter_file(project_root, chapter_num)
    if not chapter_file or not chapter_file.exists():
        return f"⚠️ 第 {chapter_num} 章文件不存在"

    content = chapter_file.read_text(encoding="utf-8")

    # 兼容旧格式：尝试提取"本章摘要"部分
    summary_match = re.search(r"##\s*本章摘要\s*\r?\n(.+?)(?=\r?\n##|$)", content, re.DOTALL)
    if summary_match:
        return summary_match.group(1).strip()

    # 如果没有摘要，提取"本章统计"部分
    stats_match = re.search(r"##\s*本章统计\s*\r?\n(.+?)(?=\r?\n##|$)", content, re.DOTALL)
    if stats_match:
        return f"[无摘要，仅统计]\n{stats_match.group(1).strip()}"

    # 最后降级：提取前500字作为摘要
    lines = content.split("\n")
    text_lines = [l for l in lines if not l.startswith("#") and l.strip()]
    text = "\n".join(text_lines)[:500]
    return f"[自动截取前500字]\n{text}..."


def extract_state_summary(project_root: Path) -> str:
    """提取 state.json 的关键字段"""
    state_file = project_root / ".webnovel" / "state.json"

    if not state_file.exists():
        return "⚠️ state.json 不存在"

    state = json.loads(state_file.read_text(encoding="utf-8"))

    # 提取关键字段
    summary_parts = []

    # 进度
    if "progress" in state:
        p = state["progress"]
        summary_parts.append(f"**进度**: 第 {p.get('current_chapter', '?')} 章 / {p.get('total_words', '?')} 字")

    # 主角状态
    if "protagonist_state" in state:
        ps = state["protagonist_state"]
        power = ps.get("power", {})
        summary_parts.append(f"**主角实力**: {power.get('realm', '?')} {power.get('layer', '?')}层")
        summary_parts.append(f"**当前位置**: {ps.get('location', '?')}")

        gf = ps.get("golden_finger", {})
        summary_parts.append(f"**金手指**: {gf.get('name', '?')} Lv.{gf.get('level', '?')}")

    # Strand 追踪
    if "strand_tracker" in state:
        st = state["strand_tracker"]
        history = st.get("history", [])[-5:]  # 最近5章
        if history:
            items = []
            for h in history:
                if not isinstance(h, dict):
                    continue
                ch = h.get("chapter", "?")
                strand = h.get("strand") or h.get("dominant") or "unknown"
                items.append(f"Ch{ch}:{strand}")
            strand_str = ", ".join(items)
            summary_parts.append(f"**近5章Strand**: {strand_str}")

    # 活跃伏笔（只显示紧急的）
    plot_threads = state.get("plot_threads", {}) if isinstance(state.get("plot_threads"), dict) else {}
    foreshadowing = plot_threads.get("foreshadowing", [])
    if isinstance(foreshadowing, list) and foreshadowing:
        active = [f for f in foreshadowing if f.get("status") in {"active", "未回收"}]
        urgent = [f for f in active if f.get("urgency", 0) > 50]
        if urgent:
            urgent_list = [f"{f.get('content', '?')[:30]}... (紧急度:{f.get('urgency')})" for f in urgent[:3]]
            summary_parts.append(f"**紧急伏笔**: {'; '.join(urgent_list)}")

    return "\n".join(summary_parts)


def main():
    parser = argparse.ArgumentParser(description="提取章节创作所需的精简上下文")
    parser.add_argument("--chapter", type=int, required=True, help="目标章节号")
    parser.add_argument("--project-root", type=str, help="项目根目录")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="输出格式")

    args = parser.parse_args()

    try:
        if args.project_root:
            project_root = Path(args.project_root)
        else:
            project_root = find_project_root()

        chapter_num = args.chapter

        # 提取各部分
        outline = extract_chapter_outline(project_root, chapter_num)

        # 提取前2章摘要
        prev_summaries = []
        for prev_ch in range(max(1, chapter_num - 2), chapter_num):
            summary = extract_chapter_summary(project_root, prev_ch)
            prev_summaries.append(f"### 第 {prev_ch} 章摘要\n{summary}")

        state_summary = extract_state_summary(project_root)

        if args.format == "json":
            result = {
                "chapter": chapter_num,
                "outline": outline,
                "previous_summaries": prev_summaries,
                "state_summary": state_summary,
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"# 第 {chapter_num} 章创作上下文\n")
            print("## 本章大纲\n")
            print(outline)
            print("\n---\n")
            print("## 前文摘要\n")
            for s in prev_summaries:
                print(s)
                print()
            print("---\n")
            print("## 当前状态\n")
            print(state_summary)

    except Exception as e:
        print(f"❌ 错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
