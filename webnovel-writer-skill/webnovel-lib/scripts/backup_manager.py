#!/usr/bin/env python3
"""
Git 集成备份管理系统 (Backup Manager with Git)

核心理念：写 200万字必然会"写废设定"，需要支持任意时间点回滚。

🔧 重大升级：使用 Git 进行原子性版本控制

为什么选择 Git：
1. ✅ 原子性回滚：state.json + 正文/*.md 同时回滚，数据 100% 一致
2. ✅ 增量存储：只存储 diff，节省 95% 空间
3. ✅ 成熟稳定：经过 20 年验证的版本控制系统
4. ✅ 分支管理：天然支持"平行世界"创作

功能：
1. 自动 Git 提交：每次 /webnovel-write 完成后自动 commit
2. 原子性回滚：git checkout 同时回滚所有文件
3. 版本历史：git log 查看完整历史
4. 差异对比：git diff 查看任意两个版本的差异
5. 分支创建：git branch 从任意时间点创建分支

使用方式：
  # 在第 45 章完成后自动备份（自动 git commit）
  python backup_manager.py --chapter 45

  # 回滚到第 30 章状态（git checkout）
  python backup_manager.py --rollback 30

  # 查看第 20 章和第 40 章的差异（git diff）
  python backup_manager.py --diff 20 40

  # 从第 50 章创建分支（git branch）
  python backup_manager.py --create-branch 50 --branch-name "alternative-ending"

  # 列出所有备份（git log）
  python backup_manager.py --list

Git 提交规范：
  - 提交信息格式: "Chapter {N}: {章节标题}"
  - Tag 格式: "ch{N}" (如 ch0045)
  - 每个章节对应一个 commit + 一个 tag

数据一致性保证：
  ✅ 回滚时，state.json 和所有 .md 文件同步回滚
  ✅ 不会出现"状态记录筑基期，但文件里写着金丹期"的数据撕裂
  ✅ 原子性操作，要么全部成功，要么全部失败
"""

import subprocess
import json
import os
import sys
import shutil
from pathlib import Path

from runtime_compat import enable_windows_utf8_stdio
from datetime import datetime
from typing import Optional, List, Tuple

# ============================================================================
# 安全修复：导入安全工具函数（P1 MEDIUM）
# ============================================================================
from security_utils import sanitize_commit_message, is_git_available, is_git_repo, git_graceful_operation
from project_locator import resolve_project_root

# Windows 编码兼容性修复
if sys.platform == "win32":
    enable_windows_utf8_stdio()

class GitBackupManager:
    """基于 Git 的备份管理器（支持优雅降级）"""

    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.git_dir = self.project_root / ".git"
        self.git_available = is_git_available()

        if not self.git_available:
            print("⚠️  Git 不可用，将使用本地备份模式")
            print("💡 如需启用 Git 版本控制，请安装 Git: https://git-scm.com/")
            return

        # 检查 Git 是否初始化
        if not self.git_dir.exists():
            print("⚠️  Git 未初始化，请先运行 /webnovel-init 或手动执行 git init")
            print("💡 现在自动初始化 Git...")
            self._init_git()

    def _init_git(self) -> bool:
        """初始化 Git 仓库"""
        try:
            # git init
            subprocess.run(
                ["git", "init"],
                cwd=self.project_root,
                check=True,
                capture_output=True
            )

            # 创建 .gitignore
            gitignore_file = self.project_root / ".gitignore"
            if not gitignore_file.exists():
                with open(gitignore_file, 'w', encoding='utf-8') as f:
                    f.write("""# Python
__pycache__/
*.py[cod]
*.so

# Temporary files
*.tmp
*.bak
.DS_Store

# IDE
.vscode/
.idea/

# Don't ignore .webnovel (we need to track state.json)
# But ignore cache files
.webnovel/context_cache.json
""")

            # 初始提交
            subprocess.run(
                ["git", "add", "."],
                cwd=self.project_root,
                check=True,
                capture_output=True
            )

            subprocess.run(
                ["git", "commit", "-m", "Initial commit: Project initialized"],
                cwd=self.project_root,
                check=True,
                capture_output=True
            )

            print("✅ Git 仓库已初始化")
            return True

        except subprocess.CalledProcessError as e:
            print(f"❌ Git 初始化失败: {e}")
            return False

    def _run_git_command(self, args: List[str], check: bool = True) -> Tuple[bool, str]:
        """执行 Git 命令（支持优雅降级）"""
        if not self.git_available:
            return False, "Git 不可用"

        try:
            result = subprocess.run(
                ["git"] + args,
                cwd=self.project_root,
                check=check,
                capture_output=True,
                text=True,
                encoding='utf-8',
                timeout=60
            )

            return True, result.stdout

        except subprocess.CalledProcessError as e:
            return False, e.stderr
        except subprocess.TimeoutExpired:
            return False, "Git 命令超时"
        except OSError as e:
            return False, str(e)

    def _local_backup(self, chapter_num: int) -> bool:
        """本地备份（Git 不可用时的降级方案）"""
        backup_dir = self.project_root / ".webnovel" / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"ch{chapter_num:04d}_{timestamp}"
        backup_path = backup_dir / backup_name

        try:
            # 备份 state.json
            state_file = self.project_root / ".webnovel" / "state.json"
            if state_file.exists():
                backup_path.mkdir(parents=True, exist_ok=True)
                shutil.copy2(state_file, backup_path / "state.json")

            print(f"✅ 本地备份完成: {backup_path}")
            return True
        except OSError as e:
            print(f"❌ 本地备份失败: {e}")
            return False

    def backup(self, chapter_num: int, chapter_title: str = "") -> bool:
        """
        备份当前状态（Git commit + tag，或本地备份）

        Args:
            chapter_num: 章节号
            chapter_title: 章节标题（可选）
        """
        print(f"📝 正在备份第 {chapter_num} 章...")

        # 如果 Git 不可用，使用本地备份
        if not self.git_available:
            return self._local_backup(chapter_num)

        # Step 1: git add .
        success, output = self._run_git_command(["add", "."])
        if not success:
            print(f"❌ git add 失败: {output}")
            return False

        # Step 2: git commit
        commit_message = f"Chapter {chapter_num}"
        if chapter_title:
            # ============================================================================
            # 安全修复：清理提交消息，防止命令注入 (CWE-77) - P1 MEDIUM
            # 原代码: commit_message += f": {chapter_title}"
            # 漏洞: chapter_title可能包含 Git 标志（如 --author, --amend）导致命令注入
            # ============================================================================
            safe_chapter_title = sanitize_commit_message(chapter_title)
            commit_message += f": {safe_chapter_title}"

        success, output = self._run_git_command(
            ["commit", "-m", commit_message],
            check=False  # 允许"无变更"的情况
        )

        if not success and "nothing to commit" in output:
            print("⚠️  无变更，跳过提交")
            return True
        elif not success:
            print(f"❌ git commit 失败: {output}")
            return False

        print(f"✅ Git 提交完成: {commit_message}")

        # Step 3: git tag
        tag_name = f"ch{chapter_num:04d}"

        # 删除旧 tag（如果存在）
        self._run_git_command(["tag", "-d", tag_name], check=False)

        success, output = self._run_git_command(["tag", tag_name])
        if not success:
            print(f"⚠️  创建 tag 失败（非致命）: {output}")
        else:
            print(f"✅ Git tag 已创建: {tag_name}")

        return True

    def rollback(self, chapter_num: int) -> bool:
        """
        回滚到指定章节（Git checkout）

        ⚠️ 警告：这会丢弃所有未提交的变更！
        """

        tag_name = f"ch{chapter_num:04d}"

        print(f"🔄 正在回滚到第 {chapter_num} 章...")
        print(f"⚠️  警告：这将丢弃所有未提交的变更！")

        # 检查是否有未提交的变更
        success, status_output = self._run_git_command(["status", "--porcelain"])

        if status_output.strip():
            print("\n⚠️  检测到未提交的变更：")
            print(status_output)

            # 创建备份提交
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_branch = f"backup_before_rollback_{timestamp}"

            print(f"\n💾 正在创建备份分支: {backup_branch}")

            success, _ = self._run_git_command(["checkout", "-b", backup_branch])
            if not success:
                print("❌ 创建备份分支失败")
                return False

            success, _ = self._run_git_command(["add", "."])
            success, _ = self._run_git_command(
                ["commit", "-m", f"Backup before rollback to chapter {chapter_num}"]
            )

            print(f"✅ 备份分支已创建: {backup_branch}")

            # 切换回 master
            success, _ = self._run_git_command(["checkout", "master"])

        # 执行回滚
        success, output = self._run_git_command(["checkout", tag_name])

        if not success:
            print(f"❌ 回滚失败: {output}")
            print(f"💡 提示：确保 tag '{tag_name}' 存在（运行 --list 查看所有备份）")
            return False

        print(f"✅ 已回滚到第 {chapter_num} 章！")
        print(f"\n💡 提示:")
        print(f"  - 所有文件（state.json + 正文/*.md）已同步回滚")
        print(f"  - 如需恢复，运行: git checkout master")

        return True

    def diff(self, chapter_a: int, chapter_b: int):
        """对比两个版本的差异（Git diff）"""

        tag_a = f"ch{chapter_a:04d}"
        tag_b = f"ch{chapter_b:04d}"

        print(f"📊 对比第 {chapter_a} 章 与 第 {chapter_b} 章的差异...\n")

        success, output = self._run_git_command(["diff", tag_a, tag_b, "--stat"])

        if not success:
            print(f"❌ 对比失败: {output}")
            return

        print("📈 文件变更统计：")
        print(output)

        # 显示 state.json 的详细差异
        print("\n📝 state.json 详细差异：")
        success, state_diff = self._run_git_command(
            ["diff", tag_a, tag_b, "--", ".webnovel/state.json"]
        )

        if success and state_diff:
            print(state_diff[:2000])  # 限制输出长度
            if len(state_diff) > 2000:
                print("\n...(输出过长，已截断)")
        else:
            print("(无变更)")

    def list_backups(self):
        """列出所有备份（Git log + tags）"""

        print("\n📚 备份列表（Git tags）：\n")

        # 获取所有 tags
        success, tags_output = self._run_git_command(["tag", "-l", "ch*"])

        if not success or not tags_output:
            print("⚠️  暂无备份")
            return

        tags = sorted(tags_output.strip().split('\n'))

        for tag in tags:
            # 提取章节号
            chapter_num = int(tag[2:])

            # 获取该 tag 的提交信息
            success, commit_info = self._run_git_command(
                ["log", tag, "-1", "--format=%h %ci %s"]
            )

            if success:
                print(f"📖 {tag} | {commit_info.strip()}")

        print(f"\n总计：{len(tags)} 个备份")

        # 显示最近 5 次提交
        print("\n📜 最近提交历史：\n")
        success, log_output = self._run_git_command(
            ["log", "--oneline", "-5"]
        )

        if success:
            print(log_output)

    def create_branch(self, chapter_num: int, branch_name: str) -> bool:
        """从指定章节创建分支（Git branch）"""

        tag_name = f"ch{chapter_num:04d}"

        print(f"🌿 从第 {chapter_num} 章创建分支: {branch_name}")

        # 检查 tag 是否存在
        success, _ = self._run_git_command(["rev-parse", tag_name], check=False)

        if not success:
            print(f"❌ Tag '{tag_name}' 不存在")
            return False

        # 创建分支
        success, output = self._run_git_command(["branch", branch_name, tag_name])

        if not success:
            print(f"❌ 创建分支失败: {output}")
            return False

        print(f"✅ 分支已创建: {branch_name}")
        print(f"\n💡 切换到分支:")
        print(f"  git checkout {branch_name}")

        return True

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Git 集成备份管理系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 在第 45 章完成后自动备份
  python backup_manager.py --chapter 45

  # 回滚到第 30 章（原子性：state.json + 所有 .md 文件）
  python backup_manager.py --rollback 30

  # 查看第 20 章和第 40 章的差异
  python backup_manager.py --diff 20 40

  # 从第 50 章创建分支
  python backup_manager.py --create-branch 50 --branch-name "alternative-ending"

  # 列出所有备份
  python backup_manager.py --list
        """
    )

    parser.add_argument('--chapter', type=int, help='备份章节号')
    parser.add_argument('--chapter-title', help='章节标题（可选）')
    parser.add_argument('--rollback', type=int, metavar='CHAPTER', help='回滚到指定章节')
    parser.add_argument('--diff', nargs=2, type=int, metavar=('A', 'B'), help='对比两个版本')
    parser.add_argument('--create-branch', type=int, metavar='CHAPTER', help='从指定章节创建分支')
    parser.add_argument('--branch-name', help='分支名称')
    parser.add_argument('--list', action='store_true', help='列出所有备份')
    parser.add_argument('--project-root', default='.', help='项目根目录')

    args = parser.parse_args()

    # 解析项目根目录（允许传入“工作区根目录”，统一解析到真正的 book project_root）
    try:
        project_root = str(resolve_project_root(args.project_root))
    except FileNotFoundError as exc:
        print(f"❌ 无法定位项目根目录（需要包含 .webnovel/state.json）: {exc}", file=sys.stderr)
        sys.exit(1)

    # 创建管理器
    manager = GitBackupManager(project_root)

    # 执行操作
    if args.chapter:
        manager.backup(args.chapter, args.chapter_title or "")

    elif args.rollback:
        manager.rollback(args.rollback)

    elif args.diff:
        manager.diff(args.diff[0], args.diff[1])

    elif args.create_branch:
        if not args.branch_name:
            print("❌ 创建分支需要 --branch-name 参数")
            sys.exit(1)
        manager.create_branch(args.create_branch, args.branch_name)

    elif args.list:
        manager.list_backups()

    else:
        parser.print_help()

if __name__ == "__main__":
    main()
