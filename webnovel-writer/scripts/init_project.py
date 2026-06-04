#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网文项目初始化脚本

目标：
- 生成可运行的项目结构（webnovel-project）
- 创建/更新 .webnovel/state.json（初始化配置与兼容读模型）
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

from runtime_compat import enable_windows_utf8_stdio
from typing import Any, Dict, List
import re

# 安全修复：导入安全工具函数
from security_utils import sanitize_commit_message, atomic_write_json, is_git_available
from project_locator import write_current_project_pointer

try:
    from data_modules.genre_aliases import normalize_genre_token, to_template_file
    from data_modules.naming import (
        DIR_MANUSCRIPT,
        DIR_SETTINGS,
        DIR_OUTLINE,
        DIR_REVIEWS,
    )
except ImportError:  # pragma: no cover
    from scripts.data_modules.genre_aliases import normalize_genre_token, to_template_file
    from scripts.data_modules.naming import (
        DIR_MANUSCRIPT,
        DIR_SETTINGS,
        DIR_OUTLINE,
        DIR_REVIEWS,
    )


# Windows 编码兼容性修复
if sys.platform == "win32":
    enable_windows_utf8_stdio()


_ASCII_LETTER_RE = re.compile(r"[A-Za-z]")
_HANGUL_RE = re.compile(r"[가-힣]")


def _validate_initial_genre_source(genre: str) -> str:
    normalized = str(genre or "").strip()
    # 한글이 전혀 없고 ASCII 영문만 있는 경우 → 내부 profile key 오입력으로 간주.
    # (예: "xianxia", "romance"). "e스포츠"처럼 한글이 섞이면 허용한다.
    if _ASCII_LETTER_RE.search(normalized) and not _HANGUL_RE.search(normalized):
        raise SystemExit(
            f"장르는 한국어 명칭으로 입력하세요. 내부 profile key('{normalized}')는 사용할 수 없습니다. "
            "예: 헌터물, 로맨스판타지, 무협, 회귀, 추리."
        )
    return normalized


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
    # 한국 장르 정규화는 genre_aliases 단일 출처를 재사용한다.
    return normalize_genre_token(key)


def _apply_label_replacements(text: str, replacements: Dict[str, str]) -> str:
    if not text or not replacements:
        return text
    lines = text.splitlines()
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        for label, value in replacements.items():
            if not value:
                continue
            # 전각(：)/반각(:) 콜론 모두 허용
            for colon in ("：", ":"):
                prefix = f"- {label}{colon}"
                if stripped.startswith(prefix):
                    leading = line[: len(line) - len(stripped)]
                    lines[i] = f"{leading}{prefix}{value}"
                    break
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


def _needs_protagonist_group(protagonist_structure: str) -> bool:
    text = (protagonist_structure or "").strip()
    return any(marker in text for marker in ("主角组", "双主角", "多主角", "群像主角"))


def _needs_heroine_card(heroine_config: str, heroine_names: str) -> bool:
    text = (heroine_config or "").strip().lower()
    if text in {"无", "无女主", "none", "no heroine"}:
        return False
    return bool((heroine_names or "").strip() or text)


def _render_team_rows(names: List[str], roles: List[str]) -> List[str]:
    rows = []
    for idx, name in enumerate(names):
        role = roles[idx] if idx < len(roles) else ""
        rows.append(f"| {name} | {role or '메인라인/서브라인'} | | | |")
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
        "# 마스터 아웃라인",
        "",
        "> 이 파일은 '마스터 아웃라인 골격'으로, /webnovel-plan에서 권 대강과 화별 대강으로 세분화한다.",
        "",
        "## 권 구성",
        "",
    ]

    for v in range(1, volumes + 1):
        start = (v - 1) * chapters_per_volume + 1
        end = min(v * chapters_per_volume, target_chapters)
        lines.extend(
            [
                f"### 제{v}권 ({start}-{end}화)",
                "- 핵심 갈등:",
                "- 핵심 사이다:",
                "- 권말 클라이맥스:",
                "- 주요 등장 인물:",
                "- 핵심 복선(매설/회수):",
                "",
            ]
        )

    return "\n".join(lines).rstrip() + "\n"


def _inject_volume_rows(template_text: str, target_chapters: int, *, chapters_per_volume: int = 50) -> str:
    """在总纲模板的卷表中只注入首卷行（后续卷由规划完成后写回）。"""
    lines = template_text.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        # 한국어(신규) "| 권 번호" + 레거시 "| 卷号" 모두 인식
        if line.strip().startswith(("| 권 번호", "| 卷号")):
            header_idx = i
            break
    if header_idx is None:
        return template_text

    insert_idx = header_idx + 2 if header_idx + 1 < len(lines) else len(lines)
    end = min(chapters_per_volume, target_chapters) if target_chapters > 0 else chapters_per_volume
    rows = [f"| 1 | | 1-{end}화 | | |"]

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
    genre = _validate_initial_genre_source(genre)
    project_path.mkdir(parents=True, exist_ok=True)

    # 目录结构（同时兼容“卷目录”与后续扩展）
    directories = [
        ".webnovel/backups",
        ".webnovel/archive",
        ".webnovel/summaries",
        DIR_SETTINGS,
        DIR_OUTLINE,
        DIR_MANUSCRIPT,
        DIR_REVIEWS,
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
        # 한국 장르명 → 기존(중국어) 템플릿 파일명으로 매핑해 로드
        template_text = _read_text_if_exists(templates_dir / "genres" / f"{to_template_file(key)}.md")
        if template_text:
            genre_templates.append(template_text.strip())
    genre_template = "\n\n---\n\n".join(genre_templates)
    # 템플릿 파일명은 현 단계 기존(중국어) 유지(본문 한국어화는 다음 단계).
    # 생성되는 프로젝트 파일명은 한국어(세계관.md 등)로 쓴다.
    output_worldview = _read_text_if_exists(output_templates_dir / "设定集-世界观.md")
    output_power = _read_text_if_exists(output_templates_dir / "设定集-力量体系.md")
    output_protagonist = _read_text_if_exists(output_templates_dir / "设定集-主角卡.md")
    output_heroine = _read_text_if_exists(output_templates_dir / "设定集-女主卡.md")
    output_team = _read_text_if_exists(output_templates_dir / "设定集-主角组.md")
    output_outline = _read_text_if_exists(output_templates_dir / "大纲-总纲.md")
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
                "대륙/차원 수": world_scale,
                "핵심 세력": factions,
                "사회 계층": social_class,
                "자원 분배 규칙": resource_distribution,
                "문파/조직 위계": sect_hierarchy,
                "화폐 체계": currency_system,
                "환전 규칙": currency_exchange,
            },
        )
    _write_text_if_missing(
        project_path / DIR_SETTINGS / "세계관.md",
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
                "체계 유형": power_system_type,
                "대표 경지 체인(선택)": cultivation_chain,
                "소경지 구분": cultivation_subtiers,
            },
        )
    _write_text_if_missing(
        project_path / DIR_SETTINGS / "파워시스템.md",
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
                "이름": protagonist_name,
                "진짜 욕망(본인도 모를 수 있음)": protagonist_desire,
                "성격적 결함": protagonist_flaw,
            },
        )
    _write_text_if_missing(
        project_path / DIR_SETTINGS / "주인공카드.md",
        protagonist_content,
    )

    heroine_content = output_heroine.strip() if output_heroine else ""
    if heroine_content and _needs_heroine_card(heroine_config, heroine_names):
        heroine_content = _apply_label_replacements(
            heroine_content,
            {
                "이름": heroine_names,
                "주인공과의 관계 포지션(라이벌/동맹/공모/견제)": heroine_role,
            },
        )
        _write_text_if_missing(project_path / DIR_SETTINGS / "여주카드.md", heroine_content)

    team_content = output_team.strip() if output_team else ""
    if team_content and _needs_protagonist_group(protagonist_structure):
        names = [n.strip() for n in co_protagonists.split(",") if n.strip()] if co_protagonists else []
        roles = [r.strip() for r in co_protagonist_roles.split(",") if r.strip()] if co_protagonist_roles else []
        if names:
            lines = team_content.splitlines()
            new_rows = _render_team_rows(names, roles)
            replaced = False
            out_lines: List[str] = []
            for line in lines:
                if line.strip().startswith("| 주인공A"):
                    out_lines.extend(new_rows)
                    replaced = True
                    continue
                if replaced and line.strip().startswith("| 주인공"):
                    continue
                out_lines.append(line)
            team_content = "\n".join(out_lines)
        _write_text_if_missing(
            project_path / DIR_SETTINGS / "주인공그룹.md",
            team_content,
        )

    antagonist_content = output_antagonist.strip() if output_antagonist else ""
    if not antagonist_content:
        antagonist_content = "\n".join(
            [
                "# 빌런 설계",
                "",
                f"> 프로젝트: {title}｜생성: {now}",
                "",
                f"- 빌런 등급: {antagonist_level or '(작성 필요)'}",
                "- 동기:",
                "- 자원/세력:",
                "- 주인공과의 미러 관계:",
                "- 결말:",
                "",
            ]
        ).rstrip() + "\n"
    else:
        tier_map = _parse_tier_map(antagonist_tiers)
        if tier_map:
            lines = antagonist_content.splitlines()
            out_lines = []
            for line in lines:
                if line.strip().startswith("| 소형빌런"):
                    name = tier_map.get("소형빌런", "")
                    out_lines.append(f"| 소형빌런 | {name} | 초반 | | |")
                    continue
                if line.strip().startswith("| 중형빌런"):
                    name = tier_map.get("중형빌런", "")
                    out_lines.append(f"| 중형빌런 | {name} | 중반 | | |")
                    continue
                if line.strip().startswith("| 대형빌런"):
                    name = tier_map.get("대형빌런", "")
                    out_lines.append(f"| 대형빌런 | {name} | 후반 | | |")
                    continue
                out_lines.append(line)
            antagonist_content = "\n".join(out_lines)
    _write_text_if_missing(project_path / DIR_SETTINGS / "빌런설계.md", antagonist_content)

    outline_content = output_outline.strip() if output_outline else ""
    if outline_content:
        outline_content = _inject_volume_rows(outline_content, int(target_chapters)).rstrip() + "\n"
    else:
        outline_content = _build_master_outline(int(target_chapters))
    _write_text_if_missing(project_path / DIR_OUTLINE / "마스터아웃라인.md", outline_content)

    # 生成环境变量模板（不写入真实密钥）
    _write_text_if_missing(
        project_path / ".env.example",
        "\n".join(
            [
                "# Webnovel Writer 설정 예시 (.env로 복사 후 작성)",
                "# 주의: 실제 API_KEY가 담긴 .env는 버전관리에 커밋하지 마세요.",
                "",
                "# Embedding",
                "# 기본값은 ModelScope(중국)입니다. 한국에서 접속이 불안정하면",
                "# OpenAI 호환 다국어 임베딩 엔드포인트로 바꾸세요.",
                "EMBED_BASE_URL=https://api-inference.modelscope.cn/v1",
                "EMBED_MODEL=Qwen/Qwen3-Embedding-8B",
                "EMBED_API_KEY=",
                "",
                "# Rerank",
                "RERANK_BASE_URL=https://api.jina.ai/v1",
                "RERANK_MODEL=jina-reranker-v3",
                "RERANK_API_KEY=",
                "",
            ]
        )
        + "\n",
    )

    # Git 初始化（仅当项目目录内尚无 .git 且 Git 可用）
    git_dir = project_path / ".git"
    if not git_dir.exists():
        if not is_git_available():
            print("\n⚠️  Git을 사용할 수 없어 버전관리 초기화를 건너뜁니다")
            print("💡 Git 버전관리를 쓰려면 Git을 설치하세요: https://git-scm.com/")
        else:
            print("\nGit 저장소 초기화 중...")
            try:
                subprocess.run(["git", "init"], cwd=project_path, check=True, capture_output=True, text=True)

                gitignore_file = project_path / ".gitignore"
                if not gitignore_file.exists():
                    gitignore_file.write_text(
                        """# Python
__pycache__/
*.py[cod]
*.so

# Env (keep .env.example)
.env
.env.*
!.env.example

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
                    ["git", "commit", "-m", f"웹소설 프로젝트 초기화: {safe_title}"],
                    cwd=project_path,
                    check=True,
                    capture_output=True,
                )
                print("Git initialized.")
            except subprocess.CalledProcessError as e:
                print(f"Git init failed (non-fatal): {e}")

    # 记录工作区默认项目指针（非阻断）
    try:
        pointer_file = write_current_project_pointer(project_path)
        if pointer_file is not None:
            print(f"Default project pointer updated: {pointer_file}")
    except Exception as e:
        print(f"Default project pointer update failed (non-fatal): {e}")

    print(f"\n프로젝트 초기화 완료: {project_path}")
    print("주요 파일:")
    print(" - .webnovel/state.json")
    print(f" - {DIR_SETTINGS}/세계관.md")
    print(f" - {DIR_SETTINGS}/파워시스템.md")
    print(f" - {DIR_SETTINGS}/주인공카드.md")
    print(f" - {DIR_OUTLINE}/마스터아웃라인.md")


def main() -> None:
    parser = argparse.ArgumentParser(description="웹소설 프로젝트 초기화 스크립트(프로젝트 구조 + state.json + 기본 템플릿 생성)")
    parser.add_argument("project_dir", help="프로젝트 디렉터리(권장: ./webnovel-project)")
    parser.add_argument("title", help="소설 제목")
    parser.add_argument(
        "genre",
        help="장르(\"+\"로 복합 지정 가능, 예: 현대판타지+공포; 예시: 헌터물/시스템/무협/로맨스판타지/추리)",
    )

    parser.add_argument("--protagonist-name", default="", help="주인공 이름")
    parser.add_argument("--target-words", type=int, default=2_000_000, help="목표 총 글자수(기본 2000000)")
    parser.add_argument("--target-chapters", type=int, default=600, help="목표 총 화수(기본 600)")

    parser.add_argument("--golden-finger-name", default="", help="치트키/시스템 명칭(독자에게 보이는 코드네임 권장)")
    parser.add_argument("--golden-finger-type", default="", help="치트키 유형(예: 시스템/감정/출석체크)")
    parser.add_argument("--golden-finger-style", default="", help="치트키 스타일(예: 냉정한 도구형/독설 츤데레형)")
    parser.add_argument("--core-selling-points", default="", help="핵심 셀링포인트(쉼표 구분)")
    parser.add_argument("--protagonist-structure", default="", help="주인공 구조(단일주인공/다중주인공)")
    parser.add_argument("--heroine-config", default="", help="여주 구성(여주없음/단일여주/다수여주)")
    parser.add_argument("--heroine-names", default="", help="여주 이름(여러 명은 쉼표 구분)")
    parser.add_argument("--heroine-role", default="", help="여주 포지션(사업라인/감정라인/대립라인)")
    parser.add_argument("--co-protagonists", default="", help="다중주인공 이름(쉼표 구분)")
    parser.add_argument("--co-protagonist-roles", default="", help="다중주인공 포지션(쉼표 구분)")
    parser.add_argument("--antagonist-tiers", default="", help="빌런 계층(예: 소형빌런:홍길동;중형빌런:김철수;대형빌런:이영희)")
    parser.add_argument("--world-scale", default="", help="세계 규모")
    parser.add_argument("--factions", default="", help="세력 구도/핵심 세력")
    parser.add_argument("--power-system-type", default="", help="파워 시스템 유형")
    parser.add_argument("--social-class", default="", help="사회 계층")
    parser.add_argument("--resource-distribution", default="", help="자원 분배")
    parser.add_argument("--gf-visibility", default="", help="치트키 노출도(공개/반공개/비공개)")
    parser.add_argument("--gf-irreversible-cost", default="", help="치트키의 비가역 대가")
    parser.add_argument("--currency-system", default="", help="화폐 체계")
    parser.add_argument("--currency-exchange", default="", help="화폐 환전/액면 규칙")
    parser.add_argument("--sect-hierarchy", default="", help="문파/조직 위계")
    parser.add_argument("--cultivation-chain", default="", help="대표 경지(레벨) 체계")
    parser.add_argument("--cultivation-subtiers", default="", help="소경지 구분(초/중/후/극 등)")

    # 심화 모드 선택 인자(템플릿 사전 채우기용)
    parser.add_argument("--protagonist-desire", default="", help="주인공 핵심 욕망(심화 모드)")
    parser.add_argument("--protagonist-flaw", default="", help="주인공 성격적 약점(심화 모드)")
    parser.add_argument("--protagonist-archetype", default="", help="주인공 캐릭터 유형(심화 모드)")
    parser.add_argument("--antagonist-level", default="", help="빌런 등급(심화 모드)")
    parser.add_argument("--target-reader", default="", help="타깃 독자(심화 모드)")
    parser.add_argument("--platform", default="", help="연재 플랫폼(심화 모드)")

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
