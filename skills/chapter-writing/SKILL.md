---
name: chapter-writing
description: Writes webnovel chapters (3000-5000 words) using v5.0 dual-agent architecture. Context Agent gathers context, writer produces pure text (no XML tags), review agents report issues, polish fixes problems, Data Agent extracts entities with AI.
allowed-tools: Read Write Edit Grep Bash Task
---

# Chapter Writing Skill

## Workflow Checklist

复制并跟踪进度：

```
章节创作进度 (v5.0)：
- [ ] Step 1: Context Agent 搜集上下文
- [ ] Step 2: 生成章节内容 (纯正文，3000-5000字)
- [ ] Step 3: 审查 (5个Agent并行，只报告)
- [ ] Step 4: 润色 (基于审查报告修复 + 去AI痕迹)
- [ ] Step 5: Data Agent 处理数据链
- [ ] Step 6: Git 备份
```

---

## Step 1: Context Agent 搜集上下文

**调用 Context Agent**:

使用 Task 工具调用 `context-agent` subagent：

```
调用 context-agent，参数：
- chapter: {chapter_num}
- project_root: {PROJECT_ROOT}
```

**Agent 自动完成**:
1. 读取本章大纲，分析需要什么信息
2. 读取 state.json 获取主角状态（使用 entities_v3 格式）
3. 调用 data_modules.index_manager 查询相关实体
4. 调用 data_modules.rag_adapter 语义检索
5. Grep 设定集搜索相关设定
6. 评估伏笔紧急度
7. 选择风格样本
8. 组装上下文包 JSON

**输出**：上下文包 JSON，包含：
- `core`: 大纲、主角快照、最近摘要
- `scene`: 地点上下文、出场角色、紧急伏笔
- `global`: 世界观骨架、力量体系、风格样本
- `rag`: 语义检索召回的相关场景
- `alerts`: 关键风险提示（如消歧警告/待确认项）

**失败处理**：
- 如果大纲不存在 → 提示用户先创建大纲
- 如果 state.json 不存在 → 提示用户初始化项目

---

## Step 2: 生成章节内容

**字数**: 3000-5000 字

**核心原则**:
- **大纲即法律**: 100% 执行大纲
- **设定即物理**: 实力 ≤ 上下文包中的设定
- **纯正文**: 不需要写任何 XML 标签

**加载核心约束**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/chapter-writing/references/core-constraints.md"
```

**按需加载场景参考**:

| 场景类型 | 判断条件 | 执行命令 |
|---------|---------|---------|
| 战斗戏 | 大纲含打斗/对决/追逐 | `cat "${CLAUDE_PLUGIN_ROOT}/skills/chapter-writing/references/writing/combat-scenes.md"` |
| 情感戏 | 大纲含告白/冲突/羁绊 | `cat "${CLAUDE_PLUGIN_ROOT}/skills/chapter-writing/references/writing/emotion-psychology.md"` |
| 对话密集 | 预估对话 >50% | `cat "${CLAUDE_PLUGIN_ROOT}/skills/chapter-writing/references/writing/dialogue-writing.md"` |
| 复杂场景 | 新地点/大场面描写 | `cat "${CLAUDE_PLUGIN_ROOT}/skills/chapter-writing/references/writing/scene-description.md"` |

**输出格式**:
- Markdown 文件: `正文/第{NNNN}章.md`
- 章节末尾追加摘要（见模板）
- 纯正文，Data Agent 会自动提取实体

---

## Step 3: 审查

**触发条件**: 每章都审查（不再是双章）

**并行调用 5 个审查 Agent**:

使用 Task 工具并行调用：

```
并行调用以下 5 个 subagent，输入为第 {chapter_num} 章：

1. high-point-checker - 爽点密度检查
2. consistency-checker - 设定一致性检查
3. pacing-checker - Strand 节奏检查
4. ooc-checker - 人物 OOC 检查
5. continuity-checker - 连贯性检查
```

**审查输出汇总**:
```json
{
  "overall_score": 85,
  "issues": [
    {"agent": "ooc-checker", "type": "OOC", "severity": "medium", "location": "第3段", "suggestion": "林天对敌人太客气，应更冷酷"},
    {"agent": "consistency-checker", "type": "POWER_CONFLICT", "severity": "high", "location": "第5段", "suggestion": "筑基3层不能使用金丹期技能"}
  ],
  "style_score": 78,
  "pacing_analysis": {
    "quest_ratio": 0.4,
    "fire_ratio": 0.35,
    "constellation_ratio": 0.25
  },
  "pass": true
}
```

---

## Step 4: 润色 (基于审查报告)

**输入**:
1. 章节正文
2. 审查报告 (Step 3 输出)
3. polish-guide.md 规则

**加载润色指南**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/chapter-writing/references/polish-guide.md"
```

**润色内容**:

### 4.1 修复审查问题

根据审查报告的 `issues` 列表针对性修改：

| 问题类型 | 修复方式 |
|---------|---------|
| OOC | 调整角色言行，符合人设 |
| POWER_CONFLICT | 修改能力描述，符合当前境界 |
| TIMELINE_ISSUE | 调整时间线描述 |
| PACING_IMBALANCE | 调整 Strand 比例 |
| LOW_COOL_POINTS | 增加爽点密度 |

### 4.2 AI痕迹清除

| 指标 | 警戒线 | 目标值 | 检测词 |
|-----|-------|--------|--------|
| 总结词密度 | > 1次/1000字 | 0次 | 综合/总之/由此可见 |
| 列举结构 | > 0.5次/1000字 | 0次 | 首先…其次…最后… |
| 学术词频 | > 3次/1000字 | < 1次 | 而言/某种程度上 |

### 4.3 自然化处理

| 指标 | 不达标 | 达标 |
|-----|-------|------|
| 停顿词 | < 0.5次/500字 | 1-2次/500字 |
| 短句占比 | < 20% | 30-50% |
| 口语词 | 0次/1000字 | ≥ 2次/1000字 |

### 4.4 润色红线

- ❌ 改变情节走向 → 违反"大纲即法律"
- ❌ 修改主角实力 → 违反"设定即物理"
- ❌ 改变人物关系 → 违反设定
- ❌ 删除伏笔 → 破坏长线剧情

**输出**: 润色后的章节文件（覆盖原文件）

---

## Step 5: Data Agent 处理数据链

**调用 Data Agent**:

使用 Task 工具调用 `data-agent` subagent：

```
调用 data-agent，参数：
- chapter: {chapter_num}
- chapter_file: "正文/第{NNNN}章.md"
- review_score: {overall_score from Step 3}
- project_root: {PROJECT_ROOT}
```

**Agent 自动完成**:

1. **AI 实体提取**
   - 调用 LLM 从正文中语义提取实体
   - 匹配已有实体库，识别新实体
   - 识别状态变化（境界/位置/关系）

2. **实体消歧**
   - 高置信度 (>0.8): 自动采用
   - 中置信度 (0.5-0.8): 采用但记录 warning
   - 低置信度 (<0.5): 标记待人工确认

3. **写入存储**
   - 更新 state.json (实体 + 状态)
   - 更新 index.db (索引)
   - 注册新别名到 alias_index

4. **AI 场景切片**
   - 按地点/时间/视角切分场景
   - 生成场景摘要

5. **向量嵌入**
   - 调用 data_modules.rag_adapter 存入向量库

6. **风格样本评估**
   - 如果 review_score > 80，提取高质量片段作为样本候选

**输出**:
```json
{
  "entities_appeared": 5,
  "entities_new": 1,
  "state_changes": 2,
  "scenes_chunked": 4,
  "uncertain": [...],
  "warnings": [...]
}
```

---

## Step 6: Git 备份

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/backup_manager.py" \
  --chapter {chapter_num} \
  --chapter-title "{title}"
```

或手动：
```bash
git add .
git commit -m "Ch{chapter_num}: {title}"
```

---

## 章节摘要模板

章节末尾追加：

```markdown
---
## 本章摘要
**剧情**: {主要事件}
**人物**: {角色互动}
**状态变化**: {实力/位置/关系}
**伏笔**: [埋设] / [回收]
**承接点**: {下章衔接}
```

---

## 错误处理

### Context Agent 失败
```
⚠️ 上下文包生成失败
→ 检查大纲是否存在
→ 检查 state.json 是否初始化
→ 手动加载必要上下文后继续
```

### 审查发现严重问题
```
⚠️ 审查发现 critical 级别问题
→ 润色步骤必须修复
→ 如果无法修复，记录 deviation
```

### Data Agent 失败
```
⚠️ AI 提取失败
→ 记录 warning
→ 可选：手动添加关键实体
→ Git 备份仍然执行
```

---

## 成功标准

1. ✅ 章节字数 3000-5000
2. ✅ 100% 执行大纲
3. ✅ 审查 overall_score ≥ 70
4. ✅ 润色后 AI 痕迹指标达标
5. ✅ Data Agent 成功提取实体
6. ✅ Git 提交成功
