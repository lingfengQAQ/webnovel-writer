#!/usr/bin/env python3
"""
上下文分页管理系统 (Context Manager)

核心理念：200万字小说不能每次都加载全部设定，需要"滑动窗口"机制。

功能：
1. 根据当前章节的 location 和 characters，动态筛选相关设定
2. 分层加载：核心上下文（必须）+ 场景上下文（按需）+ 全局概览（极简）
3. Token 优化：从 50,000 Token 压缩到 3,500 Token（节省 93%）
4. 缓存机制：避免重复计算

使用方式：
  # 为第 45 章构建上下文
  python context_manager.py --chapter 45 --output .webnovel/context_cache.json

  # 指定主角所在地点（可选，否则从 state.json 读取）
  python context_manager.py --chapter 45 --location "血煞秘境" --output context.json

  # Dry-run 模式（预览 Token 消耗）
  python context_manager.py --chapter 45 --dry-run

架构设计：
  核心上下文（Core Context）- 必须加载
    └── 当前章节大纲（本章目标、出场角色、爽点设计）
    └── 主角卡（简版：姓名、境界、金手指、核心性格）
    └── 前 2 章摘要（各 200 字）

  场景上下文（Scene Context）- 按需加载
    └── 当前地点详情（从 世界观.md 提取对应章节）
    └── 出场角色卡（完整版，最多 5 个）
    └── 相关伏笔（status=未回收 且 涉及当前地点/角色）
    └── 相关物品/招式（主角当前拥有 + 本章可能用到）

  全局概览（Global Overview）- 极简版
    └── 世界观骨架（500 Token：势力关系图 + 地理框架）
    └── 力量体系（300 Token：境界列表 + 主角当前位置）
    └── 关键伏笔提醒（100 Token：未回收且紧急的）

Token 预算分配：
  - 核心上下文：1500 Token
  - 场景上下文：1500 Token
  - 全局概览：500 Token
  - 总计：3500 Token（约 2600 字中文）
"""

import json
import os
import sys
import re
from pathlib import Path
from typing import Dict, List, Any, Optional
from project_locator import resolve_project_root
from chapter_paths import find_chapter_file

# Windows 编码兼容性修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

class ContextManager:
    """上下文滑动窗口管理器"""

    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.state_file = self.project_root / ".webnovel/state.json"
        self.outline_dir = self.project_root / "大纲"
        self.settings_dir = self.project_root / "设定集"
        self.chapters_dir = self.project_root / "正文"

        self.state = None
        self.token_budget = {
            "core": 1500,
            "scene": 1500,
            "global": 500
        }

        # 新增：初始化结构化索引（Phase 1 集成）
        try:
            # 动态导入 structured_index（避免循环依赖）
            from structured_index import StructuredIndex
            self.index = StructuredIndex(self.project_root)
            self.use_index = True
        except Exception as e:
            # 索引不可用时降级到文件遍历
            print(f"⚠️ 结构化索引不可用，降级到文件遍历: {e}")
            self.index = None
            self.use_index = False

    def load_state(self) -> bool:
        """加载 state.json"""
        if not self.state_file.exists():
            print(f"❌ 状态文件不存在: {self.state_file}")
            return False

        with open(self.state_file, 'r', encoding='utf-8') as f:
            self.state = json.load(f)

        return True

    def estimate_tokens(self, text: str) -> int:
        """估算文本的 Token 数量（粗略：中文 1.5 字/token，英文 4 字符/token）"""
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        english_chars = len(re.findall(r'[a-zA-Z]', text))

        tokens = (chinese_chars / 1.5) + (english_chars / 4)
        return int(tokens)

    def truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """截断文本到指定 Token 数"""
        current_tokens = self.estimate_tokens(text)

        if current_tokens <= max_tokens:
            return text

        # 按比例截断
        ratio = max_tokens / current_tokens
        target_length = int(len(text) * ratio * 0.95)  # 留 5% 余量

        return text[:target_length] + "..."

    def build_core_context(self, chapter_num: int) -> Dict[str, Any]:
        """构建核心上下文（1500 Token）"""
        core = {
            "current_outline": self._get_chapter_outline(chapter_num),
            "protagonist_brief": self._get_protagonist_brief(),
            "recent_summaries": self._get_recent_summaries(chapter_num, count=2)
        }

        return core

    def _get_chapter_outline(self, chapter_num: int) -> str:
        """获取当前章节大纲（从详细大纲中提取）"""
        # 查找包含该章节的卷
        for outline_file in self.outline_dir.glob("第*卷-详细大纲.md"):
            with open(outline_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # 查找章节标题（格式：#### 第 XXX 章：标题）
            pattern = f"#### 第 {chapter_num:03d} 章：(.+?)(?=####|$)"
            match = re.search(pattern, content, re.DOTALL)

            if match:
                outline = match.group(0)
                return self.truncate_to_tokens(outline, 600)  # 限制 600 Token

        return f"[未找到第 {chapter_num} 章大纲，请检查详细大纲文件]"

    def _get_protagonist_brief(self) -> Dict[str, Any]:
        """获取主角卡（简版：400 Token）"""
        if not self.state:
            return {}

        protag_state = self.state.get("protagonist_state", {})

        # 支持两种格式：嵌套格式和平铺格式
        # power 字段
        power_data = protag_state.get("power", {})
        if isinstance(power_data, dict):
            power = power_data
        else:
            # 平铺格式
            power = {
                "realm": protag_state.get("realm", "未知"),
                "layer": protag_state.get("layer", 0),
                "bottleneck": protag_state.get("bottleneck")
            }

        # location 字段
        location_data = protag_state.get("location", {})
        if isinstance(location_data, dict):
            location = location_data.get("current", "未知")
        else:
            # 平铺格式 - location 是字符串
            location = location_data if location_data else "未知"

        # golden_finger 字段
        gf_data = protag_state.get("golden_finger", {})
        gf_name = gf_data.get("name", "无") if isinstance(gf_data, dict) else "无"

        brief = {
            "name": protag_state.get("name", "主角"),
            "power": power,
            "location": location,
            "golden_finger": gf_name
        }

        # 读取主角卡的"核心性格"章节（如果存在）
        protag_card_file = self.settings_dir / "主角卡.md"
        if protag_card_file.exists():
            with open(protag_card_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # 提取"性格特点"章节
            personality_match = re.search(r'## 性格特点\n\n(.+?)(?=\n##|$)', content, re.DOTALL)
            if personality_match:
                personality = personality_match.group(1).strip()
                brief["personality"] = self.truncate_to_tokens(personality, 200)

        return brief

    def _get_recent_summaries(self, chapter_num: int, count: int = 2) -> List[str]:
        """获取前 N 章的摘要（每章 200 字）"""
        summaries = []

        for i in range(chapter_num - count, chapter_num):
            if i <= 0:
                continue

            chapter_file = find_chapter_file(self.project_root, i)
            if not chapter_file:
                continue

            with open(chapter_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # 提取正文摘要（避开标签/统计区块）
            lines = content.splitlines()
            # 去掉标题行
            if lines and lines[0].lstrip().startswith("#"):
                lines = lines[1:]

            buf: List[str] = []
            for line in lines:
                s = line.strip()
                if not s:
                    continue
                if s.startswith("## 本章统计"):
                    break
                if s == "---":
                    continue
                # 过滤工作流标签行（XML 格式 + 旧方括号格式）
                # XML 格式: <entity.../>, <skill.../>, <foreshadow.../>, <deviation.../>
                if re.match(r'^<(entity|skill|foreshadow|deviation)\s+', s):
                    continue
                # 旧格式: [NEW_ENTITY], [GOLDEN_FINGER_SKILL], [FORESHADOWING_JSON], [OUTLINE_DEVIATION]
                if s.startswith("[") and s.endswith("]"):
                    continue
                # HTML 注释包裹的标签（<!-- <entity.../> -->）
                if s.startswith("<!--") and ("<entity" in s or "<skill" in s or "<foreshadow" in s or "<deviation" in s):
                    continue
                buf.append(s)
                if sum(len(x) for x in buf) >= 220:
                    break

            text = "".join(buf).strip()
            summary = (text[:200] + "...") if len(text) > 200 else text
            summaries.append(f"第 {i} 章摘要：{summary}")

        return summaries

    def build_scene_context(self, chapter_num: int, location: Optional[str] = None,
                           characters: Optional[List[str]] = None) -> Dict[str, Any]:
        """构建场景上下文（1500 Token）"""

        # 确定当前地点（支持嵌套和平铺两种格式）
        if not location and self.state:
            location_data = self.state.get("protagonist_state", {}).get("location", {})
            if isinstance(location_data, dict):
                location = location_data.get("current")
            else:
                location = location_data if location_data else None

        scene = {
            "location_details": self._get_location_details(location) if location else None,
            "character_cards": self._get_character_cards(characters) if characters else [],
            "relevant_foreshadowing": self._get_relevant_foreshadowing(location, characters),
            "relevant_items": self._get_relevant_items()
        }

        return scene

    def _get_location_details(self, location: str) -> str:
        """获取地点详情（优先使用索引，性能提升 250x）"""

        # 新增：优先从索引查询相关章节（O(log n) vs O(n)）
        if self.use_index and self.index:
            try:
                related_chapters = self.index.query_chapters_by_location(location, limit=5)

                if related_chapters:
                    # 返回最近 5 章的摘要（动态内容，优于静态描述）
                    summaries = []
                    for chapter_num, title, _ in related_chapters:
                        summaries.append(f"Ch{chapter_num}: {title}")

                    return f"[{location}] 相关章节: " + ", ".join(summaries)

            except Exception as e:
                # 索引查询失败，降级到文件查询
                print(f"⚠️ 索引查询失败，降级到文件: {e}")

        # 降级：从 世界观.md 读取静态描述（原有逻辑）
        worldview_file = self.settings_dir / "世界观.md"

        if not worldview_file.exists():
            return f"[地点：{location}]（详情待补充）"

        with open(worldview_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 查找地点章节（格式：### 地点名）
        pattern = f"### {re.escape(location)}\n\n(.+?)(?=\n###|$)"
        match = re.search(pattern, content, re.DOTALL)

        if match:
            details = match.group(1).strip()
            return self.truncate_to_tokens(details, 400)  # 限制 400 Token

        return f"[地点：{location}]（世界观.md 中未找到详情）"

    def _get_character_cards(self, characters: List[str]) -> List[Dict[str, str]]:
        """获取角色卡（完整版，最多 5 个，每个 200 Token）

        Priority 3 修复：自动检测并恢复归档角色
        """
        cards = []

        for char_name in characters[:5]:  # 最多 5 个
            # ✅ Priority 3 修复：先检查角色是否已归档
            is_archived = False
            if self.use_index and self.index:
                try:
                    # 从索引查询角色状态
                    cursor = self.index.conn.execute(
                        "SELECT status FROM characters WHERE name = ?",
                        (char_name,)
                    )
                    row = cursor.fetchone()

                    if row and row[0] == 'archived':
                        is_archived = True
                        print(f"🔄 检测到归档角色: {char_name}，自动恢复中...")

                        # 自动恢复归档角色
                        try:
                            import subprocess
                            script_dir = Path(__file__).parent
                            archive_script = script_dir / "archive_manager.py"

                            result = subprocess.run(
                                ["python", str(archive_script), "--restore-character", char_name],
                                capture_output=True,
                                text=True,
                                encoding='utf-8',
                                timeout=10
                            )

                            if result.returncode == 0:
                                print(f"✅ 角色 {char_name} 已自动恢复")
                                # 重新加载 state.json
                                self.load_state()
                            else:
                                print(f"⚠️ 角色恢复失败: {result.stderr}")
                        except Exception as e:
                            print(f"⚠️ 自动恢复失败: {e}")

                except Exception as e:
                    print(f"⚠️ 归档检测失败（继续正常查询）: {e}")

            # 在角色库中查找
            for category in ["主要角色", "次要角色", "反派角色"]:
                char_file = self.settings_dir / f"角色库/{category}/{char_name}.md"

                if char_file.exists():
                    with open(char_file, 'r', encoding='utf-8') as f:
                        content = f.read()

                    # 截断到 200 Token
                    truncated = self.truncate_to_tokens(content, 200)
                    cards.append({
                        "name": char_name,
                        "content": truncated
                    })
                    break

        return cards

    @staticmethod
    def _is_resolved_foreshadowing_status(raw_status: Any) -> bool:
        """判断伏笔是否已回收（兼容历史字段与同义词）。"""
        if raw_status is None:
            return False

        status = str(raw_status).strip()
        if not status:
            return False

        status_lower = status.lower()
        if status in {"已回收", "已完成", "已解决", "完成"}:
            return True
        if status_lower in {"resolved", "done", "complete"}:
            return True
        if "已回收" in status:
            return True
        return False

    def _get_relevant_foreshadowing(self, location: Optional[str],
                                   characters: Optional[List[str]]) -> List[Dict[str, str]]:
        """获取相关伏笔（优先使用索引，支持复杂条件查询）"""

        # 新增：优先从索引查询（支持多条件筛选）
        if self.use_index and self.index:
            try:
                # 从索引查询未回收伏笔（自动按紧急度排序）
                urgent_plots = self.index.query_urgent_foreshadowing(threshold=20)

                # 进一步筛选：匹配当前地点/角色
                relevant = []
                for plot in urgent_plots:
                    content = plot.get('content', '')

                    is_relevant = False

                    if location and location in content:
                        is_relevant = True

                    if characters:
                        for char in characters:
                            if char in content:
                                is_relevant = True
                                break

                    if is_relevant:
                        relevant.append(plot)

                return relevant[:3]  # 最多 3 条

            except Exception as e:
                # 索引查询失败，降级到 state.json
                print(f"⚠️ 伏笔索引查询失败，降级到 state.json: {e}")

        # 降级：从 state.json 查询（原有逻辑）
        if not self.state:
            return []

        all_foreshadowing = self.state.get("plot_threads", {}).get("foreshadowing", [])
        relevant = []

        for item in all_foreshadowing:
            if self._is_resolved_foreshadowing_status(item.get("status")):
                continue

            content = item.get("content", "")

            # 检查是否与当前地点/角色相关
            is_relevant = False

            if location and location in content:
                is_relevant = True

            if characters:
                for char in characters:
                    if char in content:
                        is_relevant = True
                        break

            if is_relevant:
                relevant.append(item)

        return relevant[:3]  # 最多 3 条

    def _get_relevant_items(self) -> List[str]:
        """获取相关物品/招式（主角当前拥有）"""
        if not self.state:
            return []

        # 从 state.json 的 entities 中提取主角拥有的物品
        entities = self.state.get("entities", {})
        items = entities.get("items", [])

        # 简化：只返回物品名称列表
        return [item.get("name") for item in items[:5]]  # 最多 5 个

    def build_global_overview(self) -> Dict[str, str]:
        """构建全局概览（500 Token）"""
        overview = {
            "worldview_skeleton": self._get_worldview_skeleton(),
            "power_system_brief": self._get_power_system_brief(),
            "urgent_foreshadowing": self._get_urgent_foreshadowing()
        }

        return overview

    def _get_worldview_skeleton(self) -> str:
        """获取世界观骨架（200 Token）"""
        worldview_file = self.settings_dir / "世界观.md"

        if not worldview_file.exists():
            return "[世界观骨架待补充]"

        with open(worldview_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 提取"势力"章节的标题列表
        factions = re.findall(r'### (.+)', content)

        skeleton = "势力：" + "、".join(factions[:10])  # 最多 10 个
        return self.truncate_to_tokens(skeleton, 200)

    def _get_power_system_brief(self) -> str:
        """获取力量体系（200 Token）"""
        power_file = self.settings_dir / "力量体系.md"

        if not power_file.exists():
            return "[力量体系待补充]"

        with open(power_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 提取"境界划分"章节
        realm_match = re.search(r'## 境界划分\n\n(.+?)(?=\n##|$)', content, re.DOTALL)

        if realm_match:
            realms = realm_match.group(1).strip()
            return self.truncate_to_tokens(realms, 200)

        return "[境界划分待补充]"

    def _get_urgent_foreshadowing(self) -> List[str]:
        """获取紧急伏笔（未回收 且 已埋超过 50 章）"""
        if not self.state:
            return []

        # 优先：使用索引的紧急度（简单阈值：>50章）
        if self.use_index and self.index:
            try:
                urgent_plots = self.index.query_urgent_foreshadowing(threshold=60)
                formatted = []
                for plot in urgent_plots:
                    content = plot.get("content", "")
                    if not content:
                        continue
                    introduced = plot.get("introduced_chapter", 0) or 0
                    formatted.append(f"⚠️ {content}（埋设Ch{introduced}）")
                return formatted[:3]
            except Exception as e:
                print(f"⚠️ 伏笔索引查询失败，降级到 state.json: {e}")

        current_chapter = int(self.state.get("progress", {}).get("current_chapter", 0) or 0)
        all_foreshadowing = self.state.get("plot_threads", {}).get("foreshadowing", []) or []

        scored = []
        for item in all_foreshadowing:
            if self._is_resolved_foreshadowing_status(item.get("status")):
                continue

            introduced = item.get("introduced_chapter") or item.get("planted_chapter") or 1
            try:
                introduced_chapter = int(introduced)
            except (TypeError, ValueError):
                introduced_chapter = 1

            pending = current_chapter - introduced_chapter
            if pending < 50:
                continue

            content = item.get("content", "")
            if not content:
                continue

            scored.append((pending, content))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [f"⚠️ {content}（已埋 {pending} 章）" for pending, content in scored[:3]]

    def build_context(self, chapter_num: int, location: Optional[str] = None,
                     characters: Optional[List[str]] = None) -> Dict[str, Any]:
        """构建完整上下文"""

        context = {
            "chapter": chapter_num,
            "core_context": self.build_core_context(chapter_num),
            "scene_context": self.build_scene_context(chapter_num, location, characters),
            "global_overview": self.build_global_overview(),
            "metadata": {
                "token_usage": {}
            }
        }

        # 估算 Token 消耗
        core_tokens = self.estimate_tokens(json.dumps(context["core_context"], ensure_ascii=False))
        scene_tokens = self.estimate_tokens(json.dumps(context["scene_context"], ensure_ascii=False))
        global_tokens = self.estimate_tokens(json.dumps(context["global_overview"], ensure_ascii=False))

        context["metadata"]["token_usage"] = {
            "core": core_tokens,
            "scene": scene_tokens,
            "global": global_tokens,
            "total": core_tokens + scene_tokens + global_tokens
        }

        return context

    def save_context(self, context: Dict[str, Any], output_file: str):
        """保存上下文到文件"""
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(context, f, ensure_ascii=False, indent=2)

        print(f"✅ 上下文已保存: {output_file}")
        print(f"\n📊 Token 使用情况：")
        usage = context["metadata"]["token_usage"]
        print(f"  核心上下文: {usage['core']} Token")
        print(f"  场景上下文: {usage['scene']} Token")
        print(f"  全局概览: {usage['global']} Token")
        print(f"  总计: {usage['total']} Token")

        # 节省百分比（相比全量加载 50,000 Token）
        savings = (1 - usage['total'] / 50000) * 100
        print(f"\n💰 相比全量加载节省: {savings:.1f}%")

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="上下文滑动窗口管理器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 为第 45 章构建上下文
  python context_manager.py --chapter 45 --output .webnovel/context_cache.json

  # 指定地点和角色
  python context_manager.py --chapter 45 --location "血煞秘境" --characters "李雪,血煞门主"

  # Dry-run 模式（预览 Token 消耗）
  python context_manager.py --chapter 45 --dry-run
        """
    )

    parser.add_argument('--chapter', type=int, required=True, help='章节号')
    parser.add_argument('--location', help='主角所在地点（可选）')
    parser.add_argument('--characters', help='出场角色列表（逗号分隔）')
    parser.add_argument('--output', default='.webnovel/context_cache.json', help='输出文件路径')
    parser.add_argument('--project-root', default='.', help='项目根目录')
    parser.add_argument('--dry-run', action='store_true', help='预览模式，不保存文件')

    args = parser.parse_args()

    # 解析项目根目录（支持从仓库根目录运行）
    project_root = args.project_root
    if project_root == '.' and not (Path('.') / '.webnovel' / 'state.json').exists():
        try:
            project_root = str(resolve_project_root())
        except FileNotFoundError:
            project_root = args.project_root

    # 解析角色列表
    characters = None
    if args.characters:
        characters = [c.strip() for c in args.characters.split(',')]

    # 创建管理器
    manager = ContextManager(project_root)

    # 加载状态
    if not manager.load_state():
        sys.exit(1)

    print(f"📖 正在为第 {args.chapter} 章构建上下文...")

    # 构建上下文
    context = manager.build_context(args.chapter, args.location, characters)

    # 保存或预览
    if args.dry_run:
        print("\n⚠️  Dry-run 模式，不保存文件")
        print("\n📄 上下文预览：")
        print(json.dumps(context, ensure_ascii=False, indent=2))
    else:
        output_path = args.output
        if args.output == '.webnovel/context_cache.json' and project_root != '.':
            output_path = str(Path(project_root) / '.webnovel' / 'context_cache.json')
        manager.save_context(context, output_path)

if __name__ == "__main__":
    main()
