#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""webnovel-writer 的 MCP server —— 让 DSH 直接调用网文创作引擎。

这是「DSH 版本」的入口：把 service/ 已有的引擎能力（state / Story System /
RAG / 规划 / 写章 / 投影）暴露成 MCP 工具，由 DSH 的 dsh-mcp-client 通过
stdio 接入，成为模型可调用的原生工具。

与 service/app.py 的关系：
- app.py 是把同一批能力包成独立 Web 服务（HTTP）
- 本文件把它包成 MCP server（stdio），供 DSH / Claude Code / 任何 MCP 客户端用
两者共用 service/engine.py、service/pipeline.py、service/planner.py，不重复实现。

用法（通常由 DSH 的 mcp-client 自动拉起，无需手动运行）：
    python service/mcp_server.py

环境变量：
    WEBNOVEL_PROJECT_ROOT  默认书项目根目录（可被各工具参数覆盖）
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

SERVICE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_ROOT.parent
for _p in (str(REPO_ROOT), str(SERVICE_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from mcp.server.mcpserver import MCPServer  # noqa: E402

from service.config import ROLES, load_settings, save_runtime_settings  # noqa: E402
from service.engine import Engine, EngineError  # noqa: E402
from service.llm import LLMError, build_clients  # noqa: E402
from service.planner import PlanPipeline  # noqa: E402
from service.pipeline import WritePipeline  # noqa: E402

DEFAULT_PROJECT = os.environ.get("WEBNOVEL_PROJECT_ROOT", "").strip()

mcp = MCPServer(
    name="webnovel",
    title="Webnovel Writer",
    description=(
        "长篇网文创作引擎：规划卷纲章纲、写作章节、五维事实审查、"
        "Story System 事实入账与检索。"
    ),
    instructions=(
        "典型流程：novel_init 建书 → novel_plan 规划卷纲与章纲（必须先做，"
        "否则没有章纲无法写作）→ novel_write 写章。\n"
        "novel_write 会执行：预检→合同→上下文→起草→五维审查→润色→事实提取→"
        "提交→备份，耗时数分钟。\n"
        "审查出阻断问题时会停下返回 needs_user_action；用 novel_blocking 查看，"
        "再用 novel_resume 裁决续跑（accept_blocking=true 接受现状，或先改正文"
        "再指定 from_stage）。"
    ),
)


# ─────────────────────────────────────────────────────────────────────────────
# 内部工具
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_root(project_root: str = "") -> str:
    """定位书项目根。参数 > 环境变量 > 配置。"""
    for candidate in (project_root, DEFAULT_PROJECT):
        if candidate and Path(candidate).is_dir():
            return str(Path(candidate).resolve())
    settings = load_settings(None)
    if settings.project_root and Path(settings.project_root).is_dir():
        return settings.project_root
    raise ValueError(
        "未能定位书项目根目录。请传入 project_root，"
        "或设置环境变量 WEBNOVEL_PROJECT_ROOT，或先运行 novel_init 建书。"
    )


def _engine(project_root: str = "") -> Engine:
    root = _resolve_root(project_root)
    return Engine(load_settings(root), project_root=root)


def _scripts_dir() -> str:
    return str(REPO_ROOT / "webnovel-writer" / "scripts")


def _json(data: Any) -> str:
    """MCP 工具统一返回 JSON 文本（模型可读、可解析）。"""
    return json.dumps(data, ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# 项目状态与体检
# ─────────────────────────────────────────────────────────────────────────────


@mcp.tool()
async def novel_status(
    project_root: str = "",
    chapter: int = 0,
) -> str:
    """查看书项目当前状态：阶段、已写到第几章、下一步该做什么。

    在开始任何操作前先调这个，确认项目处于什么阶段。

    Args:
        project_root: 书项目根目录；留空则用环境变量或已配置的项目。
        chapter: 目标章节号；0 表示自动。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    try:
        return _json(await asyncio.to_thread(
            engine.project_status, chapter or None
        ))
    except EngineError as exc:
        return _json({"error": str(exc)})


@mcp.tool()
async def novel_doctor(
    project_root: str = "",
    chapter: int = 0,
    deep: bool = False,
) -> str:
    """只读体检：检查目录、文件、数据库、RAG 配置与依赖是否完整。

    项目报错或行为异常时先跑这个。

    Args:
        project_root: 书项目根目录。
        chapter: 目标章节号；0 表示自动。
        deep: 是否包含较深检查（Dashboard 等）。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    try:
        return _json(await asyncio.to_thread(
            engine.doctor, chapter or None, deep
        ))
    except EngineError as exc:
        return _json({"error": str(exc)})


# ─────────────────────────────────────────────────────────────────────────────
# 建书
# ─────────────────────────────────────────────────────────────────────────────


@mcp.tool()
async def novel_init(
    project_dir: str,
    title: str,
    genre: str = "玄幻",
    protagonist_name: str = "",
    target_chapters: int = 600,
    target_words: int = 2000000,
    golden_finger_name: str = "",
    core_selling_points: str = "",
) -> str:
    """创建一本新书（生成目录结构、state.json、基础设定与总纲）。

    注意：建书后**只有总纲、没有章纲**，必须再调 novel_plan 规划出章纲，
    否则 novel_write 无法工作。

    Args:
        project_dir: 新书目录路径。
        title: 书名。
        genre: 题材（中文）。上游用硬匹配路由，必须是已知题材，
            如 玄幻 / 仙侠 / 都市 / 规则怪谈 / 历史古代 等。
        protagonist_name: 主角姓名。
        target_chapters: 目标总章节数。
        target_words: 目标总字数。
        golden_finger_name: 金手指名称。
        core_selling_points: 核心卖点，逗号分隔。
    """
    settings = load_settings(None)
    engine = Engine(settings, project_root=None)
    options: Dict[str, Any] = {
        "protagonist_name": protagonist_name,
        "target_chapters": target_chapters,
        "target_words": target_words,
        "golden_finger_name": golden_finger_name,
        "core_selling_points": core_selling_points,
    }
    try:
        res = await asyncio.to_thread(
            engine.init_project, project_dir, title, genre, **options
        )
    except EngineError as exc:
        return _json({"ok": False, "error": str(exc)})
    root = Path(project_dir).resolve()
    return _json({
        "ok": res.returncode == 0,
        "project_root": str(root),
        "state_exists": (root / ".webnovel" / "state.json").is_file(),
        "next_step": "运行 novel_plan 规划第 1 卷（必需，否则写不了章节）",
        "detail": (res.stdout or res.stderr or "").strip()[:1500],
    })


# ─────────────────────────────────────────────────────────────────────────────
# 规划
# ─────────────────────────────────────────────────────────────────────────────


@mcp.tool()
async def novel_plan(
    project_root: str = "",
    volume: int = 1,
    chapter_start: int = 0,
    chapter_end: int = 0,
    genre: str = "",
    requirements: str = "",
    chapters_per_volume: int = 50,
    batch_size: int = 10,
) -> str:
    """规划一卷：生成卷节拍表、卷时间线、章纲，并刷新写作合同。

    这是写作的前置步骤。上游建书只产出总纲，没有章纲，而写章第一步就要
    从章纲解析本章目标 —— 跳过规划，写章必然失败。
    已存在的章纲不会被重写，只增量补齐缺失章节。

    Args:
        project_root: 书项目根目录。
        volume: 卷号。
        chapter_start: 起始章号；0 表示按 chapters_per_volume 推算。
        chapter_end: 结束章号；0 表示按 chapters_per_volume 推算。
        genre: 题材；留空则自动从 state.json 读取。
        requirements: 作者对本卷的额外要求。
        chapters_per_volume: 每卷章数，用于推算范围。
        batch_size: 章纲每批生成多少章（建议 8-12）。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    settings = load_settings(engine.project_root)
    planner = PlanPipeline(
        settings, engine, build_clients(settings),
        volume=volume,
        chapter_start=chapter_start or None,
        chapter_end=chapter_end or None,
        genre=genre,
        requirements=requirements,
        chapters_per_volume=chapters_per_volume,
        batch_size=batch_size,
    )
    try:
        result = await planner.run()
    except (LLMError, EngineError) as exc:
        return _json({"status": "failed", "error": str(exc)})
    return _json(result.to_dict())


# ─────────────────────────────────────────────────────────────────────────────
# 写作
# ─────────────────────────────────────────────────────────────────────────────


@mcp.tool()
async def novel_write(
    chapter: int,
    project_root: str = "",
    title: str = "",
    chapter_goal: str = "",
    genre: str = "",
    mode: str = "default",
    target_words: int = 0,
    accept_blocking: bool = False,
    override_existing: bool = False,
) -> str:
    """写一章：预检→合同→上下文→起草→五维审查→润色→事实提取→提交→备份。

    耗时数分钟（审查最慢）。可能的返回状态：
    - completed：全部完成，已提交
    - needs_user_action：有阻断问题，需裁决（用 novel_blocking 查看，
      再用 novel_resume 继续）
    - partial / failed：见 problems

    正文已存在时默认**沿用不覆盖**（保护作者手改）。

    Args:
        chapter: 章节号。
        project_root: 书项目根目录。
        title: 章节标题；留空则从章纲推断。
        chapter_goal: 本章目标；留空则从章纲自动解析。
        genre: 题材；留空自动读取。
        mode: default / fast / minimal。
        target_words: 目标字数；0 用默认。
        accept_blocking: 是否接受阻断问题继续（默认 false，遇阻断即停）。
        override_existing: 是否覆盖已有正文（默认 false）。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    settings = load_settings(engine.project_root)
    writer = WritePipeline(
        settings, engine, build_clients(settings),
        mode=mode,
        target_words=target_words or None,
        chapter_title=title,
        chapter_goal=chapter_goal,
        genre=genre,
        accept_blocking=accept_blocking,
        override_existing=override_existing,
    )
    try:
        result = await writer.run(int(chapter))
    except (LLMError, EngineError) as exc:
        return _json({"status": "failed", "error": str(exc)})
    return _json(result.to_dict())


@mcp.tool()
async def novel_blocking(
    project_root: str = "",
) -> str:
    """查看当前阻断问题与可选续跑方式。

    novel_write 返回 needs_user_action 时调这个，看具体卡在哪、
    以及有哪几种继续方式。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    path = Path(engine.tmp_dir()) / "blocking_state.json"
    if not path.is_file():
        return _json({"blocking_issues": [], "resume_options": [],
                      "note": "当前没有记录在案的阻断问题"})
    try:
        return _json(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as exc:
        return _json({"error": f"读取阻断状态失败：{exc}"})


@mcp.tool()
async def novel_resume(
    chapter: int,
    from_stage: str = "polish",
    project_root: str = "",
    accept_blocking: bool = False,
    title: str = "",
    genre: str = "",
) -> str:
    """从指定阶段续跑（解决阻断后继续写章）。

    from_stage 可选：preflight / contract / context / draft / review /
    polish / data / commit / backup。

    常见用法：
    - 想重新起草：from_stage="draft"
    - 接受当前正文与阻断问题，继续提交：from_stage="polish",
      accept_blocking=true
    - 已自行改好正文，直接提交：from_stage="commit", accept_blocking=true

    accept_blocking=true 会把裁决写进 artifact（上游 gate 直接读文件），
    原始记录保留在 adjudicated_* 字段里。

    Args:
        chapter: 章节号。
        from_stage: 从哪个阶段开始。
        project_root: 书项目根目录。
        accept_blocking: 是否接受阻断/待消歧项继续。
        title: 章节标题（续跑时可能需要）。
        genre: 题材。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    if from_stage not in WritePipeline.RESUME_STAGES:
        return _json({
            "error": f"from_stage 非法：{from_stage}",
            "valid": list(WritePipeline.RESUME_STAGES),
        })
    settings = load_settings(engine.project_root)
    writer = WritePipeline(
        settings, engine, build_clients(settings),
        chapter_title=title, genre=genre,
        accept_blocking=accept_blocking,
    )
    try:
        result = await writer.run(int(chapter), from_stage=from_stage)
    except (LLMError, EngineError) as exc:
        return _json({"status": "failed", "error": str(exc)})
    return _json(result.to_dict())


# ─────────────────────────────────────────────────────────────────────────────
# 读取
# ─────────────────────────────────────────────────────────────────────────────


@mcp.tool()
async def novel_read_chapter(
    chapter: int,
    project_root: str = "",
) -> str:
    """读章节正文。

    Args:
        chapter: 章节号。
        project_root: 书项目根目录。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    path = await asyncio.to_thread(engine.chapter_file, int(chapter))
    if path is None:
        return _json({"error": f"第 {chapter} 章正文尚未生成"})
    text = Path(path).read_text(encoding="utf-8")
    return _json({
        "chapter": chapter,
        "path": str(path),
        "word_count": len(text),
        "content": text,
    })


@mcp.tool()
async def novel_outline(
    project_root: str = "",
    chapter: int = 0,
    volume: int = 0,
) -> str:
    """读章纲 / 卷大纲 / 总纲。

    - 传 chapter：读该章章纲（自动从卷大纲的分节里抽取）
    - 传 volume：读该卷详细大纲全文
    - 都不传：读总纲

    Args:
        project_root: 书项目根目录。
        chapter: 章节号。
        volume: 卷号。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    if chapter:
        text = await asyncio.to_thread(engine.chapter_outline, int(chapter))
        if text is None:
            return _json({"error": f"未找到第 {chapter} 章章纲"})
        return _json({"chapter": chapter, "content": text})
    if volume:
        rel = f"大纲/第{volume}卷-详细大纲.md"
        text = await asyncio.to_thread(engine.read_outline, rel)
        if text is None:
            return _json({"error": f"未找到第 {volume} 卷详细大纲"})
        return _json({"volume": volume, "content": text})
    master = await asyncio.to_thread(engine.master_outline)
    if master is None:
        return _json({"error": "未找到 大纲/总纲.md"})
    return _json({"master_outline": master})


@mcp.tool()
async def novel_context(
    chapter: int,
    project_root: str = "",
) -> str:
    """读某章的写作上下文包（合同、近期摘要、未回收伏笔、角色状态等）。

    写章前想了解"目前故事到哪了"时用它。

    Args:
        chapter: 章节号。
        project_root: 书项目根目录。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    try:
        return _json(await asyncio.to_thread(engine.load_context, int(chapter)))
    except EngineError as exc:
        return _json({"error": str(exc)})


@mcp.tool()
async def novel_events(
    project_root: str = "",
    chapter: int = 0,
    limit: int = 200,
    health: bool = False,
) -> str:
    """查询故事事件链（角色状态变更、伏笔、关系变化等）。

    Args:
        project_root: 书项目根目录。
        chapter: 只看某章；0 表示全部。
        limit: 返回条数上限。
        health: 是否附带事件链健康检查。
    """
    engine = await asyncio.to_thread(_engine, project_root)
    try:
        return _json(await asyncio.to_thread(
            engine.story_events, chapter, limit, health
        ))
    except EngineError as exc:
        return _json({"error": str(exc)})


# ─────────────────────────────────────────────────────────────────────────────
# 配置
# ─────────────────────────────────────────────────────────────────────────────


@mcp.tool()
async def novel_config_get() -> str:
    """读当前 LLM / RAG 配置（密钥只显示是否已设置与末四位）。"""
    settings = load_settings(DEFAULT_PROJECT or None)
    pub = settings.to_public_dict()
    pub["configured_roles"] = [
        role for role in ROLES[:4] if settings.role(role).is_usable()
    ]
    return _json(pub)


@mcp.tool()
async def novel_config_set(
    base_url: str = "",
    model: str = "",
    api_key: str = "",
    api: str = "",
    embed_base_url: str = "",
    embed_model: str = "",
    embed_api_key: str = "",
) -> str:
    """配置 LLM / RAG API。

    api_key 留空表示**不改动**已保存的密钥（避免误清空）。

    Args:
        base_url: LLM 接口地址，如 https://api.example.com/v1
        model: 模型名。
        api_key: 密钥。
        api: 协议，openai-completions（默认）或 anthropic-messages。
        embed_base_url: Embedding 接口地址（可选，不配则检索退回 BM25）。
        embed_model: Embedding 模型。
        embed_api_key: Embedding 密钥。
    """
    patch: Dict[str, Any] = {}
    llm: Dict[str, Any] = {}
    if base_url:
        llm["base_url"] = base_url
    if model:
        llm["model"] = model
    if api_key:
        llm["api_key"] = api_key
    if api:
        llm["api"] = api
    if llm:
        patch["llm"] = llm
    for key, value in (
        ("embed_base_url", embed_base_url),
        ("embed_model", embed_model),
        ("embed_api_key", embed_api_key),
    ):
        if value:
            patch[key] = value
    if not patch:
        return _json({"ok": False, "error": "没有提供任何要修改的字段"})

    save_runtime_settings(patch)
    settings = load_settings(DEFAULT_PROJECT or None)
    pub = settings.to_public_dict()
    pub["ok"] = True
    pub["configured_roles"] = [
        role for role in ROLES[:4] if settings.role(role).is_usable()
    ]
    pub["note"] = "配置已保存；若之前没配过 LLM，现在可以调 novel_plan / novel_write 了"
    return _json(pub)


def main() -> None:
    """stdio 入口。由 MCP 客户端（如 DSH 的 dsh-mcp-client）拉起。"""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
