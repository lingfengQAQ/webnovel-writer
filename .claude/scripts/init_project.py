#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网文项目初始化脚本

目标：
- 生成可运行的项目结构（webnovel-project）
- 创建/更新 .webnovel/state.json（运行时真相）
- 生成基础设定集与大纲模板文件（供 /webnovel-plan 与 /webnovel-write 使用）

说明：
- 该脚本是命令 /webnovel-init 的“唯一允许的文件生成入口”（与命令文档保持一致）。
- 生成的内容以“模板骨架”为主，便于 AI/作者后续补全；但保证所有关键文件存在。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
import re

# 安全修复：导入安全工具函数
from security_utils import sanitize_commit_message, atomic_write_json, is_git_available


# Windows 编码兼容性修复
if sys.platform == "win32":
    import io

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def _read_text_if_exists(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _write_text_if_missing(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    path.write_text(content, encoding="utf-8")


def _split_genre_keys(genre: str) -> list[str]:
    raw = (genre or "").strip()
    if not raw:
        return []
    # 支持复合题材：A+B / A+B / A、B / A与B
    raw = re.sub(r"[＋/、]", "+", raw)
    raw = raw.replace("与", "+")
    parts = [p.strip() for p in raw.split("+") if p.strip()]
    return parts or [raw]


def _normalize_genre_key(key: str) -> str:
    aliases = {
        "修仙/玄幻": "修仙",
        "玄幻修仙": "修仙",
        "玄幻": "修仙",
        "修真": "修仙",
        "都市修真": "都市异能",
        "都市高武": "高武",
        "都市奇闻": "都市脑洞",
        "古言脑洞": "古言",
    }
    return aliases.get(key, key)


def _apply_label_replacements(text: str, replacements: Dict[str, str]) -> str:
    if not text or not replacements:
        return text
    lines = text.splitlines()
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        for label, value in replacements.items():
            if not value:
                continue
            prefix = f"- {label}："
            if stripped.startswith(prefix):
                leading = line[: len(line) - len(stripped)]
                lines[i] = f"{leading}{prefix}{value}"
    return "\n".join(lines)


def _parse_tier_map(raw: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    if not raw:
        return result
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            key, val = part.split(":", 1)
            result[key.strip()] = val.strip()
    return result


def _render_team_rows(names: List[str], roles: List[str]) -> List[str]:
    rows = []
    for idx, name in enumerate(names):
        role = roles[idx] if idx < len(roles) else ""
        rows.append(f"| {name} | {role or '主线/副线'} | | | |")
    return rows


def _ensure_state_schema(state: Dict[str, Any]) -> Dict[str, Any]:
    """确保 state.json 具备 v5.1 架构所需的字段集合（v5.4 沿用）。

    v5.1 变更:
    - entities_v3 和 alias_index 已迁移到 index.db，不再存储在 state.json
    - structured_relationships 已迁移到 index.db relationships 表
    - state.json 保持精简 (< 5KB)
    """
    state.setdefault("project_info", {})
    state.setdefault("progress", {})
    state.setdefault("protagonist_state", {})
    state.setdefault("relationships", {})  # update_state.py 需要此字段
    state.setdefault("disambiguation_warnings", [])
    state.setdefault("disambiguation_pending", [])
    state.setdefault("world_settings", {"power_system": [], "factions": [], "locations": []})
    state.setdefault("plot_threads", {"active_threads": [], "foreshadowing": []})
    state.setdefault("review_checkpoints", [])
    state.setdefault("chapter_meta", {})
    state.setdefault(
        "strand_tracker",
        {
            "last_quest_chapter": 0,
            "last_fire_chapter": 0,
            "last_constellation_chapter": 0,
            "current_dominant": "quest",
            "chapters_since_switch": 0,
            "history": [],
        },
    )
    # v5.1: entities_v3, alias_index, structured_relationships 已迁移到 index.db
    # 不再在 state.json 中初始化这些字段

    # progress schema evolution
    state["progress"].setdefault("current_chapter", 0)
    state["progress"].setdefault("total_words", 0)
    state["progress"].setdefault("last_updated", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    state["progress"].setdefault("volumes_completed", [])
    state["progress"].setdefault("current_volume", 1)
    state["progress"].setdefault("volumes_planned", [])

    # protagonist schema evolution
    ps = state["protagonist_state"]
    ps.setdefault("name", "")
    ps.setdefault("power", {"realm": "", "layer": 1, "bottleneck": ""})
    ps.setdefault("location", {"current": "", "last_chapter": 0})
    ps.setdefault("golden_finger", {"name": "", "level": 1, "cooldown": 0, "skills": []})
    ps.setdefault("attributes", {})

    return state


def _build_master_outline(target_chapters: int, *, chapters_per_volume: int = 50) -> str:
    volumes = (target_chapters - 1) // chapters_per_volume + 1 if target_chapters > 0 else 1
    lines: list[str] = [
        "# 总纲",
        "",
        "> 本文件为“总纲骨架”，用于 /webnovel-plan 细化为卷大纲与章纲。",
        "",
        "## 卷结构",
        "",
    ]

    for v in range(1, volumes + 1):
        start = (v - 1) * chapters_per_volume + 1
        end = min(v * chapters_per_volume, target_chapters)
        lines.extend(
            [
                f"### 第{v}卷（第{start}-{end}章）",
                "- 核心冲突：",
                "- 关键爽点：",
                "- 卷末高潮：",
                "- 主要登场角色：",
                "- 关键伏笔（埋/收）：",
                "",
            ]
        )

    return "\n".join(lines).rstrip() + "\n"


def _inject_volume_rows(template_text: str, target_chapters: int, *, chapters_per_volume: int = 50) -> str:
    """在总纲模板的卷表中注入卷行（若存在表头）。"""
    lines = template_text.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith("| 卷号"):
            header_idx = i
            break
    if header_idx is None:
        return template_text

    insert_idx = header_idx + 2 if header_idx + 1 < len(lines) else len(lines)
    volumes = (target_chapters - 1) // chapters_per_volume + 1 if target_chapters > 0 else 1
    rows = []
    for v in range(1, volumes + 1):
        start = (v - 1) * chapters_per_volume + 1
        end = min(v * chapters_per_volume, target_chapters)
        rows.append(f"| {v} | | 第{start}-{end}章 | | |")

    # 避免重复插入（若模板已有数据行）
    existing = {line.strip() for line in lines}
    rows = [r for r in rows if r.strip() not in existing]
    return "\n".join(lines[:insert_idx] + rows + lines[insert_idx:])


def init_project(
    project_dir: str,
    title: str,
    genre: str,
    *,
    protagonist_name: str = "",
    target_words: int = 2_000_000,
    target_chapters: int = 600,
    golden_finger_name: str = "",
    golden_finger_type: str = "",
    golden_finger_style: str = "",
    core_selling_points: str = "",
    protagonist_structure: str = "",
    heroine_config: str = "",
    heroine_names: str = "",
    heroine_role: str = "",
    co_protagonists: str = "",
    co_protagonist_roles: str = "",
    antagonist_tiers: str = "",
    world_scale: str = "",
    factions: str = "",
    power_system_type: str = "",
    social_class: str = "",
    resource_distribution: str = "",
    gf_visibility: str = "",
    gf_irreversible_cost: str = "",
    protagonist_desire: str = "",
    protagonist_flaw: str = "",
    protagonist_archetype: str = "",
    antagonist_level: str = "",
    target_reader: str = "",
    platform: str = "",
    currency_system: str = "",
    currency_exchange: str = "",
    sect_hierarchy: str = "",
    cultivation_chain: str = "",
    cultivation_subtiers: str = "",
) -> None:
    project_path = Path(project_dir).expanduser().resolve()
    if ".claude" in project_path.parts:
        raise SystemExit("Refusing to initialize a project inside .claude. Choose a different directory.")
    project_path.mkdir(parents=True, exist_ok=True)

    # 目录结构（同时兼容“卷目录”与后续扩展）
    directories = [
        ".webnovel/backups",
        ".webnovel/archive",
        ".webnovel/summaries",
        "设定集/角色库/主要角色",
        "设定集/角色库/次要角色",
        "设定集/角色库/反派角色",
        "设定集/物品库",
        "设定集/其他设定",
        "大纲",
        "正文/第1卷",
        "审查报告",
    ]
    for dir_path in directories:
        (project_path / dir_path).mkdir(parents=True, exist_ok=True)

    # state.json（创建或增量补齐）
    state_path = project_path / ".webnovel" / "state.json"
    if state_path.exists():
        try:
            state: Dict[str, Any] = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            state = {}
    else:
        state = {}

    state = _ensure_state_schema(state)
    created_at = state.get("project_info", {}).get("created_at") or datetime.now().strftime("%Y-%m-%d")

    state["project_info"].update(
        {
            "title": title,
            "genre": genre,
            "created_at": created_at,
            "target_words": int(target_words),
            "target_chapters": int(target_chapters),
            # 下面字段属于“初始化元信息”，不影响运行时脚本
            "golden_finger_name": golden_finger_name,
            "golden_finger_type": golden_finger_type,
            "golden_finger_style": golden_finger_style,
            "core_selling_points": core_selling_points,
            "protagonist_structure": protagonist_structure,
            "heroine_config": heroine_config,
            "heroine_names": heroine_names,
            "heroine_role": heroine_role,
            "co_protagonists": co_protagonists,
            "co_protagonist_roles": co_protagonist_roles,
            "antagonist_tiers": antagonist_tiers,
            "world_scale": world_scale,
            "factions": factions,
            "power_system_type": power_system_type,
            "social_class": social_class,
            "resource_distribution": resource_distribution,
            "gf_visibility": gf_visibility,
            "gf_irreversible_cost": gf_irreversible_cost,
            "target_reader": target_reader,
            "platform": platform,
            "currency_system": currency_system,
            "currency_exchange": currency_exchange,
            "sect_hierarchy": sect_hierarchy,
            "cultivation_chain": cultivation_chain,
            "cultivation_subtiers": cultivation_subtiers,
        }
    )

    if protagonist_name:
        state["protagonist_state"]["name"] = protagonist_name

    gf_type_norm = (golden_finger_type or "").strip()
    if gf_type_norm in {"无", "无金手指", "none"}:
        state["protagonist_state"]["golden_finger"]["name"] = "无金手指"
        state["protagonist_state"]["golden_finger"]["level"] = 0
        state["protagonist_state"]["golden_finger"]["cooldown"] = 0
    elif golden_finger_name:
        state["protagonist_state"]["golden_finger"]["name"] = golden_finger_name

    # 确保 golden_finger 字段存在且可编辑
    if not state["protagonist_state"]["golden_finger"].get("name"):
        state["protagonist_state"]["golden_finger"]["name"] = "未命名金手指"

    state["progress"]["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    state_path.parent.mkdir(parents=True, exist_ok=True)
    # 使用原子化写入（初始化不需要备份旧文件）
    atomic_write_json(state_path, state, use_lock=True, backup=False)

    # 读取内置模板（可选）
    script_dir = Path(__file__).resolve().parent
    templates_dir = script_dir.parent / "templates"
    output_templates_dir = templates_dir / "output"
    genre_key = (genre or "").strip()
    genre_keys = [_normalize_genre_key(k) for k in _split_genre_keys(genre_key)]
    genre_templates = []
    seen = set()
    for key in genre_keys:
        if not key or key in seen:
            continue
        seen.add(key)
        template_text = _read_text_if_exists(templates_dir / "genres" / f"{key}.md")
        if template_text:
            genre_templates.append(template_text.strip())
    genre_template = "\n\n---\n\n".join(genre_templates)
    golden_finger_templates = _read_text_if_exists(templates_dir / "golden-finger-templates.md")
    output_worldview = _read_text_if_exists(output_templates_dir / "设定集-世界观.md")
    output_power = _read_text_if_exists(output_templates_dir / "设定集-力量体系.md")
    output_protagonist = _read_text_if_exists(output_templates_dir / "设定集-主角卡.md")
    output_heroine = _read_text_if_exists(output_templates_dir / "设定集-女主卡.md")
    output_team = _read_text_if_exists(output_templates_dir / "设定集-主角组.md")
    output_golden_finger = _read_text_if_exists(output_templates_dir / "设定集-金手指.md")
    output_outline = _read_text_if_exists(output_templates_dir / "大纲-总纲.md")
    output_fusion = _read_text_if_exists(output_templates_dir / "复合题材-融合逻辑.md")
    output_antagonist = _read_text_if_exists(output_templates_dir / "设定集-反派设计.md")

    # 基础文件（只在缺失时生成，避免覆盖已有内容）
    now = datetime.now().strftime("%Y-%m-%d")

    worldview_content = output_worldview.strip() if output_worldview else ""
    if not worldview_content:
        worldview_content = "\n".join(
            [
                "# 世界观",
                "",
                f"> 项目：{title}｜题材：{genre}｜创建：{now}",
                "",
                "## 一句话世界观",
                "- （用一句话说明世界的核心规则与卖点）",
                "",
                "## 核心规则（设定即物理）",
                "- 规则1：",
                "- 规则2：",
                "- 规则3：",
                "",
                "## 势力与地理（简版）",
                "- 主要势力：",
                "- 关键地点：",
                "",
                "## 参考题材模板（可删/可改）",
                "",
                (genre_template.strip() + "\n") if genre_template else "（未找到对应题材模板，可自行补充）\n",
            ]
        ).rstrip() + "\n"
    else:
        worldview_content = _apply_label_replacements(
            worldview_content,
            {
                "大陆/位面数量": world_scale,
                "核心势力": factions,
                "社会阶层": social_class,
                "资源分配规则": resource_distribution,
                "宗门/组织层级": sect_hierarchy,
                "货币体系": currency_system,
                "兑换规则": currency_exchange,
            },
        )
    _write_text_if_missing(
        project_path / "设定集" / "世界观.md",
        worldview_content,
    )

    power_content = output_power.strip() if output_power else ""
    if not power_content:
        power_content = "\n".join(
            [
                "# 力量体系",
                "",
                f"> 项目：{title}｜题材：{genre}｜创建：{now}",
                "",
                "## 等级/境界划分",
                "- （列出从弱到强的等级，含突破条件与代价）",
                "",
                "## 技能/招式规则",
                "- 获得方式：",
                "- 成本与副作用：",
                "- 进阶与组合：",
                "",
                "## 禁止事项（防崩坏）",
                "- 未达等级不得使用高阶能力（设定即物理）",
                "- 新增能力必须申报并入库（发明需申报）",
                "",
            ]
        ).rstrip() + "\n"
    else:
        power_content = _apply_label_replacements(
            power_content,
            {
                "体系类型": power_system_type,
                "典型境界链（可选）": cultivation_chain,
                "小境界划分": cultivation_subtiers,
            },
        )
    _write_text_if_missing(
        project_path / "设定集" / "力量体系.md",
        power_content,
    )

    protagonist_content = output_protagonist.strip() if output_protagonist else ""
    if not protagonist_content:
        protagonist_content = "\n".join(
            [
                "# 主角卡",
                "",
                f"> 主角：{protagonist_name or '（待填写）'}｜项目：{title}｜创建：{now}",
                "",
                "## 三要素",
                f"- 欲望：{protagonist_desire or '（待填写）'}",
                f"- 弱点：{protagonist_flaw or '（待填写）'}",
                f"- 人设类型：{protagonist_archetype or '（待填写）'}",
                "",
                "## 初始状态（开局）",
                "- 身份：",
                "- 资源：",
                "- 约束：",
                "",
                "## 金手指概览",
                f"- 称呼：{golden_finger_name or '（待填写）'}",
                f"- 类型：{golden_finger_type or '（待填写）'}",
                f"- 风格：{golden_finger_style or '（待填写）'}",
                "- 成长曲线：",
                "",
            ]
        ).rstrip() + "\n"
    else:
        protagonist_content = _apply_label_replacements(
            protagonist_content,
            {
                "姓名": protagonist_name,
                "真正渴望（可能不自知）": protagonist_desire,
                "性格缺陷": protagonist_flaw,
            },
        )
    _write_text_if_missing(
        project_path / "设定集" / "主角卡.md",
        protagonist_content,
    )

    heroine_content = output_heroine.strip() if output_heroine else ""
    if heroine_content:
        heroine_content = _apply_label_replacements(
            heroine_content,
            {
                "姓名": heroine_names,
                "与主角关系定位（对手/盟友/共谋/牵制）": heroine_role,
            },
        )
        _write_text_if_missing(project_path / "设定集" / "女主卡.md", heroine_content)

    team_content = output_team.strip() if output_team else ""
    if team_content:
        names = [n.strip() for n in co_protagonists.split(",") if n.strip()] if co_protagonists else []
        roles = [r.strip() for r in co_protagonist_roles.split(",") if r.strip()] if co_protagonist_roles else []
        if names:
            lines = team_content.splitlines()
            new_rows = _render_team_rows(names, roles)
            replaced = False
            out_lines: List[str] = []
            for line in lines:
                if line.strip().startswith("| 主角A"):
                    out_lines.extend(new_rows)
                    replaced = True
                    continue
                if replaced and line.strip().startswith("| 主角"):
                    continue
                out_lines.append(line)
            team_content = "\n".join(out_lines)
        _write_text_if_missing(
            project_path / "设定集" / "主角组.md",
            team_content,
        )

    golden_finger_content = output_golden_finger.strip() if output_golden_finger else ""
    if not golden_finger_content:
        golden_finger_content = "\n".join(
            [
                "# 金手指设计",
                "",
                f"> 项目：{title}｜题材：{genre}｜创建：{now}",
                "",
                "## 选型",
                f"- 称呼：{golden_finger_name or '（待填写）'}",
                f"- 类型：{golden_finger_type or '（待填写）'}",
                f"- 风格：{golden_finger_style or '（待填写）'}",
                "",
                "## 规则（必须写清）",
                "- 触发条件：",
                "- 冷却/代价：",
                "- 上限：",
                "- 反噬/风险：",
                "",
                "## 成长曲线（章节规划）",
                "- Lv1：",
                "- Lv2：",
                "- Lv3：",
                "",
                "## 模板参考（可删/可改）",
                "",
                (golden_finger_templates.strip() + "\n") if golden_finger_templates else "（未找到金手指模板库）\n",
            ]
        ).rstrip() + "\n"
    else:
        golden_finger_content = _apply_label_replacements(
            golden_finger_content,
            {
                "类型": golden_finger_type,
                "读者可见度": gf_visibility,
                "不可逆代价": gf_irreversible_cost,
            },
        )
    _write_text_if_missing(
        project_path / "设定集" / "金手指设计.md",
        golden_finger_content,
    )

    fusion_content = output_fusion.strip() if output_fusion else ""
    if fusion_content:
        _write_text_if_missing(
            project_path / "设定集" / "复合题材-融合逻辑.md",
            fusion_content,
        )

    antagonist_content = output_antagonist.strip() if output_antagonist else ""
    if not antagonist_content:
        antagonist_content = "\n".join(
            [
                "# 反派设计",
                "",
                f"> 项目：{title}｜创建：{now}",
                "",
                f"- 反派等级：{antagonist_level or '（待填写）'}",
                "- 动机：",
                "- 资源/势力：",
                "- 与主角的镜像关系：",
                "- 终局：",
                "",
            ]
        ).rstrip() + "\n"
    else:
        tier_map = _parse_tier_map(antagonist_tiers)
        if tier_map:
            lines = antagonist_content.splitlines()
            out_lines = []
            for line in lines:
                if line.strip().startswith("| 小反派"):
                    name = tier_map.get("小反派", "")
                    out_lines.append(f"| 小反派 | {name} | 前期 | | |")
                    continue
                if line.strip().startswith("| 中反派"):
                    name = tier_map.get("中反派", "")
                    out_lines.append(f"| 中反派 | {name} | 中期 | | |")
                    continue
                if line.strip().startswith("| 大反派"):
                    name = tier_map.get("大反派", "")
                    out_lines.append(f"| 大反派 | {name} | 后期 | | |")
                    continue
                out_lines.append(line)
            antagonist_content = "\n".join(out_lines)
    _write_text_if_missing(project_path / "设定集" / "反派设计.md", antagonist_content)

    outline_content = output_outline.strip() if output_outline else ""
    if outline_content:
        outline_content = _inject_volume_rows(outline_content, int(target_chapters)).rstrip() + "\n"
    else:
        outline_content = _build_master_outline(int(target_chapters))
    _write_text_if_missing(project_path / "大纲" / "总纲.md", outline_content)

    _write_text_if_missing(
        project_path / "大纲" / "爽点规划.md",
        "\n".join(
            [
                "# 爽点规划",
                "",
                f"> 项目：{title}｜题材：{genre}｜创建：{now}",
                "",
                "## 核心卖点（来自初始化输入）",
                f"- {core_selling_points or '（待填写，建议 1-3 条，用逗号分隔）'}",
                "",
                "## 密度目标（建议）",
                "- 每章至少 1 个小爽点",
                "- 每 5 章至少 1 个大爽点",
                "",
                "## 分布表（示例，可改）",
                "",
                "| 章节范围 | 主导爽点类型 | 备注 |",
                "|---|---|---|",
                "| 1-5 | 金手指/打脸/反转 | 开篇钩子 + 立人设 |",
                "| 6-10 | 升级/收获 | 进入主线节奏 |",
                "",
            ]
        ),
    )

    # Git 初始化（仅当项目目录内尚无 .git 且 Git 可用）
    git_dir = project_path / ".git"
    if not git_dir.exists():
        if not is_git_available():
            print("\n⚠️  Git 不可用，跳过版本控制初始化")
            print("💡 如需启用 Git 版本控制，请安装 Git: https://git-scm.com/")
        else:
            print("\nInitializing Git repository...")
            try:
                subprocess.run(["git", "init"], cwd=project_path, check=True, capture_output=True, text=True)

                gitignore_file = project_path / ".gitignore"
                if not gitignore_file.exists():
                    gitignore_file.write_text(
                        """# Python
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
.webnovel/*.lock
.webnovel/*.bak
""",
                        encoding="utf-8",
                    )

                subprocess.run(["git", "add", "."], cwd=project_path, check=True, capture_output=True)
                # 安全修复：清理 title 防止命令注入
                safe_title = sanitize_commit_message(title)
                subprocess.run(
                    ["git", "commit", "-m", f"初始化网文项目：{safe_title}"],
                    cwd=project_path,
                    check=True,
                    capture_output=True,
                )
                print("Git initialized.")
            except subprocess.CalledProcessError as e:
                print(f"Git init failed (non-fatal): {e}")

    print(f"\nProject initialized at: {project_path}")
    print("Key files:")
    print(" - .webnovel/state.json")
    print(" - 设定集/世界观.md")
    print(" - 设定集/力量体系.md")
    print(" - 设定集/主角卡.md")
    print(" - 设定集/金手指设计.md")
    print(" - 大纲/总纲.md")
    print(" - 大纲/爽点规划.md")


def main() -> None:
    parser = argparse.ArgumentParser(description="网文项目初始化脚本（生成项目结构 + state.json + 基础模板）")
    parser.add_argument("project_dir", help="项目目录（建议 ./webnovel-project）")
    parser.add_argument("title", help="小说标题")
    parser.add_argument(
        "genre",
        help="题材类型（可用“+”组合，如：都市脑洞+规则怪谈；示例：修仙/系统流/都市异能/古言/现实题材）",
    )

    parser.add_argument("--protagonist-name", default="", help="主角姓名")
    parser.add_argument("--target-words", type=int, default=2_000_000, help="目标总字数（默认 2000000）")
    parser.add_argument("--target-chapters", type=int, default=600, help="目标总章节数（默认 600）")

    parser.add_argument("--golden-finger-name", default="", help="金手指称呼/系统名（建议读者可见的代号）")
    parser.add_argument("--golden-finger-type", default="", help="金手指类型（如 系统流/鉴定流/签到流）")
    parser.add_argument("--golden-finger-style", default="", help="金手指风格（如 冷漠工具型/毒舌吐槽型）")
    parser.add_argument("--core-selling-points", default="", help="核心卖点（逗号分隔）")
    parser.add_argument("--protagonist-structure", default="", help="主角结构（单主角/多主角）")
    parser.add_argument("--heroine-config", default="", help="女主配置（无女主/单女主/多女主）")
    parser.add_argument("--heroine-names", default="", help="女主姓名（多个用逗号分隔）")
    parser.add_argument("--heroine-role", default="", help="女主定位（事业线/情感线/对抗线）")
    parser.add_argument("--co-protagonists", default="", help="多主角姓名（逗号分隔）")
    parser.add_argument("--co-protagonist-roles", default="", help="多主角定位（逗号分隔）")
    parser.add_argument("--antagonist-tiers", default="", help="反派分层（如 小反派:张三;中反派:李四;大反派:王五）")
    parser.add_argument("--world-scale", default="", help="世界规模")
    parser.add_argument("--factions", default="", help="势力格局/核心势力")
    parser.add_argument("--power-system-type", default="", help="力量体系类型")
    parser.add_argument("--social-class", default="", help="社会阶层")
    parser.add_argument("--resource-distribution", default="", help="资源分配")
    parser.add_argument("--gf-visibility", default="", help="金手指可见度（明牌/半明牌/暗牌）")
    parser.add_argument("--gf-irreversible-cost", default="", help="金手指不可逆代价")
    parser.add_argument("--currency-system", default="", help="货币体系")
    parser.add_argument("--currency-exchange", default="", help="货币兑换/面值规则")
    parser.add_argument("--sect-hierarchy", default="", help="宗门/组织层级")
    parser.add_argument("--cultivation-chain", default="", help="典型境界链")
    parser.add_argument("--cultivation-subtiers", default="", help="小境界划分（初/中/后/巅 等）")

    # 深度模式可选参数（用于预填模板）
    parser.add_argument("--protagonist-desire", default="", help="主角核心欲望（深度模式）")
    parser.add_argument("--protagonist-flaw", default="", help="主角性格弱点（深度模式）")
    parser.add_argument("--protagonist-archetype", default="", help="主角人设类型（深度模式）")
    parser.add_argument("--antagonist-level", default="", help="反派等级（深度模式）")
    parser.add_argument("--target-reader", default="", help="目标读者（深度模式）")
    parser.add_argument("--platform", default="", help="发布平台（深度模式）")

    args = parser.parse_args()

    init_project(
        args.project_dir,
        args.title,
        args.genre,
        protagonist_name=args.protagonist_name,
        target_words=args.target_words,
        target_chapters=args.target_chapters,
        golden_finger_name=args.golden_finger_name,
        golden_finger_type=args.golden_finger_type,
        golden_finger_style=args.golden_finger_style,
        core_selling_points=args.core_selling_points,
        protagonist_structure=args.protagonist_structure,
        heroine_config=args.heroine_config,
        heroine_names=args.heroine_names,
        heroine_role=args.heroine_role,
        co_protagonists=args.co_protagonists,
        co_protagonist_roles=args.co_protagonist_roles,
        antagonist_tiers=args.antagonist_tiers,
        world_scale=args.world_scale,
        factions=args.factions,
        power_system_type=args.power_system_type,
        social_class=args.social_class,
        resource_distribution=args.resource_distribution,
        gf_visibility=args.gf_visibility,
        gf_irreversible_cost=args.gf_irreversible_cost,
        protagonist_desire=args.protagonist_desire,
        protagonist_flaw=args.protagonist_flaw,
        protagonist_archetype=args.protagonist_archetype,
        antagonist_level=args.antagonist_level,
        target_reader=args.target_reader,
        platform=args.platform,
        currency_system=args.currency_system,
        currency_exchange=args.currency_exchange,
        sect_hierarchy=args.sect_hierarchy,
        cultivation_chain=args.cultivation_chain,
        cultivation_subtiers=args.cultivation_subtiers,
    )


if __name__ == "__main__":
    main()
