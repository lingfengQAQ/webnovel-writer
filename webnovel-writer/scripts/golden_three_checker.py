"""
黄金三章检查工具 v2.0 (LLM-Driven)

功能：检测小说前三章是否符合"黄金三章"标准

v2.0 重大升级：
- 保留关键词预检作为快速模式
- 新增 LLM 深度评估模式（AI Native）
- 生成结构化评估 Prompt，解析 XML 评估结果

核心检查点：
- 第 1 章：300 字内主角出场 + 金手指线索 + 强冲突开局
- 第 2 章：金手指展示 + 初次小胜 + 即时爽点
- 第 3 章：悬念钩子 + 下一阶段预告 + 爽点密度 >= 1

使用方法：
python golden_three_checker.py --auto                    # 快速关键词模式
python golden_three_checker.py --auto --mode llm         # LLM 深度评估（推荐）
python golden_three_checker.py --auto --generate-prompt  # 仅生成评估 Prompt
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from chapter_paths import find_chapter_file

# 导入项目定位和章节路径模块
from project_locator import resolve_project_root
from runtime_compat import enable_windows_utf8_stdio

# Windows UTF-8 输出修复
if sys.platform == "win32":
    enable_windows_utf8_stdio()


# ============================================================================
# LLM 评估 Prompt 模板
# ============================================================================

LLM_EVALUATION_PROMPT = """你是一位网文编辑，专门负责评估小说开篇的"黄金三章"质量。

请根据以下标准，对这三章内容进行专业评估：

## 黄金三章标准

### 第 1 章核心检查点：
1. **主角 300 字内出场**：主角是否在前 300 字内登场？身份是否清晰？
2. **金手指线索**：是否有金手指/外挂的暗示或线索？
3. **强冲突开局**：开篇是否有足够强的冲突/危机/矛盾？

### 第 2 章核心检查点：
1. **金手指展示**：金手指是否有明确展示？读者能否理解其能力？
2. **初次小胜**：主角是否获得了第一次小规模胜利/成功？
3. **即时爽点**：是否有让读者感到爽快/满足的场景？

### 第 3 章核心检查点：
1. **悬念钩子**：章节结尾是否有悬念？能否驱动读者继续阅读？
2. **下一阶段预告**：是否暗示了接下来的剧情走向/新挑战？
3. **爽点密度**：本章是否至少有 1 个明显的爽点场景？

---

## 待评估内容

### 第 1 章
```
{chapter1_content}
```

### 第 2 章
```
{chapter2_content}
```

### 第 3 章
```
{chapter3_content}
```

---

## 输出要求

请以如下 XML 格式输出你的评估结果（务必严格遵循格式）：

```xml
<golden_three_assessment>
  <chapter num="1">
    <check name="主角300字内出场" passed="true|false" score="0-100">
      <evidence>具体证据/引用原文</evidence>
      <suggestion>如未通过，给出改进建议</suggestion>
    </check>
    <check name="金手指线索" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
    <check name="强冲突开局" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
  </chapter>

  <chapter num="2">
    <check name="金手指展示" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
    <check name="初次小胜" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
    <check name="即时爽点" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
  </chapter>

  <chapter num="3">
    <check name="悬念钩子" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
    <check name="下一阶段预告" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
    <check name="爽点密度>=1" passed="true|false" score="0-100">
      <evidence>具体证据</evidence>
      <suggestion>改进建议</suggestion>
    </check>
  </chapter>

  <overall_score>0-100</overall_score>
  <verdict>优秀|良好|需改进|严重不足</verdict>
  <top_issues>
    <issue priority="1">最需要改进的问题</issue>
    <issue priority="2">次要问题</issue>
  </top_issues>
</golden_three_assessment>
```

现在开始评估：
"""


class GoldenThreeChecker:
    """黄金三章检查器 v2.0"""

    def __init__(self, chapter_files: list[str], mode: str = "keyword"):
        """
        初始化检查器

        Args:
            chapter_files: 章节文件路径列表（必须是前3章）
            mode: 检查模式 ("keyword" 快速模式, "llm" LLM评估模式)
        """
        if len(chapter_files) != 3:
            raise ValueError("必须提供前 3 章的文件路径")

        self.chapter_files = chapter_files
        self.mode = mode
        self.chapters: list[dict[str, Any]] = []
        self.results: dict[str, Any] = {
            "mode": mode,
            "ch1": {"主角300字内出场": False, "金手指线索": False, "强冲突开局": False, "详细": {}},
            "ch2": {"金手指展示": False, "初次小胜": False, "即时爽点": False, "详细": {}},
            "ch3": {"悬念钩子": False, "下一阶段预告": False, "爽点密度>=1": False, "详细": {}},
        }

    def load_chapters(self) -> None:
        """加载章节内容"""
        for i, file_path in enumerate(self.chapter_files):
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"文件不存在: {file_path}")

            with open(file_path, encoding='utf-8') as f:
                content = f.read()
                self.chapters.append({
                    "number": i + 1,
                    "path": file_path,
                    "content": content,
                    "word_count": len(re.sub(r'\s+', '', content))
                })

    # ============================================================================
    # 快速关键词模式（保留原有逻辑）
    # ============================================================================

    def check_chapter1_keywords(self) -> None:
        """检查第1章（关键词模式）"""
        content = self.chapters[0]["content"]
        first_300_chars = content[:300]

        # 检查1: 主角 300 字内出场
        protagonist_keywords = ["林天", "我", "主角", "少年", "他", "叶凡", "萧炎", "楚枫"]
        for keyword in protagonist_keywords:
            if keyword in first_300_chars:
                self.results["ch1"]["主角300字内出场"] = True
                self.results["ch1"]["详细"]["主角出场关键词"] = keyword
                break

        # 检查2: 金手指线索
        golden_finger_keywords = [
            "系统", "空间", "重生", "穿越", "戒指", "老爷爷",
            "器灵", "传承", "血脉", "觉醒", "签到", "任务", "面板", "属性"
        ]
        found = [kw for kw in golden_finger_keywords if kw in content]
        self.results["ch1"]["金手指线索"] = len(found) > 0
        self.results["ch1"]["详细"]["金手指关键词"] = found

        # 检查3: 强冲突开局
        conflict_keywords = [
            "退婚", "羞辱", "嘲讽", "废物", "落魄", "危机",
            "追杀", "绝境", "被困", "重伤", "濒死", "灭族"
        ]
        found = [kw for kw in conflict_keywords if kw in content]
        self.results["ch1"]["强冲突开局"] = len(found) > 0
        self.results["ch1"]["详细"]["冲突关键词"] = found

    def check_chapter2_keywords(self) -> None:
        """检查第2章（关键词模式）"""
        content = self.chapters[1]["content"]

        system_display_keywords = ["【", "╔", "姓名", "境界", "力量", "属性", "获得", "奖励", "升级"]
        found = [kw for kw in system_display_keywords if kw in content]
        self.results["ch2"]["金手指展示"] = len(found) >= 2
        self.results["ch2"]["详细"]["展示关键词"] = found

        victory_keywords = ["击败", "胜利", "获胜", "成功", "通过", "突破", "秒杀", "碾压"]
        found = [kw for kw in victory_keywords if kw in content]
        self.results["ch2"]["初次小胜"] = len(found) > 0
        self.results["ch2"]["详细"]["胜利关键词"] = found

        cool_keywords = ["震惊", "不可能", "怎么会", "全场哗然", "目瞪口呆", "难以置信"]
        found = [kw for kw in cool_keywords if kw in content]
        self.results["ch2"]["即时爽点"] = len(found) >= 2
        self.results["ch2"]["详细"]["爽点关键词"] = found

    def check_chapter3_keywords(self) -> None:
        """检查第3章（关键词模式）"""
        content = self.chapters[2]["content"]
        last_300_chars = content[-300:]

        suspense_keywords = ["？", "！", "危机", "即将", "突然", "就在这时", "阴影", "杀机"]
        found = [kw for kw in suspense_keywords if kw in last_300_chars]
        self.results["ch3"]["悬念钩子"] = len(found) >= 2
        self.results["ch3"]["详细"]["悬念关键词"] = found

        preview_keywords = ["秘境", "大比", "选拔", "试炼", "任务", "挑战", "前往", "即将"]
        found = [kw for kw in preview_keywords if kw in content]
        self.results["ch3"]["下一阶段预告"] = len(found) > 0
        self.results["ch3"]["详细"]["预告关键词"] = found

        cool_count = sum(content.count(kw) for kw in ["震惊", "不可能", "全场哗然", "天才", "击败", "获得"])
        self.results["ch3"]["爽点密度>=1"] = cool_count >= 1
        self.results["ch3"]["详细"]["爽点统计"] = cool_count

    # ============================================================================
    # LLM 评估模式
    # ============================================================================

    def generate_llm_prompt(self) -> str:
        """生成 LLM 评估 Prompt"""
        # 截取每章内容（避免过长）
        max_chars_per_chapter = 6000

        ch1 = self.chapters[0]["content"][:max_chars_per_chapter]
        ch2 = self.chapters[1]["content"][:max_chars_per_chapter]
        ch3 = self.chapters[2]["content"][:max_chars_per_chapter]

        prompt = LLM_EVALUATION_PROMPT.format(
            chapter1_content=ch1,
            chapter2_content=ch2,
            chapter3_content=ch3
        )
        return prompt

    def parse_llm_response(self, xml_response: str) -> dict[str, Any]:
        """解析 LLM 返回的 XML 评估结果"""
        results: dict[str, Any] = {
            "mode": "llm",
            "ch1": {"详细": {}},
            "ch2": {"详细": {}},
            "ch3": {"详细": {}},
            "overall_score": 0,
            "verdict": "",
            "top_issues": []
        }

        # 提取 overall_score
        score_match = re.search(r'<overall_score>(\d+)</overall_score>', xml_response)
        if score_match:
            results["overall_score"] = int(score_match.group(1))

        # 提取 verdict
        verdict_match = re.search(r'<verdict>([^<]+)</verdict>', xml_response)
        if verdict_match:
            results["verdict"] = verdict_match.group(1).strip()

        # 提取每章的检查点
        chapter_pattern = re.compile(
            r'<chapter num="(\d)">(.*?)</chapter>',
            re.DOTALL
        )
        check_pattern = re.compile(
            r'<check name="([^"]+)" passed="(true|false)" score="(\d+)">\s*'
            r'<evidence>([^<]*)</evidence>\s*'
            r'<suggestion>([^<]*)</suggestion>\s*'
            r'</check>',
            re.DOTALL
        )

        for chapter_match in chapter_pattern.finditer(xml_response):
            chapter_num = chapter_match.group(1)
            chapter_content = chapter_match.group(2)
            chapter_key = f"ch{chapter_num}"

            for check_match in check_pattern.finditer(chapter_content):
                check_name = check_match.group(1)
                passed = check_match.group(2) == "true"
                score = int(check_match.group(3))
                evidence = check_match.group(4).strip()
                suggestion = check_match.group(5).strip()

                results[chapter_key][check_name] = passed
                results[chapter_key]["详细"][check_name] = {
                    "score": score,
                    "evidence": evidence,
                    "suggestion": suggestion
                }

        # 提取 top_issues
        issue_pattern = re.compile(r'<issue priority="(\d)">([^<]+)</issue>')
        for issue_match in issue_pattern.finditer(xml_response):
            priority = int(issue_match.group(1))
            issue_text = issue_match.group(2).strip()
            results["top_issues"].append({"priority": priority, "issue": issue_text})

        return results

    # ============================================================================
    # 报告生成
    # ============================================================================

    def calculate_score(self) -> tuple:
        """计算总体得分"""
        total_checks = 0
        passed_checks = 0

        for chapter_key in ["ch1", "ch2", "ch3"]:
            for check_key, check_value in self.results[chapter_key].items():
                if check_key != "详细" and isinstance(check_value, bool):
                    total_checks += 1
                    if check_value:
                        passed_checks += 1

        score = (passed_checks / total_checks) * 100 if total_checks > 0 else 0
        return score, passed_checks, total_checks

    def generate_report(self) -> str:
        """生成检查报告"""
        score, passed, total = self.calculate_score()

        report = []
        report.append("=" * 60)
        report.append(f"黄金三章诊断报告 (模式: {self.mode})")
        report.append("=" * 60)
        report.append(f"\n总体得分: {score:.1f}% ({passed}/{total} 项通过)\n")

        # 第 1 章
        report.append("-" * 60)
        report.append("【第 1 章】检查结果")
        report.append("-" * 60)
        for check_name in ["主角300字内出场", "金手指线索", "强冲突开局"]:
            passed = self.results["ch1"].get(check_name, False)
            icon = "✅" if passed else "❌"
            report.append(f"{icon} {check_name}: {'通过' if passed else '未通过'}")

            # 显示详细信息
            detail = self.results["ch1"]["详细"].get(check_name)
            if isinstance(detail, dict):
                if detail.get("evidence"):
                    report.append(f"   └─ 证据: {detail['evidence'][:100]}...")
                if not passed and detail.get("suggestion"):
                    report.append(f"   └─ 建议: {detail['suggestion']}")
            elif isinstance(detail, list) and detail:
                report.append(f"   └─ 关键词: {', '.join(detail[:5])}")

        # 第 2 章
        report.append("\n" + "-" * 60)
        report.append("【第 2 章】检查结果")
        report.append("-" * 60)
        for check_name in ["金手指展示", "初次小胜", "即时爽点"]:
            passed = self.results["ch2"].get(check_name, False)
            icon = "✅" if passed else "❌"
            report.append(f"{icon} {check_name}: {'通过' if passed else '未通过'}")
            detail = self.results["ch2"]["详细"].get(check_name)
            if isinstance(detail, dict) and detail.get("evidence"):
                report.append(f"   └─ 证据: {detail['evidence'][:100]}...")
            elif isinstance(detail, list) and detail:
                report.append(f"   └─ 关键词: {', '.join(detail[:5])}")

        # 第 3 章
        report.append("\n" + "-" * 60)
        report.append("【第 3 章】检查结果")
        report.append("-" * 60)
        for check_name in ["悬念钩子", "下一阶段预告", "爽点密度>=1"]:
            passed = self.results["ch3"].get(check_name, False)
            icon = "✅" if passed else "❌"
            report.append(f"{icon} {check_name}: {'通过' if passed else '未通过'}")
            detail = self.results["ch3"]["详细"].get(check_name)
            if isinstance(detail, dict) and detail.get("evidence"):
                report.append(f"   └─ 证据: {detail['evidence'][:100]}...")

        # 改进建议
        report.append("\n" + "=" * 60)
        report.append("【改进建议】")
        report.append("=" * 60)

        if score < 60:
            report.append("\n🔴 警告: 开篇吸引力不足，严重影响读者留存率！")
        elif score < 80:
            report.append("\n🟡 注意: 开篇有改进空间")
        else:
            report.append("\n✅ 很好！开篇符合黄金三章标准")

        # LLM 模式的额外信息
        if self.mode == "llm" and self.results.get("top_issues"):
            report.append("\n优先修复：")
            for issue in self.results["top_issues"]:
                report.append(f"  {issue['priority']}. {issue['issue']}")

        report.append("\n" + "=" * 60)
        return "\n".join(report)

    def run(self) -> None:
        """执行检查"""
        print("正在加载章节...")
        self.load_chapters()

        print(f"✅ 已加载 {len(self.chapters)} 章")
        for ch in self.chapters:
            print(f"   - 第 {ch['number']} 章: {ch['word_count']} 字")
        print(f"\n正在执行检查 (模式: {self.mode})...\n")

        if self.mode == "keyword":
            self.check_chapter1_keywords()
            self.check_chapter2_keywords()
            self.check_chapter3_keywords()
            report = self.generate_report()
            print(report)

        elif self.mode == "llm":
            prompt = self.generate_llm_prompt()
            print("=" * 60)
            print("LLM 评估模式：请将以下 Prompt 发送给 Codex/GPT")
            print("=" * 60)
            print("\n--- PROMPT START ---\n")
            print(prompt[:2000] + "\n...[内容已截断，完整版见输出文件]...")
            print("\n--- PROMPT END ---\n")

            # 保存完整 prompt
            output_dir = Path(".webnovel")
            output_dir.mkdir(exist_ok=True)
            prompt_file = output_dir / "golden_three_prompt.md"
            with open(prompt_file, 'w', encoding='utf-8') as f:
                f.write(prompt)
            print(f"📄 完整 Prompt 已保存至: {prompt_file}")
            print("\n💡 使用方法：")
            print("   1. 将 Prompt 发送给 Codex/GPT")
            print("   2. 获取 XML 格式的评估结果")
            print("   3. 运行: python golden_three_checker.py --parse-response <response.xml>")

        # 保存结果
        output_dir = Path(".webnovel")
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / "golden_three_report.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(self.results, f, ensure_ascii=False, indent=2)
        print(f"\n📄 详细结果已保存至: {output_file}")


def main():
    parser = argparse.ArgumentParser(
        description="黄金三章检查工具 v2.0 (LLM-Driven)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 快速关键词模式（默认）
  python golden_three_checker.py --auto

  # LLM 深度评估模式（推荐）
  python golden_three_checker.py --auto --mode llm

  # 解析 LLM 返回的评估结果
  python golden_three_checker.py --parse-response response.xml
""".strip(),
    )

    parser.add_argument("chapter_files", nargs="*", help="前三章文件路径")
    parser.add_argument("--auto", action="store_true", help="自动定位前三章文件")
    parser.add_argument("--mode", choices=["keyword", "llm"], default="keyword",
                        help="检查模式: keyword(快速) / llm(深度)")
    parser.add_argument("--project-root", default=None, help="项目根目录")
    parser.add_argument("--parse-response", metavar="FILE", help="解析 LLM 返回的 XML 文件")

    args = parser.parse_args()

    # 解析 LLM 响应模式
    if args.parse_response:
        if not os.path.exists(args.parse_response):
            print(f"❌ 文件不存在: {args.parse_response}")
            sys.exit(1)

        with open(args.parse_response, encoding='utf-8') as f:
            xml_content = f.read()

        checker = GoldenThreeChecker(["dummy"] * 3, mode="llm")
        checker.results = checker.parse_llm_response(xml_content)

        print("=" * 60)
        print("LLM 评估结果解析")
        print("=" * 60)
        print(json.dumps(checker.results, ensure_ascii=False, indent=2))
        sys.exit(0)

    # 正常检查模式
    chapter_files = []

    if args.auto or not args.chapter_files:
        try:
            project_root = resolve_project_root(args.project_root)
        except FileNotFoundError as e:
            print(f"❌ {e}")
            sys.exit(1)

        for i in range(1, 4):
            chapter_path = find_chapter_file(project_root, i)
            if chapter_path:
                chapter_files.append(str(chapter_path))
            else:
                print(f"❌ 找不到第 {i} 章文件")
                sys.exit(1)

        print(f"📂 项目根目录: {project_root}")
        print(f"📄 检测到前三章: {', '.join(Path(f).name for f in chapter_files)}\n")
    else:
        if len(args.chapter_files) < 3:
            print("用法: python golden_three_checker.py <第1章路径> <第2章路径> <第3章路径>")
            sys.exit(1)
        chapter_files = args.chapter_files[:3]

    try:
        checker = GoldenThreeChecker(chapter_files, mode=args.mode)
        checker.run()
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
