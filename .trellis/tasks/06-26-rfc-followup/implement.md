# 执行计划：v7 RFC 后续推进

## 执行顺序

按依赖关系排序，必须顺序执行：

1. ✅ **规划阶段**（已完成）
2. → **文档更新阶段**（4 个文件）
3. → **RFC 跟进评论**（依赖文档更新完成）
4. → **提交与清理**

---

## 阶段 1：更新 story-repo-spec（0.6 → 0.7）

### 1.1 更新文件头部版本信息

**文件**：`docs/architecture/story-repo-spec-2026-06-10.md`

**修改**：
```markdown
# Story Repo 格式规格（v7 草案 0.7）

> 状态：0.7。相对 0.6 的变更：
> - 补充 A1 决策：自动模式待定稿批次的版本链叠加机制（§8.1）
> - 更新 A2 决策：Node >= 22.13.0 运行时要求（§2.2）
> - 明确 A3 决策：履历证据的章节级验证范围（§5 线索条目格式，§11 缓存重建器职责）
> - 调整审稿定义：从三审改为两审（事实审查 + 编辑审），去掉读者审（§8 第 6 步）
> - 补充审稿终止机制：severity + blocking 规则（§8 第 6-7 步）
> - 澄清 B 类问题：缓存删除代价（§11）、关键词扫描边界（§4.3）、两审模式（§8 第 6 步）
```

### 1.2 更新 §2.2 Node 版本要求（A2）

**当前文本**：
```
Node ≥ 22（零第三方依赖：.cache/index.db 用内置 node:sqlite）
```

**修改为**：
```
**脚本运行时统一 Node ≥ 22.13.0**（零第三方依赖：`.cache/index.db` 用内置 `node:sqlite`，v22.13.0 起无需 `--experimental-sqlite` flag；装任何 agent CLI 的用户必有 Node；无 Python、无 pip、无 .env）。安装器检测 Node 版本，< 22.13.0 时人话提示升级。一切文件 IO 显式 UTF-8（Node 默认即是），禁止依赖系统 locale。
```

### 1.3 更新 §5 线索条目履历格式（A3）

**找到**：`§5 伏笔 / 悬念 / 感情线` 中的履历示例

**补充说明**：
```markdown
**履历证据引用格式**：
- 格式：`第152章：主角在北境对峙时首次察觉真相`（章节级别 + 自然语言描述）
- 验证范围：
  - 重建器验证：章节文件是否存在（脚本能做的）
  - 两审验证：读取整章验证语义正确性（AI 能做的）
- 理由：网文章节 2000-3000 字，全文读取压力可接受；避免段落编号维护的复杂性
```

### 1.4 更新 §8 写章流程第 6 步（D1 + D2）

**当前文本**（第 6 步）：
```
| 6 | 三审 | AI ×3（各自新鲜上下文） | **读者审**（爽不爽/哪段想划走，用追读力知识库的标准）、**编辑审**（结构与商业性）、**设定校对**（语义判断都在这里：①"要写到的事"逐条核对正文写没写到；②机检泄密候选是否真泄密；③条目履历引用的章内证据是否属实）→ `工作区/评审报告/` |
```

**修改为**：
```
| 6 | 两审 | AI ×2（各自新鲜上下文） | **事实审查**（v6 的 5 维度：设定一致性、时间线、叙事连贯、角色一致性、逻辑 + v7 特有项：①"要写到的事"逐条核对正文；②机检泄密候选是否真泄密；③条目履历引用的章内证据是否属实）、**编辑审**（结构、节奏、商业性、主角动机：主角每个主要行动是否有即时驱动、可见压力、预期收益、情绪原因，或明确标注为非理性行为）→ `工作区/评审报告/`。输出格式：结构化问题清单（severity + category + blocking），参考 v6 review schema。|
```

**补充审稿终止机制**（在第 6 步后新增说明段落）：
```markdown
**审稿终止机制**（防止无限循环）：
- 两审输出结构化问题清单，每个问题包含 `severity`（critical/high/medium/low）、`category`、`blocking`（是否阻断定稿）、`description`、`evidence`、`fix_hint`
- 阻断规则：`severity=critical` 自动 `blocking=true`；其他 severity 由 AI 判断
- 作者审稿时可选择：接受当前版本（即使有非阻断问题）/ 改完接受（不重新审稿）/ 打回重写
- **系统不强制完美**：非阻断问题作为"优化建议"，作者可接受现状并定稿
```

### 1.5 更新 §8.1 自动模式叠加视图（A1）

**找到**：`### 8.1 自动模式（连写，按批次定稿）` 中的"叠加视图"段落

**补充说明**：
```markdown
- **叠加视图与版本链**（规范性要求）：写批内后续章时，备料脚本组装"`定稿/` + 待定稿批次预登记"的叠加视图——批内前章的设定变更、条目推进、时间线行在工作区就位，定稿时原样转正。**支持批次内依赖**：第 K+1 章可以使用第 K 章的预登记事实。当第 K 章被作者打回时，标记 K+1 到 N 章为"受影响"，需重新审核或重写（具体污染传播机制由 M6 实施时设计）。
```

### 1.6 澄清 §11 缓存删除代价（B 类）

**找到**：`§11 .cache/ 派生缓存` 中关于删除的说明

**补充说明**：
```markdown
**删除 `.cache/` 后的行为**：
- 系统从源文件全量重建缓存（所有查询照常回答，这是 CI 验收项）
- 首次查询会触发冷重建（可能需数秒，视书籍体量），或临时降级为全文件扫描并给出提示
- 不应暗示"删除缓存零代价"
```

### 1.7 澄清 §4.3 信息差关键词扫描边界（B 类）

**找到**：`§4.3 信息差` 中关于泄密扫描的说明

**确认当前文本已明确**（如已明确则无需修改）：
- 关键词扫描 = 机械召回（产出候选清单）
- 是否真泄密 = 事实审查中的语义判断

### 2.6 补充 v7 架构原则

**找到**：`## 2. 里程碑` 之前

**插入新章节**：
```markdown
## 1.5 v7 架构原则（指导实施）

v7 的架构目标是**降低变化影响面**，通过清晰分层和显式用例，避免 v6 "动一个地方其他地方都受影响"的问题。

### 核心原则

1. **AI 永远不接触文件结构**
   - AI 只看到整理好的上下文 DTO（`CharacterContext`、`ChapterBrief`、`ReviewInput`）
   - AI 不知道 `定稿/设定/角色/林晚.md` 在哪里，只知道"当前角色是林晚，境界是金丹"
   - 改文件结构不影响 AI 层

2. **状态机永远不做业务判断**
   - 状态机只负责流程编排：下一步是备料/写稿/机检/审稿/定稿
   - 不判断伏笔真假，不解析 Markdown，不拼上下文

3. **脚本层按 Use Case 拆，不按技术动作拆**
   - 显式用例：`prepareChapterMaterials`、`runMechanicalChecks`、`finalizeChapter`、`rebuildCache`、`analyzeRetconImpact`
   - 不做通用工具函数到处调用

4. **Markdown 格式变化只影响 Storage Adapter**
   - front matter 字段、目录命名、履历格式这些变化，收敛在 `MarkdownStoryStore` / parser / serializer

5. **跨层通信用稳定 DTO**
   - 例如 `Chapter`、`ThreadEntry`、`ReviewIssue`、`ContextPack`
   - 不跨层传 Markdown 字符串、文件路径、半解析 YAML

### 接口设计：拆小端口，不做大接口

**避免上帝对象**：
- ❌ 不做 `StoryRepo` 大接口（20 个方法，谁都能干任何事）
- ✅ 拆成小端口：`ChapterReader`、`ChapterWriter`、`ThreadLedgerReader`、`GitPublisher`
- 每个 use case 只依赖需要的端口（权限最小化）

### 配置化边界：只调策略，不定义流程

**可以配置**（策略参数）：
```yaml
review:
  max_iterations: 3
  enable_fact_check: true

auto_mode:
  batch_size: 8
```

**不要配置**（自定义流程语言）：
```yaml
steps:
  - id: custom_step
    command: my_script.js
```

理由：v7.0 的目标是"可预测"，不是"无限可扩展"。配置化流程会让调试成本暴涨。

### 变化影响面

- ✅ 改格式（front matter 字段）→ 只改 Storage Adapter
- ✅ 改流程策略（批次大小、审稿轮数）→ 只改配置
- ✅ 改 AI prompt → 只改 AI 层模板
- ✅ 换模型 → AI 层封装，对外接口不变
- ✅ 加新宿主 → 只动 Host Adapter
- ⚠️ 改领域模型（如伏笔/悬念/感情线概念）→ 合理的跨层影响

### 里程碑对应

- **M1 格式层**：实现 Storage Adapter 接口（ChapterReader/Writer 等）
- **M2 脚本层**：实现 Use Case（prepareChapterMaterials、finalizeChapter 等）
- **M3 状态机**：只管流程编排，不管业务逻辑
- **M4 AI 层**：只吃 DTO，只吐结构化输出
- **M5 安装器**：Host Adapter 层
```

**注意**：这个章节编号为 1.5，插入在"排程原则"之后、"里程碑"之前。


### 2.1 更新文件头部版本信息

**文件**：`docs/architecture/v7-implementation-plan.md`

**修改**：
```markdown
> 状态：草案 0.2（2026-06-26，反映 RFC 后续决策）
> 上游：`v7-prd.md` 1.0、`story-repo-spec-2026-06-10.md` 0.7、`multi-agent-adaptation-spec-2026-06-05.md` v3.3、`.trellis/spec/backend/` 基线 1.0
```

### 2.2 更新现状盘点

**找到**：`## 0. 现状盘点` 表格

**修改 RFC 行**：
```
| RFC | ✅ 已发 Discussions（06-12），~06-19 收口，06-26 完成后续决策（A1/A2/A3/D1/D2） |
```

**补充 PRD 开放问题行**：
```
| PRD 开放问题 | O2/O3 已消解；**O4 归 M1 第一步**（不在 RFC 后续任务范围，需单独任务） |
```

### 2.3 更新 M1 里程碑

**找到**：`### M1 格式层核心库 + 派生缓存`

**修改第一步说明**：
```
- **第一步消解 O4（设计文档，需单独任务）**：`.cache/index.db` 五表 DDL + 精准读取接口完整清单，成稿后补进 spec §11。**Node 版本要求**：≥ 22.13.0（RFC 后续决策 A2）。
```

### 2.4 更新 M4 里程碑

**找到**：`### M4 AI 角色层 + 一级宿主壳`

**修改两审说明**：
```
- 两审任务书单源（事实审查/编辑审，参考 v6 review schema）、写评分离的上下文编排、降级模式（无 subagent 顺序执行，诚实声明）
```

### 2.5 更新 M6 里程碑

**找到**：`### M6 自动模式（按批次定稿）`

**补充版本链说明**：
```
- `工作区/待定稿/` 批次结构、"定稿+待定稿批次"叠加组装视图（**支持批次内依赖**，RFC 决策 A1）
- 污染传播机制：第 K 章打回 → 标记 K+1 到 N 章"受影响"，作者确认重审/重写
```

### 2.6 更新"下一个可立即开工的任务"

**找到**：`## 5. 下一个可立即开工的任务`

**修改为**：
```
1. **M0 仓库骨架**（立即可起）：格式无关，不等 RFC。Node 版本门槛 ≥ 22.13.0（RFC 决策 A2）。
2. **O4 设计文档**（与 M0 并行，需单独任务）：表 DDL + 精准读取接口清单，纸面工作，RFC 改格式时修订成本低。
3. spec 0.7 / multi-agent-spec v3.3 已完成（RFC 后续任务），M1 可依据新 spec 开工。
```

---

## 阶段 3：更新 multi-agent-adaptation-spec（v3.2 → v3.3）

### 3.1 更新文件头部版本信息

**文件**：`docs/architecture/multi-agent-adaptation-spec-2026-06-05.md`

**修改**：
```markdown
> 版本：v3.3（2026-06-26，反映 RFC 后续决策）
> 变更：明确两审模式（完整 vs 兼容）；更新审稿清单定义（参考 v6 review schema）
```

### 3.2 更新审稿清单定义

**找到**：多宿主适配中关于"三审"的章节

**修改为**：
```markdown
### 两审任务书

**事实审查**：
- 维度：设定一致性、时间线、叙事连贯、角色一致性、逻辑（v6 的 5 维度）
- v7 特有项：①"要写到的事"核对；②泄密候选判断；③履历证据验证
- 输出格式：结构化问题清单（参考 v6 `review-schema.md`）
- category 取值：`setting | timeline | continuity | character | logic | requirement | leak | evidence`

**编辑审**：
- 维度：结构、节奏、商业性、主角动机
- 输出格式：同上
- category 取值：`structure | pacing | commercial | motivation`

**阻断规则**：
- `severity=critical` 自动 `blocking=true`
- 存在 `blocking=true` 的问题 → 作者审稿时明确标识
- 作者可选择：接受现状 / 改完接受 / 打回重写
```

### 3.3 更新两审模式说明

**找到**：宿主能力差异的章节

**补充或修改**：
```markdown
### 两审模式

**完整模式**（推荐）：
- 事实审查 + 编辑审各用独立上下文（subagent 或独立会话）
- 审稿隔离度高，互不影响

**兼容模式**（降级）：
- 单 agent 顺序执行两审
- 输出必须诚实声明："本次使用兼容模式（单上下文顺序审稿），审稿隔离度低于完整两审模式"
- 审稿报告中标注使用的模式

不支持完整模式的宿主，应在文档中明确说明兼容模式的限制。
```

---

## 阶段 4：RFC 跟进评论

### 4.1 起草评论文案

**目标**：发布到 Discussion #118

**结构**：
1. 感谢与总结（1-2 段）
2. 核心决策说明（A1/A2/A3/D1/D2，每个 1-2 句）
3. 采纳清单（表格：v7.0 vs 7.x）
4. 遗漏反馈回应（5 个要点）
5. 质量承诺边界明确
6. 后续时间线

**文案要点**：
- 用词：易读但不过分口语
- 长度：控制在 500-800 字
- 格式：Markdown，使用标题、列表、加粗
- 链接：指向 v7 分支的更新后文档

### 4.2 评论草稿检查清单

- [ ] 所有用户反馈都有回应（Chained1001、wangwwno1、Fahaoxi、shuimushanjia）
- [ ] 术语反馈已回应
- [ ] 审稿循环问题已说明解法
- [ ] AI 平庸倾向已明确边界
- [ ] 伏笔追踪已说明改进
- [ ] 文风成本已更新 backlog
- [ ] 文案符合"易读但不过分口语"

### 4.3 发布流程

1. 在本地起草完整评论（保存为 `rfc-followup-comment.md`）
2. 复制到 Discussion #118 评论框
3. 预览检查格式
4. 发布

---

## 阶段 5：提交与清理

### 5.1 git 提交

**验证修改**：
```bash
git status
git diff docs/architecture/story-repo-spec-2026-06-10.md
git diff docs/architecture/v7-implementation-plan.md
git diff docs/architecture/multi-agent-adaptation-spec-2026-06-05.md
```

**提交**：
```bash
git add docs/architecture/story-repo-spec-2026-06-10.md
git add docs/architecture/v7-implementation-plan.md
git add docs/architecture/multi-agent-adaptation-spec-2026-06-05.md
git commit -m "docs(v7): RFC 后续决策落地 - spec 0.7 + 实施计划 0.2

- 补充 A1/A2/A3 核心决策（版本链叠加、Node 22.13.0、章节级锚点）
- 审稿机制调整为两审（事实审查 + 编辑审），增加终止机制
- 更新实施计划反映决策，明确 M1/M4/M6 里程碑要点
- 多宿主 spec 明确两审模式（完整 vs 兼容）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### 5.2 最终验收

- [ ] 4 个文档文件版本号正确（spec 0.7, plan 0.2, multi-agent v3.3）
- [ ] 所有决策在 spec 中完整体现
- [ ] 术语一致性检查通过
- [ ] RFC 跟进评论已发布
- [ ] git 提交已完成，commit message 清晰
- [ ] 当前任务目录整理完毕

---

## 回滚方案

如果文档更新出现问题：

```bash
# 查看提交历史
git log --oneline -5

# 回滚到上一次提交
git reset --soft HEAD~1

# 或撤销特定文件
git checkout HEAD~1 -- docs/architecture/story-repo-spec-2026-06-10.md
```

---

## 验证命令

**检查版本号**：
```bash
grep "草案 0.7\|v3.3\|草案 0.2" docs/architecture/*.md
```

**检查术语一致性**（抽查）：
```bash
grep -n "三审\|读者审" docs/architecture/story-repo-spec-2026-06-10.md
# 预期：应该改为"两审"，无"读者审"
```

**检查 Node 版本**：
```bash
grep "Node.*22" docs/architecture/story-repo-spec-2026-06-10.md
# 预期：应该是 "22.13.0"
```

---

## 执行注意事项

1. **顺序执行**：必须先完成所有文档更新，再起草 RFC 评论（评论需要引用更新后的文档）
2. **验证后再提交**：每个文档更新后用 `git diff` 检查，确认无误再进入下一个
3. **保留草稿**：RFC 评论先保存为本地文件，检查后再发布
4. **记录问题**：执行中发现的问题记录到任务研究目录
