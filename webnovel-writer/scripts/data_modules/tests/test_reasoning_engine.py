#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv

from data_modules.story_system_engine import StorySystemEngine


def _write_csv(path, headers, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def _setup_csvs(csv_dir):
    """Create fixture CSVs for 题材与调性推理, 裁决规则, 桥段套路, 爽点与节奏."""
    csv_dir.mkdir(exist_ok=True)

    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "write|plan",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻|退婚",
                "意图与同义词": "玄幻怎么写",
                "适用题材": "玄幻",
                "大模型指令": "先给压抑，再给爆发兑现。",
                "核心摘要": "玄幻退婚流需要耻辱起手和强兑现。",
                "详细展开": "",
                "题材/流派": "玄幻",
                "题材别名": "退婚流",
                "核心调性": "压抑蓄势后爆裂反击",
                "节奏策略": "前压后爆",
                "毒点": "打脸节奏不能缺最后一拍补刀",
                "推荐基础检索表": "命名规则|人设与关系",
                "推荐动态检索表": "桥段套路|爽点与节奏",
                "默认查询词": "退婚|打脸",
            },
            {
                "编号": "GR-002",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "末日|末日求生",
                "意图与同义词": "末世求生",
                "适用题材": "科幻",
                "大模型指令": "",
                "核心摘要": "末日求生需要资源压力和秩序崩塌。",
                "详细展开": "",
                "题材/流派": "末日求生",
                "题材别名": "末世",
                "核心调性": "资源压力下的秩序重建",
                "节奏策略": "先生存后扩张",
                "毒点": "",
                "推荐基础检索表": "命名规则|人设与关系",
                "推荐动态检索表": "桥段套路|爽点与节奏",
                "默认查询词": "末日|生存",
            },
        ],
    )

    _write_csv(
        csv_dir / "裁决规则.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材", "风格优先级", "爽点优先级",
            "节奏默认策略", "毒点权重", "冲突裁决", "contract注入层", "反模式",
        ],
        [
            {
                "编号": "RS-001",
                "适用技能": "write|plan",
                "分类": "裁决",
                "层级": "推理层",
                "关键词": "玄幻",
                "意图与同义词": "玄幻怎么写",
                "适用题材": "玄幻",
                "大模型指令": "按冲突裁决排序命中条目",
                "核心摘要": "玄幻裁决规则",
                "详细展开": "",
                "题材": "玄幻",
                "风格优先级": "热血冲突 > 冷硬算计",
                "爽点优先级": "实力碾压 > 逆境翻盘",
                "节奏默认策略": "快推慢收",
                "毒点权重": "圣母病 > 情绪标签化 > 逻辑断裂",
                "冲突裁决": "爽点与节奏 > 桥段套路 > 写作技法",
                "contract注入层": "CHAPTER_BRIEF.writing_guidance",
                "反模式": "情绪标签化|角色行为无逻辑",
            },
        ],
    )

    _write_csv(
        csv_dir / "桥段套路.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "桥段名称", "毒点"],
        [
            {
                "编号": "TR-001",
                "适用技能": "write",
                "分类": "桥段",
                "层级": "知识补充",
                "关键词": "退婚|打脸",
                "适用题材": "玄幻",
                "核心摘要": "退婚现场要给足羞辱和反击空间",
                "桥段名称": "退婚反击",
                "毒点": "主角还没反打就被配角替他出手",
            },
        ],
    )

    _write_csv(
        csv_dir / "爽点与节奏.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "毒点", "节奏类型"],
        [
            {
                "编号": "PA-001",
                "适用技能": "write",
                "分类": "节奏",
                "层级": "知识补充",
                "关键词": "打脸|兑现",
                "适用题材": "玄幻",
                "核心摘要": "兑现必须补刀",
                "毒点": "打脸收尾太软，没有读者情绪补刀",
                "节奏类型": "爆发期",
            },
        ],
    )


def test_build_with_reasoning_includes_reasoning_rule_in_source_trace(tmp_path):
    csv_dir = tmp_path / "csv"
    _setup_csvs(csv_dir)

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="玄幻", genre=None, chapter=1)

    source_trace = contract["master_setting"]["source_trace"]
    reasoning_entries = [e for e in source_trace if e.get("reasoning_rule") == "玄幻"]
    assert len(reasoning_entries) > 0, f"Expected reasoning_rule='玄幻' in source_trace, got {source_trace}"
    assert reasoning_entries[0]["inject_target"] == "CHAPTER_BRIEF.writing_guidance"


def test_reasoning_anti_patterns_sorted_by_weight(tmp_path):
    csv_dir = tmp_path / "csv"
    _setup_csvs(csv_dir)

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="玄幻", genre=None, chapter=None)

    anti_patterns = contract["anti_patterns"]
    assert len(anti_patterns) > 0, "Expected non-empty anti_patterns"

    # Check that reasoning 反模式 entries are present
    texts = [a["text"] for a in anti_patterns]
    assert "情绪标签化" in texts or "角色行为无逻辑" in texts, (
        f"Expected reasoning 反模式 in anti_patterns, got {texts}"
    )


def test_reasoning_not_found_falls_back_gracefully(tmp_path):
    csv_dir = tmp_path / "csv"
    _setup_csvs(csv_dir)

    engine = StorySystemEngine(csv_dir=csv_dir)
    # 末日 has no matching row in 裁决规则.csv fixture
    contract = engine.build(query="末日求生", genre="末日", chapter=None)

    assert contract["master_setting"] is not None
    assert contract["anti_patterns"] is not None
    # Should still produce a valid contract without errors
    assert contract["meta"]["explicit_genre"] == "末日"
