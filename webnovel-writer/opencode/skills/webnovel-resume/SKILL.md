---
name: webnovel-resume
description: Recovers interrupted webnovel tasks with precise workflow state tracking. Detects interruption point and provides safe recovery options. Activates when user wants to resume or /webnovel-resume.
tools: Read Bash AskUserQuestion
---

# Task Resume Skill

## Project Root Guard（必须先确认）

- OpenCode 的“工作区根目录”不一定等于“书项目根目录”。常见结构：工作区为 `D:\wk\xiaoshuo`，书项目为 `D:\wk\xiaoshuo\凡人资本论`。
- 必须先解析真实书项目根（必须包含 `.webnovel/state.json`），后续所有读写路径都以该目录为准。

环境设置（bash 命令执行前）：
```bash
export WORKSPACE_ROOT="${OPENCODE_PROJECT_DIR:-$PWD}"

if [ -z "${OPENCODE_PLUGIN_ROOT}" ] || [ ! -d "${OPENCODE_PLUGIN_ROOT}/skills/webnovel-resume" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${OPENCODE_PLUGIN_ROOT}/skills/webnovel-resume" >&2
  exit 1
fi
export SKILL_ROOT="${OPENCODE_PLUGIN_ROOT}/skills/webnovel-resume"

if [ -z "${OPENCODE_PLUGIN_ROOT}" ] || [ ! -d "${OPENCODE_PLUGIN_ROOT}/scripts" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${OPENCODE_PLUGIN_ROOT}/scripts" >&2
  exit 1
fi
export SCRIPTS_DIR="${OPENCODE_PLUGIN_ROOT}/scripts"

export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

## Workflow Checklist

Copy and track progress:

```
任务恢复进度：
- [ ] Step 1: 加载恢复协议 (cat "${SKILL_ROOT}/references/workflow-resume.md")
- [ ] Step 2: 加载数据规范 (cat "${SKILL_ROOT}/references/system-data-flow.md")
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
- [workflow-resume.md](references/workflow-resume.md)

### L2 (conditional)
- [system-data-flow.md](references/system-data-flow.md)（仅在需要核对状态字段/恢复策略时）

## Step 1: 加载恢复协议（必须执行）

```bash
cat "${SKILL_ROOT}/references/workflow-resume.md"
```

**核心原则**（读取后应用）：
- **禁止智能续写**: 上下文丢失风险高
- **必须检测后恢复**: 不猜测中断点
- **必须用户确认**: 不自动恢复

## Step 2: 加载数据规范

```bash
cat "${SKILL_ROOT}/references/system-data-flow.md"
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
| Step 1.5 | ⭐ | 重新设计 |
| Step 2A | ⭐⭐ | 删除半成品，重新开始 |
| Step 2B | ⭐⭐ | 继续适配或回到 2A |
| Step 3 | ⭐⭐⭐ | 用户决定：重审或跳过 |
| Step 4 | ⭐⭐ | 继续润色或删除重写 |
| Step 5 | ⭐⭐ | 重新运行（幂等） |
| Step 6 | ⭐⭐⭐ | 检查暂存区，决定提交/回滚 |

## Step 4: 检测中断状态

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" workflow detect
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
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" workflow cleanup --chapter {N} --confirm
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" workflow clear
```

**选项 B - Git 回滚**：
```bash
git -C "$PROJECT_ROOT" reset --hard ch{N-1:04d}
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" workflow clear
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
