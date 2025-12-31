#!/usr/bin/env python3
"""
安全的 state.json 更新脚本

功能：
1. 提供结构化的 state.json 更新接口
2. 自动验证 JSON 格式和数据完整性
3. 自动备份（带时间戳）
4. 支持部分更新（不影响其他字段）
5. 原子性操作（要么全部成功，要么全部回滚）

使用方式：
  # 更新主角状态
  python update_state.py --protagonist-power "金丹" 3 "雷劫"

  # 更新人际关系
  python update_state.py --relationship "李雪" affection 95 --relationship-status "李雪" "确认关系"

  # 记录伏笔
  python update_state.py --add-foreshadowing "神秘玉佩的秘密" "未回收"

  # 回收伏笔
  python update_state.py --resolve-foreshadowing "天雷果的下落" 45

  # 更新进度
  python update_state.py --progress 45 198765

  # 标记卷已规划
  python update_state.py --volume-planned 1 --chapters-range 1-100

  # 组合更新（原子性）
  python update_state.py \
    --protagonist-power "金丹" 3 "雷劫" \
    --progress 45 198765 \
    --relationship "李雪" affection 95 \
    --add-foreshadowing "神秘玉佩" "未回收"

安全特性：
  - 自动备份原文件（.backup_TIMESTAMP.json）
  - JSON 格式验证
  - Schema 完整性检查
  - 原子性操作（失败自动回滚）
  - Dry-run 模式（--dry-run）
"""

import json
import os
import sys
import argparse
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

# Windows 编码兼容性修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

class StateUpdater:
    """state.json 安全更新器"""

    def __init__(self, state_file: str, dry_run: bool = False):
        self.state_file = state_file
        self.dry_run = dry_run
        self.backup_file = None
        self.state = None

    def _validate_schema(self, state: Dict) -> bool:
        """验证 state.json 的基本结构"""
        required_keys = [
            "project_info",
            "progress",
            "protagonist_state",
            "relationships",
            "world_settings",
            "plot_threads",
            "review_checkpoints"
        ]

        for key in required_keys:
            if key not in state:
                print(f"❌ 缺少必需字段: {key}")
                return False

        # 验证嵌套结构
        if "power" not in state["protagonist_state"]:
            print(f"❌ 缺少 protagonist_state.power 字段")
            return False

        if "location" not in state["protagonist_state"]:
            print(f"❌ 缺少 protagonist_state.location 字段")
            return False

        return True

    def load(self) -> bool:
        """加载并验证 state.json"""
        if not os.path.exists(self.state_file):
            print(f"❌ 状态文件不存在: {self.state_file}")
            return False

        try:
            with open(self.state_file, 'r', encoding='utf-8') as f:
                self.state = json.load(f)

            if not self._validate_schema(self.state):
                print("❌ state.json 结构不完整，请检查")
                return False

            return True

        except json.JSONDecodeError as e:
            print(f"❌ JSON 格式错误: {e}")
            return False

    def backup(self) -> bool:
        """备份当前 state.json"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = Path(self.state_file).parent / "backups"
        backup_dir.mkdir(exist_ok=True)

        self.backup_file = backup_dir / f"state.backup_{timestamp}.json"

        try:
            shutil.copy2(self.state_file, self.backup_file)
            print(f"✅ 已备份: {self.backup_file}")
            return True
        except Exception as e:
            print(f"❌ 备份失败: {e}")
            return False

    def save(self) -> bool:
        """保存更新后的 state.json"""
        if self.dry_run:
            print("\n⚠️  Dry-run 模式，不执行实际写入")
            print("\n📄 预览更新后的内容：")
            print(json.dumps(self.state, ensure_ascii=False, indent=2))
            return True

        try:
            with open(self.state_file, 'w', encoding='utf-8') as f:
                json.dump(self.state, f, ensure_ascii=False, indent=2)

            print(f"✅ 已保存: {self.state_file}")
            return True

        except Exception as e:
            print(f"❌ 保存失败: {e}")
            if self.backup_file and os.path.exists(self.backup_file):
                print(f"🔄 正在回滚到备份文件...")
                shutil.copy2(self.backup_file, self.state_file)
                print(f"✅ 已回滚")
            return False

    def update_protagonist_power(self, realm: str, layer: int, bottleneck: str):
        """更新主角实力"""
        self.state["protagonist_state"]["power"] = {
            "realm": realm,
            "layer": layer,
            "bottleneck": bottleneck
        }
        print(f"📝 更新主角实力: {realm} {layer}层, 瓶颈: {bottleneck}")

    def update_protagonist_location(self, location: str, chapter: int):
        """更新主角位置"""
        self.state["protagonist_state"]["location"] = {
            "current": location,
            "last_chapter": chapter
        }
        print(f"📝 更新主角位置: {location}（第{chapter}章）")

    def update_golden_finger(self, name: str, level: int, cooldown: int):
        """更新金手指状态"""
        self.state["protagonist_state"]["golden_finger"] = {
            "name": name,
            "level": level,
            "cooldown": cooldown
        }
        print(f"📝 更新金手指: {name} Lv.{level}, 冷却: {cooldown}天")

    def update_relationship(self, char_name: str, key: str, value: Any):
        """更新人际关系"""
        if char_name not in self.state["relationships"]:
            self.state["relationships"][char_name] = {}

        self.state["relationships"][char_name][key] = value
        print(f"📝 更新关系: {char_name}.{key} = {value}")

    def add_foreshadowing(self, content: str, status: str = "未回收"):
        """添加伏笔"""
        if "foreshadowing" not in self.state["plot_threads"]:
            self.state["plot_threads"]["foreshadowing"] = []

        # 检查是否已存在
        for item in self.state["plot_threads"]["foreshadowing"]:
            if item.get("content") == content:
                print(f"⚠️  伏笔已存在: {content}")
                return

        self.state["plot_threads"]["foreshadowing"].append({
            "content": content,
            "status": status,
            "added_at": datetime.now().strftime("%Y-%m-%d")
        })
        print(f"📝 添加伏笔: {content}（{status}）")

    def resolve_foreshadowing(self, content: str, chapter: int):
        """回收伏笔"""
        if "foreshadowing" not in self.state["plot_threads"]:
            print(f"❌ 未找到伏笔列表")
            return

        for item in self.state["plot_threads"]["foreshadowing"]:
            if item.get("content") == content:
                item["status"] = "已回收"
                item["resolved_chapter"] = chapter
                item["resolved_at"] = datetime.now().strftime("%Y-%m-%d")
                print(f"📝 回收伏笔: {content}（第{chapter}章）")
                return

        print(f"⚠️  未找到伏笔: {content}")

    def update_progress(self, current_chapter: int, total_words: int):
        """更新创作进度"""
        self.state["progress"]["current_chapter"] = current_chapter
        self.state["progress"]["total_words"] = total_words
        self.state["progress"]["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"📝 更新进度: 第{current_chapter}章, 总字数: {total_words}")

    def mark_volume_planned(self, volume: int, chapters_range: str):
        """标记卷已规划"""
        if "volumes_planned" not in self.state["progress"]:
            self.state["progress"]["volumes_planned"] = []

        # 检查是否已存在
        for item in self.state["progress"]["volumes_planned"]:
            if item.get("volume") == volume:
                print(f"⚠️  第{volume}卷已规划，更新章节范围")
                item["chapters_range"] = chapters_range
                item["updated_at"] = datetime.now().strftime("%Y-%m-%d")
                return

        self.state["progress"]["volumes_planned"].append({
            "volume": volume,
            "chapters_range": chapters_range,
            "planned_at": datetime.now().strftime("%Y-%m-%d")
        })
        print(f"📝 标记第{volume}卷已规划: 第{chapters_range}章")

    def add_review_checkpoint(self, chapters_range: str, report_file: str):
        """添加审查记录"""
        if "review_checkpoints" not in self.state:
            self.state["review_checkpoints"] = []

        self.state["review_checkpoints"].append({
            "chapters": chapters_range,
            "report": report_file,
            "reviewed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        print(f"📝 添加审查记录: 第{chapters_range}章 → {report_file}")

def main():
    parser = argparse.ArgumentParser(
        description="安全更新 state.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 更新主角实力
  python update_state.py --protagonist-power "金丹" 3 "雷劫"

  # 更新人际关系
  python update_state.py --relationship "李雪" affection 95

  # 添加伏笔
  python update_state.py --add-foreshadowing "神秘玉佩的秘密" "未回收"

  # 回收伏笔
  python update_state.py --resolve-foreshadowing "天雷果的下落" 45

  # 更新进度
  python update_state.py --progress 45 198765

  # 标记卷已规划
  python update_state.py --volume-planned 1 --chapters-range "1-100"

  # 组合更新（原子性）
  python update_state.py \
    --protagonist-power "金丹" 3 "雷劫" \
    --progress 45 198765 \
    --relationship "李雪" affection 95
        """
    )

    parser.add_argument(
        '--state-file',
        default='.webnovel/state.json',
        help='state.json 文件路径（默认: .webnovel/state.json）'
    )

    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='预览模式，不执行实际写入'
    )

    # 主角状态更新
    parser.add_argument(
        '--protagonist-power',
        nargs=3,
        metavar=('REALM', 'LAYER', 'BOTTLENECK'),
        help='更新主角实力（境界 层数 瓶颈）'
    )

    parser.add_argument(
        '--protagonist-location',
        nargs=2,
        metavar=('LOCATION', 'CHAPTER'),
        help='更新主角位置（地点 章节号）'
    )

    parser.add_argument(
        '--golden-finger',
        nargs=3,
        metavar=('NAME', 'LEVEL', 'COOLDOWN'),
        help='更新金手指（名称 等级 冷却天数）'
    )

    # 人际关系更新
    parser.add_argument(
        '--relationship',
        nargs=3,
        action='append',
        metavar=('CHAR_NAME', 'KEY', 'VALUE'),
        help='更新人际关系（角色名 属性 值）'
    )

    # 伏笔管理
    parser.add_argument(
        '--add-foreshadowing',
        nargs=2,
        metavar=('CONTENT', 'STATUS'),
        help='添加伏笔（内容 状态）'
    )

    parser.add_argument(
        '--resolve-foreshadowing',
        nargs=2,
        metavar=('CONTENT', 'CHAPTER'),
        help='回收伏笔（内容 章节号）'
    )

    # 进度更新
    parser.add_argument(
        '--progress',
        nargs=2,
        type=int,
        metavar=('CHAPTER', 'WORDS'),
        help='更新进度（当前章节 总字数）'
    )

    # 卷规划
    parser.add_argument(
        '--volume-planned',
        type=int,
        metavar='VOLUME',
        help='标记卷已规划（卷号）'
    )

    parser.add_argument(
        '--chapters-range',
        metavar='RANGE',
        help='章节范围（如 "1-100"）'
    )

    # 审查记录
    parser.add_argument(
        '--add-review',
        nargs=2,
        metavar=('CHAPTERS_RANGE', 'REPORT_FILE'),
        help='添加审查记录（章节范围 报告文件）'
    )

    args = parser.parse_args()

    # 如果没有任何更新参数，显示帮助并退出
    if not any([
        args.protagonist_power,
        args.protagonist_location,
        args.golden_finger,
        args.relationship,
        args.add_foreshadowing,
        args.resolve_foreshadowing,
        args.progress,
        args.volume_planned,
        args.add_review
    ]):
        parser.print_help()
        sys.exit(1)

    # 创建更新器
    updater = StateUpdater(args.state_file, args.dry_run)

    # 加载状态文件
    if not updater.load():
        sys.exit(1)

    # 备份（除非是 dry-run）
    if not args.dry_run:
        if not updater.backup():
            sys.exit(1)

    print("\n📝 开始更新...")

    # 执行更新操作
    try:
        if args.protagonist_power:
            realm, layer, bottleneck = args.protagonist_power
            updater.update_protagonist_power(realm, int(layer), bottleneck)

        if args.protagonist_location:
            location, chapter = args.protagonist_location
            updater.update_protagonist_location(location, int(chapter))

        if args.golden_finger:
            name, level, cooldown = args.golden_finger
            updater.update_golden_finger(name, int(level), int(cooldown))

        if args.relationship:
            for char_name, key, value in args.relationship:
                # 尝试转换为数字
                try:
                    value = int(value)
                except ValueError:
                    pass
                updater.update_relationship(char_name, key, value)

        if args.add_foreshadowing:
            content, status = args.add_foreshadowing
            updater.add_foreshadowing(content, status)

        if args.resolve_foreshadowing:
            content, chapter = args.resolve_foreshadowing
            updater.resolve_foreshadowing(content, int(chapter))

        if args.progress:
            chapter, words = args.progress
            updater.update_progress(chapter, words)

        if args.volume_planned:
            if not args.chapters_range:
                print("❌ --volume-planned 需要 --chapters-range 参数")
                sys.exit(1)
            updater.mark_volume_planned(args.volume_planned, args.chapters_range)

        if args.add_review:
            chapters_range, report_file = args.add_review
            updater.add_review_checkpoint(chapters_range, report_file)

        # 保存更新
        if not updater.save():
            sys.exit(1)

        print("\n✅ 更新完成！")

        if not args.dry_run:
            print(f"\n💡 提示:")
            print(f"  - 原文件已备份: {updater.backup_file}")
            print(f"  - 如需回滚，可复制备份文件到 {args.state_file}")

    except Exception as e:
        print(f"\n❌ 更新失败: {e}")
        if updater.backup_file and os.path.exists(updater.backup_file):
            print(f"🔄 正在回滚...")
            shutil.copy2(updater.backup_file, updater.state_file)
            print(f"✅ 已回滚到备份版本")
        sys.exit(1)

if __name__ == "__main__":
    main()
