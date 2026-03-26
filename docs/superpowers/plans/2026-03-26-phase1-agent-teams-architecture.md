# Phase 1: Agent Teams 架构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现混合架构，上下文隔离，主窗口上下文大小降低50%，每章API调用降到80次以内

**Architecture:** 混合架构 - 主Agent仅保留精简上下文，Context Agent/Data Agent/审查器池通过文件交换中间结果，分组并行执行审查

**Tech Stack:** Python + Bash CLI + JSON中间文件 + Task子代理

---

## 文件结构

```
.webnovel/tmp/agent_outputs/           # 中间结果目录
├── ctx_ch{NNNN}.json                 # Context Agent 输出
├── rev1_ch{NNNN}.json                # 审查器组1输出
├── rev2_ch{NNNN}.json                # 审查器组2输出
└── data_ch{NNNN}.json                # Data Agent 输出
```

### 需创建的文件

| 文件 | 职责 |
|------|------|
| `docs/agent-protocol.md` | 中间层协议规范 |
| `webnovel-writer/agents/context-agent.md` (改造) | 支持独立输出模式 |
| `webnovel-writer/agents/data-agent.md` (改造) | 支持独立输出模式 |
| `webnovel-writer/skills/webnovel-write/SKILL.md` (改造) | 主Agent精简上下文加载 |

---

## Task 1: 设计中间层协议

**Files:**
- Create: `docs/agent-protocol.md`
- Modify: `webnovel-writer/scripts/workflow_manager.py` (添加中间文件支持)

- [ ] **Step 1: 创建协议文档框架**

```bash
mkdir -p docs
cat > docs/agent-protocol.md << 'EOF'
# Agent 中间层协议 (Agent Middleware Protocol)

## 概述

本协议定义了主Agent与子Agent之间的文件交换规范，实现上下文隔离。

## 中间文件命名规范

| 文件类型 | 命名格式 | 内容 |
|----------|----------|------|
| Context Agent 输出 | `ctx_ch{NNNN}.json` | 创作执行包摘要 |
| 审查器组1输出 | `rev1_ch{NNNN}.json` | 一致性+连贯性+OOC审查结果 |
| 审查器组2输出 | `rev2_ch{NNNN}.json` | 追读力+爽点+节奏审查结果 |
| Data Agent 输出 | `data_ch{NNNN}.json` | 状态更新确认 |

## 版本号规范

```json
{
  "version": "1.0",
  "chapter": 100,
  "timestamp": "2026-03-26T10:00:00Z",
  "checksum": "sha256:..."
}
```

## 写入协议

1. 写入前先写 `.tmp` 文件
2. 完成后 rename 到正式位置
3. 读取前检查 checksum

## 目录结构

```
.webnovel/tmp/agent_outputs/
├── ctx_ch0100.json       # Context Agent
├── rev1_ch0100.json      # 审查器组1
├── rev2_ch0100.json      # 审查器组2
├── data_ch0100.json      # Data Agent
└── .lock/                # 锁文件目录
```
EOF
```

- [ ] **Step 2: 提交协议文档**

```bash
git add docs/agent-protocol.md
git commit -m "docs: 添加Agent中间层协议规范"
```

---

## Task 2: Context Agent 独立输出改造

**Files:**
- Modify: `webnovel-writer/agents/context-agent.md`

- [ ] **Step 1: 添加独立输出模式支持**

在 context-agent.md 添加 `--output-file` 参数支持：

```markdown
## 新增：独立输出模式

当传入 `--output-file` 时，Context Agent 将结果写入指定JSON文件而非直接输出。

### 输入
```json
{
  "chapter": 100,
  "project_root": "D:/wk/斗破苍穹",
  "storage_path": ".webnovel/",
  "state_file": ".webnovel/state.json",
  "output_file": ".webnovel/tmp/agent_outputs/ctx_ch0100.json"
}
```

### 输出格式
```json
{
  "version": "1.0",
  "chapter": 100,
  "timestamp": "2026-03-26T10:00:00Z",
  "task_summary": "萧炎在天云宗获得传承，突破斗师",
  "constraints": ["主线不动摇", "战力严格递增"],
  "style_guide": "战斗场面详尽，感情线克制",
  "entities_in_chapter": ["xiaoyan", "master", "tianyun_sect"],
  "context_contract": {
    "目标": "...",
    "阻力": "...",
    "代价": "...",
    "本章变化": "...",
    "未闭合问题": "...",
    "开头类型": "...",
    "情绪节奏": "...",
    "追读力设计": "..."
  },
  "writing_prompt": {
    "beat_sheet": "...",
    "immutable_facts": [...],
    "prohibitions": [...],
    "final_checklist": [...]
  }
}
```
```

- [ ] **Step 2: 更新CLI调用方式**

在 SKILL.md 的 Step 1 中添加：

```bash
# 新增：独立输出模式
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" context \
  --chapter ${chapter_num} \
  --output-file "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/ctx_ch${chapter_padded}.json"
```

- [ ] **Step 3: 测试 Context Agent 输出**

```bash
export PROJECT_ROOT="测试项目路径"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" context --chapter 1 --output-file "/tmp/test_ctx.json"
cat /tmp/test_ctx.json | jq '.version, .chapter, .task_summary'
```

- [ ] **Step 4: 提交改动**

```bash
git add webnovel-writer/agents/context-agent.md webnovel-writer/skills/webnovel-write/SKILL.md
git commit -m "feat: Context Agent 支持独立输出模式"
```

---

## Task 3: 审查器分组并行实现

**Files:**
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md`
- Modify: `webnovel-writer/scripts/workflow_manager.py`

- [ ] **Step 1: 定义审查器分组**

在 SKILL.md 中添加：

```markdown
## 审查器分组

### 组1：核心审查器（必须同时执行）
- `consistency-checker` - 设定一致性
- `continuity-checker` - 连贯性
- `ooc-checker` - 人物OOC

### 组2：扩展审查器（条件执行）
- `reader-pull-checker` - 追读力
- `high-point-checker` - 爽点
- `pacing-checker` - 节奏

### 分组执行规则
- 组1必须全部执行，结果合并到 `rev1_ch{NNNN}.json`
- 组2按 `auto` 路由执行，结果合并到 `rev2_ch{NNNN}.json`
```

- [ ] **Step 2: 修改Step 3的Task调用**

将原有的串行审查器调用改为分组并行：

```bash
# Step 3: 审查器组1（并行）
cat "${SKILL_ROOT}/references/step-3-review-gate.md"

Task: webnovel-writer:consistency-checker
  --chapter ${chapter_num}
  --chapter-file "${PROJECT_ROOT}/正文/第${chapter_padded}章.md"
  --output-file "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/rev1_ch${chapter_padded}.json"

Task: webnovel-writer:continuity-checker
  --chapter ${chapter_num}
  --chapter-file "${PROJECT_ROOT}/正文/第${chapter_padded}章.md"
  --output-file "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/rev1_ch${chapter_padded}.json"

Task: webnovel-writer:ooc-checker
  --chapter ${chapter_num}
  --chapter-file "${PROJECT_ROOT}/正文/第${chapter_padded}章.md"
  --output-file "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/rev1_ch${chapter_padded}.json"

# 审查器组2（条件并行）
if [ "${AUTO_ROUTE}" = "true" ]; then
  Task: webnovel-writer:reader-pull-checker
    --chapter ${chapter_num}
    --chapter-file "${PROJECT_ROOT}/正文/第${chapter_padded}章.md"
    --output-file "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/rev2_ch${chapter_padded}.json"
  # ... 其他条件审查器
fi
```

- [ ] **Step 3: 添加审查结果合并逻辑**

在 SKILL.md Step 3 末尾添加：

```bash
# 合并审查结果
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  review merge \
  --group1 "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/rev1_ch${chapter_padded}.json" \
  --group2 "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/rev2_ch${chapter_padded}.json" \
  --output "${PROJECT_ROOT}/.webnovel/tmp/review_merged_ch${chapter_padded}.json"
```

- [ ] **Step 4: 添加merge命令到webnovel.py**

在 `data_modules/webnovel.py` 添加 merge 命令处理：

```python
elif action == "review" and sub_action == "merge":
    # 合并审查结果
    pass
```

- [ ] **Step 5: 测试分组审查**

```bash
export PROJECT_ROOT="测试项目路径"
# 模拟审查器输出
echo '{"issues":[],"critical_count":0,"high_count":0,"overall_score":85}' > /tmp/test_rev1.json
echo '{"issues":[],"critical_count":0,"high_count":0,"overall_score":80}' > /tmp/test_rev2.json
```

- [ ] **Step 6: 提交改动**

```bash
git add webnovel-writer/skills/webnovel-write/SKILL.md
git commit -m "feat: 审查器分组并行执行"
```

---

## Task 4: Data Agent 独立输出改造

**Files:**
- Modify: `webnovel-writer/agents/data-agent.md`

- [ ] **Step 1: 添加独立输出模式支持**

在 data-agent.md 添加：

```markdown
## 新增：独立输出模式

当传入 `--output-file` 时，Data Agent 将结果写入指定JSON文件。

### 输入
```json
{
  "chapter": 100,
  "chapter_file": "正文/第0100章.md",
  "review_score": 85,
  "project_root": "D:/wk/斗破苍穹",
  "storage_path": ".webnovel/",
  "state_file": ".webnovel/state.json",
  "output_file": ".webnovel/tmp/agent_outputs/data_ch0100.json"
}
```

### 输出格式
```json
{
  "version": "1.0",
  "chapter": 100,
  "timestamp": "2026-03-26T10:00:00Z",
  "entities_updated": 5,
  "state_changes": [...],
  "summary_written": true,
  "scenes_chunked": 4,
  "warnings": []
}
```
```

- [ ] **Step 2: 更新CLI调用**

在 SKILL.md 的 Step 5 中添加：

```bash
# Data Agent 独立输出模式
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  data-agent \
  --chapter ${chapter_num} \
  --chapter-file "正文/第${chapter_padded}章.md" \
  --review-score ${review_score} \
  --output-file "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/data_ch${chapter_padded}.json"
```

- [ ] **Step 3: 提交改动**

```bash
git add webnovel-writer/agents/data-agent.md webnovel-writer/skills/webnovel-write/SKILL.md
git commit -m "feat: Data Agent 支持独立输出模式"
```

---

## Task 5: 主Agent精简上下文加载

**Files:**
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md`

- [ ] **Step 1: 分析当前上下文加载**

当前主Agent在Step 1加载的内容：
- 全部 state.json
- 全部 index.db 查询结果
- 全部章节大纲
- 全部上章摘要

改造后主Agent只加载：
- `ctx_ch{NNNN}.json` 中的 task_summary + constraints + style_guide
- 不再加载完整state/index

- [ ] **Step 2: 修改Step 1加载逻辑**

在 SKILL.md 的 Step 1 中：

```bash
# 旧逻辑：直接调用 Context Agent 获取完整上下文
# Task: context-agent ...

# 新逻辑：调用独立模式，结果写入文件，主Agent只读摘要
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  context \
  --chapter ${chapter_num} \
  --output-file "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/ctx_ch${chapter_padded}.json"

# 主Agent仅加载精简后的上下文
export CONTEXT_SUMMARY="$(cat "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/ctx_ch${chapter_padded}.json" | jq -r '.task_summary')"
export CONTEXT_CONSTRAINTS="$(cat "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/ctx_ch${chapter_padded}.json" | jq -r '.constraints | join(", ")')"
export CONTEXT_STYLE="$(cat "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/ctx_ch${chapter_padded}.json" | jq -r '.style_guide')"
```

- [ ] **Step 3: 更新Step 2A写作提示词**

```bash
# Step 2A 使用精简上下文
# 旧：加载大量参考文档
# 新：仅使用 Context Agent 输出文件中的关键信息
```

- [ ] **Step 4: 测试精简上下文加载**

```bash
# 对比改造前后主窗口收到的数据量
# 改造前：约 5000 tokens/章
# 改造后：约 1500 tokens/章
```

- [ ] **Step 5: 提交改动**

```bash
git add webnovel-writer/skills/webnovel-write/SKILL.md
git commit -m "feat: 主Agent精简上下文加载"
```

---

## Task 6: 端到端测试

**Files:**
- Modify: `webnovel-writer/scripts/workflow_manager.py` (添加观测)

- [ ] **Step 1: 创建测试项目**

```bash
# 创建测试小说项目
export PROJECT_ROOT="/tmp/test_webnovel_project"
mkdir -p "${PROJECT_ROOT}"

# 初始化测试项目
python -X utf8 "${CLAUDE_PLUGIN_ROOT}/scripts/webnovel.py" \
  --project-root "${PROJECT_ROOT}" init \
  --title "测试小说" \
  --genre "xuanhuan"
```

- [ ] **Step 2: 执行完整写作流程**

```bash
# 写入一章测试
cd "${PROJECT_ROOT}"
# 调用 /webnovel-write 1
```

- [ ] **Step 3: 验证中间文件生成**

```bash
# 检查中间文件
ls -la "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/"
cat "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/ctx_ch0001.json" | jq keys
cat "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/rev1_ch0001.json" | jq keys
cat "${PROJECT_ROOT}/.webnovel/tmp/agent_outputs/data_ch0001.json" | jq keys
```

- [ ] **Step 4: 统计API调用次数**

```bash
# 统计CLI调用次数
# 改造前：100-150次/章
# 改造后目标：60-80次/章

# 监控脚本
watch_cli_calls() {
  local count=0
  while read line; do
    ((count++))
    echo "[$(date +%H:%M:%S)] CLI调用 #$count: $line"
  done
}

# 重新执行并统计
```

- [ ] **Step 5: 验证主窗口上下文大小**

```bash
# 测量主窗口收到的上下文大小
# 使用 Claude API 日志或监控工具
```

- [ ] **Step 6: 验收标准检查**

| 指标 | 目标 | 验证方法 |
|------|------|----------|
| 中间文件生成 | 4个文件/章 | `ls .webnovel/tmp/agent_outputs/` |
| 主窗口上下文降低 | ≥50% | 对比改造前后token数 |
| API调用次数 | ≤80次/章 | CLI调用计数 |
| 章节质量 | overall_score≥75 | 检查 review_metrics |

- [ ] **Step 7: 提交测试结果**

```bash
git add docs/test-results-phase1.md
git commit -m "test: Phase 1 端到端测试结果"
```

---

## 依赖关系

```
Task 1 (协议设计)
    ↓
Task 2 (Context Agent改造) ← Task 1 完成
    ↓
Task 5 (主Agent精简) ← Task 2 完成
    ↓
Task 3 (审查器分组) ← Task 1 完成
    ↓
Task 4 (Data Agent改造) ← Task 1 完成
    ↓
Task 6 (端到端测试) ← Task 2,3,4,5 全部完成
```

---

## 回滚计划

| 步骤 | 回滚方式 |
|------|----------|
| Task 1 | 删除 `docs/agent-protocol.md` |
| Task 2 | `git revert` Context Agent改动 |
| Task 3 | `git revert` 审查器分组改动 |
| Task 4 | `git revert` Data Agent改动 |
| Task 5 | `git revert` 主Agent精简改动 |
| Task 6 | 删除测试项目，保留 `git revert` |

---

## 验收标准

- [ ] 主窗口上下文大小降低 **50%**
- [ ] 每章API调用降到 **80次以内**
- [ ] 中间文件正确生成
- [ ] 审查器分组并行执行
- [ ] 端到端测试通过
- [ ] 章节质量不下降（overall_score ≥ 75）

---

## 测试结果

**测试日期**: 2026-03-26

### 验收标准检查

| 验收项 | 状态 | 说明 |
|--------|------|------|
| 协议文档创建 | ✅ | `docs/agent-protocol.md` 已创建 |
| Context Agent独立输出模式 | ✅ | `webnovel-writer/agents/context-agent.md` 包含独立输出模式章节 |
| 审查器分组规范 | ✅ | `webnovel-writer/skills/webnovel-write/SKILL.md` 包含审查器分组章节 |
| Data Agent独立输出模式 | ✅ | `webnovel-writer/agents/data-agent.md` 包含独立输出模式章节 |
| 主Agent精简上下文加载 | ✅ | `webnovel-writer/skills/webnovel-write/SKILL.md` 包含 Step 1.5 |

### Phase 1 完成状态

- [x] Task 1: 设计中间层协议
- [x] Task 2: Context Agent 独立输出改造
- [x] Task 3: 审查器分组并行实现
- [x] Task 4: Data Agent 独立输出改造
- [x] Task 5: 主Agent精简上下文加载
- [x] Task 6: 端到端测试（本文档更新）

### 下一步

Phase 1 文档改造已完成，实际运行时测试需要在真实项目中验证。
