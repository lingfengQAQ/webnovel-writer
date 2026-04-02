# Webnovel-Writer Harness v6 设计文档

> 日期：2026-04-02（更新：2026-04-03）
> 状态：草案 v2
> 基于：用户反馈 + issue#5 token 分析 + 23 条问题清单

---

## 1. 终极目标

写出一本长篇网络小说（500-2000 章），支持多种主流题材。要求：
- 文笔优秀，减少 AI 味
- 剧情跌宕起伏，出人意料（AI 主导创意，作者事后审核）
- 长上下文后保持文风且不吃书
- 完善的人机协作，可注入作者灵感
- 系统稳定，减少上下文消耗
- 合适的错误改善机制

## 2. 核心原则

- **Claude Code 本身就是 harness**——不另建编排层，充分利用原生能力（/resume、Task、子 agent 隔离、自动 compaction）
- **卷纲是 harness**——给写作 AI 足够约束，防止跑偏、失控、遗忘
- **记忆是根基**——防吃书靠记忆系统，不靠大纲节点
- **减法优先**——砍掉不产生价值的环节，而非叠加更多流程

---

## 3. 问题清单（23 条）

### 3.1 Init

| # | 问题 | 根因 |
|---|------|------|
| 1 | 参考文件重结构轻范例 | 教了"格式"没教"品味"，LLM 知道填什么字段但不知道什么内容算好 |
| 2 | 缺少题材标杆 | 没有"好世界书长什么样"的真实小说范例作为 few-shot |
| 3 | 生成不可迭代 | 总纲、设定集一次生成就结束，无打磨循环 |

### 3.2 Plan

| # | 问题 | 根因 |
|---|------|------|
| 4 | 约束了"发生什么"而非"方向和边界" | 章纲写"主角救了叫朵朵的小女孩"→全量灌入写作 AI→剧透 |
| 5 | 缺少卷级叙事功能定义 | 每章在卷中承担什么角色（起/承/转/合）不明确 |
| 6 | 时间约束太显性 | 时间锚点、倒计时直接写在章纲里，AI 反复在正文中提及 |
| 7 | Strand 比例硬编码 60/20/20 | 不同题材节奏不同，末世文和甜宠文不可能一样 |
| 8 | 四层产出下游利用率不明 | 节拍表、时间线、卷纲、章纲——write 阶段真正消费的只有章纲 |
| 9 | 10 章/批生成质量递减 | 后面几章趋向套路化 |

### 3.3 Write

| # | 问题 | 根因 |
|---|------|------|
| 10 | 流水线太重 | 8 步 + workflow 记录，大量 token 花在流程管理而非写作 |
| 11 | context-agent 是 token 黑洞 | 全量灌入所有数据，输出巨大执行包 |
| 12 | 审查消耗大产出低 | 6 个 checker 各自独立 context，打 90 分但用户觉得很差 |
| 13 | anti-AI 必须加强 | 黑名单只能挡已知口癖，挡不了叙事结构/情绪表达/节奏层面的 AI 味 |
| 14 | data-agent 太重 | 9 个子步骤，归入记忆模块统一设计 |
| 15 | 写作和回写耦合 | 回写失败卡住整条链，但回写时机不变（下一章前必须完成） |
| 16 | workflow_manager + resume skill 浪费 | Claude Code 原生 /resume 即可恢复中断会话 |

### 3.4 记忆

| # | 问题 | 根因 |
|---|------|------|
| 17 | 6 种存储太分散 | state.json / index.db / scratchpad / summaries / vectors / snapshots 各自读写 |
| 18 | 分层不符合写作直觉 | 应按时效分级：近期（详细）→ 中期（摘要）→ 远期（活跃事实） |
| 19 | 时间线不是索引轴 | 所有记忆应挂在时间线上，支持"第 N 章时角色是什么状态"的查询 |
| 20 | 记忆类型需明确 | 角色状态（可变）、世界规则（稳定）、伏笔（有生命周期）、时间线（单调递增） |

### 3.5 系统级

| # | 问题 | 根因 |
|---|------|------|
| 21 | Skill/Agent prompt 格式混乱 | 缺少统一模板，每个文件组织方式不同，LLM 抓不住重点 |
| 22 | 参考资料需要清理和补充 | 删冗余、补方法论（含真实小说片段作为正面/反面范例） |
| 23 | Token 消耗过高 | 单章 300-500 万，审查占大头但产出最低 |

---

## 4. 已确认的设计方向

### 4.1 废弃项

| 废弃 | 替代 |
|------|------|
| workflow_manager.py | Claude Code 原生 /resume |
| resume skill | Claude Code 原生 /resume |
| Step 2B（独立风格适配步骤） | 合并到 Step 4 润色 |
| 6 个独立 checker agent | 合并为 1 个审查 agent |
| 审查评分机制 | 改为 code review 格式输出具体问题清单 |
| memory_scratchpad.json（长记忆系统） | 基于远端无长记忆版本重新设计统一记忆模块 |

### 4.2 Write 流程（新）

```
Step 0.5 预检
  → Step 1 上下文搜集（context-agent，research 模式）
  → Step 2 起草
  → Step 3 审查（单 agent，code review 格式）
  → Step 4 润色 + 风格适配 + anti-AI
  → Step 5 数据回写（统一记忆模块，单次调用）
  → Step 6 Git 备份
```

### 4.3 Context-Agent（新模式）

从"一次性全量灌入 → 输出巨大执行包"改为 research 模式：

1. 调用记忆模块合并接口 → 拿到基础上下文（章纲目标、角色状态、未闭合伏笔）
2. 思考：这章还需要什么额外信息？
3. 按需调用记忆模块独立接口补充（某角色历史、某条世界规则、上章结尾）
4. 确认信息充分 → 按固定格式输出写作提示

### 4.4 审查（新模式）

- 1 个 agent，一次灌入正文 + 记忆中的角色状态/世界规则
- 输出格式为结构化问题清单（code review 风格）：

**最小 schema：**

```json
{
  "issues": [
    {
      "severity": "critical | high | medium | low",
      "category": "continuity | setting | character | timeline | ai_flavor | logic",
      "location": "第3段",
      "description": "主角使用了第15章已失去的能力'xxx'",
      "evidence": "原文：'萧炎催动xxx斗技' vs 记忆：第15章已失去该能力",
      "fix_hint": "改为使用当前已有的yyy能力",
      "blocking": true
    }
  ],
  "blocking_count": 1,
  "summary": "发现1个阻断问题，2个高优问题"
}
```

**阻断规则：**
- `blocking=true` 的问题替代原 `timeline_gate` 语义——存在任何 blocking issue 时，不得进入 Step 4
- `severity=critical` 默认 `blocking=true`；其余 severity 由审查 agent 判断

**指标沉淀（轻量）：**
- 每次审查结果写入 `index.db.review_metrics`，字段：`chapter, issues_count, blocking_count, categories, timestamp`
- 用于趋势观测（连续 N 章某类问题反复出现 → 提示系统性问题）
- 不再保存 `overall_score`

**anti-AI 职责划分：**
- **Step 3 负责发现** anti-AI 问题（category="ai_flavor"），列入问题清单
- **Step 4 负责修复**并做最终 anti-AI gate——修复所有问题后复检，确认无 blocking issue 残留

### 4.5 记忆模块（分两阶段交付）

**阶段 A：接口契约（先定，不依赖存储实现）**

上层消费者（context-agent、data-agent、审查 agent）只依赖以下契约：

```python
# 合并接口
memory.commit_chapter(chapter: int, result: dict) -> CommitResult
memory.load_context(chapter: int, budget_tokens: int) -> ContextPack

# 独立接口（context-agent research 模式按需调用）
memory.query_entity(entity_id: str) -> EntitySnapshot
memory.query_rules(domain: str) -> list[Rule]
memory.read_summary(chapter: int) -> str
memory.get_open_loops(status: str = "active") -> list[OpenLoop]
memory.get_timeline(from_ch: int, to_ch: int) -> list[TimelineEvent]
```

契约定义返回类型的字段，但不规定底层用 SQLite/JSON/向量库中的哪个。
context-agent 和 data-agent 重构只依赖这层契约。

**阶段 B：存储实现（后做）**

已确认方向：
- 按时效分层：近期（详细）→ 中期（摘要）→ 远期（活跃事实）
- 时间线作为索引轴
- 记忆类型：角色状态（可变）、世界规则（稳定）、伏笔（有生命周期）
- 具体实现方案搁置，待进一步思考

### 4.6 Plan（章纲约束重构方向）

章纲作为 harness 给 write 足够约束，但约束形式需要变：
- **约束"方向和边界"**，不约束"具体发生什么"
- **时间约束隐性化**——不在章纲里写死时间锚点，通过记忆系统间接传递，写后校验
- **Strand 比例按题材预设**，不硬编码 60/20/20
- **卷级叙事功能**——每章需要标注在卷中的叙事角色（起/承/转/合）
- 具体章纲字段设计待定

### 4.7 Skill/Agent Prompt 统一模板

每个 skill/agent 文件按固定结构编写：

```
1. 身份与目标
2. 可用工具与脚本（含调用方式）
3. 思维链（ReAct / 其他）
4. 输入
5. 执行流程（每步：输入 → 动作 → 输出）
6. 边界与禁区
7. 检查清单
8. 输出格式
9. 错误处理
```

### 4.8 参考资料

**删除**：冗余引用、已废弃文档、重复的 shared 引用（共 13 个文件）

**补充**（P0，16 条）：
- 反派设计、镜像反派、对手梯度、人物关系动力学
- 时间线设计、长篇升级节奏、反派压迫递进、伏笔埋设与回收
- 感情线递进、身份隐藏与曝光
- 暧昧/打脸/反转/对峙场景写法
- 章节开头钩子、章节结尾 cliffhanger

**要求**：每条方法论必须包含真实小说片段作为正面/反面范例

**改造**：现有 genres/ 和 write/references/ 下的文件从"结构模板"改为"方法论 + 范例 + 反面教材"

---

## 5. 未解决的设计问题

| # | 问题 | 状态 |
|---|------|------|
| 1 | 记忆模块具体实现（分层、存储、接口） | 搁置，待进一步思考 |
| 2 | 章纲具体字段设计（什么算"方向和边界"） | 待 plan 方案细化 |
| 3 | anti-AI 的具体机制（超越黑名单的方案） | 待写作 prompt 设计时解决 |
| 4 | context-agent 输出的写作提示具体格式 | 待 write 方案细化 |
| 5 | 参考资料的真实小说片段收集 | 待用户收集 |
| 6 | Init 的迭代打磨机制 | 待 init 方案细化 |
| 7 | 节拍表/时间线是否保留 | 待确认下游是否消费 |
| 8 | 批量生成章纲的最佳批次大小 | 待实验 |

---

## 6. Token 优化预估

| 环节 | 当前 | 优化后 | 节省 |
|------|------|--------|------|
| 审查 | ~200 万（6 agent × ~33 万） | ~40 万（1 agent） | ~80% |
| Context-agent | ~50 万（全量灌入） | ~15 万（按需检索） | ~70% |
| 风格适配 | ~30 万（独立 Step 2B） | 0（合并到润色） | 100% |
| Workflow 记录 | ~5 万（16 次 CLI） | 0（废弃） | 100% |
| **单章总计** | 300-500 万 | 预估 80-150 万 | ~60-70% |

---

## 7. 实施路径（建议）

| 阶段 | 内容 | 依赖 |
|------|------|------|
| Phase 1 | 废弃 workflow/resume + 审查合并 + Step 2B 合并 | 无 |
| Phase 2A | Skill/Agent prompt 统一模板 + 参考资料清理（删冗余） | 无 |
| Phase 2B | 参考资料范例补强（真实小说片段） | 用户收集素材 |
| Phase 3 | 记忆模块接口契约设计 | 无 |
| Phase 4 | Context-agent research 模式重构 | Phase 3（契约） |
| Phase 5 | 记忆模块存储实现 | Phase 3（契约）+ 用户设计确认 |
| Phase 6 | Plan 章纲约束重构 | Phase 4+5 |
| Phase 7 | anti-AI 加强 + 写作 prompt 优化 | Phase 2A+4 |

注：Phase 1/2A/3 无互相依赖，可并行推进。
