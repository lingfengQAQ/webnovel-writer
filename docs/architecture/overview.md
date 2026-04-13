# 系统架构与模块设计

## 核心理念

### 防幻觉三定律

| 定律 | 说明 | 执行方式 |
|------|------|----------|
| **大纲即法律** | 遵循大纲，不擅自发挥 | Context Agent 强制加载章节大纲 |
| **设定即物理** | 遵守设定，不自相矛盾 | Reviewer Agent 内置一致性审查 |
| **发明需识别** | 新实体必须入库管理 | Data Agent 自动提取并消歧 |

### Strand Weave 节奏系统

| Strand | 含义 | 理想占比 | 说明 |
|--------|------|----------|------|
| **Quest** | 主线剧情 | 60% | 推动核心冲突 |
| **Fire** | 感情线 | 20% | 人物关系发展 |
| **Constellation** | 世界观扩展 | 20% | 背景/势力/设定 |

节奏红线：

- Quest 连续不超过 5 章
- Fire 断档不超过 10 章
- Constellation 断档不超过 15 章

## 总体架构图

```text
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                           │
├─────────────────────────────────────────────────────────────┤
│  Skills (7个):                                             │
│    init / plan / write / review / query / learn / dashboard │
├─────────────────────────────────────────────────────────────┤
│  Agents (3个):                                             │
│    Context Agent / Data Agent / Reviewer (含六维审查)        │
├─────────────────────────────────────────────────────────────┤
│  Data Layer:                                               │
│    state.json / index.db (SQLite) / vectors.db             │
├─────────────────────────────────────────────────────────────┤
│  Story System:                                             │
│    .story-system/ (合同·提交·事件)                           │
└─────────────────────────────────────────────────────────────┘
```

## Agent 分工

### Context Agent（读）

- 文件：`agents/context-agent.md`
- 职责：在写作前构建"创作任务书"，提供本章上下文、约束和追读力策略。

### Data Agent（写）

- 文件：`agents/data-agent.md`
- 职责：从正文提取实体与状态变化，更新 `state.json`、`index.db`、`vectors.db`，保证数据链闭环。

### Reviewer（审）

- 文件：`agents/reviewer.md`
- 职责：章节质量审查，内部包含以下六个审查维度：

| 审查维度 | 检查重点 |
|----------|----------|
| High-point Checker | 爽点密度与质量 |
| Consistency Checker | 设定一致性（战力/地点/时间线） |
| Pacing Checker | Strand 比例与断档 |
| OOC Checker | 人物行为是否偏离人设 |
| Continuity Checker | 场景与叙事连贯性 |
| Reader-pull Checker | 钩子强度、期待管理、追读力 |

## Story System（合同驱动体系）

Story System 以 `.story-system/` 为独立运行面，分四段递进：

1. **Phase 1**：合同种子 — `MASTER_SETTING.json` + 章节合同 + 反模式配置
2. **Phase 2**：合同优先运行时 — 卷合同 (`volumes/`) + 审查合同 (`reviews/`) + 写前校验
3. **Phase 3**：章节提交链 — `commits/chapter_XXX.commit.json` + state/index/summary/memory 投影
4. **Phase 4**：事件审计链 — `events/chapter_XXX.events.json` + 修订提案 + 覆写账本

核心链路：

```text
story-system --persist
    -> 写入合同种子（MASTER_SETTING.json 等）
story-system --emit-runtime-contracts --chapter N
    -> 生成运行时合同 + 写前校验
chapter-commit --chapter N
    -> 提交 commit + 执行各投影写入
story-events --chapter N / --health
    -> 事件审计与健康检查
```

其中 Phase 4 不起第二套投影循环，事件路由仅负责声明式激活 writer，
实际执行入口仍是 `ChapterCommitService.apply_projections()`。
