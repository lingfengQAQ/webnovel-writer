# -*- coding: utf-8 -*-
"""
黄金三章检查工具
Golden Three Chapters Checker

功能：检测小说前三章是否符合"黄金三章"标准

核心检查点：
- 第 1 章：300 字内主角出场 + 金手指线索 + 强冲突开局
- 第 2 章：金手指展示 + 初次小胜 + 即时爽点
- 第 3 章：悬念钩子 + 下一阶段预告 + 爽点密度 >= 1

使用方法：
python golden_three_checker.py <章节文件路径1> <章节文件路径2> <章节文件路径3>

示例：
python .claude/skills/webnovel-writer/scripts/golden_three_checker.py "正文/第0001章.md" "正文/第0002章.md" "正文/第0003章.md"
"""

import sys
import os
import re
import json
from pathlib import Path

# Windows UTF-8 输出修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


class GoldenThreeChecker:
    """黄金三章检查器"""

    def __init__(self, chapter_files):
        """
        初始化检查器

        Args:
            chapter_files: 章节文件路径列表（必须是前3章）
        """
        if len(chapter_files) != 3:
            raise ValueError("必须提供前 3 章的文件路径")

        self.chapter_files = chapter_files
        self.chapters = []
        self.results = {
            "ch1": {
                "主角300字内出场": False,
                "金手指线索": False,
                "强冲突开局": False,
                "详细": {}
            },
            "ch2": {
                "金手指展示": False,
                "初次小胜": False,
                "即时爽点": False,
                "详细": {}
            },
            "ch3": {
                "悬念钩子": False,
                "下一阶段预告": False,
                "爽点密度>=1": False,
                "详细": {}
            }
        }

    def load_chapters(self):
        """加载章节内容"""
        for i, file_path in enumerate(self.chapter_files):
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"文件不存在: {file_path}")

            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                self.chapters.append({
                    "number": i + 1,
                    "path": file_path,
                    "content": content,
                    "word_count": len(re.sub(r'\s+', '', content))  # 去空格字数
                })

    def check_chapter1(self):
        """检查第1章"""
        content = self.chapters[0]["content"]

        # 检查1: 主角 300 字内出场
        first_300_chars = content[:300]
        protagonist_keywords = [
            "林天", "我", "主角", "少年", "他",
            "叶凡", "萧炎", "楚枫"  # 常见主角名
        ]

        protagonist_found = False
        for keyword in protagonist_keywords:
            if keyword in first_300_chars:
                protagonist_found = True
                self.results["ch1"]["详细"]["主角出场关键词"] = keyword
                self.results["ch1"]["详细"]["出场位置"] = first_300_chars.find(keyword)
                break

        self.results["ch1"]["主角300字内出场"] = protagonist_found

        # 检查2: 金手指线索
        golden_finger_keywords = [
            "系统", "空间", "重生", "穿越", "戒指", "老爷爷",
            "器灵", "传承", "血脉", "觉醒", "签到", "任务",
            "面板", "属性", "商城", "抽奖"
        ]

        found_keywords = [kw for kw in golden_finger_keywords if kw in content]
        self.results["ch1"]["金手指线索"] = len(found_keywords) > 0
        self.results["ch1"]["详细"]["金手指关键词"] = found_keywords

        # 检查3: 强冲突开局
        conflict_keywords = [
            "退婚", "羞辱", "嘲讽", "废物", "落魄", "危机",
            "追杀", "绝境", "被困", "重伤", "濒死", "灭族"
        ]

        found_conflicts = [kw for kw in conflict_keywords if kw in content]
        self.results["ch1"]["强冲突开局"] = len(found_conflicts) > 0
        self.results["ch1"]["详细"]["冲突关键词"] = found_conflicts

    def check_chapter2(self):
        """检查第2章"""
        content = self.chapters[1]["content"]

        # 检查1: 金手指展示
        system_display_keywords = [
            "【", "╔", "姓名", "境界", "力量", "属性",
            "获得", "奖励", "任务完成", "升级"
        ]

        found_display = [kw for kw in system_display_keywords if kw in content]
        self.results["ch2"]["金手指展示"] = len(found_display) >= 2  # 至少2个关键词
        self.results["ch2"]["详细"]["展示关键词"] = found_display

        # 检查2: 初次小胜
        victory_keywords = [
            "击败", "胜利", "获胜", "成功", "通过", "突破",
            "秒杀", "碾压", "打败", "制服"
        ]

        found_victory = [kw for kw in victory_keywords if kw in content]
        self.results["ch2"]["初次小胜"] = len(found_victory) > 0
        self.results["ch2"]["详细"]["胜利关键词"] = found_victory

        # 检查3: 即时爽点
        cool_point_keywords = [
            "震惊", "不可能", "怎么会", "全场哗然", "目瞪口呆",
            "倒吸一口凉气", "难以置信", "惊呼", "惊叹", "天才"
        ]

        found_cool = [kw for kw in cool_point_keywords if kw in content]
        self.results["ch2"]["即时爽点"] = len(found_cool) >= 2
        self.results["ch2"]["详细"]["爽点关键词"] = found_cool

    def check_chapter3(self):
        """检查第3章"""
        content = self.chapters[2]["content"]

        # 检查1: 悬念钩子（通常在章节结尾）
        last_300_chars = content[-300:]

        suspense_keywords = [
            "？", "！", "危机", "即将", "突然", "就在这时",
            "阴影", "杀机", "威胁", "出现", "降临", "来了"
        ]

        found_suspense = [kw for kw in suspense_keywords if kw in last_300_chars]
        self.results["ch3"]["悬念钩子"] = len(found_suspense) >= 2
        self.results["ch3"]["详细"]["悬念关键词"] = found_suspense
        self.results["ch3"]["详细"]["结尾内容预览"] = last_300_chars[:100] + "..."

        # 检查2: 下一阶段预告
        preview_keywords = [
            "秘境", "大比", "选拔", "试炼", "任务", "挑战",
            "前往", "即将", "准备", "接下来", "下一步"
        ]

        found_preview = [kw for kw in preview_keywords if kw in content]
        self.results["ch3"]["下一阶段预告"] = len(found_preview) > 0
        self.results["ch3"]["详细"]["预告关键词"] = found_preview

        # 检查3: 爽点密度 >= 1
        cool_count = content.count("震惊") + content.count("不可能") + \
                     content.count("全场哗然") + content.count("天才") + \
                     content.count("击败") + content.count("获得")

        self.results["ch3"]["爽点密度>=1"] = cool_count >= 1
        self.results["ch3"]["详细"]["爽点统计"] = cool_count

    def calculate_score(self):
        """计算总体得分"""
        total_checks = 0
        passed_checks = 0

        for chapter_key in ["ch1", "ch2", "ch3"]:
            for check_key, check_value in self.results[chapter_key].items():
                if check_key != "详细":
                    total_checks += 1
                    if check_value:
                        passed_checks += 1

        score = (passed_checks / total_checks) * 100
        return score, passed_checks, total_checks

    def generate_report(self):
        """生成检查报告"""
        score, passed, total = self.calculate_score()

        report = []
        report.append("=" * 60)
        report.append("黄金三章诊断报告")
        report.append("=" * 60)
        report.append(f"\n总体得分: {score:.1f}% ({passed}/{total} 项通过)\n")

        # 第 1 章
        report.append("-" * 60)
        report.append("【第 1 章】检查结果")
        report.append("-" * 60)
        report.append(f"✅ 主角 300 字内出场: {'通过' if self.results['ch1']['主角300字内出场'] else '❌ 未通过'}")
        if self.results['ch1']['详细'].get('主角出场关键词'):
            report.append(f"   └─ 关键词: {self.results['ch1']['详细']['主角出场关键词']}")

        report.append(f"\n✅ 金手指线索: {'通过' if self.results['ch1']['金手指线索'] else '❌ 未通过'}")
        if self.results['ch1']['详细'].get('金手指关键词'):
            report.append(f"   └─ 发现: {', '.join(self.results['ch1']['详细']['金手指关键词'])}")

        report.append(f"\n✅ 强冲突开局: {'通过' if self.results['ch1']['强冲突开局'] else '❌ 未通过'}")
        if self.results['ch1']['详细'].get('冲突关键词'):
            report.append(f"   └─ 发现: {', '.join(self.results['ch1']['详细']['冲突关键词'])}")

        # 第 2 章
        report.append("\n" + "-" * 60)
        report.append("【第 2 章】检查结果")
        report.append("-" * 60)
        report.append(f"✅ 金手指展示: {'通过' if self.results['ch2']['金手指展示'] else '❌ 未通过'}")
        if self.results['ch2']['详细'].get('展示关键词'):
            report.append(f"   └─ 发现: {', '.join(self.results['ch2']['详细']['展示关键词'])}")

        report.append(f"\n✅ 初次小胜: {'通过' if self.results['ch2']['初次小胜'] else '❌ 未通过'}")
        if self.results['ch2']['详细'].get('胜利关键词'):
            report.append(f"   └─ 发现: {', '.join(self.results['ch2']['详细']['胜利关键词'])}")

        report.append(f"\n✅ 即时爽点: {'通过' if self.results['ch2']['即时爽点'] else '❌ 未通过'}")
        if self.results['ch2']['详细'].get('爽点关键词'):
            report.append(f"   └─ 发现: {', '.join(self.results['ch2']['详细']['爽点关键词'])}")

        # 第 3 章
        report.append("\n" + "-" * 60)
        report.append("【第 3 章】检查结果")
        report.append("-" * 60)
        report.append(f"✅ 悬念钩子: {'通过' if self.results['ch3']['悬念钩子'] else '❌ 未通过'}")
        if self.results['ch3']['详细'].get('悬念关键词'):
            report.append(f"   └─ 发现: {', '.join(self.results['ch3']['详细']['悬念关键词'])}")

        report.append(f"\n✅ 下一阶段预告: {'通过' if self.results['ch3']['下一阶段预告'] else '❌ 未通过'}")
        if self.results['ch3']['详细'].get('预告关键词'):
            report.append(f"   └─ 发现: {', '.join(self.results['ch3']['详细']['预告关键词'])}")

        report.append(f"\n✅ 爽点密度 >= 1: {'通过' if self.results['ch3']['爽点密度>=1'] else '❌ 未通过'}")
        if self.results['ch3']['详细'].get('爽点统计') is not None:
            report.append(f"   └─ 统计: {self.results['ch3']['详细']['爽点统计']} 个爽点")

        # 改进建议
        report.append("\n" + "=" * 60)
        report.append("【改进建议】")
        report.append("=" * 60)

        if score < 60:
            report.append("\n🔴 警告: 开篇吸引力不足，严重影响读者留存率！")
        elif score < 80:
            report.append("\n🟡 注意: 开篇有改进空间，建议优化以下方面：")
        else:
            report.append("\n✅ 很好！开篇符合黄金三章标准，继续保持！")

        # 具体建议
        if not self.results["ch1"]["主角300字内出场"]:
            report.append("\n• 第 1 章: 主角出场过晚，建议在前 300 字内让主角登场")

        if not self.results["ch1"]["金手指线索"]:
            report.append("\n• 第 1 章: 缺少金手指线索，建议暗示主角的特殊之处")

        if not self.results["ch1"]["强冲突开局"]:
            report.append("\n• 第 1 章: 冲突不够强烈，建议直接从危机/冲突切入")

        if not self.results["ch2"]["金手指展示"]:
            report.append("\n• 第 2 章: 金手指展示不明显，建议加入系统面板或明确描述")

        if not self.results["ch2"]["初次小胜"]:
            report.append("\n• 第 2 章: 缺少主角的初次胜利，建议安排一次小规模打脸/胜利")

        if not self.results["ch3"]["悬念钩子"]:
            report.append("\n• 第 3 章: 结尾缺少悬念，建议卡在危机降临/新任务出现的时刻")

        if not self.results["ch3"]["下一阶段预告"]:
            report.append("\n• 第 3 章: 缺少下一阶段预告，建议暗示即将到来的大事件")

        report.append("\n" + "=" * 60)

        return "\n".join(report)

    def run(self):
        """执行检查"""
        print("正在加载章节...")
        self.load_chapters()

        print(f"✅ 已加载 {len(self.chapters)} 章")
        print(f"   - 第 1 章: {self.chapters[0]['word_count']} 字")
        print(f"   - 第 2 章: {self.chapters[1]['word_count']} 字")
        print(f"   - 第 3 章: {self.chapters[2]['word_count']} 字")
        print("\n正在执行检查...\n")

        self.check_chapter1()
        self.check_chapter2()
        self.check_chapter3()

        report = self.generate_report()
        print(report)

        # 保存结果到 JSON
        output_dir = Path(".webnovel")
        output_dir.mkdir(exist_ok=True)

        output_file = output_dir / "golden_three_report.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(self.results, f, ensure_ascii=False, indent=2)

        print(f"\n📄 详细结果已保存至: {output_file}")


def main():
    if len(sys.argv) < 4:
        print("用法: python golden_three_checker.py <第1章路径> <第2章路径> <第3章路径>")
        print("\n示例:")
        print('python .claude/skills/webnovel-writer/scripts/golden_three_checker.py "正文/第0001章.md" "正文/第0002章.md" "正文/第0003章.md"')
        sys.exit(1)

    chapter_files = sys.argv[1:4]

    try:
        checker = GoldenThreeChecker(chapter_files)
        checker.run()
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
