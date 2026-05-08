"""
生成仿真数据并启动 Dashboard，用于视觉验收。

用法:
    python -m data_modules.tests.mock_demo
    然后浏览器打开 http://localhost:8765
"""

from __future__ import annotations

import json
import math
import random
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

TOTAL_CHAPTERS = 120
TOTAL_VOLUMES = 4
VOLUME_RANGES = [
    (1, 1, 30),
    (2, 31, 60),
    (3, 61, 90),
    (4, 91, 120),
]

STRANDS = ["quest", "fire", "constellation"]
HOOK_STRENGTHS = ["weak", "medium", "strong"]
LOCATIONS = [
    "青元宗", "青元秘境", "东海仙城", "黑市", "天魔教总坛",
    "龙脉洞府", "太虚殿", "凤鸣谷", "剑冢", "星河幻境",
    "白骨荒原", "紫霄山", "碧落天池", "幽冥渡口", "九天雷域",
]
CHARACTERS = [
    "lintian", "fenglinger", "laodaoshi", "baiyujing", "heishifanzi",
    "jianling", "tianyao", "zixiao", "qingyun", "mozu",
]
CHARACTER_NAMES = {
    "lintian": "林长青",
    "fenglinger": "凤灵儿",
    "laodaoshi": "老道士",
    "baiyujing": "白玉京",
    "heishifanzi": "黑市掮客",
    "jianling": "剑灵",
    "tianyao": "天妖",
    "zixiao": "紫霄真人",
    "qingyun": "青云",
    "mozu": "魔祖残念",
}

FORESHADOWING = [
    {"content": "青元秘境的钥匙碎片下落", "status": "未回收", "tier": "核心", "planted_chapter": 15, "target_chapter": 45},
    {"content": "凤灵儿真实身份暗示", "status": "未回收", "tier": "核心", "planted_chapter": 28, "target_chapter": 80},
    {"content": "老道士临终遗言中的数字", "status": "未回收", "tier": "核心", "planted_chapter": 42, "target_chapter": 100},
    {"content": "黑市拍卖会幕后势力", "status": "未回收", "tier": "支线", "planted_chapter": 55, "target_chapter": 90},
    {"content": "主角功法异变的真实原因", "status": "未回收", "tier": "核心", "planted_chapter": 65, "target_chapter": 130},
    {"content": "天魔血脉觉醒征兆", "status": "未回收", "tier": "支线", "planted_chapter": 70, "target_chapter": 140},
    {"content": "仙城禁地秘密", "status": "未回收", "tier": "支线", "planted_chapter": 38, "target_chapter": 110},
    {"content": "师门灭门线索", "status": "已回收", "tier": "核心", "planted_chapter": 3, "target_chapter": 50, "resolved_chapter": 48},
    {"content": "初代掌门遗物功用", "status": "已回收", "tier": "支线", "planted_chapter": 10, "target_chapter": 40, "resolved_chapter": 38},
    {"content": "龙脉封印来历", "status": "已回收", "tier": "装饰", "planted_chapter": 25, "target_chapter": 60, "resolved_chapter": 58},
    {"content": "剑冢守灵人身份", "status": "已回收", "tier": "支线", "planted_chapter": 50, "target_chapter": 85, "resolved_chapter": 82},
    {"content": "紫霄山禁术", "status": "未回收", "tier": "装饰", "planted_chapter": 78, "target_chapter": 150},
    {"content": "碧落天池的水源秘密", "status": "未回收", "tier": "装饰", "planted_chapter": 90, "target_chapter": 160},
    {"content": "魔祖残念的苏醒条件", "status": "未回收", "tier": "核心", "planted_chapter": 95, "target_chapter": 180},
    {"content": "九天雷域的上古阵法", "status": "未回收", "tier": "支线", "planted_chapter": 105, "target_chapter": 170},
]

ENTITIES = [
    {"id": "lintian", "canonical_name": "林长青", "type": "角色", "tier": "S", "is_protagonist": True, "first_appearance": 1, "last_appearance": 120, "desc": "太虚宗弟子，身负天魔血脉，修炼无极真经。"},
    {"id": "fenglinger", "canonical_name": "凤灵儿", "type": "角色", "tier": "S", "is_protagonist": False, "first_appearance": 8, "last_appearance": 118, "desc": "林长青师妹，真实身份成谜。"},
    {"id": "laodaoshi", "canonical_name": "老道士", "type": "角色", "tier": "A", "is_protagonist": False, "first_appearance": 1, "last_appearance": 42, "desc": "林长青之师，太虚宗前长老，临终留下数字谜题。"},
    {"id": "baiyujing", "canonical_name": "白玉京", "type": "角色", "tier": "A", "is_protagonist": False, "first_appearance": 20, "last_appearance": 115, "desc": "天魔教少主，林长青宿敌。"},
    {"id": "heishifanzi", "canonical_name": "黑市掮客", "type": "角色", "tier": "B", "is_protagonist": False, "first_appearance": 50, "last_appearance": 110, "desc": "黑市情报贩子，立场模糊。"},
    {"id": "jianling", "canonical_name": "剑灵", "type": "角色", "tier": "A", "is_protagonist": False, "first_appearance": 75, "last_appearance": 120, "desc": "初代掌门遗物中的剑灵意识。"},
    {"id": "tianyao", "canonical_name": "天妖", "type": "角色", "tier": "B", "is_protagonist": False, "first_appearance": 35, "last_appearance": 95, "desc": "天魔教护法，实力深不可测。"},
    {"id": "zixiao", "canonical_name": "紫霄真人", "type": "角色", "tier": "A", "is_protagonist": False, "first_appearance": 60, "last_appearance": 120, "desc": "太虚宗掌门，暗中布局百年。"},
    {"id": "qingyun", "canonical_name": "青云", "type": "角色", "tier": "B", "is_protagonist": False, "first_appearance": 15, "last_appearance": 100, "desc": "林长青同门师兄，嫉妒心重。"},
    {"id": "mozu", "canonical_name": "魔祖残念", "type": "角色", "tier": "S", "is_protagonist": False, "first_appearance": 95, "last_appearance": 120, "desc": "上古魔祖残留意志，沉睡于龙脉封印之下。"},
    {"id": "taixuzong", "canonical_name": "太虚宗", "type": "势力", "tier": "S", "is_protagonist": False, "first_appearance": 1, "last_appearance": 120, "desc": "东荒第一仙门。"},
    {"id": "tianmojiao", "canonical_name": "天魔教", "type": "势力", "tier": "A", "is_protagonist": False, "first_appearance": 20, "last_appearance": 120, "desc": "魔道第一势力。"},
    {"id": "donghaixiancheng", "canonical_name": "东海仙城", "type": "势力", "tier": "B", "is_protagonist": False, "first_appearance": 40, "last_appearance": 110, "desc": "散修联盟据点。"},
    {"id": "qingyuanmianjing", "canonical_name": "青元秘境", "type": "地点", "tier": "A", "is_protagonist": False, "first_appearance": 15, "last_appearance": 90, "desc": "太虚宗管辖的上古秘境。"},
    {"id": "longmaidonfu", "canonical_name": "龙脉洞府", "type": "地点", "tier": "B", "is_protagonist": False, "first_appearance": 55, "last_appearance": 120, "desc": "封印魔祖残念之地。"},
]

RELATIONSHIPS = [
    {"from_entity": "lintian", "to_entity": "laodaoshi", "type": "师徒", "chapter": 1, "description": "师徒"},
    {"from_entity": "lintian", "to_entity": "taixuzong", "type": "归属", "chapter": 3, "description": "入门弟子"},
    {"from_entity": "lintian", "to_entity": "fenglinger", "type": "同门", "chapter": 8, "description": "同门师兄妹"},
    {"from_entity": "lintian", "to_entity": "qingyun", "type": "同门", "chapter": 15, "description": "同门师兄弟"},
    {"from_entity": "baiyujing", "to_entity": "tianmojiao", "type": "归属", "chapter": 20, "description": "少主"},
    {"from_entity": "lintian", "to_entity": "baiyujing", "type": "敌对", "chapter": 25, "description": "初次交手"},
    {"from_entity": "taixuzong", "to_entity": "tianmojiao", "type": "敌对", "chapter": 30, "description": "世代仇敌"},
    {"from_entity": "tianyao", "to_entity": "tianmojiao", "type": "归属", "chapter": 35, "description": "护法"},
    {"from_entity": "laodaoshi", "to_entity": "donghaixiancheng", "type": "隐居", "chapter": 40, "description": "隐居"},
    {"from_entity": "heishifanzi", "to_entity": "tianmojiao", "type": "线人", "chapter": 55, "description": "暗中合作"},
    {"from_entity": "lintian", "to_entity": "longmaidonfu", "type": "发现", "chapter": 60, "description": "发现龙脉"},
    {"from_entity": "zixiao", "to_entity": "taixuzong", "type": "归属", "chapter": 60, "description": "掌门"},
    {"from_entity": "lintian", "to_entity": "jianling", "type": "契约", "chapter": 75, "description": "缔结剑灵契约"},
    {"from_entity": "jianling", "to_entity": "longmaidonfu", "type": "封印", "chapter": 80, "description": "封印守护"},
    {"from_entity": "mozu", "to_entity": "longmaidonfu", "type": "封印", "chapter": 95, "description": "沉睡于此"},
    {"from_entity": "lintian", "to_entity": "mozu", "type": "对峙", "chapter": 100, "description": "初次感知"},
]

RELATIONSHIP_EVENTS = [
    {"from_entity": "lintian", "to_entity": "fenglinger", "chapter": 45, "event_type": "升温", "description": "秘境同生共死"},
    {"from_entity": "lintian", "to_entity": "baiyujing", "chapter": 60, "event_type": "恶化", "description": "龙脉争夺战"},
    {"from_entity": "lintian", "to_entity": "baiyujing", "chapter": 90, "event_type": "恶化", "description": "仙城决战"},
    {"from_entity": "qingyun", "to_entity": "lintian", "chapter": 70, "event_type": "背叛", "description": "向天魔教泄密"},
    {"from_entity": "lintian", "to_entity": "zixiao", "chapter": 85, "event_type": "信任", "description": "获授掌门秘传"},
    {"from_entity": "lintian", "to_entity": "jianling", "chapter": 100, "event_type": "觉醒", "description": "剑灵完全觉醒"},
    {"from_entity": "fenglinger", "to_entity": "tianmojiao", "chapter": 110, "event_type": "揭示", "description": "身份危机"},
]


# ---------------------------------------------------------------------------
# 数据生成
# ---------------------------------------------------------------------------

def volume_for_chapter(ch: int) -> int:
    for vol, start, end in VOLUME_RANGES:
        if start <= ch <= end:
            return vol
    return TOTAL_VOLUMES


def generate_state(project_root: Path) -> None:
    webnovel = project_root / ".webnovel"
    webnovel.mkdir(parents=True, exist_ok=True)

    chapter_meta = {}
    for ch in range(1, TOTAL_CHAPTERS + 1):
        chapter_meta[f"{ch:04d}"] = {"summary": f"第{ch}章概要：本章情节发展。"}

    state = {
        "project_info": {
            "title": "《仙道长青》",
            "genre": "仙侠",
            "target_words": 2000000,
            "target_chapters": 800,
        },
        "progress": {
            "current_chapter": TOTAL_CHAPTERS,
            "current_volume": volume_for_chapter(TOTAL_CHAPTERS),
            "total_words": sum(2800 + int(math.sin(ch / 10) * 500 + random.randint(-200, 400)) for ch in range(1, TOTAL_CHAPTERS + 1)),
            "volumes_planned": [
                {"volume": v, "chapters_range": f"{s}-{e}"} for v, s, e in VOLUME_RANGES
            ],
        },
        "protagonist_state": {
            "name": "林长青",
            "power": {"realm": "金丹中期", "level": 7},
            "location": {"current": "龙脉洞府"},
        },
        "strand_tracker": {
            "current_dominant": "constellation",
            "history": [
                {"chapter": ch, "strand": STRANDS[(ch * 7 + ch // 3) % 3]}
                for ch in range(1, TOTAL_CHAPTERS + 1)
            ],
        },
        "plot_threads": {
            "foreshadowing": FORESHADOWING,
        },
        "chapter_meta": chapter_meta,
    }

    (webnovel / "state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def generate_index_db(project_root: Path) -> None:
    db_path = project_root / ".webnovel" / "index.db"
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # chapters
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chapters (
            chapter INTEGER PRIMARY KEY,
            title TEXT,
            location TEXT,
            word_count INTEGER,
            characters TEXT,
            summary TEXT
        )
    """)

    titles = [
        "初入山门", "师父赐剑", "宗门大比", "秘境开启", "血战妖兽",
        "金丹之路", "黑市风云", "龙脉异动", "天魔来袭", "剑灵觉醒",
        "仙城之变", "紫霄秘传", "雷域试炼", "魔祖之影", "宿命对决",
    ]

    random.seed(42)
    for ch in range(1, TOTAL_CHAPTERS + 1):
        title = titles[(ch - 1) % len(titles)] + f"（{ch}）"
        location = LOCATIONS[(ch * 3 + ch // 7) % len(LOCATIONS)]
        word_count = 2800 + int(math.sin(ch / 10) * 500) + random.randint(-200, 400)
        chars = random.sample(CHARACTERS[:6], k=random.randint(1, 3))
        if ch <= 5:
            chars = ["lintian"]
        summary = f"第{ch}章：林长青在{location}展开冒险。"

        cursor.execute(
            "INSERT INTO chapters VALUES (?,?,?,?,?,?)",
            (ch, title, location, word_count, json.dumps(chars), summary),
        )

    # entities
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            canonical_name TEXT,
            type TEXT,
            tier TEXT,
            is_protagonist INTEGER DEFAULT 0,
            is_archived INTEGER DEFAULT 0,
            first_appearance INTEGER,
            last_appearance INTEGER,
            desc TEXT,
            current_json TEXT
        )
    """)
    for e in ENTITIES:
        current_json = json.dumps({
            "realm": "金丹中期" if e["id"] == "lintian" else "未知",
            "location": LOCATIONS[hash(e["id"]) % len(LOCATIONS)],
        }, ensure_ascii=False)
        cursor.execute(
            "INSERT INTO entities VALUES (?,?,?,?,?,0,?,?,?,?)",
            (e["id"], e["canonical_name"], e["type"], e["tier"],
             1 if e.get("is_protagonist") else 0,
             e["first_appearance"], e["last_appearance"],
             e.get("desc", ""), current_json),
        )

    # relationships
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS relationships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_entity TEXT,
            to_entity TEXT,
            type TEXT,
            chapter INTEGER,
            description TEXT
        )
    """)
    for r in RELATIONSHIPS:
        cursor.execute(
            "INSERT INTO relationships (from_entity, to_entity, type, chapter, description) VALUES (?,?,?,?,?)",
            (r["from_entity"], r["to_entity"], r["type"], r["chapter"], r["description"]),
        )

    # relationship_events
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS relationship_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_entity TEXT,
            to_entity TEXT,
            chapter INTEGER,
            event_type TEXT,
            description TEXT
        )
    """)
    for ev in RELATIONSHIP_EVENTS:
        cursor.execute(
            "INSERT INTO relationship_events (from_entity, to_entity, chapter, event_type, description) VALUES (?,?,?,?,?)",
            (ev["from_entity"], ev["to_entity"], ev["chapter"], ev["event_type"], ev["description"]),
        )

    # state_changes
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS state_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT,
            chapter INTEGER,
            field TEXT,
            old_value TEXT,
            new_value TEXT
        )
    """)
    state_changes = [
        ("lintian", 1, "realm", "凡人", "练气一层"),
        ("lintian", 15, "realm", "练气九层", "筑基初期"),
        ("lintian", 40, "realm", "筑基大圆满", "金丹初期"),
        ("lintian", 80, "realm", "金丹初期", "金丹中期"),
        ("lintian", 25, "location", "青元宗", "青元秘境"),
        ("lintian", 50, "location", "东海仙城", "黑市"),
        ("lintian", 75, "location", "剑冢", "龙脉洞府"),
        ("fenglinger", 8, "realm", "未知", "练气五层"),
        ("fenglinger", 35, "realm", "练气九层", "筑基初期"),
        ("fenglinger", 70, "realm", "筑基大圆满", "金丹初期"),
        ("baiyujing", 25, "realm", "金丹初期", "金丹中期"),
        ("baiyujing", 60, "realm", "金丹中期", "金丹大圆满"),
        ("baiyujing", 90, "attitude", "敌意", "杀意"),
        ("qingyun", 70, "loyalty", "太虚宗", "天魔教"),
    ]
    for entity_id, chapter, field, old_val, new_val in state_changes:
        cursor.execute(
            "INSERT INTO state_changes (entity_id, chapter, field, old_value, new_value) VALUES (?,?,?,?,?)",
            (entity_id, chapter, field, old_val, new_val),
        )

    # aliases
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT,
            alias TEXT
        )
    """)
    aliases = [
        ("lintian", "长青"), ("lintian", "林师弟"),
        ("fenglinger", "灵儿"), ("fenglinger", "凤师妹"),
        ("baiyujing", "白少主"), ("laodaoshi", "无名老道"),
    ]
    for entity_id, alias in aliases:
        cursor.execute("INSERT INTO aliases (entity_id, alias) VALUES (?,?)", (entity_id, alias))

    # chapter_reading_power
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chapter_reading_power (
            chapter INTEGER PRIMARY KEY,
            hook_type TEXT,
            hook_strength TEXT,
            is_transition INTEGER DEFAULT 0,
            override_count INTEGER DEFAULT 0,
            debt_balance REAL DEFAULT 0.0,
            coolpoint_patterns TEXT
        )
    """)
    hook_types = ["悬念钩", "反转钩", "追杀钩", "情感钩", "秘密钩"]
    for ch in range(1, TOTAL_CHAPTERS + 1):
        strength = HOOK_STRENGTHS[min(2, max(0, int(math.sin(ch / 8) * 1.5 + 1.2)))]
        is_transition = 1 if ch % 30 in (0, 1) else 0
        override_count = random.randint(0, 2) if ch > 50 else 0
        debt = round(random.uniform(-0.5, 2.0), 2) if ch > 30 else 0.0
        cursor.execute(
            "INSERT INTO chapter_reading_power VALUES (?,?,?,?,?,?,?)",
            (ch, hook_types[ch % len(hook_types)], strength, is_transition,
             override_count, debt, json.dumps([hook_types[ch % len(hook_types)]])),
        )

    # review_metrics
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS review_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_chapter INTEGER,
            end_chapter INTEGER,
            overall_score REAL,
            dimension_scores TEXT,
            severity_counts TEXT,
            critical_issues TEXT
        )
    """)
    for ch in range(1, TOTAL_CHAPTERS + 1):
        base = 65 + math.sin(ch / 15) * 12 + random.uniform(-5, 5)
        score = round(min(98, max(50, base)), 1)
        dims = json.dumps({"plot": round(score + random.uniform(-3, 3), 1),
                           "character": round(score + random.uniform(-3, 3), 1),
                           "pacing": round(score + random.uniform(-5, 5), 1)})
        severity = json.dumps({"high": random.randint(0, 1),
                               "medium": random.randint(0, 2),
                               "low": random.randint(0, 3)})
        critical = json.dumps([]) if score > 60 else json.dumps(["节奏过缓"])
        cursor.execute(
            "INSERT INTO review_metrics (start_chapter, end_chapter, overall_score, dimension_scores, severity_counts, critical_issues) VALUES (?,?,?,?,?,?)",
            (ch, ch, score, dims, severity, critical),
        )

    # 扩展表 (空表，防止 _fetchall_safe 报错)
    for table_sql in [
        "CREATE TABLE IF NOT EXISTS override_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, chapter INTEGER, status TEXT, record_type TEXT, description TEXT)",
        "CREATE TABLE IF NOT EXISTS chase_debt (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, updated_at TEXT)",
        "CREATE TABLE IF NOT EXISTS debt_events (id INTEGER PRIMARY KEY AUTOINCREMENT, debt_id INTEGER, chapter INTEGER)",
        "CREATE TABLE IF NOT EXISTS invalid_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, marked_at TEXT)",
        "CREATE TABLE IF NOT EXISTS rag_query_log (id INTEGER PRIMARY KEY AUTOINCREMENT, query_type TEXT, created_at TEXT)",
        "CREATE TABLE IF NOT EXISTS tool_call_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_name TEXT, created_at TEXT)",
        "CREATE TABLE IF NOT EXISTS writing_checklist_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, chapter INTEGER)",
        "CREATE TABLE IF NOT EXISTS story_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, chapter INTEGER, event_type TEXT, subject TEXT, payload_json TEXT, created_at TEXT)",
    ]:
        cursor.execute(table_sql)

    # scenes
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS scenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter INTEGER,
            scene_index INTEGER,
            content TEXT
        )
    """)

    # vector db (模拟)
    vector_db_path = project_root / ".webnovel" / "vectors.db"
    with sqlite3.connect(str(vector_db_path)) as vconn:
        vconn.execute("""
            CREATE TABLE IF NOT EXISTS vectors (
                chunk_id TEXT PRIMARY KEY,
                chapter INTEGER,
                scene_index INTEGER,
                content TEXT,
                embedding BLOB,
                parent_chunk_id TEXT,
                chunk_type TEXT,
                source_file TEXT
            )
        """)
        for ch in range(1, TOTAL_CHAPTERS + 1):
            for scene in range(1, random.randint(2, 5)):
                vconn.execute(
                    "INSERT INTO vectors VALUES (?,?,?,?,?,?,?,?)",
                    (f"ch{ch:04d}_s{scene}", ch, scene,
                     f"第{ch}章场景{scene}内容片段",
                     b"\x00" * 16, None, "scene", f"正文/第{ch:04d}章.md"),
                )
        vconn.commit()

    conn.commit()
    conn.close()


def generate_story_system(project_root: Path) -> None:
    story_root = project_root / ".story-system"
    for subdir in ("chapters", "volumes", "reviews", "commits", "events"):
        (story_root / subdir).mkdir(parents=True, exist_ok=True)

    # MASTER_SETTING
    (story_root / "MASTER_SETTING.json").write_text(json.dumps({
        "meta": {"schema_version": "story-system/v1", "contract_type": "MASTER_SETTING"},
        "route": {"primary_genre": "仙侠升级流"},
        "master_constraints": {"core_tone": "先压后爆"},
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # Volumes
    for vol, start, end in VOLUME_RANGES:
        (story_root / "volumes" / f"volume_{vol:03d}.json").write_text(json.dumps({
            "meta": {"contract_type": "VOLUME_BRIEF", "volume": vol},
            "chapters_range": f"{start}-{end}",
        }, ensure_ascii=False), encoding="utf-8")

    # Chapter briefs + reviews + commits
    random.seed(99)
    for ch in range(max(1, TOTAL_CHAPTERS - 15), TOTAL_CHAPTERS + 1):
        (story_root / "chapters" / f"chapter_{ch:03d}.json").write_text(json.dumps({
            "meta": {"contract_type": "CHAPTER_BRIEF", "chapter": ch},
        }, ensure_ascii=False), encoding="utf-8")

        (story_root / "reviews" / f"chapter_{ch:03d}.review.json").write_text(json.dumps({
            "meta": {"contract_type": "REVIEW_CONTRACT", "chapter": ch},
        }, ensure_ascii=False), encoding="utf-8")

        status = "accepted" if random.random() > 0.15 else "rejected"
        proj_state = "done" if status == "accepted" else "skipped"
        (story_root / "commits" / f"chapter_{ch:03d}.commit.json").write_text(json.dumps({
            "meta": {"schema_version": "story-system/v1", "chapter": ch, "status": status},
            "provenance": {"write_fact_role": "chapter_commit"},
            "projection_status": {
                "state": proj_state,
                "index": proj_state,
                "summary": proj_state,
                "memory": proj_state,
                "vector": proj_state,
            },
        }, ensure_ascii=False, indent=2), encoding="utf-8")


def generate_content_files(project_root: Path) -> None:
    for folder in ("正文", "大纲", "设定集"):
        (project_root / folder).mkdir(parents=True, exist_ok=True)

    # 正文
    for ch in range(1, TOTAL_CHAPTERS + 1):
        vol = volume_for_chapter(ch)
        vol_dir = project_root / "正文" / f"第{vol}卷"
        vol_dir.mkdir(exist_ok=True)
        content = f"# 第{ch}章\n\n林长青缓缓睁开双眼，灵力在经脉中流转不息。\n\n" + "这是模拟正文内容。\n" * 10
        (vol_dir / f"第{ch:04d}章.md").write_text(content, encoding="utf-8")

    # 大纲
    (project_root / "大纲" / "总纲.md").write_text("# 仙道长青 总纲\n\n修仙世界，少年林长青踏上修仙之路……\n", encoding="utf-8")
    for vol, _, _ in VOLUME_RANGES:
        (project_root / "大纲" / f"第{vol}卷大纲.md").write_text(f"# 第{vol}卷大纲\n\n本卷主线情节……\n", encoding="utf-8")

    # 设定集
    (project_root / "设定集" / "修炼体系.md").write_text("# 修炼体系\n\n练气 → 筑基 → 金丹 → 元婴 → 化神\n", encoding="utf-8")
    (project_root / "设定集" / "门派势力.md").write_text("# 门派势力\n\n太虚宗、天魔教、东海仙城……\n", encoding="utf-8")
    (project_root / "设定集" / "法宝一览.md").write_text("# 法宝一览\n\n无极剑、天魔幡、青元镜……\n", encoding="utf-8")


def generate_env(project_root: Path) -> None:
    (project_root / ".env").write_text("\n".join([
        "EMBED_BASE_URL=https://api.voyageai.com/v1",
        "EMBED_MODEL=voyage-3-lite",
        "EMBED_API_KEY=demo-embed-key-xxxxx",
        "RERANK_BASE_URL=https://api.cohere.com/v2",
        "RERANK_MODEL=rerank-v3.5",
        "RERANK_API_KEY=demo-rerank-key-xxxxx",
    ]), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    demo_root = Path(tempfile.mkdtemp(prefix="pixelwriter_demo_"))
    print(f"[mock_demo] 生成仿真数据 → {demo_root}")

    generate_state(demo_root)
    generate_index_db(demo_root)
    generate_story_system(demo_root)
    generate_content_files(demo_root)
    generate_env(demo_root)

    print(f"[mock_demo] 数据就绪:")
    print(f"  state.json  : {demo_root / '.webnovel' / 'state.json'}")
    print(f"  index.db    : {demo_root / '.webnovel' / 'index.db'}")
    print(f"  vectors.db  : {demo_root / '.webnovel' / 'vectors.db'}")
    print(f"  .story-system/commits: {len(list((demo_root / '.story-system' / 'commits').glob('*.json')))} files")
    print(f"  正文/        : {sum(1 for _ in (demo_root / '正文').rglob('*.md'))} chapters")
    print()

    # 启动
    plugin_root = Path(__file__).resolve().parents[3]
    scripts_dir = plugin_root / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    if str(plugin_root) not in sys.path:
        sys.path.insert(0, str(plugin_root))

    from dashboard.app import create_app

    app = create_app(demo_root)

    import uvicorn

    print("[mock_demo] 启动 Dashboard → http://localhost:8765")
    print("[mock_demo] Ctrl+C 停止\n")

    try:
        uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
    finally:
        print(f"\n[mock_demo] 清理临时目录: {demo_root}")
        shutil.rmtree(demo_root, ignore_errors=True)


if __name__ == "__main__":
    main()
