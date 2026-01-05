#!/usr/bin/env python3
"""
[NEW_ENTITY] 标签提取与同步脚本

功能：
1. 扫描指定章节正文，提取所有 [NEW_ENTITY] 标签
2. 解析实体类型（角色/地点/物品/势力/招式）
3. 支持实体层级分类（核心/支线/装饰）- 匹配伏笔三层级系统
4. 提取金手指技能标签 [GOLDEN_FINGER_SKILL]
5. 同步到设定集对应文件
6. 更新 state.json 中的相关记录
7. 支持自动化模式和交互式模式

使用方式：
  python extract_entities.py <章节文件> [--auto] [--dry-run]

示例：
  python extract_entities.py ../../../正文/第0001章.md           # 交互式模式
  python extract_entities.py ../../../正文/第0001章.md --auto    # 自动化模式
  python extract_entities.py ../../../正文/第0001章.md --dry-run # 仅预览不写入
"""

import re
import json
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Tuple, Optional, Any

# ============================================================================
# 安全修复：导入安全工具函数（P0 CRITICAL）
# ============================================================================
from security_utils import sanitize_filename, create_secure_directory
from project_locator import resolve_project_root, resolve_state_file
from chapter_paths import find_chapter_file, extract_chapter_num_from_filename

# Windows 编码兼容性修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 实体类型与目标文件映射
ENTITY_TYPE_MAP = {
    "角色": "设定集/角色库/{category}/{name}.md",
    "地点": "设定集/世界观.md",  # 追加到世界观地理章节
    "物品": "设定集/物品库/{name}.md",
    "势力": "设定集/世界观.md",  # 追加到势力章节
    "招式": "设定集/力量体系.md",  # 追加到招式章节
    "其他": "设定集/其他设定/{name}.md"
}

# 角色分类规则
ROLE_CATEGORY_MAP = {
    "主角": "主要角色",
    "配角": "次要角色",
    "反派": "反派角色",
    "路人": "次要角色"
}

# 实体层级权重（匹配伏笔三层级系统）
ENTITY_TIER_MAP = {
    "核心": {"weight": 3.0, "desc": "必须追踪，影响主线"},
    "core": {"weight": 3.0, "desc": "必须追踪，影响主线"},
    "支线": {"weight": 2.0, "desc": "应该追踪，丰富剧情"},
    "sub": {"weight": 2.0, "desc": "应该追踪，丰富剧情"},
    "装饰": {"weight": 1.0, "desc": "可选追踪，增加真实感"},
    "decor": {"weight": 1.0, "desc": "可选追踪，增加真实感"}
}

def extract_new_entities(file_path: str) -> List[Dict]:
    """
    从章节文件中提取所有 [NEW_ENTITY] 标签

    标签格式（支持两种）：
      基础格式：[NEW_ENTITY: 类型, 名称, 描述]
      增强格式：[NEW_ENTITY: 类型, 名称, 描述, 层级]  （层级可选：核心/支线/装饰）

      示例：
      [NEW_ENTITY: 角色, 李雪, 天云宗外门弟子]
      [NEW_ENTITY: 角色, 血煞门主, 本卷最终BOSS, 核心]
      [NEW_ENTITY: 地点, 血煞秘境, 危险的试炼之地, 支线]
      [NEW_ENTITY: 物品, 天雷果, 可提升雷属性修炼速度的灵果, 装饰]

    Returns:
        List[Dict]: [{"type": "角色", "name": "李雪", "desc": "...", "tier": "支线", "line": 123}, ...]
    """
    entities = []

    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            # 增强格式：4个字段（包含层级）
            matches_enhanced = re.findall(
                r'\[NEW_ENTITY:\s*([^,，]+)[,，]\s*([^,，]+)[,，]\s*([^,，]+)[,，]\s*([^,，\]]+)\]',
                line
            )

            # 基础格式：3个字段
            matches_basic = re.findall(
                r'\[NEW_ENTITY:\s*([^,，]+)[,，]\s*([^,，]+)[,，]\s*([^,，\]]+)\]',
                line
            )

            # 优先处理增强格式
            for match in matches_enhanced:
                entity_type = match[0].strip()
                entity_name = match[1].strip()
                entity_desc = match[2].strip()
                entity_tier = match[3].strip()

                # 验证层级有效性
                if entity_tier.lower() not in ENTITY_TIER_MAP:
                    entity_tier = "支线"  # 默认支线

                entities.append({
                    "type": entity_type,
                    "name": entity_name,
                    "desc": entity_desc,
                    "tier": entity_tier,
                    "line": line_num,
                    "source_file": file_path
                })

            # 处理基础格式（排除已被增强格式匹配的）
            for match in matches_basic:
                entity_type = match[0].strip()
                entity_name = match[1].strip()
                entity_desc = match[2].strip()

                # 检查是否已被增强格式匹配
                already_matched = any(
                    e["name"] == entity_name and e["line"] == line_num
                    for e in entities
                )

                if not already_matched:
                    entities.append({
                        "type": entity_type,
                        "name": entity_name,
                        "desc": entity_desc,
                        "tier": "支线",  # 默认层级
                        "line": line_num,
                        "source_file": file_path
                    })

    return entities


def extract_golden_finger_skills(file_path: str) -> List[Dict]:
    """
    从章节文件中提取金手指技能标签 [GOLDEN_FINGER_SKILL]

    标签格式：
      [GOLDEN_FINGER_SKILL: 技能名, 等级, 描述, 冷却时间]

      示例：
      [GOLDEN_FINGER_SKILL: 吞噬, Lv1, 可吞噬敌人获得经验, 10秒]
      [GOLDEN_FINGER_SKILL: 鉴定术, Lv2, 查看物品/角色属性, 无冷却]

    Returns:
        List[Dict]: [{"name": "吞噬", "level": "Lv1", "desc": "...", "cooldown": "10秒"}, ...]
    """
    skills = []

    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            matches = re.findall(
                r'\[GOLDEN_FINGER_SKILL:\s*([^,，]+)[,，]\s*([^,，]+)[,，]\s*([^,，]+)[,，]\s*([^\]]+)\]',
                line
            )

            for match in matches:
                skills.append({
                    "name": match[0].strip(),
                    "level": match[1].strip(),
                    "desc": match[2].strip(),
                    "cooldown": match[3].strip(),
                    "line": line_num,
                    "source_file": file_path
                })

    return skills


def extract_foreshadowing_json(file_path: str) -> List[Dict[str, Any]]:
    """
    从章节文件提取伏笔标签（推荐放在 HTML 注释内，避免影响读者阅读）：

      <!-- [FORESHADOWING_JSON: {"content":"继承者验证通过","tier":"支线","target_chapter":101,"location":"云程贸易公司","characters":["陆辰"]}] -->

    字段：
      - content (必填)
      - tier (可选: 核心/支线/装饰，默认 支线)
      - planted_chapter (可选: 默认由调用方补齐)
      - target_chapter (可选: 默认 planted_chapter + 100)
      - location (可选)
      - characters (可选: list[str] 或 逗号分隔字符串)
    """
    p = Path(file_path)
    text = p.read_text(encoding="utf-8")

    pattern = re.compile(r"\[FORESHADOWING_JSON:\s*(\{.*?\})\s*\]", re.DOTALL)
    results: List[Dict[str, Any]] = []

    for m in pattern.finditer(text):
        raw = m.group(1).strip()
        line_num = text[: m.start()].count("\n") + 1
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            print(f"?? 伏笔 JSON 解析失败（第{line_num}行附近），已跳过")
            continue

        content = str(obj.get("content", "")).strip()
        if not content:
            print(f"?? 伏笔缺少 content（第{line_num}行附近），已跳过")
            continue

        tier = str(obj.get("tier", "支线")).strip() or "支线"
        if tier.lower() not in ENTITY_TIER_MAP:
            tier = "支线"

        characters = obj.get("characters", [])
        if isinstance(characters, str):
            characters_list = [c.strip() for c in re.split(r"[,，]", characters) if c.strip()]
        elif isinstance(characters, list):
            characters_list = [str(c).strip() for c in characters if str(c).strip()]
        else:
            characters_list = []

        results.append(
            {
                "content": content,
                "tier": tier,
                "planted_chapter": obj.get("planted_chapter"),
                "target_chapter": obj.get("target_chapter"),
                "location": str(obj.get("location", "")).strip(),
                "characters": characters_list,
                "line": line_num,
                "source_file": str(p),
            }
        )

    return results


def categorize_character(desc: str) -> str:
    """
    根据描述判断角色分类

    规则：
      - 包含"主角"/"林天" → 主要角色
      - 包含"反派"/"敌对"/"血煞门" → 反派角色
      - 其他 → 次要角色
    """
    if "主角" in desc or "重要" in desc:
        return "主要角色"
    elif "反派" in desc or "敌对" in desc or "血煞" in desc:
        return "反派角色"
    else:
        return "次要角色"

def generate_character_card(entity: Dict, category: str) -> str:
    """生成角色卡 Markdown 内容"""
    return f"""# {entity['name']}

> **首次登场**: {entity.get('source_file', '未知')}（第 {entity.get('line', '?')} 行）
> **创建时间**: {datetime.now().strftime('%Y-%m-%d')}

## 基本信息

- **姓名**: {entity['name']}
- **性别**: 待补充
- **年龄**: 待补充
- **身份**: {entity['desc']}
- **所属势力**: 待补充

## 实力设定

- **当前境界**: 待补充
- **擅长招式**: 待补充
- **特殊能力**: 待补充

## 性格特点

{entity['desc']}

## 外貌描述

待补充

## 人际关系

- **与主角**: 待补充

## 重要剧情

- 【第 X 章】{entity['desc']}

## 备注

自动提取自 [NEW_ENTITY] 标签，请补充完善。
"""

def update_world_view(entity: Dict, target_file: str, section: str):
    """更新世界观.md（追加地点/势力信息）"""
    if not os.path.exists(target_file):
        # 创建基础模板
        content = f"""# 世界观

## 地理

## 势力

## 历史背景

"""
        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(content)

    # 读取现有内容
    with open(target_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # 追加到对应章节
    if section == "地理":
        entry = f"""
### {entity['name']}

{entity['desc']}

> 首次登场: {entity.get('source_file', '未知')}
"""
    elif section == "势力":
        entry = f"""
### {entity['name']}

{entity['desc']}

> 首次登场: {entity.get('source_file', '未知')}
"""

    # 在对应章节后追加
    pattern = f"## {section}"
    if pattern in content:
        content = content.replace(pattern, f"{pattern}\n{entry}")
    else:
        content += f"\n## {section}\n{entry}"

    with open(target_file, 'w', encoding='utf-8') as f:
        f.write(content)

def update_power_system(entity: Dict, target_file: str):
    """更新力量体系.md（追加招式）"""
    if not os.path.exists(target_file):
        content = f"""# 力量体系

## 境界划分

## 修炼方法

## 招式库

"""
        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(content)

    with open(target_file, 'r', encoding='utf-8') as f:
        content = f.read()

    entry = f"""
### {entity['name']}

{entity['desc']}

> 首次登场: {entity.get('source_file', '未知')}
"""

    if "## 招式库" in content:
        content = content.replace("## 招式库", f"## 招式库\n{entry}")
    else:
        content += f"\n## 招式库\n{entry}"

    with open(target_file, 'w', encoding='utf-8') as f:
        f.write(content)

def update_state_json(
    entities: List[Dict],
    state_file: str,
    golden_finger_skills: Optional[List[Dict]] = None,
    foreshadowing_items: Optional[List[Dict[str, Any]]] = None,
    *,
    default_planted_chapter: Optional[int] = None,
):
    """更新 state.json 中的实体记录（支持层级分类/金手指技能/伏笔结构化）"""

    def _to_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    with open(state_file, 'r', encoding='utf-8') as f:
        state = json.load(f)

    first_seen_chapter = _to_int(default_planted_chapter, 0)

    # 确保存在实体列表
    if 'entities' not in state:
        state['entities'] = {
            "characters": [],
            "locations": [],
            "items": [],
            "factions": [],
            "techniques": []
        }

    # 确保存在金手指技能列表
    if 'protagonist_state' not in state:
        state['protagonist_state'] = {}
    golden_finger = state['protagonist_state'].get('golden_finger')
    if not isinstance(golden_finger, dict):
        golden_finger = {}
        state['protagonist_state']['golden_finger'] = golden_finger
    golden_finger.setdefault("name", "")
    golden_finger.setdefault("level", 1)
    golden_finger.setdefault("cooldown", 0)
    golden_finger.setdefault("skills", [])

    for entity in entities:
        entity_type = entity['type']
        entity_tier = entity.get('tier', '支线')

        if entity_type == "角色":
            chars = state['entities']['characters']
            record = next((c for c in chars if c.get('name') == entity['name']), None)
            if record is None:
                record = {"name": entity['name']}
                chars.append(record)

            desc = entity['desc']
            record.setdefault("desc", desc)
            record.setdefault("description", desc)  # 兼容 structured_index
            record.setdefault("category", categorize_character(desc))
            record.setdefault("tier", entity_tier)
            record.setdefault("importance", "major" if entity_tier == "核心" else "minor")
            record.setdefault("first_appearance", entity.get('source_file', ''))
            if first_seen_chapter:
                record.setdefault("first_appearance_chapter", first_seen_chapter)
                record["last_appearance_chapter"] = max(_to_int(record.get("last_appearance_chapter"), 0), first_seen_chapter)
            record.setdefault("added_at", datetime.now().strftime('%Y-%m-%d'))

        elif entity_type == "地点":
            if entity['name'] not in [l.get('name') for l in state['entities']['locations']]:
                state['entities']['locations'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "description": entity['desc'],
                    "tier": entity_tier,
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

        elif entity_type == "物品":
            if entity['name'] not in [i.get('name') for i in state['entities']['items']]:
                state['entities']['items'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "description": entity['desc'],
                    "tier": entity_tier,
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

        elif entity_type == "势力":
            if entity['name'] not in [f.get('name') for f in state['entities']['factions']]:
                state['entities']['factions'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "description": entity['desc'],
                    "tier": entity_tier,
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

        elif entity_type == "招式":
            if entity['name'] not in [t.get('name') for t in state['entities']['techniques']]:
                state['entities']['techniques'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "description": entity['desc'],
                    "tier": entity_tier,
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

    # 更新金手指技能
    if golden_finger_skills:
        existing_skills = [s.get('name') for s in state['protagonist_state']['golden_finger'].get('skills', [])]
        for skill in golden_finger_skills:
            if skill['name'] not in existing_skills:
                state['protagonist_state']['golden_finger']['skills'].append({
                    "name": skill['name'],
                    "level": skill['level'],
                    "desc": skill['desc'],
                    "cooldown": skill['cooldown'],
                    "unlocked_at": skill.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })
                print(f"  ✨ 新增金手指技能: {skill['name']} ({skill['level']})")

    # 更新伏笔（结构化）
    if foreshadowing_items:
        state.setdefault("plot_threads", {"active_threads": [], "foreshadowing": []})
        state["plot_threads"].setdefault("foreshadowing", [])

        existing = state["plot_threads"]["foreshadowing"]

        for item in foreshadowing_items:
            content = str(item.get("content", "")).strip()
            if not content:
                continue

            planted = item.get("planted_chapter") or default_planted_chapter or 1
            try:
                planted = int(planted)
            except (TypeError, ValueError):
                planted = default_planted_chapter or 1

            target = item.get("target_chapter")
            if target is None:
                target = planted + 100
            try:
                target = int(target)
            except (TypeError, ValueError):
                target = planted + 100

            tier = str(item.get("tier", "支线")).strip() or "支线"
            if tier.lower() not in ENTITY_TIER_MAP:
                tier = "支线"

            location = str(item.get("location", "")).strip()
            characters = item.get("characters", [])
            if not isinstance(characters, list):
                characters = []

            found = None
            for old in existing:
                if old.get("content") == content:
                    found = old
                    break

            if found is None:
                existing.append({
                    "content": content,
                    "status": "未回收",
                    "tier": tier,
                    "planted_chapter": planted,
                    "target_chapter": target,
                    "location": location,
                    "characters": characters,
                    "added_at": datetime.now().strftime("%Y-%m-%d"),
                })
                print(f"  ?? 新增伏笔: {content[:30]}...")
            else:
                found["tier"] = tier
                found["planted_chapter"] = planted
                found["target_chapter"] = target
                if location:
                    found["location"] = location

                old_chars = found.get("characters", [])
                if not isinstance(old_chars, list):
                    old_chars = []
                merged = []
                seen = set()
                for n in [*old_chars, *characters]:
                    s = str(n).strip()
                    if not s or s in seen:
                        continue
                    merged.append(s)
                    seen.add(s)
                found["characters"] = merged

    # 备份旧文件
    backup_file = state_file.replace('.json', f'.backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')
    os.rename(state_file, backup_file)

    # 写入新文件
    with open(state_file, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    print(f"✅ 已备份旧状态文件到: {backup_file}")

def sync_entity_to_settings(entity: Dict, project_root: str, auto_mode: bool = False) -> bool:
    """
    将实体同步到设定集

    Returns:
        bool: 是否成功同步
    """
    entity_type = entity['type']
    entity_name = entity['name']

    if entity_type == "角色":
        category = categorize_character(entity['desc'])
        category_dir = ROLE_CATEGORY_MAP.get(category.split('/')[0], "次要角色")

        target_dir = Path(project_root) / f"设定集/角色库/{category_dir}"
        # ============================================================================
        # 安全修复：使用安全目录创建函数（文件权限修复）
        # ============================================================================
        create_secure_directory(str(target_dir))

        # ============================================================================
        # 安全修复：清理文件名，防止路径遍历 (CWE-22) - P0 CRITICAL
        # 原代码: target_file = target_dir / f"{entity_name}.md"
        # 漏洞: entity_name可能包含 "../" 导致目录遍历攻击
        # ============================================================================
        safe_entity_name = sanitize_filename(entity_name)
        target_file = target_dir / f"{safe_entity_name}.md"

        if target_file.exists():
            print(f"⚠️  角色卡已存在: {target_file}")
            if not auto_mode:
                choice = input("是否覆盖？(y/n): ")
                if choice.lower() != 'y':
                    return False

        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(generate_character_card(entity, category))

        print(f"✅ 已创建角色卡: {target_file}")
        return True

    elif entity_type == "地点":
        target_file = Path(project_root) / "设定集/世界观.md"
        update_world_view(entity, str(target_file), "地理")
        print(f"✅ 已更新世界观（地理）: {entity_name}")
        return True

    elif entity_type == "势力":
        target_file = Path(project_root) / "设定集/世界观.md"
        update_world_view(entity, str(target_file), "势力")
        print(f"✅ 已更新世界观（势力）: {entity_name}")
        return True

    elif entity_type == "招式":
        target_file = Path(project_root) / "设定集/力量体系.md"
        update_power_system(entity, str(target_file))
        print(f"✅ 已更新力量体系（招式）: {entity_name}")
        return True

    elif entity_type == "物品":
        target_dir = Path(project_root) / "设定集/物品库"
        # ============================================================================
        # 安全修复：使用安全目录创建函数（文件权限修复）
        # ============================================================================
        create_secure_directory(str(target_dir))

        # ============================================================================
        # 安全修复：清理文件名，防止路径遍历 (CWE-22) - P0 CRITICAL
        # 原代码: target_file = target_dir / f"{entity_name}.md"
        # 漏洞: entity_name可能包含 "../" 导致目录遍历攻击
        # ============================================================================
        safe_entity_name = sanitize_filename(entity_name)
        target_file = target_dir / f"{safe_entity_name}.md"

        if target_file.exists():
            print(f"⚠️  物品卡已存在: {target_file}")
            if not auto_mode:
                choice = input("是否覆盖？(y/n): ")
                if choice.lower() != 'y':
                    return False

        content = f"""# {entity_name}

> **首次登场**: {entity.get('source_file', '未知')}
> **创建时间**: {datetime.now().strftime('%Y-%m-%d')}

## 基本信息

{entity['desc']}

## 详细设定

待补充

## 相关剧情

- 【第 X 章】首次出现

## 备注

自动提取自 [NEW_ENTITY] 标签，请补充完善。
"""

        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(content)

        print(f"✅ 已创建物品卡: {target_file}")
        return True

    else:
        print(f"⚠️  未知实体类型: {entity_type}")
        return False

def main():
    parser = argparse.ArgumentParser(
        description="[NEW_ENTITY]/[GOLDEN_FINGER_SKILL]/FORESHADOWING_JSON 提取与同步",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 指定文件（兼容卷目录）
  python extract_entities.py "webnovel-project/正文/第1卷/第001章-死亡降临.md" --auto

  # 指定章节号（推荐）
  python extract_entities.py --project-root "webnovel-project" --chapter 1 --auto
""".strip(),
    )

    parser.add_argument("chapter_file", nargs="?", help="章节文件路径（或使用 --chapter）")
    parser.add_argument("--chapter", type=int, help="章节号（与 --project-root 配合，自动定位章节文件）")
    parser.add_argument("--project-root", default=None, help="项目根目录（包含 .webnovel/state.json）")
    parser.add_argument("--auto", action="store_true", help="自动模式（非交互）")
    parser.add_argument("--dry-run", action="store_true", help="仅预览，不写入文件/状态")

    args = parser.parse_args()

    auto_mode = args.auto
    dry_run = args.dry_run

    project_root: Optional[Path] = None
    if args.project_root:
        project_root = resolve_project_root(args.project_root)
    else:
        try:
            project_root = resolve_project_root()
        except FileNotFoundError:
            project_root = None

    chapter_file: Optional[str] = None
    chapter_num: Optional[int] = None

    if args.chapter is not None:
        if not project_root:
            print("❌ 未提供有效的 --project-root，无法用 --chapter 定位章节文件")
            sys.exit(1)

        chapter_num = int(args.chapter)
        chapter_path = find_chapter_file(project_root, chapter_num)
        if not chapter_path:
            print(f"❌ 未找到第{chapter_num}章文件（请先生成/保存章节）")
            sys.exit(1)
        chapter_file = str(chapter_path)
    else:
        if not args.chapter_file:
            parser.error("必须提供 chapter_file 或 --chapter")
        chapter_file = args.chapter_file
        if not os.path.exists(chapter_file):
            print(f"❌ 文件不存在: {chapter_file}")
            sys.exit(1)

        chapter_num = extract_chapter_num_from_filename(Path(chapter_file).name)

    print(f"📖 正在扫描: {chapter_file}")
    entities = extract_new_entities(chapter_file)
    golden_finger_skills = extract_golden_finger_skills(chapter_file)
    foreshadowing_items = extract_foreshadowing_json(chapter_file)

    if not entities and not golden_finger_skills and not foreshadowing_items:
        print("✅ 未发现 [NEW_ENTITY] / [GOLDEN_FINGER_SKILL] / [FORESHADOWING_JSON] 标签")
        return

    if entities:
        print(f"\n🔍 发现 {len(entities)} 个新实体：")
        for i, entity in enumerate(entities, 1):
            tier_emoji = {"核心": "🔴", "支线": "🟡", "装饰": "🟢"}.get(entity.get("tier", "支线"), "⚪")
            print(
                f"  {i}. [{entity['type']}] {entity['name']} {tier_emoji}{entity.get('tier', '支线')} - {entity['desc'][:25]}..."
            )

    if golden_finger_skills:
        print(f"\n✨ 发现 {len(golden_finger_skills)} 个金手指技能：")
        for i, skill in enumerate(golden_finger_skills, 1):
            print(f"  {i}. {skill['name']} ({skill['level']}) - {skill['desc'][:25]}...")

    if foreshadowing_items:
        print(f"\n🧩 发现 {len(foreshadowing_items)} 条伏笔：")
        for i, item in enumerate(foreshadowing_items, 1):
            tier = item.get("tier", "支线")
            target = item.get("target_chapter", "未设定")
            print(f"  {i}. {tier} → 目标Ch{target}: {str(item.get('content', ''))[:40]}...")

    if dry_run:
        print("\n⚠️  Dry-run 模式，不执行实际写入")
        return

    if not project_root:
        chapter_path = Path(chapter_file).resolve()
        for parent in [chapter_path.parent] + list(chapter_path.parents):
            if (parent / ".webnovel" / "state.json").exists():
                project_root = parent
                break

    if not project_root:
        print("❌ 找不到项目根目录（缺少 .webnovel/state.json）")
        print("请先运行 /webnovel-init 初始化项目，或使用 --project-root 指定路径")
        sys.exit(1)

    state_file = resolve_state_file(explicit_project_root=str(project_root))

    print("\n📝 开始同步到设定集...")
    success_count = 0
    for entity in entities:
        if sync_entity_to_settings(entity, str(project_root), auto_mode):
            success_count += 1

    print("\n💾 更新 state.json...")
    update_state_json(
        entities,
        str(state_file),
        golden_finger_skills,
        foreshadowing_items,
        default_planted_chapter=chapter_num,
    )

    print("\n✅ 完成！")
    print(f"  - 实体同步: {success_count}/{len(entities)} 个")
    if golden_finger_skills:
        print(f"  - 金手指技能: {len(golden_finger_skills)} 个")
    if foreshadowing_items:
        print(f"  - 伏笔同步: {len(foreshadowing_items)} 条")

    if not auto_mode:
        print("\n💡 建议:")
        print("  1. 检查生成的角色卡/物品卡，补充详细设定")
        print("  2. 查看 世界观.md 和 力量体系.md 的更新")
        print("  3. 确认 .webnovel/state.json 中的实体记录")
        if golden_finger_skills:
            print("  4. 检查金手指技能是否正确记录在 protagonist_state.golden_finger.skills")
        if foreshadowing_items:
            print("  5. 检查 plot_threads.foreshadowing 的 planted/target/tier/location/characters 是否合理")

if __name__ == "__main__":
    main()
