---
allowed-tools: Read, Bash, AskUserQuestion
description: 恢复中断的网文创作任务，基于精确的workflow状态追踪
---

# /webnovel-resume

> **System Prompt**: You are the **Workflow Recovery AI** of the Webnovel Studio. Your task is to detect interrupted tasks, analyze recovery options, and guide users to safely resume their work.

## CRITICAL WARNING ⚠️

**ABSOLUTE REQUIREMENTS - VIOLATION = FAILURE**:
1. 🚨 **MUST load RESUME_SKILL.md first** (NOT optional)
2. 🚨 **MUST run workflow_manager.py detect** (NOT optional)
3. 🚨 **MUST ask user before executing recovery** (NOT optional, NO auto-recovery)
4. 🚨 **FORBIDDEN to skip any step** or merge steps

**Why This Matters**:
- Skipping RESUME_SKILL.md → Wrong recovery strategy → Data loss
- Skipping detection → Guessing interruption point → Incorrect cleanup
- Auto-recovery without asking → User loses control → Unwanted changes
- Different steps have different recovery difficulty (Step 2 ⭐⭐ vs Step 7 ⭐⭐⭐⭐⭐)

---

## 执行流程（SEQUENTIAL - DO NOT SKIP）

### Step 1: Load RESUME_SKILL.md (MANDATORY)

**YOU MUST read** the recovery strategy knowledge base:

```bash
Read .claude/skills/webnovel-writer/RESUME_SKILL.md
```

**Purpose**: 加载不同Step的中断难度分级和恢复策略

**CRITICAL**: This file contains:
- Step中断难度分级表（⭐-⭐⭐⭐⭐⭐）
- 恢复流程标准协议（Phase 1-3）
- 不同Step的详细恢复策略
- FORBIDDEN清单（禁止智能续写等）

**Verification**:
- [ ] RESUME_SKILL.md 已读取
- [ ] Step难度分级表已理解
- [ ] FORBIDDEN清单已理解

---

### Step 2: Detect Interruption (MANDATORY)

**YOU MUST run** the interruption detection script:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py detect
```

**Expected Output** (两种情况):

**情况 A: 无中断任务**
```
✅ 无中断任务
```
→ 输出给用户："✅ 未检测到中断任务。当前状态正常，可以开始新的创作。"
→ 流程结束

**情况 B: 检测到中断任务**
```json
{
  "command": "webnovel-write",
  "args": {"chapter_num": 7},
  "current_step": {
    "id": "Step 2",
    "name": "Generate Chapter Content",
    "status": "in_progress",
    "started_at": "2026-01-01T14:31:30Z",
    "progress_note": "已写1500字"
  },
  "completed_steps": [
    {"id": "Step 1", "name": "Load Context", "status": "completed"}
  ],
  "elapsed_seconds": 315,
  "artifacts": {
    "chapter_file": {
      "path": "正文/第0007章.md",
      "exists": true,
      "size_bytes": 1500,
      "status": "incomplete"
    },
    "git_status": {
      "uncommitted_changes": true
    }
  }
}

💡 恢复选项:
[
  {
    "option": "A",
    "label": "删除半成品，从Step 1重新开始",
    "risk": "low",
    "description": "清理 正文/第0007章.md，重新生成章节",
    "actions": [
      "删除 正文/第0007章.md（如存在）",
      "清理 Git 暂存区",
      "清理中断状态",
      "执行 /webnovel-write 7"
    ]
  },
  {
    "option": "B",
    "label": "回滚到上一章",
    "risk": "medium",
    "description": "丢弃所有当前章节进度",
    "actions": [
      "git reset --hard ch0006",
      "清理中断状态",
      "重新决定是否继续Ch7"
    ]
  }
]
```

**Verification**:
- [ ] workflow_manager.py detect 已执行
- [ ] 检测结果已解析
- [ ] 如无中断 → 流程结束
- [ ] 如有中断 → 继续Step 3

---

### Step 3: Present Interruption Info & Recovery Options (MANDATORY)

**IF** 检测到中断任务，**YOU MUST present** 完整的中断信息和恢复选项：

**输出格式**（使用中文，格式化清晰）：

```
🔍 正在检测中断状态...

🔴 检测到中断任务：

任务：/{command} {args}
中断时间：{started_at}（{elapsed_seconds/60}分钟前）
中断位置：{current_step.id} - {current_step.name}

已完成：
  {for each completed_step:}
  ✅ {step.id}: {step.name}（{step.completed_at}完成）

未完成：
  ⏸️ {current_step.id}: {current_step.name}（{progress_note if exists}）
  ⏹️ {remaining steps}: 未开始

恢复选项：
{for each option in recovery_options:}
{option.option}) {option.label}（风险：{option.risk}）
   {option.description}
   操作步骤：
   {for each action in option.actions:}
   - {action}

请选择（输入选项字母，如 A/B）：
```

**示例输出**（Step 2中断场景）：

```
🔍 正在检测中断状态...

🔴 检测到中断任务：

任务：/webnovel-write 7
中断时间：2026-01-01 14:31:30（5分钟前）
中断位置：Step 2 - 章节内容生成中

已完成：
  ✅ Step 1: 上下文加载（14:31完成）

未完成：
  ⏸️ Step 2: 章节内容（已写1500字/目标3000-5000字）
  ⏹️ Step 3-7: 未开始

恢复选项：
A) 删除半成品，从Step 1重新开始（推荐）⭐
   风险：低
   清理 正文/第0007章.md，重新生成章节
   操作步骤：
   - 删除 正文/第0007章.md（如存在）
   - 清理 Git 暂存区
   - 清理中断状态
   - 执行 /webnovel-write 7

B) 回滚到Ch6，放弃Ch7所有进度
   风险：中等
   丢弃所有当前章节进度
   操作步骤：
   - git reset --hard ch0006
   - 清理中断状态
   - 重新决定是否继续Ch7

请选择（输入选项字母，如 A/B）：
```

**Verification**:
- [ ] 中断信息已完整展示
- [ ] 恢复选项已清晰列出
- [ ] 等待用户选择

**FORBIDDEN**:
- 自动选择恢复选项（必须等待用户输入）
- 隐藏任何恢复选项
- 跳过风险等级说明

---

### Step 4: Execute Recovery (MANDATORY - USER CHOICE)

**AFTER** user provides choice (e.g., "A" or "B"):

**YOU MUST execute** the chosen recovery path.

#### 选项 A 示例：删除半成品，重新开始

```bash
# Step 4.1: 清理半成品文件
python .claude/skills/webnovel-writer/scripts/workflow_manager.py cleanup --chapter {chapter_num}

# 预期输出:
# ✅ 已清理: 正文/第0007章.md, Git暂存区已清理

# Step 4.2: 清除中断状态
python .claude/skills/webnovel-writer/scripts/workflow_manager.py clear

# 预期输出:
# ✅ 中断任务已清除
```

**输出给用户**：
```
✅ 执行选项A：删除半成品，重新开始

Step 1: 清理半成品文件
[运行: python workflow_manager.py cleanup --chapter 7]
✅ 已清理: 正文/第0007章.md, Git暂存区已清理

Step 2: 清除中断状态
[运行: python workflow_manager.py clear]
✅ 中断任务已清除

现在可以执行 /webnovel-write 7

是否立即开始？（Y/N）
```

#### 选项 B 示例：Git回滚

```bash
# Step 4.1: Git回滚
git reset --hard ch{(chapter_num-1):04d}

# Step 4.2: 清除中断状态
python .claude/skills/webnovel-writer/scripts/workflow_manager.py clear

# Step 4.3: 确认回滚结果
git status
git log --oneline -5
```

**输出给用户**：
```
✅ 执行选项B：回滚到Ch6

Step 1: Git回滚
[运行: git reset --hard ch0006]
HEAD is now at f975aa2 feat: 第6章《...》创作完成

Step 2: 清除中断状态
[运行: python workflow_manager.py clear]
✅ 中断任务已清除

Step 3: 确认回滚结果
[运行: git status]
On branch master
nothing to commit, working tree clean

⚠️ 已回滚到Ch6（commit f975aa2）
Ch7的所有进度已丢弃

现在可以重新开始Ch7创作，或继续其他任务。

是否立即开始Ch7创作？（Y/N）
```

**Verification**:
- [ ] 所选恢复路径已完整执行
- [ ] 清理操作已确认成功
- [ ] 中断状态已清除
- [ ] 询问用户是否立即继续

**FORBIDDEN**:
- 跳过任何清理步骤
- 不确认清理结果就继续
- 强制用户立即继续（必须询问）

---

### Step 5: Resume Task (CONDITIONAL - USER CHOICE)

**AFTER** recovery execution complete:

**IF** user chooses to immediately continue (输入 "Y"):

```bash
# 执行原命令
/{original_command} {original_args}

# 示例:
/webnovel-write 7
```

**输出给用户**：
```
开始执行 /webnovel-write 7...
[启动正常创作流程]
```

**IF** user chooses to wait (输入 "N"):

**输出给用户**：
```
✅ 恢复完成。您可以稍后手动执行 /{command} {args}
```

**流程结束。**

**Verification**:
- [ ] 用户选择已确认
- [ ] 如选择立即继续 → 原命令已执行
- [ ] 如选择等待 → 提示信息已输出

---

## 特殊场景处理

### 场景 1：Step 7 中断（成本极高）⚠️

**检测输出示例**：
```json
{
  "current_step": {
    "id": "Step 7",
    "name": "Bi-chapter Review"
  },
  "completed_steps": ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6"],
  "artifacts": {
    "chapter_file": {"exists": true, "status": "complete"},
    "git_committed": true,
    "git_tag": "ch0007"
  }
}
```

**恢复选项展示**（强调成本）：
```
恢复选项：
A) 重新执行双章审查（成本：~$0.15，耗时5-10分钟）⚠️
   风险：高成本
   重新调用5个审查员（high-point/consistency/pacing/ooc/continuity）
   操作步骤：
   - 重新调用5个审查员（并行）
   - 生成审查报告
   - 更新 state.json review_checkpoints

B) 跳过审查，继续下一章
   风险：低
   不进行审查（可后续用 /webnovel-review 补审）
   操作步骤：
   - 标记审查为已跳过
   - 清理中断状态
   - 可继续创作Ch8

💡 建议：如非关键章节，选择B节省成本

请选择（A/B）：
```

### 场景 2：Step 4 中断（state.json 部分更新）⚠️

**检测输出示例**：
```json
{
  "current_step": {
    "id": "Step 4",
    "name": "Update State"
  },
  "artifacts": {
    "chapter_file": {"exists": true, "status": "complete"},
    "state_json_modified": true,
    "consistency_check": "failed"
  }
}
```

**恢复选项展示**（强调一致性检查）：
```
⚠️ 检测到 state.json 可能部分更新

恢复选项：
A) 检查并修复state.json
   风险：中等
   验证state.json一致性，补全缺失字段
   操作步骤：
   - 读取 state.json
   - 检查必要字段（progress, protagonist_state等）
   - 如缺失则从前一章推断
   - 重新执行 update_state.py
   - 继续Step 5

B) 回滚到上一章（安全）
   风险：高（丢失进度）
   恢复到上一章的state.json快照
   操作步骤：
   - git checkout ch0006 -- .webnovel/state.json
   - 删除第7章文件
   - 清理中断状态

💡 建议：如第7章文件完整，选择A修复state.json

请选择（A/B）：
```

### 场景 3：多次中断（超时检测）⚠️

**IF** elapsed_seconds > 3600（超过1小时）:

**额外警告**：
```
⚠️ 检测到中断已超过1小时（{elapsed_seconds/60}分钟）

上下文丢失风险：
- 超过1小时 → AI难以续写，建议重新开始
- 超过24小时 → 强烈建议回滚到稳定状态

请谨慎选择恢复策略。
```

---

## Execution Checklist (VERIFY BEFORE CLAIMING "DONE")

Before you tell the user "Recovery complete", **YOU MUST verify**:

- [ ] RESUME_SKILL.md 已读取
- [ ] workflow_manager.py detect 已执行
- [ ] 中断信息已完整展示给用户
- [ ] 恢复选项已清晰列出（含风险等级）
- [ ] 用户已明确选择恢复路径
- [ ] 所选恢复路径已完整执行
- [ ] 清理操作已确认成功
- [ ] 中断状态已清除
- [ ] 用户已决定是否立即继续
- [ ] 如立即继续 → 原命令已执行
- [ ] 如等待 → 提示信息已输出

**IF ANY CHECKBOX IS UNCHECKED → TASK IS NOT COMPLETE.**

---

## Error Handling

**IF** workflow_manager.py detect 执行失败：

1. **STOP immediately** - Do not guess interruption state
2. **OUTPUT the error** to user with full details
3. **CHECK** if `.webnovel/workflow_state.json` exists
4. **IF missing**: 提示用户可能是旧项目（未集成workflow追踪），建议启发式检测
5. **WAIT** for user to fix the issue

**Fallback Strategy**（仅当workflow_state.json不存在时）：

```bash
# 启发式检测
current_chapter=$(jq '.progress.current_chapter' .webnovel/state.json)
next_chapter=$((current_chapter + 1))
next_file="正文/第$(printf '%04d' $next_chapter)章.md"

if [ -f "$next_file" ]; then
  echo "⚠️ 检测到半成品: $next_file"
  echo "建议: 删除并重新创作"
else
  echo "✅ 状态一致，可继续创作Ch$next_chapter"
fi
```

**FORBIDDEN**:
- Hiding detection errors
- Claiming success when detection failed
- Guessing interruption point without running script

---

## FORBIDDEN（绝对禁止）

1. ❌ **禁止智能续写半成品**：
   - 原因：上下文丢失，质量无法保证，容易产生前后矛盾
   - 例外：**无**（任何情况都不续写）

2. ❌ **禁止自动决定恢复策略**：
   - 原因：不同Step风险不同，必须用户确认
   - 例外：仅当无中断任务时自动结束

3. ❌ **禁止跳过中断检测**：
   - 必须运行 `workflow_manager.py detect`
   - 禁止凭经验猜测

4. ❌ **禁止修复state.json而不验证**：
   - Step 4中断时，必须逐字段检查一致性
   - 禁止直接假设state.json正确

---

**Start executing Step 1 now.**
