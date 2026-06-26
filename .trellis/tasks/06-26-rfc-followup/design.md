# 技术设计：v7 RFC 后续推进

## 1. 设计范围

本任务是**文档更新任务**，不涉及代码实施。设计范围：

- 更新 4 个文档文件（spec、实施计划、multi-agent-spec）
- 发布 RFC 跟进评论（Discussion #118）
- 不涉及代码修改、不涉及 master 分支

## 2. 文档更新边界

### 2.1 决策来源

- **A1/A2/A3**：三个核心决策（来自 RFC 反馈报告 §A）
- **D1**：两审调整（来自 v6 实践经验 + RFC 反馈）
- **D2**：审稿终止机制（来自 Discussion #118 遗漏分析）
- **D3**：未登记伏笔检测（来自 Discussion #118 深度核验，shuimushanjia 06-22）
- **D4**：设定↔大纲单向依赖不变量（来自 freezero2020 06-26）
- **B 类澄清**：缓存删除代价、关键词扫描边界、两审模式（来自 RFC 反馈报告 §B）

### 2.2 更新策略

**story-repo-spec 0.6 → 0.7**：
- 补充内容：A1/A2/A3 决策、D1 两审定义、D2 审稿终止机制、**D3 未登记伏笔检测（§8 第 6 步事实审查职责）**、**D4 设定↔大纲单向依赖不变量（§1 + §4.2）**、B 类澄清
- 不修改内容：其他章节保持不变
- 版本号：0.6 → 0.7

**v7-implementation-plan 0.1 → 0.2**：
- 更新 M1/M4/M6 里程碑描述（反映决策）
- 更新"下一个可立即开工的任务"章节
- 版本号：草案 0.1 → 草案 0.2

**multi-agent-adaptation-spec v3.2 → v3.3**：
- 明确两审模式（完整 vs 兼容）
- 更新审稿清单定义（参考 v6 review schema）
- 版本号：v3.2 → v3.3

**v7-prd.md**：
- 保持 1.0 不变（已定稿）
- 决策细节只记录在 spec 中

## 3. 两审输出格式设计

### 3.1 参考基准

v6 的 `webnovel-writer/references/review-schema.md` 定义了结构化问题清单：

```json
{
  "chapter": 100,
  "issues": [
    {
      "severity": "critical | high | medium | low",
      "category": "continuity | setting | character | timeline | logic | pacing | other",
      "location": "第N段 或 具体引用",
      "description": "问题描述",
      "evidence": "原文引用 vs 数据记录",
      "fix_hint": "修复方向",
      "blocking": true
    }
  ],
  "issues_count": 1,
  "blocking_count": 1,
  "has_blocking": true,
  "dimension_results": [
    {"dimension": "setting", "conclusion": "pass"},
    {"dimension": "timeline", "conclusion": "发现1个问题：..."},
    ...
  ],
  "summary": "N个问题：X个阻断，Y个高优"
}
```

### 3.2 v7 两审输出格式

**事实审查输出**（AI，新鲜上下文）：

- 维度：设定、时间线、连贯、角色、逻辑（v6 的 5 维度）+ v7 特有项（要写到的事核对、泄密候选判断、履历证据验证、**未登记伏笔检测 D3**）
- 输出格式：同 v6 review schema
- category 取值：`setting | timeline | continuity | character | logic | requirement | leak | evidence | unregistered_thread`
  - `unregistered_thread`（D3）：正文出现疑似伏笔但无对应条目；`severity` low/medium，**`blocking` 恒为 false**，候选制不拦截

**编辑审输出**（AI，新鲜上下文）：

- 维度：结构、节奏、商业性、主角动机
- 输出格式：同 v6 review schema
- category 取值：`structure | pacing | commercial | motivation`

### 3.3 阻断规则

- `severity=critical` 自动 `blocking=true`
- 其他 severity 由 AI 根据上下文判断
- 存在任何 `blocking=true` 的 issue → 作者审稿时看到明确标识
- 作者可选择：接受（即使有非阻断问题）/ 改完接受 / 打回重写

## 4. 版本链叠加机制概要

**A1 决策**：支持批次内依赖，打回时传播影响。

**设计要点**（spec 0.7 需明确）：
- 叠加视图组装规则：`定稿/ + 待定稿/批次预登记`
- 污染传播：第 K 章打回 → 标记 K+1 到 N 章为"受影响"
- 作者确认流程：整批重写 vs 逐章确认（待 M6 实施时设计细节）

**不在本次任务范围**：
- 具体的污染传播算法（M6 实施时设计）
- 叠加视图的代码实现（M6 实施时完成）

## 5. 文档一致性检查清单

更新完成后需验证：

- [ ] A1/A2/A3 决策在 spec 0.7 中完整体现
- [ ] D1 两审定义在 spec 0.7 §8 和 multi-agent-spec v3.3 中一致
- [ ] D2 审稿终止机制在 spec 0.7 §8 中明确
- [ ] 实施计划 0.2 反映了决策对里程碑的影响
- [ ] 所有文档的版本号已更新
- [ ] 术语一致性（伏笔/悬念/感情线、细纲、审稿等）

## 6. RFC 跟进评论结构

**段落结构**：
1. 感谢反馈（1-2 句）
2. RFC 征集期总结（收到哪些反馈）
3. 核心决策说明（A1/A2/A3/D1/D2）
4. 采纳清单（v7.0 vs 7.x）
5. 遗漏反馈回应（术语、审稿循环、AI 平庸、伏笔追踪、文风）
6. 质量承诺边界明确
7. 后续时间线（如有）

**文案要求**：
- 易读但不过分口语
- 每个决策用 1-2 句话说清楚
- 避免技术细节（链接到 v7 分支文档）
- 真诚回应用户关切

## 7. 边界与约束

**本次任务不做的事**：
- ❌ 不实施 O4 设计（`.cache/index.db` DDL）
- ❌ 不修改 master 分支
- ❌ 不编写代码
- ❌ 不设计版本链叠加的具体算法
- ❌ 不设计两审的具体 prompt

**后续任务接口**：
- O4 设计应该作为独立任务，在 M1 前完成
- v7.0 实施时，M4 需要根据 spec 0.7 实现两审
- M6 需要根据 spec 0.7 实现版本链叠加

## 8. 风险与缓解

**风险 1**：文档更新后与 PRD 1.0 冲突
- **缓解**：PRD 1.0 是产品法律文本，spec 是技术细化，只要不违背 PRD 原则即可

**风险 2**：两审定义与 v6 reviewer 的区别不够清晰
- **缓解**：在 spec 中明确"继承 v6 的什么 + v7 新增了什么"

**风险 3**：RFC 跟进评论发布后收到新反馈
- **缓解**：评论中说明"征集期已结束，后续反馈将记录但不影响 v7.0 范围"

## 9. 验收标准

- [ ] 4 个文档文件已更新，版本号正确
- [ ] 文档内容与 PRD 决策一致
- [ ] 术语一致性检查通过
- [ ] RFC 跟进评论已发布到 Discussion #118
- [ ] 所有决策和遗漏反馈都有回应
- [ ] git 状态干净（文档更新已提交到 v7 分支）
