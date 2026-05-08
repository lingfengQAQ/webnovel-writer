#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prompt 完整性静态校验。

验证 agents/*.md 和 skills/*/SKILL.md 的结构、引用、CLI 命令等，
不需要 LLM 调用，可加入 CI。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# 基础路径
# ---------------------------------------------------------------------------

PLUGIN_ROOT = Path(__file__).resolve().parent.parent.parent.parent
AGENTS_DIR = PLUGIN_ROOT / "agents"
SKILLS_DIR = PLUGIN_ROOT / "skills"
REFERENCES_DIR = PLUGIN_ROOT / "references"
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"

AGENT_FILES = sorted(AGENTS_DIR.glob("*.md"))
SKILL_FILES = sorted(SKILLS_DIR.glob("*/SKILL.md"))
ALL_PROMPT_FILES = AGENT_FILES + SKILL_FILES

# webnovel.py 注册的子命令（从 add_parser 提取）
REGISTERED_CLI_SUBCOMMANDS = {
    "where", "preflight", "use",
    "index", "state", "rag", "style", "entity", "context", "memory",
    "migrate", "status", "update-state", "backup", "archive",
    "init", "extract-context", "memory-contract", "project-memory", "review-pipeline",
    "placeholder-scan", "master-outline-sync",
    "story-system", "chapter-commit", "story-events", "knowledge",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _extract_frontmatter(text: str) -> dict:
    """提取 YAML frontmatter 为 dict。"""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    result = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            result[key.strip()] = value.strip()
    return result


def _extract_referenced_paths(text: str, base_dir: Path) -> list[tuple[str, Path]]:
    """从 markdown 中提取被引用的文件路径（references/, skills/, agents/ 等）。

    返回 (raw_ref, resolved_path) 列表。
    """
    refs = []
    # 匹配 `references/xxx.md`、`../../references/xxx.md`、`skills/xxx` 等相对路径
    for m in re.finditer(r'[`"]((?:\.\./)*(?:references|skills|agents)/[^\s`"]+\.md)[`"]', text):
        raw = m.group(1)
        resolved = (base_dir / raw).resolve()
        refs.append((raw, resolved))
    # 匹配 references 段落中列出的路径（不带引号）
    for m in re.finditer(r'^- `((?:\.\./)*(?:references|skills|agents)/[^\s`]+\.md)`', text, re.MULTILINE):
        raw = m.group(1)
        resolved = (base_dir / raw).resolve()
        refs.append((raw, resolved))
    return refs


def _extract_cli_subcommands(text: str) -> list[str]:
    """从 prompt 中提取 webnovel.py 调用的子命令。"""
    cmds = set()
    for m in re.finditer(r'webnovel\.py["\s]+--project-root\s+[^\s]+\s+([a-z][\w-]*)', text):
        cmd = m.group(1)
        cmds.add(cmd)
    return sorted(cmds)


# ---------------------------------------------------------------------------
# 1. Frontmatter 完整性
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("agent_file", AGENT_FILES, ids=lambda f: f.name)
def test_agent_frontmatter_complete(agent_file: Path):
    """每个 agent 必须有 name, description, tools。"""
    fm = _extract_frontmatter(_read_text(agent_file))
    assert "name" in fm, f"{agent_file.name}: 缺少 name"
    assert "description" in fm, f"{agent_file.name}: 缺少 description"
    assert "tools" in fm, f"{agent_file.name}: 缺少 tools"


@pytest.mark.parametrize("skill_file", SKILL_FILES, ids=lambda f: f.parent.name)
def test_skill_frontmatter_complete(skill_file: Path):
    """每个 skill 必须有 name, description。"""
    fm = _extract_frontmatter(_read_text(skill_file))
    assert "name" in fm, f"{skill_file.parent.name}: 缺少 name"
    assert "description" in fm, f"{skill_file.parent.name}: 缺少 description"


# ---------------------------------------------------------------------------
# 2. Agent 模板结构（9 段）
# ---------------------------------------------------------------------------

EXPECTED_AGENT_SECTIONS = [
    "1.",
    "2.",
    "3.",
    "4.",
    "5.",
    "6.",
    "7.",
    "8.",
]


@pytest.mark.parametrize("agent_file", AGENT_FILES, ids=lambda f: f.name)
def test_agent_template_structure(agent_file: Path):
    """每个 agent 至少包含 8 个编号段。"""
    text = _read_text(agent_file)
    missing = []
    for section in EXPECTED_AGENT_SECTIONS:
        # 匹配 "## 1. 身份与目标" 或 "## 2. 可用工具与脚本"（允许后缀）
        pattern = rf"^## {re.escape(section)}"
        if not re.search(pattern, text, re.MULTILINE):
            missing.append(section)
    assert not missing, f"{agent_file.name}: 缺少段落 {missing}"


# ---------------------------------------------------------------------------
# 3. 引用完整性
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("prompt_file", ALL_PROMPT_FILES, ids=lambda f: f.name)
def test_all_references_exist(prompt_file: Path):
    """prompt 中引用的所有文件路径都必须真实存在。"""
    text = _read_text(prompt_file)
    base_dir = prompt_file.parent
    refs = _extract_referenced_paths(text, base_dir)
    missing = []
    for raw, resolved in refs:
        if not resolved.exists():
            missing.append(raw)
    assert not missing, f"{prompt_file.name}: 引用了不存在的文件 {missing}"


# ---------------------------------------------------------------------------
# 4. CLI 命令有效性
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("prompt_file", ALL_PROMPT_FILES, ids=lambda f: f.name)
def test_cli_commands_valid(prompt_file: Path):
    """prompt 中的 webnovel.py 子命令都必须在 CLI 注册表中。"""
    text = _read_text(prompt_file)
    cmds = _extract_cli_subcommands(text)
    # 排除已知例外（如 webnovel-review 的 workflow 命令待重构）
    skill_name = prompt_file.parent.name
    exceptions = _KNOWN_CLI_EXCEPTIONS.get(skill_name, set())
    invalid = [c for c in cmds if c not in REGISTERED_CLI_SUBCOMMANDS and c not in exceptions]
    assert not invalid, f"{prompt_file.name}: 使用了未注册的 CLI 子命令 {invalid}"


# ---------------------------------------------------------------------------
# 5. Review Schema 一致性
# ---------------------------------------------------------------------------

def test_review_schema_consistency():
    """reviewer.md 输出格式中的字段必须与 review_schema.py 定义匹配。"""
    reviewer_text = _read_text(AGENTS_DIR / "reviewer.md")

    # 从 reviewer.md 的 JSON 示例中提取 issue 字段
    issue_fields_in_prompt = set()
    json_block = re.search(r'"issues":\s*\[\s*\{([^}]+)\}', reviewer_text, re.DOTALL)
    if json_block:
        for m in re.finditer(r'"(\w+)":', json_block.group(1)):
            issue_fields_in_prompt.add(m.group(1))

    # 从 review_schema.py 提取 ReviewIssue 字段
    schema_path = SCRIPTS_DIR / "data_modules" / "review_schema.py"
    schema_text = _read_text(schema_path)
    schema_fields = set()
    in_review_issue = False
    for line in schema_text.splitlines():
        if "class ReviewIssue" in line:
            in_review_issue = True
            continue
        if in_review_issue:
            if line.strip().startswith("class ") or line.strip().startswith("def "):
                break
            m = re.match(r"\s+(\w+):\s+", line)
            if m:
                schema_fields.add(m.group(1))

    # reviewer prompt 中的字段应该是 schema 字段的子集
    assert issue_fields_in_prompt, "无法从 reviewer.md 提取 issue 字段"
    assert schema_fields, "无法从 review_schema.py 提取字段"
    extra = issue_fields_in_prompt - schema_fields
    assert not extra, f"reviewer.md 中有字段不在 review_schema.py 中: {extra}"


# ---------------------------------------------------------------------------
# 6. 无残留引用（已删文件）
# ---------------------------------------------------------------------------

KNOWN_DELETED_FILES = [
    "step-1.5-contract.md",
    "step-3-review-gate.md",
    "step-5-debt-switch.md",
    "workflow-details.md",
    "checker-output-schema.md",
    "workflow_manager.py",
    "webnovel-resume",
    "golden_three_checker.py",
    "snapshot_manager.py",
]

_KNOWN_CLI_EXCEPTIONS = {}


@pytest.mark.parametrize("prompt_file", ALL_PROMPT_FILES, ids=lambda f: f.name)
def test_no_stale_references(prompt_file: Path):
    """不得引用已知已删除的文件。"""
    text = _read_text(prompt_file)
    found = [name for name in KNOWN_DELETED_FILES if name in text]
    assert not found, f"{prompt_file.name}: 残留引用已删除文件 {found}"


def test_webnovel_review_skill_uses_unified_reviewer_pipeline():
    """webnovel-review 必须与 webnovel-write 使用同一套 reviewer + review-pipeline 链路。"""
    skill_text = _read_text(SKILLS_DIR / "webnovel-review" / "SKILL.md")

    assert "`reviewer`" in skill_text
    assert "Agent(" in skill_text
    assert 'subagent_type: "webnovel-writer:reviewer"' in skill_text
    assert "review-pipeline" in skill_text
    assert ".webnovel/tmp/review_results.json" in skill_text
    assert ".webnovel/tmp/review_metrics.json" in skill_text

    for legacy_agent in (
        "consistency-checker",
        "continuity-checker",
        "ooc-checker",
        "reader-pull-checker",
        "high-point-checker",
        "pacing-checker",
    ):
        assert legacy_agent not in skill_text

    assert " workflow " not in skill_text


def test_active_skills_use_agent_tool_name_not_legacy_task():
    """Claude Code 2.1.63+ 将 Task 工具改名为 Agent；active skills 不应再声明 Task。"""
    for skill_file in SKILL_FILES:
        text = _read_text(skill_file)
        fm = _extract_frontmatter(text)
        allowed_tools = fm.get("allowed-tools", "")
        assert "Task" not in allowed_tools, f"{skill_file.parent.name}: allowed-tools 仍声明 Task"
        assert "Task 调用" not in text, f"{skill_file.parent.name}: 仍使用软性的 Task 调用描述"
        assert "必须通过 `Task`" not in text, f"{skill_file.parent.name}: 仍要求旧 Task 工具名"


def test_webnovel_write_skill_uses_explicit_agent_invocation_templates():
    """webnovel-write 的关键 subagent 必须用显式 Agent(subagent_type=...) 调用模板。"""
    text = _read_text(SKILLS_DIR / "webnovel-write" / "SKILL.md")
    fm = _extract_frontmatter(text)

    assert "Agent" in fm.get("allowed-tools", "")
    for subagent in ("context-agent", "reviewer", "data-agent"):
        assert f'subagent_type: "webnovel-writer:{subagent}"' in text
        assert f'subagent_type: "{subagent}"' not in text
    assert "不得用主流程口头代替 subagent 输出" in text


def test_story_system_runtime_contract_commands_exist():
    text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")
    assert "story-system" in text
    assert "--emit-runtime-contracts" in text


def test_webnovel_write_skill_uses_chapter_commit_as_step5_mainline():
    text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")
    assert "chapter-commit" in text
    assert "CHAPTER_COMMIT" in text
    assert "state process-chapter" not in text


def test_webnovel_write_skill_uses_project_root_backup_not_bare_git_add():
    text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")
    assert "webnovel.py" in text
    assert "--project-root \"${PROJECT_ROOT}\" backup" in text
    assert "git add ." not in text


def test_webnovel_query_skill_prefers_story_system_and_memory_contract():
    text = (SKILLS_DIR / "webnovel-query" / "SKILL.md").read_text(encoding="utf-8")
    assert "memory-contract load-context" in text
    assert ".story-system/" in text
    assert 'cat "$PROJECT_ROOT/.webnovel/state.json"' not in text


def test_context_agent_prefers_contract_and_latest_commit_mainline():
    text = (AGENTS_DIR / "context-agent.md").read_text(encoding="utf-8")
    assert "story_contracts" in text or ".story-system/" in text
    assert "CHAPTER_COMMIT" in text or "chapter-commit" in text
    assert "load-context" in text


def test_context_agent_loads_fixed_guides_and_outputs_writer_brief():
    text = (AGENTS_DIR / "context-agent.md").read_text(encoding="utf-8")
    # core-constraints 和 anti-ai-guide 已内化为"写作铁律"段落
    assert "写作铁律" in text or "Anti-AI" in text
    assert "写作任务书" in text
    assert "Step 2 直写提示词" not in text
    assert "Context Contract" not in text


def test_agents_do_not_name_nonexistent_writing_dna_files():
    for filename in ("context-agent.md", "reviewer.md"):
        text = (AGENTS_DIR / filename).read_text(encoding="utf-8")
        assert "P20_WRITING_DNA" not in text
        assert "WRITING_DNA.md" not in text
        assert ".claude/rules/P20_" not in text


def test_data_agent_is_described_as_extraction_only_not_direct_write_mainline():
    text = (AGENTS_DIR / "data-agent.md").read_text(encoding="utf-8")
    assert "chapter-commit" in text
    assert "extraction_result.json" in text
    assert "直接写入 index.db 和 state.json" not in text


def test_dashboard_and_plan_skills_surface_story_runtime_mainline():
    dashboard_text = (SKILLS_DIR / "webnovel-dashboard" / "SKILL.md").read_text(encoding="utf-8")
    plan_text = (SKILLS_DIR / "webnovel-plan" / "SKILL.md").read_text(encoding="utf-8")
    assert "story-runtime/health" in dashboard_text
    assert ".story-system/" in plan_text


def test_webnovel_write_skill_routes_step2_through_writing_brief():
    text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")
    assert "写作任务书" in text
    assert "context-agent" in text
    assert "Step 0.5" not in text
    assert 'cat "${SKILL_ROOT}/../../references/shared/core-constraints.md"' not in text
    assert 'cat "${SKILL_ROOT}/references/anti-ai-guide.md"' not in text


def test_context_agent_and_write_skill_form_isolated_write_chain():
    context_text = (AGENTS_DIR / "context-agent.md").read_text(encoding="utf-8")
    skill_text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")

    assert "写作任务书" in context_text
    assert "写作任务书" in skill_text
    assert "context-agent" in skill_text
    assert "Context Contract" not in context_text
    assert "Step 2 直写提示词" not in context_text


def test_no_direct_state_writes_in_write_skill():
    """webnovel-write SKILL.md 中不应有 set-chapter-status 调用。"""
    text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")
    assert "state set-chapter-status" not in text, (
        "webnovel-write 中不应直接调用 state set-chapter-status，"
        "chapter_status 由 state_projection_writer 在 commit 时自动推进"
    )


def test_no_direct_state_writes_in_agents():
    """agents 目录中不应有直接写 state/index 的指令。"""
    for agent_file in AGENT_FILES:
        text = _read_text(agent_file)
        assert "state set-chapter-status" not in text, (
            f"{agent_file.name}: 不应直接调用 state set-chapter-status"
        )


def test_deconstruction_agent_preserves_init_handoff_and_boundaries():
    """reference deconstruction must remain extraction-only and init-scoped."""
    text = _read_text(AGENTS_DIR / "deconstruction-agent.md")

    assert "init_reference_research" in text
    assert ".webnovel/tmp/reference_analyses/<safe-title>/" not in text
    assert "不写任何文件" in text
    assert "不得写 `_progress.md`" in text
    assert "resume_state" in text
    assert "tools: Read, Grep, Bash" in text
    assert "快速模式" in text
    assert "深度模式" in text
    assert "黄金三章" in text
    assert "情节点" in text
    assert "质量门控" in text
    assert "不得凭记忆" in text
    assert "条件框架" in text
    assert "情绪链条" in text
    assert "核心梗边界" in text

    for field in (
        "reader_promise",
        "opening_hook_patterns",
        "cool_point_loops",
        "protagonist_patterns",
        "antagonist_pressure_patterns",
        "pacing_notes",
        "borrowable_structures",
        "do_not_copy",
        "differentiation_requirements",
        "init_candidates",
        "quality",
        "resume_state",
        "orphan_plot_fallback",
        "canon_contamination_warnings",
    ):
        assert f'"{field}"' in text

    for forbidden_path in (
        ".story-system/",
        "设定集/",
        "大纲/",
        "正文/",
        ".webnovel/",
    ):
        assert forbidden_path in text

    assert "不写 `idea_bank.json`" in text
    assert "用户确认后" in text
    assert "MIT License attribution" not in text


def test_webnovel_init_deconstruction_wiring_keeps_confirmation_gate():
    """init may consume only confirmed, transformed reference patterns."""
    text = _read_text(SKILLS_DIR / "webnovel-init" / "SKILL.md")

    assert 'subagent_type: "webnovel-writer:deconstruction-agent"' in text
    assert "Step 1.5：灵感来源询问" in text
    assert "进入故事核采集前" in text
    assert "不要默认拆书" in text
    assert "你这本书的灵感来源想从哪里开始" in text
    assert "init_reference_research" in text
    assert "init_reference_research JSON 对象" in text
    assert ".webnovel/tmp/reference_analyses/<safe-title>/" not in text
    assert "project_root=${PROJECT_ROOT" not in text
    assert "不写任何文件" in text
    assert "不得由 init 主流程口头替代拆解结果" in text
    assert "`quality`" in text
    assert "`quality.passed=false`" in text
    assert "`confidence < 0.85`" in text

    for handoff_field in (
        "reader_promise",
        "opening_hook_patterns",
        "cool_point_loops",
        "protagonist_patterns",
        "antagonist_pressure_patterns",
        "pacing_notes",
        "borrowable_structures",
        "differentiation_requirements",
        "init_candidates",
    ):
        assert handoff_field in text

    for forbidden_path in (
        "idea_bank.json",
        ".story-system",
        "设定集",
        "大纲",
        "正文",
        ".webnovel/state.json",
    ):
        assert forbidden_path in text

    assert "用户确认前" in text
    assert "Step 2-6 只能使用用户确认过、并已变形为本书差异化表达的模式" in text
    assert "汇总 Step 1.5 已确认的灵感来源" in text
