# M5.5 体检里程碑：高频意象统计、句式体检、文体指纹

## Goal

体检从"最小占位"升级为 spec §9 完整定义：三个零 token 统计算法落地（跨章高频意象、句式体检、文体指纹+基线漂移），填充 `fingerprints` 表激活 `report-style-drift`，高频意象接通备料"反复读清单"占位，并为 M6 停止条件"体检不过线"提供结构化数据面。

对应实施计划 0.3 §2「M5.5 体检」（`docs/architecture/v7-implementation-plan.md:157`），上游依据：`v7-prd.md` §4 #9（桥段循环）/#11（AI 味）/#2（时间线，缺锚点检查部分）、`story-repo-spec` 0.10 §3（体检周期/文体基线）/§8 第 5 步（机检统计项）/§9（体检定义）/§10 序 5、`cache-design-2026-06-26.md` §1.5（fingerprints 表）。

**里程碑定位**：M6 硬前置——M6 停止条件"体检不过线"依赖本任务的数据面；本任务不做阈值判定。

## Background（已确认事实）

- **序 5 已接通，体检是"最小版"**：`v7/src/state-machine/index.js:61-65` 按 `maxChapter - lastCheck >= 体检周期` 判定进入 `health-check` 态（needsAI=false）；`runHealthCheck`（`v7/src/health-check/index.js`）已产 `工作区/体检报告.md`（全书近况 + 悬了太久 + 条目活跃率 + 连续弱钩），体检章号写 meta `last_health_check_chapter`（跨重建保留，丢失重测无害）。报告"文体指纹 / 高频意象 / 句式体检"节是占位（index.js:48-49"随 M5.5 落地"）。
- **fingerprints 表已建**（`v7/src/cache/schema.js:80-93`，SCHEMA_VERSION 2）：PK `(chapter_range_start, chapter_range_end)`、`is_baseline`、5 个常用特征列 + `fingerprint_data` JSON；**无时间戳**（指纹是确定性派生物，删缓存重算结果必须一致，cache-design §1.5 不变量）。`rebuilder.js:49` 重建时留空，何时算哪段由调用方决定。
- **report-style-drift 半激活**（`v7/src/commands/report-style-drift.js`）：读表对比基线 vs 最近章段已实现（表空友好报错），但只输出 3 项 delta，**缺句长方差 delta**；特征提取函数不存在（M1 明确 defer：`06-27-m1-format-core/prd.md:266`）。
- **备料占位**：`v7/src/prep/index.js:97`「反复读清单（暂空，跨章高频意象统计随 M5.5 体检补）」。
- **机检推迟项**：M2 D2 决策（`06-27-m2-writing-flow/prd.md:46`）把"跨章高频意象统计、句式体检"推到体检里程碑，机检框架预留扩展点（`v7/src/mechanical-check/index.js` 顺序 check 函数，issues 带 `blocking` 字段；先例：新专名/信息差走非阻断候选）。
- **book.yaml 策略参数已就位**：`体检周期: 50`、`文体基线起/止`（默认 1-30），BookConfigReader 已读（spec 0.10 §3）。
- **缺时间锚点检查是 spec-实现缺口**：spec §9 体检定义含此项（原文用词"时间线孤儿"，本任务改名，见决策 D4），PRD §4 #2 验收依赖它，v7 无任何实现；chapters 表有 `story_time` 列，TimelineReader 已有。
- **v6 无可平移代码资产**：高频意象/句式仅存在于设计讨论记录，算法新写（spec 已定口径）。
- **CLI 通道已有**：`health-check` 命令（`v7/src/commands/health-check.js`）走 run 契约；宿主经 `next` 序 5 → `health-check` 已可跑通。

## Requirements

### A. 跨章高频意象统计（PRD #9，零 token）

- A1 全书扫描定稿正文，提取跨章重复短语（中文 n-gram 聚合 + 最长优先去重），排除名册专名/别名；产出 top-N 清单（短语、全书次数、出现章分布概要）
- A2 清单进体检报告"高频意象"节（"空气仿佛凝固：全书 47 次"这类可读呈现）
- A3 统计结果存缓存（meta JSON，跨重建保留无害、重测刷新），备料读取接通"反复读清单"：列 top-N「全书已用 N 次，本章避免再用」；从未体检 → 占位改为人话提示"尚未体检，暂无数据"
- A4 机检接入（消费不生产）：本章草稿命中缓存清单中的高频意象 → **非阻断**提醒（不改变机检 pass 判定）；无体检数据 → 该项静默跳过

### B. 句式体检（PRD #11）

- B1 分句/分段统计：句长方差、段落长度分布、高频句式开头（句首短语 top-N）
- B2 指标进体检报告"句式体检"节
- B3 机检接入：本章句式指标 vs 基线指纹对比，偏离超容差 → **非阻断**提醒；无基线数据 → 静默跳过
- B4 单章（机检）与章段（体检/指纹）复用同一统计函数，口径一致

### C. 文体指纹提取 + 基线对比（激活 M1 留桩）

- C1 特征提取函数：输入章号区间 → 读定稿正文 → 产指纹（avg_sentence_length / sentence_length_variance / avg_paragraph_length / common_phrase_frequency / vocabulary_richness + fingerprint_data 完整 JSON）；**确定性**：同章段任何时候重算结果一致
- C2 体检时 upsert 两行：基线章段（book.yaml `文体基线起/止`）+ 当前周期章段；重建器保持留空（注释同步更新）
- C3 `report-style-drift` 补齐：输出增加句长方差 delta；体检报告"文体指纹"节含基线 vs 最近的漂移对比与人话说明（回拉或更新基线由作者决定，脚本只提示改 book.yaml 的方法，不自动改）

### D. 缺时间锚点检查（原 spec 表述"时间线孤儿"，本任务统一改名）

- D1 两种缺法都查：定稿章 front matter 无「故事时间」（chapters 表 `story_time` 空）；或时间线文件中无该章对应行。统一进体检报告"缺时间锚点"节（全齐报"无"）
- D2 对齐 PRD §4 #2 验收（原文"体检报告时间线孤儿为零"→"缺时间锚点的章为零"，spec §9/PRD #2 用词随本任务 3.3 spec 回填一并替换）

### E. 体检编排与 M6 数据面

- E1 `runHealthCheck` 集成上述统计，替换占位节；返回值增加结构化 `data`（各项指标与清单），作为 M6 阈值判定的对接面（本任务不判"过线/不过线"）
- E2 报告仍落 `工作区/体检报告.md` 不入档；`last_health_check_chapter` 逻辑不变
- E3 降级诚实：单项统计失败不炸整个体检，节内如实说明该项失败原因；永不带英文堆栈

## Acceptance Criteria

- [x] AC1（PRD #9 验收）：构造重复意象样章 fixture（如"空气仿佛凝固"多章反复），体检报告高频意象节列出短语与全书次数；体检后机检对命中草稿产**非阻断**提醒（后半在 `test/health-check/index.test.js` 报告节用例；前半"机检报出"在 `test/mechanical-check/check.test.js`「高频意象命中」用例，meta 种子 = 体检产物，链路由体检测试证明 meta 确实写入）
- [x] AC2（PRD #11 验收）：体检报告含句长方差、段落长度分布、高频句式开头三类指标；机检句式项在偏离基线时产非阻断提醒、无基线时静默跳过
- [x] AC3 指纹链路：体检后 `fingerprints` 表含基线 + 当前周期两行；`report-style-drift` 输出含句长方差在内的 delta；**删 `.cache` 全量重建后再次体检，指纹逐字段一致**（确定性）
- [x] AC4 备料接通：体检后 `prepare-chapter` 产出的写作材料"反复读清单"含 top-N 高频意象及次数；未体检时输出人话占位
- [x] AC5 缺时间锚点：时间锚点齐全的 fixture 报"无"；构造缺「故事时间」（实字段名「书内时间」）或时间线漏行的章，体检能列出章号
- [x] AC6 序 5 回归：体检后 meta 更新、`next` 不再报体检；既有全量测试绿（374/374，Windows 本机）；CI 双平台绿随 P4.4 push 后回填 run 号：（待）
- [x] AC7 M6 对接面：`runHealthCheck` 返回结构化 data（指纹漂移/高频意象/句式/悬了太久等），测试断言形状稳定

## Out of Scope

- ❌ 阈值判定与"体检不过线"停止条件（M6：数据面在本任务，判定归自动模式）
- ❌ 卷复盘调用指纹提取（cache-design"调用方决定"机制已允许，接入随 M6/M7 按需）
- ❌ 语气体检/遮名盲测/情绪波形图（7.x，PRD #4/#10/#12 明确后置）
- ❌ 高频阈值/top-N 的 book.yaml 参数化（本版硬编码合理默认；报告是提醒不拦截，参数化收益低，7.x 视反馈）
- ❌ 增量指纹计算（体检低频操作，每次全量重算章段可接受）
- ❌ 分词库引入（保持"运行时直接依赖仅 js-yaml"，用字符 n-gram + 标点分句的零依赖算法）

## 决策记录（brainstorm）

- **D1 机检两统计项按 spec §8 第 5 步回接，均非阻断**：出口原文"高频意象可被机检/体检报出"；"报出"≠拦截，且与 M2 候选类先例（新专名/信息差不拦）一致。机检消费体检缓存（meta 清单/基线指纹），不在每章全书扫描——体检产出、机检消费的分工保持机检快与零重复计算。
- **D2 全书高频意象存 meta JSON 不建新表**：派生物、单 key 读写、跨重建保留语义与体检章号一致；避免 SCHEMA_VERSION 变更触发全量重建。
- **D3 指纹每次体检直接重算 upsert**（不查缺）：确定性派生物重算结果相同，简单胜过缓存判断。
- **D4 术语替换（作者确认 07-04）**："时间线孤儿"面向作者不是人话，统一改为**"缺时间锚点"**；检查项纳入 M5.5，spec §9 与 PRD #2 原文用词随本任务 3.3 spec 回填替换。

## Open Questions

（无——scope 与术语均已收敛，技术口径见 design.md）
