---
name: webnovel-resume
description: Recovers interrupted webnovel tasks with precise workflow state tracking. Detects interruption point and provides safe recovery options. Activates when user wants to resume or /webnovel-resume.
allowed-tools: Read Bash AskUserQuestion
---

# Task Resume Skill

## Project Root Guard（必须先确认）

- 必须在项目根目录执行（需存在 `.webnovel/state.json`）
- 若当前目录不存在该文件，先询问用户项目路径并 `cd` 进入
- 进入后设置变量：`$PROJECT_ROOT = (Resolve-Path ".").Path`

## Workflow Checklist

Copy and track progress:

```
任务恢复进度：
- [ ] Step 1: 加载恢复协议 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-resume/references/workflow-resume.md")
- [ ] Step 2: 加载数据规范 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-resume/references/system-data-flow.md")
- [ ] Step 3: 确认上下文充足
- [ ] Step 4: 检测中断状态
- [ ] Step 5: 展示恢复选项 (AskUserQuestion)
- [ ] Step 6: 执行恢复
- [ ] Step 7: 继续任务 (可选)
```

---

## Reference Loading Levels (strict, lazy)

- L0: 不加载任何参考，直到确认存在中断恢复需求。
- L1: 只加载恢复协议主文件。
- L2: 仅在数据一致性检查时加载数据规范。

### L1 (minimum)
- `references/workflow-resume.md`

### L2 (conditional)
- `references/system-data-flow.md`（仅在需要核对状态字段/恢复策略时）

## Step 1: 加载恢复协议（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-resume/references/workflow-resume.md"
```

**核心原则**（读取后应用）：
- **禁止智能续写**: 上下文丢失风险高
- **必须检测后恢复**: 不猜测中断点
- **必须用户确认**: 不自动恢复

## Step 2: 加载数据规范

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-resume/references/system-data-flow.md"
```

## Step 3: 确认上下文充足

**检查清单**：
- [ ] 恢复协议已理解
- [ ] Step 难度分级已知
- [ ] 状态结构已理解
- [ ] "删除重来" vs "智能续写" 原则已明确

**如有缺失 → 返回对应 Step**

## Step 难度分级（来自 workflow-resume.md）

| Step | 难度 | 恢复策略 |
|------|------|---------|
| Step 1 | ⭐ | 直接重新执行 |
| Step 2 | ⭐⭐ | 删除半成品，重新开始 |
| Step 3 | ⭐⭐ | 重新运行提取 |
| Step 4 | ⭐⭐⭐ | 验证 state.json 一致性 |
| Step 5 | ⭐⭐ | 重新运行 strand 更新 |
| Step 6 | ⭐⭐⭐⭐⭐ | 成本高 - 5个检查员 ~$0.15 |
| Step 7 | ⭐ | 重新运行 git 备份 |

## Step 4: 检测中断状态

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" detect
```

**输出情况**：
- 无中断 → 结束流程，通知用户
- 检测到中断 → 继续 Step 5

## Step 5: 展示恢复选项（必须执行）

**展示给用户**：
- 任务命令和参数
- 中断时间和已过时长
- 已完成步骤
- 当前（中断）步骤
- 剩余步骤
- 恢复选项及风险等级

**示例输出**：

```
🔴 检测到中断任务：

任务：/webnovel-write 7
中断位置：Step 2 - 章节内容生成中

已完成：
  ✅ Step 1: 上下文加载

未完成：
  ⏸️ Step 2: 章节内容（已写1500字）
  ⏹️ Step 3-7: 未开始

恢复选项：
A) 删除半成品，从Step 1重新开始（推荐）
B) 回滚到Ch6，放弃Ch7所有进度

请选择（A/B）：
```

## Step 6: 执行恢复

**选项 A - 删除重来**（推荐）：
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" cleanup --chapter {N}
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" clear
```

**选项 B - Git 回滚**：
```bash
git -C "$PROJECT_ROOT" reset --hard ch{N-1:04d}
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" clear
```

## Step 7: 继续任务（可选）

如用户选择立即继续：
```bash
/{original_command} {original_args}
```

---

## 特殊场景

### Step 6 中断（成本高）

```
恢复选项：
A) 重新执行双章审查（成本：~$0.15）⚠️
B) 跳过审查，继续下一章（可后续补审）
```

### Step 4 中断（部分状态）

```
⚠️ state.json 可能部分更新

A) 检查并修复 state.json
B) 回滚到上一章（安全）
```

### 长时间中断（>1小时）

```
⚠️ 中断已超过1小时

上下文丢失风险高
建议重新开始而非续写
```

---

## 禁止事项

- ❌ 智能续写半成品内容
- ❌ 自动选择恢复策略
- ❌ 跳过中断检测
- ❌ 不验证就修复 state.json
