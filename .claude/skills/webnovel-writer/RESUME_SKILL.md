# webnovel-resume Skill

> **Purpose**: 指导AI正确恢复中断的网文创作任务，基于精确的workflow状态追踪系统。

---

## 核心原则

**不同Step的中断难度分级**（CRITICAL - 必须遵循）：

| Step | 中断影响 | 恢复难度 | 默认策略 |
|------|---------|---------|----------|
| **Step 1** | 无副作用（仅读取文件） | ⭐ 简单 | 直接重新执行 |
| **Step 2** | 半成品章节文件 | ⭐⭐ 中等 | **删除半成品**，从Step 1重新开始 |
| **Step 3** | 部分实体未提取 | ⭐⭐ 中等 | 重新运行脚本（幂等） |
| **Step 4** | state.json 部分更新 | ⭐⭐⭐ 复杂 | 检测一致性，回滚或补全 |
| **Step 5** | Git未提交改动 | ⭐⭐⭐⭐ 高危 | 检查暂存区，决定提交/回滚 |
| **Step 6** | strand_tracker 未更新 | ⭐⭐ 中等 | 重新运行脚本 |
| **Step 7** | 审查未完成/报告未保存 | ⭐⭐⭐⭐⭐ 极高 | 用户决定：重审（成本高）或跳过 |

---

## 恢复流程（标准协议）

### Phase 1: 检测中断状态

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py detect
```

**输出示例**：
```json
{
  "command": "webnovel-write",
  "args": {"chapter_num": 7},
  "current_step": {
    "id": "Step 2",
    "name": "Generate Chapter Content",
    "status": "in_progress",
    "started_at": "2026-01-01T14:31:30Z",
    "progress_note": "已写1500字，目标3000-5000字"
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
      "uncommitted_changes": true,
      "unstaged_files": ["正文/第0007章.md"]
    }
  }
}
```

**恢复选项**：
```json
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

---

### Phase 2: 用户选择恢复方案

**YOU MUST询问用户**：

```
🔴 检测到中断任务：

任务：/webnovel-write 7
中断时间：2026-01-01 14:32:15（5分钟前）
中断位置：Step 2 - 章节内容生成中

已完成：
  ✅ Step 1: 上下文加载（14:31完成）

未完成：
  ⏸️ Step 2: 章节内容（已写1500字/目标3000-5000字）
  ⏹️ Step 3-7: 未开始

恢复选项：
A) 删除半成品，从Step 1重新开始（推荐）⭐
   - 清理 正文/第0007章.md
   - 清理 Git 暂存区
   - 重新执行完整流程

B) 回滚到Ch6，放弃Ch7所有进度
   - git reset --hard ch0006
   - 丢弃所有Ch7改动

请选择（A/B）：
```

---

### Phase 3: 执行恢复流程

#### 选项A: 删除半成品重新开始（最常用）

**执行步骤**：

1. **清理半成品文件**：
```bash
python workflow_manager.py cleanup --chapter 7
```

**预期输出**：
```
✅ 已清理: 正文/第0007章.md, Git暂存区已清理
```

2. **清除中断状态**：
```bash
python workflow_manager.py clear
```

**预期输出**：
```
✅ 中断任务已清除
```

3. **重新执行命令**：
```
/webnovel-write 7
```

---

#### 选项B: 回滚到上一章（高风险）

**执行步骤**：

1. **Git回滚**：
```bash
git reset --hard ch0006
```

2. **清除中断状态**：
```bash
python workflow_manager.py clear
```

3. **确认回滚结果**：
```bash
git status
git log --oneline -5
```

4. **提示用户**：
```
⚠️ 已回滚到Ch6（commit f975aa2）
Ch7的所有进度已丢弃
现在可以重新开始Ch7创作，或继续其他任务
```

---

## 不同Step中断的详细恢复策略

### Step 1中断：上下文加载

**影响**：无副作用（仅读取文件）

**恢复策略**：
```
选项A: 清除中断状态 → 重新执行 /webnovel-write {N}
```

**原因**：Step 1只是读取文件，没有写入操作，重新执行成本极低。

---

### Step 2中断：章节内容生成 ⭐ 最常见

**影响**：
- ✅ 可能存在半成品章节文件（1500/3000字）
- ⚠️ Git暂存区可能有未提交改动
- ❌ state.json**未更新**（因Step 4未执行）

**恢复策略**（推荐A）：

**选项A（推荐）**：
```bash
# Step 1: 清理半成品
python workflow_manager.py cleanup --chapter 7
# 输出: ✅ 已清理: 正文/第0007章.md, Git暂存区已清理

# Step 2: 清除中断状态
python workflow_manager.py clear

# Step 3: 重新执行
/webnovel-write 7
```

**选项B（回滚）**：
```bash
git reset --hard ch{N-1:04d}
python workflow_manager.py clear
```

**为什么删除半成品而不是续写？**
1. **质量保证**：半成品可能包含未完成的句子、逻辑断裂
2. **上下文丢失**：AI新会话无法记住之前的创作思路
3. **防幻觉**：续写容易产生前后矛盾
4. **成本可控**：重新生成3000字 < 修复半成品 + 审查修复

---

### Step 3中断：实体提取

**影响**：
- ✅ 章节文件已完整（Step 2已完成）
- ⚠️ 部分实体可能未提取到设定集

**恢复策略**：
```bash
# 重新运行实体提取（幂等操作）
python extract_entities.py "正文/第{N:04d}章.md" --auto

# 继续后续步骤
# 手动执行Step 4-7，或重新执行整个命令
```

**原因**：`extract_entities.py`是幂等操作，重新运行不会破坏已有数据。

---

### Step 4中断：state.json 更新 ⚠️ 高危

**影响**：
- ✅ 章节文件已完整
- ⚠️ state.json 可能**部分更新**（如只更新了progress，未更新protagonist_state）
- ❌ 数据不一致风险：Ch7文件存在，但state.json显示Ch6

**恢复策略**（需检测）：

**Step 1: 检查state.json一致性**：
```bash
# 读取state.json
cat .webnovel/state.json | jq '.progress.current_chapter'
# 输出: 6 （应该是7，说明未更新）

# 检查文件是否存在
ls -lh 正文/第0007章.md
# 输出: -rw-r--r-- 1 user 3542 Jan 1 14:35 正文/第0007章.md
```

**Step 2: 决定恢复方案**：

**选项A（推荐）**：补全state.json更新
```bash
# 重新执行update_state.py
python update_state.py \
  --progress 7 {total_words} \
  --protagonist-power "{realm}" {layer} "{bottleneck}" \
  --protagonist-location "{location}" 7

# 继续Step 5-7
```

**选项B（高风险）**：回滚到Ch6
```bash
git checkout ch0006 -- .webnovel/state.json
rm 正文/第0007章.md
python workflow_manager.py clear
```

---

### Step 5中断：Git备份 ⚠️ 高危

**影响**：
- ✅ 章节文件已完整
- ✅ state.json 已更新
- ⚠️ Git未提交（暂存区有改动）
- ❌ **无Git tag**（无法回滚到此章）

**恢复策略**（推荐A）：

**选项A（推荐）**：继续Git提交
```bash
# 检查暂存区
git status

# 重新执行backup_manager.py
python backup_manager.py --chapter 7 --chapter-title "{标题}"

# 验证提交
git log --oneline -1
git tag -l | grep ch0007
```

**选项B（回滚）**：丢弃改动
```bash
git reset HEAD .
git checkout -- .
rm 正文/第0007章.md
python workflow_manager.py clear
```

---

### Step 6中断：strand_tracker 更新

**影响**：
- ✅ 章节文件已完整
- ✅ state.json 已更新
- ✅ Git已提交
- ⚠️ strand_tracker 未更新（无法做节奏分析）

**恢复策略**：
```bash
# 重新运行strand_tracker更新
python update_state.py --strand-dominant {quest|fire|constellation} 7

# 可选：手动执行Step 7（双章审查）
```

**原因**：strand_tracker未更新不影响主线流程，但会影响节奏分析。

---

### Step 7中断：双章审查 ⚠️ 成本极高

**影响**：
- ✅ 章节文件已完整
- ✅ state.json 已更新
- ✅ Git已提交
- ✅ strand_tracker 已更新
- ⚠️ 审查未完成/报告未保存

**恢复策略**（用户决定）：

**选项A（成本高）**：重新执行双章审查
```
重新调用5个审查员（high-point/consistency/pacing/ooc/continuity）
  ↓
生成审查报告
  ↓
更新state.json review_checkpoints
  ↓
询问用户是否立即修复（Step 7.4）
```

**成本评估**：
- Token消耗：~30,000 tokens（5个agents并行）
- 时间消耗：~5-10分钟
- AI成本：~$0.15（根据模型定价）

**选项B（推荐）**：跳过审查，继续下一章
```bash
# 标记审查为已跳过
python workflow_manager.py clear

# 提示用户
echo "💡 已跳过Ch{N-1}-{N}审查，可后续用 /webnovel-review {N-1}-{N} 补审"

# 继续创作下一章
/webnovel-write {N+1}
```

**何时选择重审？**
- 关键章节（卷末、重要剧情转折）
- 前几章（建立质量基线）
- 用户明确要求

**何时跳过？**
- 普通章节
- 时间成本敏感
- 可后续批量审查（如Ch1-10一起审）

---

## 特殊场景处理

### 场景1：多次中断

**检测**：
```bash
python workflow_manager.py detect
# 输出: elapsed_seconds: 86400 (24小时前)
```

**策略**：
- 超过24小时 → **推荐回滚**（上下文已完全丢失）
- 超过1小时 → **推荐重新开始**（难以续写）
- 小于1小时 → 可尝试续写或重新开始

---

### 场景2：同时有多个半成品章节

**检测**：
```bash
ls -lh 正文/*.md | tail -5
# 发现: 第0007章.md (1500字), 第0008章.md (800字)
```

**策略**：
```bash
# 查看state.json
cat .webnovel/state.json | jq '.progress.current_chapter'
# 输出: 6

# 决策: 删除所有半成品
rm 正文/第0007章.md 正文/第0008章.md

# 从Ch6的稳定状态重新开始
python workflow_manager.py clear
/webnovel-write 7
```

---

### 场景3：workflow_state.json 不存在

**原因**：
- 旧项目（未集成workflow追踪）
- 文件被误删

**策略**（启发式检测）：
```bash
# Step 1: 读取state.json
current_chapter=$(jq '.progress.current_chapter' .webnovel/state.json)

# Step 2: 检查章节文件
next_chapter=$((current_chapter + 1))
next_file="正文/第$(printf '%04d' $next_chapter)章.md"

if [ -f "$next_file" ]; then
  echo "⚠️ 检测到半成品: $next_file"
  echo "建议: 删除并重新创作"
else
  echo "✅ 状态一致，可继续创作Ch$next_chapter"
fi
```

---

## FORBIDDEN（绝对禁止）

1. ❌ **禁止智能续写半成品**：
   - 原因：上下文丢失，质量无法保证，容易产生前后矛盾
   - 例外：**无**（任何情况都不续写）

2. ❌ **禁止自动决定恢复策略**：
   - 原因：不同Step风险不同，必须用户确认
   - 例外：Step 1（无副作用，可自动重新执行）

3. ❌ **禁止跳过中断检测**：
   - 用户执行 `/webnovel-resume` 时，必须先运行 `workflow_manager.py detect`
   - 禁止凭经验猜测

4. ❌ **禁止修复state.json而不验证**：
   - Step 4中断时，必须逐字段检查一致性
   - 禁止直接假设state.json正确

---

## 最佳实践

1. **优先使用选项A**（删除重新开始）：
   - 质量保证 > 时间节省
   - 重新生成3000字 < 修复半成品质量问题

2. **高危Step谨慎处理**（Step 4/5/7）：
   - 必须详细检查状态
   - 提供多个恢复选项
   - 明确标注风险等级

3. **保持workflow_state.json更新**：
   - 每个Step开始/结束时更新
   - 定期heartbeat（避免误判超时）

4. **Git tag是最可靠的回滚点**：
   - 优先回滚到 `ch{N:04d}` tag
   - 而不是尝试修复复杂状态

---

## 示例对话（完整恢复流程）

```
用户: /webnovel-resume

AI: 🔍 正在检测中断状态...
    [运行: python workflow_manager.py detect]

    🔴 检测到中断任务：

    任务：/webnovel-write 7
    中断时间：2026-01-01 14:32:15（5分钟前）
    中断位置：Step 2 - 章节内容生成中

    已完成：
      ✅ Step 1: 上下文加载（14:31完成）

    未完成：
      ⏸️ Step 2: 章节内容（已写1500字/目标3000-5000字）
      ⏹️ Step 3-7: 未开始

    恢复选项：
    A) 删除半成品，从Step 1重新开始（推荐）⭐
       风险：低
       操作：清理文件 + 重新执行

    B) 回滚到Ch6，放弃Ch7所有进度
       风险：中等
       操作：Git回滚 + 清理状态

    请选择（A/B）：

用户: A

AI: ✅ 执行选项A：删除半成品，重新开始

    Step 1: 清理半成品文件
    [运行: python workflow_manager.py cleanup --chapter 7]
    ✅ 已清理: 正文/第0007章.md, Git暂存区已清理

    Step 2: 清除中断状态
    [运行: python workflow_manager.py clear]
    ✅ 中断任务已清除

    Step 3: 重新执行命令
    现在可以执行 /webnovel-write 7

    是否立即开始？（Y/N）

用户: Y

AI: 开始执行 /webnovel-write 7...
    [启动正常创作流程]
```

---

**Skill加载完成。请遵循上述协议处理所有中断恢复场景。**
