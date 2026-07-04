# M5.5 实施清单

执行方式：inline（同 M1-M5 先例），implement.jsonl / check.jsonl 保持种子行，Phase 2 上下文走 trellis-before-dev。四期，每期一 commit，期末验证绿才进下期。

## P1 style-stats 统计算法（纯函数）

- [x] P1.1 `v7/src/style-stats/index.js`：splitSentences / splitParagraphs / styleMetrics / extractImagery / extractFingerprint（契约与算法口径见 design §2.1）
- [x] P1.2 `v7/test/style-stats/index.test.js`：
  - 分句边界：引号收尾（「…！」）、省略号、分号；空文本
  - 方差/均值：小样本手算对照
  - 意象：构造重复短语样章——阈值边界（9 次不报 10 次报）、专名排除（含"林晚"的短语被丢）、最长优先去重（子串被父串覆盖）、跨章条件（chapterCount<3 不出）
  - TTR：窗口平均与朴素 TTR 的差异用长短两文本验证
  - **确定性**：同输入两次调用结果深等（deepStrictEqual）

验证：`node --test v7/test/style-stats/`
提交：`feat(v7): M5.5 P1——style-stats 统计算法（分句/意象/指纹）`

## P2 体检编排

- [x] P2.1 `v7/src/health-check/index.js` 改造：排除表 / 正文读取剥 front matter / 全书意象→meta / 两段指纹 upsert / 缺时间锚点 / 报告四节替换占位 / 结构化 data 返回 / 单项 try-catch 降级（design §2.2）
- [x] P2.2 fixture：构造带重复意象与缺锚点章的测试书仓库（复用 sample-book 结构，专用小 fixture 或临时目录搭建，随测试现建避免污染既有 fixture 断言）
- [x] P2.3 `v7/test/health-check/index.test.js`：
  - AC1 后半：报告高频意象节含构造短语与全书次数
  - AC2 前半:报告含句长方差/段落分布/高频开头
  - AC3：体检 → 断言 fingerprints 两行 → 删 `.cache` 全量重建 → 再体检 → 指纹行逐字段一致
  - AC5：锚点齐全报「无」；缺「故事时间」与时间线漏行各能列出章号
  - AC7：data 形状断言（各 key 存在且类型稳定）
  - 降级：构造单项失败（如时间线目录不可读），报告照落、该节含失败说明
- [x] P2.4 序 5 回归：`v7/test/state-machine/router.test.js` 不改仍绿（体检后 meta 更新、next 不再报体检）

验证：`node --test v7/test/health-check/ v7/test/state-machine/`
提交：`feat(v7): M5.5 P2——体检编排（意象入 meta/指纹入表/缺时间锚点/结构化返回）`

## P3 消费方接通

- [x] P3.1 `v7/src/mechanical-check/index.js`：checkImageryHits + checkStyleDeviation 两候选（design §2.3）；`v7/test/mechanical-check/` 补用例——有数据命中出候选、无数据静默跳过、句式阈值边界（29% 不报 31% 报）、pass 判定不受候选影响
- [x] P3.2 `v7/src/prep/index.js:97`：反复读清单接 meta（design §2.4）；`v7/test/prep/` 补有/无 imagery_top 两态断言
- [x] P3.3 `v7/src/commands/report-style-drift.js`：补 sentence_length_variance_delta；对应 `v7/test/commands/report-style-drift.test.js` 更新
- [x] P3.4 `v7/src/cache/rebuilder.js:49` 注释同步（行为不变）

验证：`node --test v7/test/mechanical-check/ v7/test/prep/ v7/test/commands/`
提交：`feat(v7): M5.5 P3——机检候选、备料反复读清单、drift 方差 delta`

## P4 收口

- [x] P4.1 全量测试：`node --test v7/test/`（Windows 本机跑）——374/374 绿（原 346 + 新增 28）
- [x] P4.2 AC1-AC7 逐条复核，prd.md 打勾；AC1 前半（机检报出）在 P3.1 用例覆盖处标注
- [x] P4.3 spec 回填（Phase 3.3）：
  - story-repo-spec 0.10 → 0.11：§9 术语「时间线孤儿」→「缺时间锚点」+ 变更记录一条（决策 35）；§9 体检定义与实现对齐复核（补高频意象/句式两节与"体检产出、机检消费"分工）
  - v7-prd.md 1.1 → 1.2：§4 #2 验收用词同步替换
  - v7-implementation-plan.md §M5.5 出口达成标注
  - 追加：cache-design §1.5 补"基线段与近段重合只落基线行"写入约定；backend/database-guidelines 增 2.5（派生统计确定性）、backend/quality-guidelines 增 2.4（机检候选通道语义）
- [x] P4.4 commit + push，CI 双平台绿——run 28704414272 六 job 全绿（2026-07-04）

## 风险与回滚点

- P2 触碰序 5 执行点——router.test.js 回归必跑；报告文件名/meta key（`last_health_check_chapter`）绝不改
- 机检 `pass = issues.length===0` 语义绝不动，新增只进 candidates
- 每期独立 commit，任一期出问题 `git revert` 该期即可，无跨期数据耦合
