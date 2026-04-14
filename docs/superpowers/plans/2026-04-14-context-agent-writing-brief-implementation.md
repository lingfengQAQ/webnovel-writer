# Context Agent 写作任务书收束 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `context-agent` 成为唯一写前入口，代码层只准备 research 底稿，最终由 `context-agent` 按示例直接写出给 Step 2 使用的写作任务书。

**Architecture:** 不再引入模板生成器。`extract_chapter_context.py` 继续负责组装 research 底稿；`context-agent` 基于底稿、固定守则和文档内示例，直接产出最终写作任务书；`webnovel-write` 的 Step 2 只消费这份任务书，不再自己补规则或拼中间块。

**Tech Stack:** Python 3、pytest、Markdown agent/skill prompt、`webnovel.py` CLI

---

## 文件结构

### 修改文件

- `webnovel-writer/scripts/extract_chapter_context.py`
  - 保持为底稿组装器，不负责最终文案生成
- `webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py`
  - 验证底稿字段与旧文本输出能力
- `webnovel-writer/agents/context-agent.md`
  - 收回 Step 0.5 职责，明确按示例直接输出写作任务书
- `webnovel-writer/skills/webnovel-write/SKILL.md`
  - 删除 Step 0.5，Step 2 改为只消费写作任务书
- `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`
  - 锁定新的提示词边界
- `webnovel-writer/skills/webnovel-write/evals/evals.json`
  - 更新流程预期
- `docs/guides/commands.md`
  - 更新 `/webnovel-write` 描述

### 删除文件

- `webnovel-writer/scripts/data_modules/writing_brief_renderer.py`
- `webnovel-writer/scripts/data_modules/tests/test_writing_brief_renderer.py`

---

### Task 1: 删除生成器路线并恢复底稿职责

**Files:**
- Delete: `webnovel-writer/scripts/data_modules/writing_brief_renderer.py`
- Delete: `webnovel-writer/scripts/data_modules/tests/test_writing_brief_renderer.py`
- Modify: `webnovel-writer/scripts/extract_chapter_context.py`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py`

- [ ] **Step 1: 删除生成器文件**

```bash
git rm webnovel-writer/scripts/data_modules/writing_brief_renderer.py
git rm webnovel-writer/scripts/data_modules/tests/test_writing_brief_renderer.py
```

- [ ] **Step 2: 移除 `extract_chapter_context.py` 中的生成器调用**

```python
# webnovel-writer/scripts/extract_chapter_context.py
# 删除：
from data_modules.writing_brief_renderer import render_writer_brief

# 删除：
def _plugin_root() -> Path: ...
def _load_fixed_guides() -> Dict[str, str]: ...
def _extract_book_title(project_root: Path, state: Dict[str, Any]) -> str: ...
def _extract_chapter_title(outline: str, chapter_num: int) -> str: ...

# build_chapter_context_payload 保留为底稿输出：
return {
    "chapter": chapter_num,
    "outline": outline,
    "previous_summaries": prev_summaries,
    "state_summary": state_summary,
    "context_contract_version": contract_context.get("context_contract_version"),
    "context_weight_stage": contract_context.get("context_weight_stage"),
    "story_contract": contract_context.get("story_contract", {}),
    "runtime_status": contract_context.get("runtime_status", {}),
    "latest_commit": contract_context.get("latest_commit", {}),
    "prewrite_validation": contract_context.get("prewrite_validation", {}),
    "reader_signal": contract_context.get("reader_signal", {}),
    "genre_profile": contract_context.get("genre_profile", {}),
    "writing_guidance": contract_context.get("writing_guidance", {}),
    "plot_structure": plot_structure,
    "long_term_memory": contract_context.get("long_term_memory", {}),
    "scene": contract_context.get("scene", {}),
    "core": contract_context.get("core", {}),
    "rag_assist": rag_assist,
}
```

- [ ] **Step 3: 删除 `writer_brief` 相关测试，恢复旧文本输出断言**

```python
# webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py
# 删除：
def test_build_chapter_context_payload_includes_writer_brief(...): ...
def test_render_text_returns_writer_brief_instead_of_old_audit_sections(...): ...

# 保留：
def test_render_text_contains_writing_guidance_section(...): ...
def test_render_text_contains_contract_first_runtime_section(...): ...
```

- [ ] **Step 4: 跑测试确认底稿链恢复正常**

Run:

```bash
python -m pytest webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py -q --no-cov
```

Expected:

```text
全部通过，0 失败
```

- [ ] **Step 5: 提交这一块**

```bash
git add webnovel-writer/scripts/extract_chapter_context.py \
        webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py
git commit -m "refactor: keep chapter context as research draft only"
```

---

### Task 2: 让 `context-agent` 直接按示例输出写作任务书

**Files:**
- Modify: `webnovel-writer/agents/context-agent.md`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`

- [ ] **Step 1: 先补静态测试，锁住示例驱动输出**

```python
# webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py
def test_context_agent_loads_fixed_guides_and_outputs_writer_brief():
    text = (AGENTS_DIR / "context-agent.md").read_text(encoding="utf-8")
    assert "core-constraints.md" in text
    assert "anti-ai-guide.md" in text
    assert "写作任务书" in text
    assert "### 示例" in text
    assert "你现在要写《凡人修仙传》第47章《坊市试探》。" in text
    assert "Step 2 直写提示词" not in text
    assert "Context Contract" not in text
```

- [ ] **Step 2: 改 `context-agent.md`**

```md
### webnovel-writer/agents/context-agent.md

## 8. 输出格式

最终只输出一份写作任务书。

任务书固定写成五段，每一段该织入哪些数据源见下方说明和示例。

### 1. 开篇委托
### 2. 这一章的故事
### 3. 这章的人物
### 4. 这章怎么写更顺
### 5. 这章收在哪里

### 示例

你现在要写《凡人修仙传》第47章《坊市试探》。
...
让读者带着"这个人到底是谁"翻到下一章。
```

- [ ] **Step 3: 跑静态测试**

Run:

```bash
python -m pytest webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py -q --no-cov
```

Expected:

```text
相关断言全部通过
```

- [ ] **Step 4: 提交这一块**

```bash
git add webnovel-writer/agents/context-agent.md \
        webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py
git commit -m "feat: make context agent write briefs from example"
```

---

### Task 3: 收束 `/webnovel-write` 主链

**Files:**
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md`
- Modify: `webnovel-writer/skills/webnovel-write/evals/evals.json`
- Modify: `docs/guides/commands.md`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`

- [ ] **Step 1: 先补静态测试，锁住新流程**

```python
# webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py
def test_webnovel_write_skill_routes_step2_through_writing_brief():
    text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")
    assert "写作任务书" in text
    assert "context-agent" in text
    assert "Step 0.5" not in text
    assert 'cat "${SKILL_ROOT}/../../references/shared/core-constraints.md"' not in text
    assert 'cat "${SKILL_ROOT}/references/anti-ai-guide.md"' not in text
```

- [ ] **Step 2: 改 `webnovel-write/SKILL.md`**

```md
### Step 1：调用 Context Agent 生成写作任务书

### Step 2：起草正文

硬要求：
- Step 2 只根据 Step 1 生成的写作任务书起草正文
- Step 2 不再直接加载 `core-constraints.md`
- Step 2 不再直接加载 `anti-ai-guide.md`
- Step 2 不再自己拼中间块或旧版直写块
```

- [ ] **Step 3: 改 eval 和命令文档**

```json
// webnovel-writer/skills/webnovel-write/evals/evals.json
"expected_output": "完成 Step 1 到 Step 6 的完整流程，由 context-agent 先生成写作任务书，再起草第4章正文..."
```

```md
### docs/guides/commands.md

执行完整章节创作流程（`context-agent` 先 research 并生成写作任务书 → 按任务书起草正文 → 审查 → 润色 → 数据落盘）。
```

- [ ] **Step 4: 跑静态测试**

Run:

```bash
python -m pytest webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py -q --no-cov
```

Expected:

```text
相关断言全部通过
```

- [ ] **Step 5: 提交这一块**

```bash
git add webnovel-writer/skills/webnovel-write/SKILL.md \
        webnovel-writer/skills/webnovel-write/evals/evals.json \
        docs/guides/commands.md \
        webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py
git commit -m "feat: make write step consume only final brief"
```

---

### Task 4: 回归验证

**Files:**
- Test: `webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py`
- Test: `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`

- [ ] **Step 1: 跑回归测试**

Run:

```bash
python -m pytest \
  webnovel-writer/scripts/data_modules/tests/test_extract_chapter_context.py \
  webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py \
  -q --no-cov
```

Expected:

```text
全部通过，0 失败
```

- [ ] **Step 2: grep 自检**

Run:

```bash
rg -n "Step 0\\.5|writing_brief_renderer|test_writing_brief_renderer|Context Contract|Step 2 直写提示词|cat \\\"\\$\\{SKILL_ROOT\\}/../../references/shared/core-constraints.md\\\"|cat \\\"\\$\\{SKILL_ROOT\\}/references/anti-ai-guide.md\\\"" \
  webnovel-writer \
  docs/guides/commands.md
```

Expected:

```text
除计划文档历史记录外，无业务代码残留
```

---

## 覆盖检查

这份计划覆盖当前真实方案：

1. 代码层只准备底稿
2. `context-agent` 直接按示例写任务书
3. `/webnovel-write` Step 2 只消费任务书
4. 不再使用模板生成器
5. `anti-ai-guide.md` 与 `core-constraints.md` 继续存在，但由 `context-agent` 吸收后转写

## 自检

- 已移除模板生成器路线
- 没再要求字段映射表
- 与当前未提交实现方向一致
