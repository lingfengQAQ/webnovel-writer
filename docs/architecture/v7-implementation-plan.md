# webnovel-writer v7 实施计划（里程碑路线图）

> 状态：草案 0.3（2026-07-02 同步设计边界回顾：新增 M5.5 体检里程碑、M5 补 F1 宿主 CLI 缝清单；0.2 于 2026-06-26 反映 RFC 后续决策、2026-06-27 同步 D3/D4）
> 上游：`v7-prd.md` 1.1、`story-repo-spec-2026-06-10.md` 0.9、`multi-agent-adaptation-spec-2026-06-05.md` v3.5、`.trellis/spec/backend/` 基线 1.0
> 地位：本文档管**实施排程**——把 PRD §6 的 v7.0 范围切成有依赖顺序、有出口判据的里程碑。范围与行为以 PRD/spec 为准，两者冲突时改本文档。

---

## 0. 现状盘点（2026-06-26）

| 事项 | 状态 |
|---|---|
| PRD 1.0 | ✅ 定稿（06-12，作者逐项确认） |
| story-repo-spec 0.8 / multi-agent-spec v3.4 | ✅ 按 PRD §10 修订指令完成，RFC 后续决策已落地（06-26）+ RFC 深度核验 D3/D4（06-27） |
| RFC | ✅ 已发 Discussions（06-12），~06-19 收口，06-26 完成后续决策（A1/A2/A3/D1/D2），06-27 深度核验补 D3/D4 |
| 后端开发规范基线 1.0 | ✅ `.trellis/spec/backend/` |
| v7 代码 | ❌ 0 行（`webnovel-writer/` 目录是 v6 遗产，冻结） |
| PRD 开放问题 | O2/O3 已消解；**O4（精准读取接口完整清单 + `.cache` 表设计）归 M1 第一步**（不在 RFC 后续任务范围，需单独任务） |
| 2026-07-02 边界回顾 | 13 项：文档侧已收口（spec 0.9 / PRD 1.1 / multi-agent v3.5 / 本文档 0.3）；代码侧另立「边界收口」任务，**M5 前置**（格式对齐、状态机判定、机检/备料/ReviewInput 补料） |

## 1. 排程原则

1. **RFC 开放期只做格式不敏感的地基**。RFC 意见可能改格式层（目录、front matter、条目格式），开放期内（至 ~06-19）不写依赖具体格式的代码；收口后格式层全速开工。
2. **依赖顺序**：格式库（读写+缓存重建）→ 写章流程脚本 → 状态机单入口 → AI 角色层 → 安装器 → 自动模式 → 迁移/导出。每层只依赖其左侧。
3. **验收前置**：beta 判据里的两条 CI（Windows 中文路径全链路、删 `.cache` 全量重建）分别在 M0、M1 就建起来，全程绿着往前走，不留到发布前补。
4. **每个里程碑出口判据可验证**——对应 PRD §4 验收方式或 §7 发布判据的具体条目，不接受"做完了"。
5. 里程碑是依赖序不是严格串行：M4 的知识层平移（纯搬运 v6 资产）、M5 安装器骨架可与 M2/M3 并行。

## 1.5 v7 架构原则（指导实施）

v7 的架构目标是**降低变化影响面**，通过清晰分层和显式用例，避免 v6 "动一个地方其他地方都受影响"的问题。

### 核心原则

1. **AI 永远不接触文件结构**
   - AI 只看到整理好的上下文 DTO（`CharacterContext`、`ChapterBrief`、`ReviewInput`）
   - AI 不知道 `定稿/设定/角色/林晚.md` 在哪里，只知道"当前角色是林晚，境界是金丹"
   - 改文件结构不影响 AI 层

2. **状态机永远不做业务判断**
   - 状态机只负责流程编排：下一步是备料/写稿/机检/两审/定稿
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

## 2. 里程碑

### M0 仓库骨架（RFC 开放期内，立即可开）

格式无关，RFC 怎么改都不浪费。

- npm 包骨架：包名、`bin` 入口、`src/` 模块划分（安装器/状态机/机检/备料/定稿/缓存）——定稿后回填 `.trellis/spec/backend/directory-structure.md` §4 待补项
- 测试骨架：`node:test`，零第三方依赖纪律从第一行代码生效；测试目录与命名约定回填规范
- CI：Linux + Windows 双矩阵，Windows 跑**中文路径**用例（先空壳，用例随里程碑长）
- **Node 版本门槛**（RFC 决策 A2）：≥ 22.13.0（`node:sqlite` 无需 flag 的最低版本）
- **出口**：CI 双平台绿；`node --version` 门槛检查（≥ 22.13.0）与人话提示可跑

### M1 格式层核心库 + 派生缓存（RFC 收口后第一批）

- **第一步消解 O4（设计文档，需单独任务）**：`.cache/index.db` 五表（chapters/threads/secrets/entities/fingerprints）DDL + 精准读取接口完整清单（spec 0.7 §11.1 初版清单的补全），成稿后补进 spec §11
- 容错读写库：front matter / 平铺 YAML / 三类条目文件 / book.yaml；未知字段保留原样写回（不变量 9）；写出防呆（平铺、块列表、危险值加引号）
- 重建器：只读 定稿/大纲/文风 全量重建缓存——**重建器即格式的参考实现**；履历证据引用验证章节文件存在（RFC 决策 A3）
- 精准读取接口 CLI 全套（条目/大纲/正文/时间线/设定/全文检索/报表）
- **架构实施**（§1.5 原则）：实现 Storage Adapter 接口（ChapterReader/Writer、ThreadLedgerReader/Writer 等小端口）
- **出口**：「删光 `.cache` 全量重建」CI 绿（beta 判据之一提前达成）；精准读取清单逐条有测试

### M2 写章流程脚本面（零 AI 全通）

八阶段里"执行体=脚本"的部分（spec 0.6 §8 第 1/3/5/8 步）：

- 全书近况组装、备料（本章写作材料，默认精准片段）
- 机检全套可计数项：字数、禁词/禁句式、复读、高频意象统计、句式体检、新专名比对名册、front matter 格式、账本变动形式检查、信息差关键词候选（只出清单不拦截）
  （事后注：跨章统计项——高频意象统计、句式体检——按 M2 任务 D2 决策移 **M5.5 体检**；条目变动形式检查在 M2 漏做，归「边界收口」任务补齐）
- 定稿原子 commit：正文入定稿、设定/时间线/名册更新、条目履历写入、章摘要落盘、工作区清空——要么完成要么原样保留
- **出口**：用手工伪造的草稿与细纲，一章从细纲走到定稿全程脚本可跑、零 AI 调用；定稿中断注入测试（断电模拟）后工作区原样保留

### M3 状态机单入口 + git 隐身全套

- git 健康检查（半提交/冲突/锁文件/损坏/网盘副本，各配自动修复或人话指引）
- 状态机 7 个态（spec 0.6 §10）：修复确认、建书引导、手改检测补登、断点续跑、卷复盘入口、体检入口、起草细纲
- "回到第 N 章"、影响分析脚本、吃书流程
- **出口**：7 个态各有端到端测试；构造 git 异常样本库逐个演练，作者可见输出零英文堆栈

### M4 AI 角色层 + 一级宿主壳（可与 M2/M3 部分并行）

- SKILL.md 入口、角色单源生成三平台壳 + drift check（multi-agent-spec v3.4）
- 两审任务书单源（事实审查/编辑审，RFC 决策 D1/D2）、写评分离的上下文编排、降级模式（无 subagent 顺序执行，诚实声明隔离度下降）
- 两审输出格式：结构化问题清单（severity + category + blocking），参考 v6 review schema
- **D3 未登记伏笔检测**：事实审查搭整章通读，反查"正文疑似伏笔但无条目"，产 `unregistered_thread` 候选，恒非阻断，作者裁决（spec 0.8 §8 第 6 步）
- SessionStart 注入（读 `books.jsonl`）；无 hook 宿主状态机入口等价路径
- 知识层平移：37 题材模板、追读力分类、爽点节奏库（纯搬运，可提前并行做）
- **架构实施**（§1.5 原则）：AI 只吃 DTO（CharacterContext、ChapterBrief、ReviewInput），只吐结构化输出
- **出口**：Claude Code + Codex 各跑一次真模型 smoke（建书引导→写 1 章→定稿→导出）
- **出口**：Claude Code 与 Codex 各跑一次真模型 smoke——建书 → 写 1 章 → 两审 → 定稿

### M5 安装器与多本书

- `npx webnovel-writer init` / `update`：工作目录布局、平台壳按检测生成、模板哈希追踪、Node 版本人话提示
- `books.jsonl` 登记 + 换书对话 + 书单重建自愈；工作目录 `AGENTS.md` 公约数层（标记块管理）；书仓库指路 `AGENTS.md`
- **F1 宿主 CLI 缝收口**（M1-M4 review follow-up，含"`next` 不输出 DTO"）：`next --json`（输出完整状态机 DTO，人读 message 保留为默认）、`review-input <章号>`、`save-review <章号> --file=<两审json>`、`persist-outline` / `persist-book` / `persist-volume-review` / `persist-repair`、`finalize <章号> --payload=<定稿包json>`；JSON 一律走 `--file` 不走 stdin（Windows 中文管道编码雷区）
- **出口**：干净 Windows 中文用户名环境一条命令装出工作目录并建第一本书（CI + 手测各一）；写章流程八阶段每一步都有宿主可调的 CLI 通道，`finalize→next` 端到端可经 CLI 跑通（F1）

### M5.5 体检（可与 M5 并行；M6 硬前置）

M1 defer 的指纹提取与 M2 D2 决策推迟的统计项在此收口——此前无宿主里程碑，PRD §4 #9/#11 是 7.0 验收项却悬空（2026-07-02 边界回顾）。

- 跨章高频意象统计（"空气仿佛凝固"全书 47 次这类；进体检报告，并接通备料"反复读清单"占位——取 top-N）
- 句式体检：句长方差、段落长度分布、高频句式开头
- 文体指纹提取 + 基线对比（填充 `fingerprints` 表，激活 `report-style-drift`）
- 状态机序 5 接通：体检报告落工作区不入档；上次体检章号存 `.cache`（spec 0.9 §10 序 5，丢失则重测无害）
- **出口**：PRD §4 #9/#11 验收方式可跑——高频意象可被机检/体检报出、句式体检指标进体检报告
  （出口达成 2026-07-04：意象/句式/指纹/缺时间锚点四节进体检报告，`runHealthCheck` 返回结构化 data 供 M6 阈值判定；机检增高频意象命中与句式偏离两候选（非阻断）；备料反复读清单接通；`report-style-drift` 补句长方差 delta。任务：`.trellis/tasks/07-04-m5-5-checkup/`，spec 0.11 决策 35）
- **硬依赖**：M6 停止条件"体检不过线"依赖本里程碑，M6 不得先行

### M6 自动模式（按批次定稿）

- `工作区/待定稿/` 批次结构、"定稿+待定稿批次"叠加组装视图（**支持批次内依赖**，RFC 决策 A1）
- 版本链与污染传播：第 K 章打回 → 标记 K+1 到 N 章"受影响"，作者确认重审/重写
- 停止条件四件套（写满/体检不过线/卷纲耗尽/连续 3 章无账本变动）
- 批量审稿、作者敲定后逐章按序定稿、整批回滚（"回到第 N 章"复用 M3）
- **架构实施**（§1.5 原则）：叠加视图通过 Storage Adapter 组装，状态机只管编排
- **出口**：PRD §4 #15 验收——自动模式端到端 + 注入错误的恢复演练（批内污染不出批次）
  （出口达成 2026-07-05：staging 批次模块（真源唯一读写点）+ 批次六命令 stage-chapter/batch-status/finalize-batch/batch-reject/batch-restage/batch-discard；备料/审稿输入/机检三消费点叠加，批内依赖可用、删缓存重建输出不变；停止四件套逐章判早停 + 批次质检三判据；污染传播三态 + finalize-batch 入口硬校验"全待审收"；序 3/序 6 dto 批次感知；SKILL「自动模式（连写）」段 + 壳重渲染 drift 绿。实现口径两处偏离原计划并已回填法律文本："整批不要"= batch-discard 删工作区（非"回到第 N 章"，goto 只管已定稿回退）；叠加视图=staging 只读模块直读工作区文件（不经 Storage Adapter、不碰缓存）。任务：`.trellis/tasks/07-04-m6-auto-mode/`，spec 0.12 决策 36-37）

### M7 导出 + /migrate + beta 入口

- 干净导出（单章/范围/全书，去 front matter，落 `工作区/导出/`）
- `/migrate` 一次性脚本（PRD §10.3 映射表）+ 迁移报告 + 整体回退
- **出口**：进入 beta——用 v7 真实写一本书到 50 章（建书→日更→吃书→卷复盘全覆盖）；`/migrate` 在 ≥3 个真实 v6 项目跑通是 7.0.0 判据，beta 期内完成

## 3. RFC 收口（~06-19，硬节点）

1. 汇总 Discussions 意见，逐条给处置（接受/改造接受/说明理由不接受）——回复全程大白话。
2. 接受的意见：先修 PRD/spec（0.6 → 0.7，走任务流程），再动代码——文档先行是铁律。
3. 收口前 issue 区与 Discussions 的提问保持及时回复。
4. 收口后 M1 格式层代码开闸。

## 4. 与发布判据的对应

| PRD §7 判据 | 路线图归属 |
|---|---|
| 发 RFC | ✅ 已达成（06-12） |
| beta：真写一本书到 50 章 | M7 出口后启动 |
| beta：Windows 中文路径全链路 CI 绿 | M0 建、M5 补全链路 |
| beta：删 `.cache` 全量重建 CI 绿 | M1 出口 |
| 7.0.0：`/migrate` ≥3 真实项目 + 无数据丢失级 bug | M7 + beta 期 |

## 5. 下一个可立即开工的任务

1. **M0 仓库骨架**（立即可起）：格式无关，不等 RFC。Node 版本门槛 ≥ 22.13.0（RFC 决策 A2）。
2. **O4 设计文档**（与 M0 并行，需单独任务）：表 DDL + 精准读取接口清单，纸面工作，RFC 改格式时修订成本低。
3. spec 0.7 / multi-agent-spec v3.3 已完成（RFC 后续任务），M1 可依据新 spec 开工。
