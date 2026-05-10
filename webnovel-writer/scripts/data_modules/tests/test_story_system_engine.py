#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import uuid
from pathlib import Path

import pytest

from data_modules.story_system_engine import StorySystemEngine, StorySystemRoutingError


def _write_csv(path, headers, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def _make_local_tmp_path() -> Path:
    base_dir = Path(__file__).resolve().parents[4] / ".tmp_story_system_engine"
    base_dir.mkdir(exist_ok=True)
    tmp_dir = base_dir / f"case_{uuid.uuid4().hex}"
    tmp_dir.mkdir()
    return tmp_dir


def test_story_system_routes_explicit_genre_and_collects_anti_patterns():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()

    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻退婚流|退婚打脸",
                "意图与同义词": "退婚流|废材逆袭",
                "适用题材": "玄幻",
                "大模型指令": "先给压抑，再给爆发兑现。",
                "核心摘要": "玄幻退婚流需要耻辱起手和强兑现。",
                "详细展开": "",
                "题材/流派": "玄幻退婚流",
                "canonical_genre": "玄幻",
                "题材别名": "退婚流|废材逆袭",
                "核心调性": "压抑蓄势后爆裂反击",
                "节奏策略": "前压后爆，三章内必须首个反打",
                "毒点": "打脸节奏不能缺最后一拍补刀|配角不能压过主角兑现",
                "推荐基础检索表": "命名规则|人设与关系|金手指与设定",
                "推荐动态检索表": "桥段套路|爽点与节奏|场景写法",
                "默认查询词": "退婚|打脸|废材逆袭",
            }
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
            }
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
            }
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
                "适用技能": "story-system",
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
                "冲突裁决": "爽点与节奏 > 桥段套路 > 场景写法",
                "contract注入层": "CHAPTER_BRIEF.writing_guidance",
                "反模式": "情绪标签化|角色行为无逻辑",
            }
        ],
    )

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="玄幻退婚流", genre=None, chapter=None)

    assert contract["master_setting"]["route"]["primary_genre"] == "玄幻退婚流"
    assert contract["master_setting"]["master_constraints"]["core_tone"] == "压抑蓄势后爆裂反击"
    assert "命名规则" in contract["master_setting"]["route"]["recommended_base_tables"]
    assert {
        item["text"] for item in contract["anti_patterns"]
    } >= {
        "打脸节奏不能缺最后一拍补刀",
        "主角还没反打就被配角替他出手",
        "打脸收尾太软，没有读者情绪补刀",
    }


def test_story_system_falls_back_to_explicit_genre():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()

    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-010",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "甜宠日常",
                "意图与同义词": "",
                "适用题材": "现言",
                "大模型指令": "",
                "核心摘要": "",
                "详细展开": "",
                "题材/流派": "现言",
                "canonical_genre": "现言",
                "题材别名": "",
                "核心调性": "",
                "节奏策略": "",
                "毒点": "",
                "推荐基础检索表": "命名规则|人设与关系",
                "推荐动态检索表": "桥段套路|爽点与节奏|场景写法",
                "默认查询词": "",
            }
        ],
    )

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="压抑一点，后面爆", genre="现言", chapter=None)

    assert contract["master_setting"]["route"]["primary_genre"] == "现言"
    assert contract["master_setting"]["route"]["route_source"] == "explicit_genre_fallback"
    assert contract["master_setting"]["route"]["recommended_dynamic_tables"] == ["桥段套路", "爽点与节奏", "场景写法"]


def test_story_system_unmatched_genre_raises_routing_error():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()

    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻退婚流|退婚打脸",
                "意图与同义词": "退婚流|废材逆袭",
                "适用题材": "玄幻",
                "大模型指令": "",
                "核心摘要": "",
                "详细展开": "",
                "题材/流派": "玄幻退婚流",
                "canonical_genre": "玄幻",
                "题材别名": "退婚流",
                "核心调性": "",
                "节奏策略": "",
                "毒点": "",
                "推荐基础检索表": "命名规则",
                "推荐动态检索表": "桥段套路",
                "默认查询词": "",
            }
        ],
    )

    engine = StorySystemEngine(csv_dir=csv_dir)

    with pytest.raises(StorySystemRoutingError) as exc:
        engine.build(query="赛博厨神", genre="赛博厨神", chapter=None)

    message = str(exc.value)
    assert "赛博厨神" in message
    assert "未命中任何路由行" in message
    assert "玄幻退婚流" not in message


def test_story_system_routes_chinese_rules_mystery_to_canonical_suspense():
    csv_dir = Path(__file__).resolve().parents[3] / "references" / "csv"

    contract = StorySystemEngine(csv_dir=csv_dir).build(
        query="规则怪谈",
        genre="规则怪谈",
        chapter=None,
    )

    route = contract["master_setting"]["route"]
    assert route["canonical_genre"] == "悬疑"
    assert route["genre_filter"] == "悬疑"
    assert route["route_source"] != "default_seed_fallback"


def test_story_system_rejects_english_explicit_genre_even_when_query_routes():
    csv_dir = Path(__file__).resolve().parents[3] / "references" / "csv"

    for query in ("rules-mystery", "规则怪谈"):
        with pytest.raises(StorySystemRoutingError) as exc:
            StorySystemEngine(csv_dir=csv_dir).build(
                query=query,
                genre="rules-mystery",
                chapter=None,
            )

        message = str(exc.value)
        assert "rules-mystery" in message
        assert "规则怪谈" in message
        assert "不会生成 .story-system contracts" in message


def test_route_output_includes_canonical_genre():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()

    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻退婚流|退婚打脸",
                "意图与同义词": "退婚流|废材逆袭",
                "适用题材": "玄幻|仙侠",
                "大模型指令": "先给压抑，再给爆发兑现。",
                "核心摘要": "玄幻退婚流需要耻辱起手和强兑现。",
                "详细展开": "",
                "题材/流派": "玄幻退婚流",
                "canonical_genre": "玄幻",
                "题材别名": "退婚流|废材逆袭",
                "核心调性": "压抑蓄势后爆裂反击",
                "节奏策略": "前压后爆，三章内必须首个反打",
                "毒点": "",
                "推荐基础检索表": "命名规则|人设与关系|金手指与设定",
                "推荐动态检索表": "桥段套路|爽点与节奏|场景写法",
                "默认查询词": "退婚|打脸|废材逆袭",
            }
        ],
    )

    engine = StorySystemEngine(csv_dir=csv_dir)
    route = engine._route("退婚流 三年之约", "玄幻")

    assert route["meta"]["canonical_genre"] == "玄幻"
    assert route["meta"]["genre_filter"] == "玄幻"
    assert route["genre_filter"] == "玄幻"


def test_route_infers_canonical_genre_from_spaced_query():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()

    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻退婚流|退婚流",
                "意图与同义词": "",
                "适用题材": "玄幻",
                "大模型指令": "",
                "核心摘要": "",
                "详细展开": "",
                "题材/流派": "玄幻退婚流",
                "canonical_genre": "玄幻",
                "题材别名": "退婚流",
                "核心调性": "先压后爆",
                "节奏策略": "",
                "毒点": "",
                "推荐基础检索表": "命名规则",
                "推荐动态检索表": "桥段套路",
                "默认查询词": "",
            },
            {
                "编号": "GR-025",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "快穿任务|攻略系统",
                "意图与同义词": "",
                "适用题材": "快穿",
                "大模型指令": "",
                "核心摘要": "",
                "详细展开": "",
                "题材/流派": "快穿任务",
                "canonical_genre": "快穿",
                "题材别名": "小世界|穿梭任务",
                "核心调性": "任务驱动",
                "节奏策略": "",
                "毒点": "",
                "推荐基础检索表": "人设与关系",
                "推荐动态检索表": "桥段套路",
                "默认查询词": "",
            },
        ],
    )

    engine = StorySystemEngine(csv_dir=csv_dir)
    route = engine._route("快穿 任务 原主", None)

    assert route["meta"]["primary_genre"] == "快穿任务"
    assert route["meta"]["canonical_genre"] == "快穿"
    assert route["meta"]["route_source"] == "inferred_genre_fallback"


def test_build_uses_canonical_genre_for_reasoning_lookup():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()

    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001",
                "适用技能": "story-system",
                "分类": "题材路由",
                "层级": "知识补充",
                "关键词": "玄幻退婚流|退婚打脸",
                "意图与同义词": "退婚流|废材逆袭",
                "适用题材": "玄幻|仙侠",
                "大模型指令": "先给压抑，再给爆发兑现。",
                "核心摘要": "玄幻退婚流需要耻辱起手和强兑现。",
                "详细展开": "",
                "题材/流派": "玄幻退婚流",
                "canonical_genre": "玄幻",
                "题材别名": "退婚流|废材逆袭",
                "核心调性": "压抑蓄势后爆裂反击",
                "节奏策略": "前压后爆，三章内必须首个反打",
                "毒点": "",
                "推荐基础检索表": "命名规则",
                "推荐动态检索表": "桥段套路|爽点与节奏",
                "默认查询词": "退婚|打脸|废材逆袭",
            }
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
                "适用技能": "story-system",
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
                "冲突裁决": "桥段套路 > 爽点与节奏",
                "contract注入层": "CHAPTER_BRIEF.writing_guidance",
                "反模式": "情绪标签化|角色行为无逻辑",
            }
        ],
    )

    _write_csv(
        csv_dir / "命名规则.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "命名对象", "毒点"],
        [
            {
                "编号": "NR-001",
                "适用技能": "write",
                "分类": "角色",
                "层级": "知识补充",
                "关键词": "玄幻|人名",
                "适用题材": "玄幻",
                "核心摘要": "玄幻人名要保留修仙意象。",
                "命名对象": "角色人名",
                "毒点": "",
            }
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
            }
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
            }
        ],
    )

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="退婚流 三年之约", genre=None, chapter=1)

    assert contract["master_setting"]["route"]["canonical_genre"] == "玄幻"
    assert contract["chapter_brief"]["reasoning"]["genre"] == "玄幻"


def test_chapter_focus_uses_directive_goal_not_dynamic_summary():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()
    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001", "适用技能": "story-system", "分类": "题材路由", "层级": "知识补充",
                "关键词": "仙侠", "意图与同义词": "", "适用题材": "仙侠", "大模型指令": "",
                "核心摘要": "", "详细展开": "", "题材/流派": "仙侠", "canonical_genre": "仙侠",
                "题材别名": "", "核心调性": "", "节奏策略": "", "毒点": "",
                "推荐基础检索表": "", "推荐动态检索表": "场景写法", "默认查询词": "",
            }
        ],
    )
    _write_csv(
        csv_dir / "场景写法.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "毒点"],
        [
            {
                "编号": "SP-087", "适用技能": "write", "分类": "场景", "层级": "知识补充",
                "关键词": "论道", "适用题材": "仙侠", "核心摘要": "文斗场面的张力来自观点击中修行根基。",
                "毒点": "",
            }
        ],
    )

    contract = StorySystemEngine(csv_dir).build(
        query="仙侠",
        genre="仙侠",
        chapter=2,
        chapter_directive={"goal": "井边对话收集借贷情报"},
    )

    brief = contract["chapter_brief"]
    assert brief["chapter_directive"]["goal"] == "井边对话收集借贷情报"
    assert brief["override_allowed"]["chapter_focus"] == "井边对话收集借贷情报"


def test_chapter_focus_never_taken_from_dynamic_context_summary_for_placeholder_query():
    engine = StorySystemEngine(_make_local_tmp_path())
    focus = engine._suggest_chapter_focus("{章纲目标}", {})

    assert focus == ""


def test_story_system_reference_matching_prefers_chapter_keywords_with_same_priority():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()
    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001", "适用技能": "story-system", "分类": "题材路由", "层级": "知识补充",
                "关键词": "仙侠", "意图与同义词": "", "适用题材": "仙侠", "大模型指令": "",
                "核心摘要": "", "详细展开": "", "题材/流派": "仙侠", "canonical_genre": "仙侠",
                "题材别名": "", "核心调性": "", "节奏策略": "", "毒点": "",
                "推荐基础检索表": "", "推荐动态检索表": "场景写法", "默认查询词": "宗门",
            }
        ],
    )
    _write_csv(
        csv_dir / "场景写法.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "适用场景", "核心摘要", "毒点"],
        [
            {
                "编号": "SP-001", "适用技能": "write", "分类": "场景", "层级": "知识补充",
                "关键词": "宗门|论道", "适用题材": "仙侠", "适用场景": "论道",
                "核心摘要": "宗门论道要写观点交锋。", "毒点": "",
            },
            {
                "编号": "FIN-001", "适用技能": "write", "分类": "场景", "层级": "知识补充",
                "关键词": "借据|利息|复利|债", "适用题材": "仙侠", "适用场景": "借贷调查",
                "核心摘要": "借贷场景要写清条款陷阱。", "毒点": "",
            },
        ],
    )

    contract = StorySystemEngine(csv_dir).build(
        query="看穿借据条款的荒谬",
        genre="仙侠",
        chapter=1,
        chapter_directive={"goal": "看穿借据条款的荒谬", "key_entities": ["借据", "利息", "复利"]},
    )

    selected = contract["chapter_brief"]["dynamic_context"]
    assert selected[0]["编号"] == "FIN-001"


def test_story_system_reference_matching_combines_priority_and_chapter_keywords():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()
    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-001", "适用技能": "story-system", "分类": "题材路由", "层级": "知识补充",
                "关键词": "仙侠", "意图与同义词": "", "适用题材": "仙侠", "大模型指令": "",
                "核心摘要": "", "详细展开": "", "题材/流派": "仙侠", "canonical_genre": "仙侠",
                "题材别名": "", "核心调性": "", "节奏策略": "", "毒点": "",
                "推荐基础检索表": "", "推荐动态检索表": "桥段套路|场景写法", "默认查询词": "宗门",
            }
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
                "编号": "RS-001", "适用技能": "story-system", "分类": "裁决", "层级": "推理层",
                "关键词": "仙侠", "意图与同义词": "", "适用题材": "仙侠", "大模型指令": "",
                "核心摘要": "", "详细展开": "", "题材": "仙侠", "风格优先级": "",
                "爽点优先级": "", "节奏默认策略": "", "毒点权重": "",
                "冲突裁决": "桥段套路 > 场景写法", "contract注入层": "CHAPTER_BRIEF", "反模式": "",
            }
        ],
    )
    _write_csv(
        csv_dir / "桥段套路.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "桥段名称", "毒点"],
        [
            {
                "编号": "TR-001", "适用技能": "write", "分类": "桥段", "层级": "知识补充",
                "关键词": "宗门|论道", "适用题材": "仙侠", "核心摘要": "宗门论道冲突。",
                "桥段名称": "论道", "毒点": "",
            }
        ],
    )
    _write_csv(
        csv_dir / "场景写法.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "适用场景", "核心摘要", "毒点"],
        [
            {
                "编号": "FIN-001", "适用技能": "write", "分类": "场景", "层级": "知识补充",
                "关键词": "借据|利息|复利|债", "适用题材": "仙侠", "适用场景": "借贷调查",
                "核心摘要": "借贷场景要写清条款陷阱。", "毒点": "",
            }
        ],
    )

    contract = StorySystemEngine(csv_dir).build(
        query="看穿借据条款的荒谬",
        genre="仙侠",
        chapter=1,
        chapter_directive={"goal": "看穿借据条款的荒谬", "key_entities": ["借据", "利息", "复利"]},
    )

    selected = contract["chapter_brief"]["dynamic_context"]
    assert [row["编号"] for row in selected[:2]] == ["FIN-001", "TR-001"]
    trace_by_id = {row["id"]: row for row in contract["chapter_brief"]["source_trace"]}
    assert trace_by_id["FIN-001"]["combined_rank_score"] > trace_by_id["TR-001"]["combined_rank_score"]


def test_story_system_composite_platform_genre_filters_dynamic_context():
    csv_dir = _make_local_tmp_path() / "csv"
    csv_dir.mkdir()
    _write_csv(
        csv_dir / "题材与调性推理.csv",
        [
            "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
            "大模型指令", "核心摘要", "详细展开", "题材/流派", "canonical_genre", "题材别名", "核心调性",
            "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
        ],
        [
            {
                "编号": "GR-CITY", "适用技能": "story-system", "分类": "题材路由", "层级": "知识补充",
                "关键词": "", "意图与同义词": "", "适用题材": "都市", "大模型指令": "",
                "核心摘要": "", "详细展开": "", "题材/流派": "都市脑洞", "canonical_genre": "都市",
                "题材别名": "", "核心调性": "", "节奏策略": "", "毒点": "",
                "推荐基础检索表": "", "推荐动态检索表": "场景写法", "默认查询词": "",
            }
        ],
    )
    _write_csv(
        csv_dir / "场景写法.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "适用场景", "核心摘要", "毒点"],
        [
            {
                "编号": "FOOD-001", "适用技能": "write", "分类": "场景", "层级": "知识补充",
                "关键词": "美食|店铺", "适用题材": "都市", "适用场景": "深夜食堂",
                "核心摘要": "都市美食场景要写烟火气。", "毒点": "",
            },
            {
                "编号": "ELIXIR-001", "适用技能": "write", "分类": "场景", "层级": "知识补充",
                "关键词": "美食|丹药", "适用题材": "仙侠", "适用场景": "炼丹",
                "核心摘要": "仙侠炼丹场景强调灵材。", "毒点": "",
            },
        ],
    )

    contract = StorySystemEngine(csv_dir).build(
        query="美食 店铺",
        genre="都市脑洞,美食,甜宠",
        chapter=1,
    )

    route = contract["master_setting"]["route"]
    assert route["canonical_genre"] == "都市"
    assert route["route_source"] == "explicit_genre_fallback"
    selected_ids = [row["编号"] for row in contract["chapter_brief"]["dynamic_context"]]
    assert selected_ids == ["FOOD-001"]
