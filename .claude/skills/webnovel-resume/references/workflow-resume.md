---
name: workflow-resume
purpose: 任务恢复时加载，指导中断恢复流程
version: "5.4"
---

<context>
此文件用于中断任务恢复。Claude 已知错误处理流程，这里只补充网文创作工作流特定的 Step 难度分级和恢复策略。
v5.4：版本号对齐，内容沿用 v5.2。
</context>

<instructions>

## Step 中断难度分级 (v5.4)

| Step | 名称 | 影响 | 难度 | 默认策略 |
|------|------|------|------|----------|
| Step 1 | Context Agent | 无副作用（仅读取） | ⭐ | 直接重新执行 |
| Step 1.5 | 章节设计 | 结构未固化 | ⭐ | 重新设计 |
| Step 2A | 生成粗稿 | 半成品章节文件 | ⭐⭐ | **删除半成品**，从 Step 1 重新开始 |
| Step 2B | 风格适配 | 部分改写内容 | ⭐⭐ | 继续适配或回到 2A |
| Step 3 | 审查 | 审查未完成 | ⭐⭐⭐ | 用户决定：重审或跳过 |
| Step 4 | 网文化润色 | 部分润色的文件 | ⭐⭐ | 继续润色或删除重写 |
| Step 5 | Data Agent | 实体未提取完 | ⭐⭐ | 重新运行（幂等） |
| Step 6 | Git 备份 | 未提交 | ⭐⭐⭐ | 检查暂存区，决定提交/回滚 |

## 恢复流程

### Phase 1: 检测中断状态

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" detect
```

### Phase 2: 询问用户

**必须展示**:
- 任务命令和参数
- 中断时间和位置
- 已完成步骤
- 恢复选项和风险等级

### Phase 3: 执行恢复

**选项 A（推荐）**: 删除半成品重新开始
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" cleanup --chapter {N}
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" clear
/webnovel-write {N}
```

**选项 B**: 回滚到上一章
```bash
git reset --hard ch{N-1:04d}
python "${CLAUDE_PLUGIN_ROOT}/scripts/workflow_manager.py" clear
```

## 为什么删除而不续写？

1. **质量保证**: 半成品可能包含未完成句子、逻辑断裂
2. **上下文丢失**: 新会话无法记住之前创作思路
3. **防幻觉**: 续写容易产生前后矛盾
4. **成本可控**: 重新生成 < 修复半成品 + 审查

## 特殊场景

| 场景 | 策略 |
|------|------|
| 超过24小时 | 推荐回滚（上下文完全丢失） |
| 超过1小时 | 推荐重新开始 |
| 多个半成品 | 删除所有，从稳定状态重新开始 |
| workflow_state.json不存在 | 启发式检测 state.json vs 文件 |

</instructions>

<examples>

<example>
<input>Step 2A 中断（最常见）</input>
<output>
🔴 检测到中断任务：

任务：/webnovel-write 7
中断位置：Step 2A - 章节内容生成中

已完成：
  ✅ Step 1: Context Agent 搜集上下文

未完成：
  ⏸️ Step 2A: 生成章节内容（已写1500字）
  ⏹️ Step 3-6: 未开始

恢复选项：
A) 删除半成品，从 Step 1 重新开始（推荐）⭐
B) 回滚到 Ch6，放弃 Ch7 所有进度

请选择（A/B）：
</output>
</example>

<example>
<input>Step 3 中断（审查）</input>
<output>
恢复选项：
A) 重新执行审查 ⚠️
   - 调用6个审查员
   - 生成审查报告
   - 继续 Step 4 润色

B) 跳过审查，直接润色（推荐）
   - 不生成审查报告
   - 可后续用 /webnovel-review 补审

请选择（A/B）：
</output>
</example>

<example>
<input>Step 4 中断（润色）</input>
<output>
恢复选项：
A) 继续润色（推荐）⭐
   - 打开并继续润色 正文/第0007章.md
   - 保存文件
   - 继续 Step 5（Data Agent）

B) 删除润色稿，从 Step 2A 重写
   - 删除 正文/第0007章.md
   - 重新生成章节内容

请选择（A/B）：
</output>
</example>

</examples>

<errors>
❌ 智能续写半成品 → ✅ 删除后重新生成
❌ 自动决定恢复策略 → ✅ 必须用户确认
❌ 跳过中断检测 → ✅ 先运行 workflow_manager.py detect
❌ 修复 state.json 不验证 → ✅ 逐字段检查一致性
</errors>
