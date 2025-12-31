#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网文项目初始化脚本
创建 AI 工作室所需的完整项目结构
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from datetime import datetime

# Windows 编码兼容性修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def init_project(project_dir, title, genre):
    """初始化项目结构"""

    project_path = Path(project_dir)

    # 创建目录结构
    directories = [
        ".webnovel/backups",
        "设定集/角色库/主要角色",
        "设定集/角色库/次要角色",
        "设定集/角色库/反派角色",
        "大纲",
        "正文",
        "审查报告"
    ]

    for dir_path in directories:
        (project_path / dir_path).mkdir(parents=True, exist_ok=True)

    # 创建 state.json（动态状态管理）
    state = {
        "project_info": {
            "title": title,
            "genre": genre,
            "author": "",
            "created_at": datetime.now().strftime("%Y-%m-%d"),
            "target_words": 2000000,
            "target_chapters": 600
        },
        "progress": {
            "current_chapter": 0,
            "total_words": 0,
            "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "volumes_completed": [],
            "current_volume": 1
        },
        "protagonist_state": {
            "name": "",
            "power": {
                "realm": "",
                "layer": 1,
                "bottleneck": ""
            },
            "location": {
                "current": "",
                "last_chapter": 0
            },
            "golden_finger": {
                "name": "",
                "level": 1,
                "cooldown": 0
            }
        },
        "relationships": {},
        "world_settings": {
            "power_system": [],
            "factions": [],
            "locations": []
        },
        "plot_threads": {
            "active_threads": [],
            "foreshadowing": []
        },
        "strand_tracker": {
            "last_quest_chapter": 0,
            "last_fire_chapter": 0,
            "last_constellation_chapter": 0,
            "current_dominant": "quest",
            "chapters_since_switch": 0,
            "history": []
        },
        "review_checkpoints": []
    }

    with open(project_path / ".webnovel/state.json", "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    # Git 初始化（自动版本控制）
    print("\n🔧 正在初始化 Git 仓库...")
    try:
        # Step 1: git init
        subprocess.run(
            ["git", "init"],
            cwd=project_path,
            check=True,
            capture_output=True,
            text=True
        )

        # Step 2: 创建 .gitignore
        gitignore_file = project_path / ".gitignore"
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

        # Step 3: git add .
        subprocess.run(
            ["git", "add", "."],
            cwd=project_path,
            check=True,
            capture_output=True
        )

        # Step 4: Initial commit
        subprocess.run(
            ["git", "commit", "-m", "Initial commit: Project initialized"],
            cwd=project_path,
            check=True,
            capture_output=True
        )

        print("✅ Git 仓库已初始化（原子性版本控制已启用）")

    except subprocess.CalledProcessError as e:
        print(f"⚠️  Git 初始化失败（非致命）: {e.stderr if hasattr(e, 'stderr') else str(e)}")
        print("💡 提示：可以稍后手动执行 git init")
    except FileNotFoundError:
        print("⚠️  未检测到 Git（请安装 Git 以启用版本控制功能）")

    print(f"\n✅ 项目初始化完成：{project_path}")
    print(f"📁 项目目录已创建")
    print(f"💾 状态文件已保存：.webnovel/state.json")
    print(f"🔖 Git 版本控制已启用")
    print(f"\n📚 题材：{genre}")
    print(f"📖 标题：{title}")
    print(f"\n🎯 下一步：")
    print(f"   1. 编辑设定集中的文件")
    print(f"   2. 运行 /webnovel-plan 1 规划第一卷")
    print(f"   3. 运行 /webnovel-write 1 开始创作")
    print(f"\n💾 版本控制提示：")
    print(f"   - 每章完成后自动 Git 备份")
    print(f"   - 回滚命令：python backup_manager.py --rollback N")
    print(f"   - 查看历史：python backup_manager.py --list")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 4:
        print("用法: python init_project.py <项目目录> <标题> <题材>")
        print("示例: python init_project.py ./my-novel '废柴崛起' '修仙'")
        sys.exit(1)

    init_project(sys.argv[1], sys.argv[2], sys.argv[3])
