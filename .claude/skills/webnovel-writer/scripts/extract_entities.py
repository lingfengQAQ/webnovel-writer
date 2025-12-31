#!/usr/bin/env python3
"""
[NEW_ENTITY] 标签提取与同步脚本

功能：
1. 扫描指定章节正文，提取所有 [NEW_ENTITY] 标签
2. 解析实体类型（角色/地点/物品/势力/招式）
3. 同步到设定集对应文件
4. 更新 state.json 中的相关记录
5. 支持自动化模式和交互式模式

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
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Tuple

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

def extract_new_entities(file_path: str) -> List[Dict]:
    """
    从章节文件中提取所有 [NEW_ENTITY] 标签

    标签格式：
      [NEW_ENTITY: 角色, 李雪, 天云宗外门弟子，主角的青梅竹马]
      [NEW_ENTITY: 地点, 血煞秘境, 危险的试炼之地，内有金丹期凶兽]
      [NEW_ENTITY: 物品, 天雷果, 可提升雷属性修炼速度的灵果]

    Returns:
        List[Dict]: [{"type": "角色", "name": "李雪", "desc": "...", "line": 123}, ...]
    """
    entities = []

    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            # 匹配 [NEW_ENTITY: 类型, 名称, 描述]
            # 支持全角逗号（，）和半角逗号（,）混用
            matches = re.findall(
                r'\[NEW_ENTITY:\s*([^,，]+)[,，]\s*([^,，]+)[,，]\s*([^\]]+)\]',
                line
            )

            for match in matches:
                entity_type = match[0].strip()
                entity_name = match[1].strip()
                entity_desc = match[2].strip()

                entities.append({
                    "type": entity_type,
                    "name": entity_name,
                    "desc": entity_desc,
                    "line": line_num,
                    "source_file": file_path
                })

    return entities

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

def update_state_json(entities: List[Dict], state_file: str):
    """更新 state.json 中的实体记录"""
    with open(state_file, 'r', encoding='utf-8') as f:
        state = json.load(f)

    # 确保存在实体列表
    if 'entities' not in state:
        state['entities'] = {
            "characters": [],
            "locations": [],
            "items": [],
            "factions": [],
            "techniques": []
        }

    for entity in entities:
        entity_type = entity['type']

        if entity_type == "角色":
            if entity['name'] not in [c.get('name') for c in state['entities']['characters']]:
                state['entities']['characters'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "category": categorize_character(entity['desc']),
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

        elif entity_type == "地点":
            if entity['name'] not in [l.get('name') for l in state['entities']['locations']]:
                state['entities']['locations'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

        elif entity_type == "物品":
            if entity['name'] not in [i.get('name') for i in state['entities']['items']]:
                state['entities']['items'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

        elif entity_type == "势力":
            if entity['name'] not in [f.get('name') for f in state['entities']['factions']]:
                state['entities']['factions'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

        elif entity_type == "招式":
            if entity['name'] not in [t.get('name') for t in state['entities']['techniques']]:
                state['entities']['techniques'].append({
                    "name": entity['name'],
                    "desc": entity['desc'],
                    "first_appearance": entity.get('source_file', ''),
                    "added_at": datetime.now().strftime('%Y-%m-%d')
                })

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
        target_dir.mkdir(parents=True, exist_ok=True)

        target_file = target_dir / f"{entity_name}.md"

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
        target_dir.mkdir(parents=True, exist_ok=True)

        target_file = target_dir / f"{entity_name}.md"

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
    if len(sys.argv) < 2:
        print("用法: python extract_entities.py <章节文件> [--auto] [--dry-run]")
        print("示例: python extract_entities.py ../../../正文/第0001章.md")
        sys.exit(1)

    chapter_file = sys.argv[1]
    auto_mode = '--auto' in sys.argv
    dry_run = '--dry-run' in sys.argv

    if not os.path.exists(chapter_file):
        print(f"❌ 文件不存在: {chapter_file}")
        sys.exit(1)

    # 提取实体
    print(f"📖 正在扫描: {chapter_file}")
    entities = extract_new_entities(chapter_file)

    if not entities:
        print("✅ 未发现 [NEW_ENTITY] 标签")
        return

    print(f"\n🔍 发现 {len(entities)} 个新实体：")
    for i, entity in enumerate(entities, 1):
        print(f"  {i}. [{entity['type']}] {entity['name']} - {entity['desc'][:30]}...")

    if dry_run:
        print("\n⚠️  Dry-run 模式，不执行实际写入")
        return

    # 确定项目根目录
    project_root = Path(chapter_file).parent.parent
    state_file = project_root / ".webnovel/state.json"

    if not state_file.exists():
        print(f"❌ 状态文件不存在: {state_file}")
        print("请先运行 /webnovel-init 初始化项目")
        sys.exit(1)

    # 同步实体到设定集
    print(f"\n📝 开始同步到设定集...")
    success_count = 0

    for entity in entities:
        if sync_entity_to_settings(entity, str(project_root), auto_mode):
            success_count += 1

    # 更新 state.json
    print(f"\n💾 更新 state.json...")
    update_state_json(entities, str(state_file))

    print(f"\n✅ 完成！成功同步 {success_count}/{len(entities)} 个实体")

    if not auto_mode:
        print("\n💡 建议:")
        print("  1. 检查生成的角色卡/物品卡，补充详细设定")
        print("  2. 查看 世界观.md 和 力量体系.md 的更新")
        print("  3. 确认 .webnovel/state.json 中的实体记录")

if __name__ == "__main__":
    main()
