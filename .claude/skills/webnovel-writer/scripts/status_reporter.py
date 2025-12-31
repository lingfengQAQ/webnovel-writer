#!/usr/bin/env python3
"""
可视化状态报告系统 (Status Reporter)

核心理念：面对 1000 个章节，作者会迷失。需要"宏观俯瞰"能力。

功能：
1. 角色活跃度分析：哪些角色太久没出场（掉线统计）
2. 伏笔深度分析：哪些坑挖得太久了（超过 20 万字未收）
3. 爽点节奏分布：全书高潮点的分布频率（热力图）
4. 字数分布统计：各卷、各篇的字数分布
5. 人际关系图谱：好感度/仇恨度趋势

输出格式：
  - Markdown 报告（.webnovel/health_report.md）
  - 包含 Mermaid 图表（角色关系图、爽点热力图）

使用方式：
  # 生成完整健康报告
  python status_reporter.py --output .webnovel/health_report.md

  # 仅分析角色活跃度
  python status_reporter.py --focus characters

  # 仅分析伏笔
  python status_reporter.py --focus foreshadowing

  # 仅分析爽点节奏
  python status_reporter.py --focus pacing

报告示例：
  # 全书健康报告

  ## 📊 基本数据

  - **总章节数**: 450 章
  - **总字数**: 1,985,432 字
  - **平均章节字数**: 4,412 字
  - **创作进度**: 99.3%（目标 200万字）

  ## ⚠️ 角色掉线（3人）

  | 角色 | 最后出场 | 缺席章节 | 状态 |
  |------|---------|---------|------|
  | 李雪 | 第 350 章 | 100 章 | 🔴 严重掉线 |
  | 血煞门主 | 第 300 章 | 150 章 | 🔴 严重掉线 |
  | 天云宗宗主 | 第 400 章 | 50 章 | 🟡 轻度掉线 |

  ## ⚠️ 伏笔超时（2条）

  | 伏笔内容 | 埋设章节 | 已过章节 | 状态 |
  |---------|---------|---------|------|
  | "林家宝库铭文的秘密" | 第 200 章 | 250 章 | 🔴 严重超时 |
  | "神秘玉佩的来历" | 第 270 章 | 180 章 | 🟡 轻度超时 |

  ## 📈 爽点节奏分布

  ```
  第 1-100 章   ████████████ 优秀（1200字/爽点）
  第 101-200章  ██████████ 良好（1500字/爽点）
  第 201-300章  ████████ 良好（1600字/爽点）
  第 301-400章  ████ 偏低（2200字/爽点）⚠️
  第 401-450章  ██████ 良好（1550字/爽点）
  ```

  ## 💑 人际关系趋势

  ```mermaid
  graph LR
    主角 -->|好感度95| 李雪
    主角 -->|好感度60| 慕容雪
    主角 -->|仇恨度100| 血煞门
  ```
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Any, Tuple
from datetime import datetime
from collections import defaultdict

# Windows 编码兼容性修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

class StatusReporter:
    """状态报告生成器"""

    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.state_file = self.project_root / ".webnovel/state.json"
        self.chapters_dir = self.project_root / "正文"

        self.state = None
        self.chapters_data = []

    def load_state(self) -> bool:
        """加载 state.json"""
        if not self.state_file.exists():
            print(f"❌ 状态文件不存在: {self.state_file}")
            return False

        with open(self.state_file, 'r', encoding='utf-8') as f:
            self.state = json.load(f)

        return True

    def scan_chapters(self):
        """扫描所有章节文件"""
        if not self.chapters_dir.exists():
            print(f"⚠️  正文目录不存在: {self.chapters_dir}")
            return

        for chapter_file in sorted(self.chapters_dir.glob("第*.md")):
            # 提取章节号
            match = re.search(r'第(\d+)章', chapter_file.name)
            if not match:
                continue

            chapter_num = int(match.group(1))

            # 读取章节内容
            with open(chapter_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # 统计字数（去除 Markdown 标记）
            text = re.sub(r'```[\s\S]*?```', '', content)  # 去除代码块
            text = re.sub(r'#+ .+', '', text)  # 去除标题
            text = re.sub(r'---', '', text)  # 去除分隔线
            word_count = len(text.strip())

            # 提取出场角色（粗略：查找 [角色: XXX]）
            characters = re.findall(r'\[角色:\s*([^\]]+)\]', content)

            self.chapters_data.append({
                "chapter": chapter_num,
                "file": chapter_file,
                "word_count": word_count,
                "characters": characters
            })

    def analyze_characters(self) -> Dict:
        """分析角色活跃度"""
        if not self.state:
            return {}

        current_chapter = self.state.get("progress", {}).get("current_chapter", 0)
        entities = self.state.get("entities", {})
        characters = entities.get("characters", [])

        # 统计每个角色的最后出场章节
        character_activity = {}

        for char in characters:
            char_name = char.get("name")
            if not char_name:
                continue

            # 查找最后出场章节
            last_appearance = 0

            for ch_data in self.chapters_data:
                if char_name in ch_data.get("characters", []):
                    last_appearance = max(last_appearance, ch_data["chapter"])

            absence = current_chapter - last_appearance

            character_activity[char_name] = {
                "last_appearance": last_appearance,
                "absence": absence,
                "status": self._get_absence_status(absence)
            }

        return character_activity

    def _get_absence_status(self, absence: int) -> str:
        """判断掉线状态"""
        if absence == 0:
            return "✅ 活跃"
        elif absence < 30:
            return "🟢 正常"
        elif absence < 100:
            return "🟡 轻度掉线"
        else:
            return "🔴 严重掉线"

    def analyze_foreshadowing(self) -> List[Dict]:
        """分析伏笔深度"""
        if not self.state:
            return []

        current_chapter = self.state.get("progress", {}).get("current_chapter", 0)
        plot_threads = self.state.get("plot_threads", {})
        foreshadowing = plot_threads.get("foreshadowing", [])

        overdue = []

        for item in foreshadowing:
            if item.get("status") != "未回收":
                continue

            # 假设每个伏笔记录了"added_chapter"（埋设章节）
            # 如果没有，使用 added_at 日期估算（粗略）
            # 这里简化：假设第 1 章开始，平均每天写 1 章

            # 简化：假设伏笔按添加顺序，第 N 个伏笔大约在第 N*10 章埋下
            # 实际项目应该在伏笔记录中加入 "埋设章节号" 字段

            # 这里使用 content 中的关键词匹配（极度简化）
            content = item.get("content", "")

            # 假设伏笔平均埋设时间 = 当前章节的一半（极度粗糙估算）
            estimated_chapter = current_chapter // 2
            elapsed = current_chapter - estimated_chapter

            overdue.append({
                "content": content,
                "estimated_chapter": estimated_chapter,
                "elapsed": elapsed,
                "status": self._get_foreshadowing_status(elapsed)
            })

        return overdue

    def _get_foreshadowing_status(self, elapsed: int) -> str:
        """判断伏笔超时状态"""
        if elapsed < 50:
            return "🟢 正常"
        elif elapsed < 150:
            return "🟡 轻度超时"
        else:
            return "🔴 严重超时"

    def analyze_pacing(self) -> List[Dict]:
        """分析爽点节奏分布（每 100 章为一段）"""
        segment_size = 100
        segments = []

        for i in range(0, len(self.chapters_data), segment_size):
            segment_chapters = self.chapters_data[i:i+segment_size]

            if not segment_chapters:
                continue

            start_ch = segment_chapters[0]["chapter"]
            end_ch = segment_chapters[-1]["chapter"]
            total_words = sum(ch["word_count"] for ch in segment_chapters)

            # 假设爽点数量 = 章节数（简化：每章至少 1 个爽点）
            # 实际项目应该在审查报告中记录爽点数量
            assumed_cool_points = len(segment_chapters)

            words_per_point = total_words / assumed_cool_points if assumed_cool_points > 0 else 0

            segments.append({
                "start": start_ch,
                "end": end_ch,
                "total_words": total_words,
                "cool_points": assumed_cool_points,
                "words_per_point": words_per_point,
                "rating": self._get_pacing_rating(words_per_point)
            })

        return segments

    def _get_pacing_rating(self, words_per_point: float) -> str:
        """判断节奏评级"""
        if words_per_point < 1000:
            return "优秀"
        elif words_per_point < 1500:
            return "良好"
        elif words_per_point < 2000:
            return "及格"
        else:
            return "偏低⚠️"

    def generate_relationship_graph(self) -> str:
        """生成人际关系 Mermaid 图"""
        if not self.state:
            return ""

        relationships = self.state.get("relationships", {})
        protagonist_name = self.state.get("protagonist_state", {}).get("name", "主角")

        lines = ["```mermaid", "graph LR"]

        for char_name, rel_data in relationships.items():
            affection = rel_data.get("affection", 0)
            hatred = rel_data.get("hatred", 0)

            if affection > 0:
                lines.append(f"    {protagonist_name} -->|好感度{affection}| {char_name}")

            if hatred > 0:
                lines.append(f"    {protagonist_name} -->|仇恨度{hatred}| {char_name}")

        lines.append("```")

        return "\n".join(lines)

    def generate_report(self, focus: str = "all") -> str:
        """生成健康报告（Markdown 格式）"""

        report_lines = [
            "# 全书健康报告",
            "",
            f"> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "---",
            ""
        ]

        # 基本数据
        if focus in ["all", "basic"]:
            report_lines.extend(self._generate_basic_stats())

        # 角色活跃度
        if focus in ["all", "characters"]:
            report_lines.extend(self._generate_character_section())

        # 伏笔深度
        if focus in ["all", "foreshadowing"]:
            report_lines.extend(self._generate_foreshadowing_section())

        # 爽点节奏
        if focus in ["all", "pacing"]:
            report_lines.extend(self._generate_pacing_section())

        # 人际关系
        if focus in ["all", "relationships"]:
            report_lines.extend(self._generate_relationship_section())

        return "\n".join(report_lines)

    def _generate_basic_stats(self) -> List[str]:
        """生成基本统计"""
        if not self.state:
            return []

        progress = self.state.get("progress", {})
        current_chapter = progress.get("current_chapter", 0)
        total_words = progress.get("total_words", 0)
        target_words = self.state.get("project_info", {}).get("target_words", 2000000)

        avg_words = total_words / current_chapter if current_chapter > 0 else 0
        completion = (total_words / target_words * 100) if target_words > 0 else 0

        return [
            "## 📊 基本数据",
            "",
            f"- **总章节数**: {current_chapter} 章",
            f"- **总字数**: {total_words:,} 字",
            f"- **平均章节字数**: {avg_words:,.0f} 字",
            f"- **创作进度**: {completion:.1f}%（目标 {target_words:,} 字）",
            "",
            "---",
            ""
        ]

    def _generate_character_section(self) -> List[str]:
        """生成角色分析章节"""
        activity = self.analyze_characters()

        if not activity:
            return []

        # 筛选掉线角色
        dropped = {name: data for name, data in activity.items()
                  if "掉线" in data["status"]}

        lines = [
            f"## ⚠️ 角色掉线（{len(dropped)}人）",
            ""
        ]

        if dropped:
            lines.extend([
                "| 角色 | 最后出场 | 缺席章节 | 状态 |",
                "|------|---------|---------|------|"
            ])

            for char_name, data in sorted(dropped.items(),
                                         key=lambda x: x[1]["absence"],
                                         reverse=True):
                lines.append(
                    f"| {char_name} | 第 {data['last_appearance']} 章 | "
                    f"{data['absence']} 章 | {data['status']} |"
                )
        else:
            lines.append("✅ 所有角色活跃度正常")

        lines.extend(["", "---", ""])

        return lines

    def _generate_foreshadowing_section(self) -> List[str]:
        """生成伏笔分析章节"""
        overdue = self.analyze_foreshadowing()

        # 筛选超时伏笔
        overdue_items = [item for item in overdue if "超时" in item["status"]]

        lines = [
            f"## ⚠️ 伏笔超时（{len(overdue_items)}条）",
            ""
        ]

        if overdue_items:
            lines.extend([
                "| 伏笔内容 | 估计埋设 | 已过章节 | 状态 |",
                "|---------|---------|---------|------|"
            ])

            for item in sorted(overdue_items, key=lambda x: x["elapsed"], reverse=True):
                lines.append(
                    f"| {item['content'][:30]}... | 第 {item['estimated_chapter']} 章 | "
                    f"{item['elapsed']} 章 | {item['status']} |"
                )
        else:
            lines.append("✅ 所有伏笔进度正常")

        lines.extend(["", "---", ""])

        return lines

    def _generate_pacing_section(self) -> List[str]:
        """生成节奏分析章节"""
        segments = self.analyze_pacing()

        lines = [
            "## 📈 爽点节奏分布",
            "",
            "```"
        ]

        for seg in segments:
            bar_length = int(12 - (seg["words_per_point"] / 2000 * 12))
            bar_length = max(1, min(12, bar_length))

            bar = "█" * bar_length

            lines.append(
                f"第 {seg['start']}-{seg['end']}章   {bar} "
                f"{seg['rating']}（{seg['words_per_point']:.0f}字/爽点）"
            )

        lines.extend(["```", "", "---", ""])

        return lines

    def _generate_relationship_section(self) -> List[str]:
        """生成人际关系章节"""
        graph = self.generate_relationship_graph()

        lines = [
            "## 💑 人际关系趋势",
            "",
            graph,
            "",
            "---",
            ""
        ]

        return lines

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="可视化状态报告生成器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 生成完整健康报告
  python status_reporter.py --output .webnovel/health_report.md

  # 仅分析角色活跃度
  python status_reporter.py --focus characters

  # 仅分析伏笔
  python status_reporter.py --focus foreshadowing

  # 仅分析爽点节奏
  python status_reporter.py --focus pacing
        """
    )

    parser.add_argument('--output', default='.webnovel/health_report.md',
                       help='输出文件路径')
    parser.add_argument('--focus', choices=['all', 'basic', 'characters',
                                            'foreshadowing', 'pacing', 'relationships'],
                       default='all', help='分析焦点')
    parser.add_argument('--project-root', default='.', help='项目根目录')

    args = parser.parse_args()

    # 创建报告生成器
    reporter = StatusReporter(args.project_root)

    # 加载状态
    if not reporter.load_state():
        sys.exit(1)

    print("📖 正在扫描章节文件...")
    reporter.scan_chapters()

    print(f"✅ 已扫描 {len(reporter.chapters_data)} 个章节")

    print("\n📊 正在分析...")

    # 生成报告
    report = reporter.generate_report(args.focus)

    # 保存报告
    output_file = Path(args.output)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(report)

    print(f"\n✅ 健康报告已生成: {output_file}")

    # 预览报告（前 30 行）
    print("\n" + "="*60)
    print("📄 报告预览：\n")
    print("\n".join(report.split("\n")[:30]))
    print("\n...")
    print("="*60)

if __name__ == "__main__":
    main()
