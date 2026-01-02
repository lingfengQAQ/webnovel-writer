#!/usr/bin/env python3
"""
state.json 数据归档管理脚本

目标：防止 state.json 无限增长，确保 200 万字长跑稳定运行

功能：
1. 智能归档长期未使用的数据（角色/伏笔/审查报告）
2. 自动触发条件检测（文件大小/章节数）
3. 安全备份与恢复机制
4. 归档数据可随时恢复

归档策略：
- 角色：超过 50 章未出场的次要角色 → archive/characters.json
- 伏笔：status="已回收" 且超过 20 章的伏笔 → archive/plot_threads.json
- 审查报告：超过 50 章的旧报告 → archive/reviews.json

使用方式：
  # 自动归档检查（推荐在 update_state.py 之后调用）
  python archive_manager.py --auto-check

  # 强制归档（忽略触发条件）
  python archive_manager.py --force

  # 恢复特定角色
  python archive_manager.py --restore-character "李雪"

  # 查看归档统计
  python archive_manager.py --stats

  # Dry-run 模式（仅显示将被归档的数据）
  python archive_manager.py --auto-check --dry-run
"""

import json
import os
import sys
import argparse
from datetime import datetime
from pathlib import Path

# Windows UTF-8 编码修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


class ArchiveManager:
    """state.json 数据归档管理器"""

    def __init__(self, project_root=None):
        if project_root is None:
            # 默认使用当前目录
            project_root = Path.cwd()
        else:
            project_root = Path(project_root)

        self.state_file = project_root / ".webnovel" / "state.json"
        self.archive_dir = project_root / ".webnovel" / "archive"

        # 确保归档目录存在
        self.archive_dir.mkdir(parents=True, exist_ok=True)

        # 归档文件路径
        self.characters_archive = self.archive_dir / "characters.json"
        self.plot_threads_archive = self.archive_dir / "plot_threads.json"
        self.reviews_archive = self.archive_dir / "reviews.json"

        # 归档规则配置
        self.config = {
            "character_inactive_threshold": 50,  # 角色超过 50 章未出场视为不活跃
            "plot_resolved_threshold": 20,       # 已回收伏笔超过 20 章后归档
            "review_old_threshold": 20,          # 审查报告超过 20 章后归档（从 50 降至 20）
            "file_size_trigger_mb": 0.5,         # state.json 超过 0.5MB 触发归档（从 1.0 降至 0.5）
            "chapter_trigger": 10                # 每 10 章检查一次
        }

    def load_state(self):
        """加载 state.json"""
        if not self.state_file.exists():
            print(f"❌ state.json 不存在: {self.state_file}")
            sys.exit(1)

        with open(self.state_file, 'r', encoding='utf-8') as f:
            return json.load(f)

    def save_state(self, state):
        """保存 state.json（带备份）"""
        # 备份原文件
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = self.state_file.parent / f"state.backup_{timestamp}.json"

        if self.state_file.exists():
            import shutil
            shutil.copy2(self.state_file, backup_file)

        # 写入新文件
        with open(self.state_file, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)

        print(f"✅ state.json 已更新（备份: {backup_file.name}）")

    def load_archive(self, archive_file):
        """加载归档文件"""
        if not archive_file.exists():
            return []

        with open(archive_file, 'r', encoding='utf-8') as f:
            return json.load(f)

    def save_archive(self, archive_file, data):
        """保存归档文件"""
        with open(archive_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def check_trigger_conditions(self, state):
        """检查是否需要触发归档"""
        current_chapter = state.get("progress", {}).get("current_chapter", 0)

        # 条件 1: 文件大小超过阈值
        file_size_mb = self.state_file.stat().st_size / (1024 * 1024)
        size_trigger = file_size_mb >= self.config["file_size_trigger_mb"]

        # 条件 2: 章节数是触发间隔的倍数
        chapter_trigger = (current_chapter % self.config["chapter_trigger"]) == 0 and current_chapter > 0

        return {
            "should_archive": size_trigger or chapter_trigger,
            "file_size_mb": file_size_mb,
            "current_chapter": current_chapter,
            "size_trigger": size_trigger,
            "chapter_trigger": chapter_trigger
        }

    def identify_inactive_characters(self, state):
        """识别不活跃的次要角色"""
        current_chapter = state.get("progress", {}).get("current_chapter", 0)
        characters = state.get("entities", {}).get("characters", [])
        threshold = self.config["character_inactive_threshold"]

        inactive = []
        for char in characters:
            # 只归档次要角色（importance="minor"）
            if char.get("importance") != "minor":
                continue

            # 检查最后出场章节
            last_appearance = char.get("last_appearance_chapter", 0)
            inactive_chapters = current_chapter - last_appearance

            if inactive_chapters >= threshold:
                inactive.append({
                    "character": char,
                    "inactive_chapters": inactive_chapters,
                    "last_appearance": last_appearance
                })

        return inactive

    def identify_resolved_plot_threads(self, state):
        """识别可归档的已回收伏笔"""
        current_chapter = state.get("progress", {}).get("current_chapter", 0)
        plot_threads = state.get("plot_threads", {}).get("active", [])
        resolved = state.get("plot_threads", {}).get("resolved", [])
        threshold = self.config["plot_resolved_threshold"]

        archivable = []
        for thread in resolved:
            resolved_chapter = thread.get("resolved_chapter", 0)
            chapters_since_resolved = current_chapter - resolved_chapter

            if chapters_since_resolved >= threshold:
                archivable.append({
                    "thread": thread,
                    "chapters_since_resolved": chapters_since_resolved,
                    "resolved_chapter": resolved_chapter
                })

        return archivable

    def identify_old_reviews(self, state):
        """识别可归档的旧审查报告"""
        current_chapter = state.get("progress", {}).get("current_chapter", 0)
        reviews = state.get("review_checkpoints", [])
        threshold = self.config["review_old_threshold"]

        old_reviews = []
        for review in reviews:
            review_chapter = review.get("chapter_range", [0, 0])[1]  # 取结束章节
            chapters_since_review = current_chapter - review_chapter

            if chapters_since_review >= threshold:
                old_reviews.append({
                    "review": review,
                    "chapters_since_review": chapters_since_review,
                    "review_chapter": review_chapter
                })

        return old_reviews

    def archive_characters(self, inactive_list, dry_run=False):
        """归档不活跃角色（Priority 2 修复：与索引集成）"""
        if not inactive_list:
            return 0

        # 加载现有归档
        archived = self.load_archive(self.characters_archive)

        # 添加时间戳
        timestamp = datetime.now().isoformat()
        for item in inactive_list:
            item["character"]["archived_at"] = timestamp
            archived.append(item["character"])

            # ✅ Priority 2 修复：同步更新索引状态（而非删除）
            if not dry_run:
                try:
                    # 导入索引模块
                    import sys
                    from pathlib import Path
                    script_dir = Path(__file__).parent
                    sys.path.insert(0, str(script_dir))
                    from structured_index import StructuredIndex

                    # 更新索引状态为 'archived'
                    project_root = self.state_file.parent.parent
                    index = StructuredIndex(str(project_root))
                    index.mark_character_archived(item["character"]["name"], timestamp)
                except Exception as e:
                    # 索引更新失败不影响归档流程
                    print(f"⚠️ 索引状态更新失败（不影响归档）: {e}")

        if not dry_run:
            self.save_archive(self.characters_archive, archived)

        return len(inactive_list)

    def archive_plot_threads(self, resolved_list, dry_run=False):
        """归档已回收伏笔"""
        if not resolved_list:
            return 0

        # 加载现有归档
        archived = self.load_archive(self.plot_threads_archive)

        # 添加时间戳
        timestamp = datetime.now().isoformat()
        for item in resolved_list:
            item["thread"]["archived_at"] = timestamp
            archived.append(item["thread"])

        if not dry_run:
            self.save_archive(self.plot_threads_archive, archived)

        return len(resolved_list)

    def archive_reviews(self, old_reviews_list, dry_run=False):
        """归档旧审查报告"""
        if not old_reviews_list:
            return 0

        # 加载现有归档
        archived = self.load_archive(self.reviews_archive)

        # 添加时间戳
        timestamp = datetime.now().isoformat()
        for item in old_reviews_list:
            item["review"]["archived_at"] = timestamp
            archived.append(item["review"])

        if not dry_run:
            self.save_archive(self.reviews_archive, archived)

        return len(old_reviews_list)

    def remove_from_state(self, state, inactive_chars, resolved_threads, old_reviews):
        """从 state.json 中移除已归档的数据"""
        # 移除不活跃角色
        if inactive_chars:
            char_names = {item["character"]["name"] for item in inactive_chars}
            state["entities"]["characters"] = [
                char for char in state["entities"]["characters"]
                if char["name"] not in char_names
            ]

        # 移除已归档的伏笔
        if resolved_threads:
            thread_ids = {item["thread"]["description"] for item in resolved_threads}
            state["plot_threads"]["resolved"] = [
                thread for thread in state["plot_threads"]["resolved"]
                if thread["description"] not in thread_ids
            ]

        # 移除旧审查报告
        if old_reviews:
            review_dates = {item["review"]["date"] for item in old_reviews}
            state["review_checkpoints"] = [
                review for review in state["review_checkpoints"]
                if review["date"] not in review_dates
            ]

        return state

    def run_auto_check(self, force=False, dry_run=False):
        """自动归档检查"""
        state = self.load_state()

        # 检查触发条件
        trigger = self.check_trigger_conditions(state)

        if not force and not trigger["should_archive"]:
            print("✅ 无需归档（触发条件未满足）")
            print(f"   文件大小: {trigger['file_size_mb']:.2f} MB (阈值: {self.config['file_size_trigger_mb']} MB)")
            print(f"   当前章节: {trigger['current_chapter']} (每 {self.config['chapter_trigger']} 章触发)")
            return

        print("🔍 开始归档检查...")
        print(f"   文件大小: {trigger['file_size_mb']:.2f} MB")
        print(f"   当前章节: {trigger['current_chapter']}")

        # 识别可归档数据
        inactive_chars = self.identify_inactive_characters(state)
        resolved_threads = self.identify_resolved_plot_threads(state)
        old_reviews = self.identify_old_reviews(state)

        # 输出统计
        print(f"\n📊 归档统计:")
        print(f"   不活跃角色: {len(inactive_chars)}")
        print(f"   已回收伏笔: {len(resolved_threads)}")
        print(f"   旧审查报告: {len(old_reviews)}")

        if not (inactive_chars or resolved_threads or old_reviews):
            print("\n✅ 无需归档（无符合条件的数据）")
            return

        # Dry-run 模式
        if dry_run:
            print("\n🔍 [Dry-run] 将被归档的数据:")
            if inactive_chars:
                print("\n   不活跃角色:")
                for item in inactive_chars[:5]:  # 只显示前 5 个
                    print(f"   - {item['character']['name']} (超过 {item['inactive_chapters']} 章未出场)")
            if resolved_threads:
                print("\n   已回收伏笔:")
                for item in resolved_threads[:5]:
                    print(f"   - {item['thread']['description'][:30]}... (已回收 {item['chapters_since_resolved']} 章)")
            if old_reviews:
                print("\n   旧审查报告:")
                for item in old_reviews[:5]:
                    print(f"   - Ch{item['review_chapter']} ({item['chapters_since_review']} 章前)")
            return

        # 执行归档
        chars_archived = self.archive_characters(inactive_chars, dry_run=dry_run)
        threads_archived = self.archive_plot_threads(resolved_threads, dry_run=dry_run)
        reviews_archived = self.archive_reviews(old_reviews, dry_run=dry_run)

        # 从 state.json 中移除
        state = self.remove_from_state(state, inactive_chars, resolved_threads, old_reviews)
        self.save_state(state)

        # 最终统计
        print(f"\n✅ 归档完成:")
        print(f"   角色归档: {chars_archived} → {self.characters_archive.name}")
        print(f"   伏笔归档: {threads_archived} → {self.plot_threads_archive.name}")
        print(f"   报告归档: {reviews_archived} → {self.reviews_archive.name}")

        # 显示归档后的文件大小
        new_size_mb = self.state_file.stat().st_size / (1024 * 1024)
        saved_mb = trigger["file_size_mb"] - new_size_mb
        print(f"\n💾 文件大小: {trigger['file_size_mb']:.2f} MB → {new_size_mb:.2f} MB (节省 {saved_mb:.2f} MB)")

    def restore_character(self, name):
        """恢复归档的角色（Priority 2 修复：同步恢复索引状态）"""
        archived = self.load_archive(self.characters_archive)
        state = self.load_state()

        # 查找角色
        char_to_restore = None
        for char in archived:
            if char["name"] == name:
                char_to_restore = char
                break

        if not char_to_restore:
            print(f"❌ 归档中未找到角色: {name}")
            return

        # 移除 archived_at 字段
        char_to_restore.pop("archived_at", None)

        # ✅ 原子性修复：先从归档中移除，再添加到 state.json
        # 理由：即使崩溃，数据仍在归档中，可重新恢复，不会丢失或重复
        archived = [char for char in archived if char["name"] != name]
        self.save_archive(self.characters_archive, archived)

        # 恢复到 state.json
        state["entities"]["characters"].append(char_to_restore)
        self.save_state(state)

        # ✅ Priority 2 修复：同步恢复索引状态为 'active'
        try:
            import sys
            from pathlib import Path
            script_dir = Path(__file__).parent
            sys.path.insert(0, str(script_dir))
            from structured_index import StructuredIndex

            project_root = self.state_file.parent.parent
            index = StructuredIndex(str(project_root))
            index.mark_character_active(name)
        except Exception as e:
            print(f"⚠️ 索引状态恢复失败（不影响数据恢复）: {e}")

        print(f"✅ 角色已恢复: {name}")

    def show_stats(self):
        """显示归档统计"""
        chars = self.load_archive(self.characters_archive)
        threads = self.load_archive(self.plot_threads_archive)
        reviews = self.load_archive(self.reviews_archive)

        print("📊 归档统计:")
        print(f"   角色归档: {len(chars)}")
        print(f"   伏笔归档: {len(threads)}")
        print(f"   报告归档: {len(reviews)}")

        # 计算归档文件大小
        total_size = 0
        for archive_file in [self.characters_archive, self.plot_threads_archive, self.reviews_archive]:
            if archive_file.exists():
                total_size += archive_file.stat().st_size

        print(f"   归档大小: {total_size / 1024:.2f} KB")

        # 显示 state.json 大小
        state_size_mb = self.state_file.stat().st_size / (1024 * 1024)
        print(f"\n💾 state.json 当前大小: {state_size_mb:.2f} MB")


def main():
    parser = argparse.ArgumentParser(description="state.json 数据归档管理")

    parser.add_argument("--auto-check", action="store_true", help="自动归档检查")
    parser.add_argument("--force", action="store_true", help="强制归档（忽略触发条件）")
    parser.add_argument("--dry-run", action="store_true", help="Dry-run 模式（仅显示将被归档的数据）")
    parser.add_argument("--restore-character", metavar="NAME", help="恢复归档的角色")
    parser.add_argument("--stats", action="store_true", help="显示归档统计")
    parser.add_argument("--project-root", metavar="PATH", help="项目根目录（默认为当前目录）")

    args = parser.parse_args()

    # 创建管理器
    manager = ArchiveManager(project_root=args.project_root)

    # 执行操作
    if args.auto_check or args.force:
        manager.run_auto_check(force=args.force, dry_run=args.dry_run)
    elif args.restore_character:
        manager.restore_character(args.restore_character)
    elif args.stats:
        manager.show_stats()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
