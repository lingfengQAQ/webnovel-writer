# M5.5 体检 design

## 1. 总体结构：体检产出，机检/备料消费

```
runHealthCheck（v7/src/health-check/index.js，序 5 执行点，改造）
  ├─ assembleBookStatus（既有，不动）
  ├─ style-stats（新模块 v7/src/style-stats/index.js，纯函数零依赖）
  │    ├─ splitSentences / splitParagraphs        分句分段
  │    ├─ styleMetrics(text, exclude)             句长方差/段落分布/高频开头（单章与章段通用）
  │    ├─ extractImagery(chapters, exclude)       跨章高频意象（Apriori n-gram）
  │    └─ extractFingerprint(chapters, exclude)   指纹对象（内部复用上两者）
  ├─ 缺时间锚点检查（chapters 表 + TimelineReader 比对）
  ├─ fingerprints 表 upsert（基线段 + 滚动近段两行）
  ├─ meta 写入：imagery_top JSON（新 key）+ last_health_check_chapter（既有）
  └─ 体检报告.md 渲染（替换占位节）+ 结构化 data 返回（M6 对接面）

消费方（均为小改）：
  - v7/src/prep/index.js:97          反复读清单 ← meta.imagery_top
  - v7/src/mechanical-check/index.js 新增 2 个候选检查 ← meta.imagery_top / fingerprints 基线行
  - v7/src/commands/report-style-drift.js ← fingerprints（补句长方差 delta）
```

体检是低频全量计算（每 50 章一次），机检是每章轻量消费——统计只在体检算一次，机检读缓存结果，零重复计算。

## 2. 模块契约

### 2.1 style-stats（新）

纯函数、无 IO、无缓存依赖；全部固定排序纯计数，无时间戳无随机——AC3「删缓存重算逐字段一致」的根基。

- `splitSentences(text)`：按 `/[。！？；…]+[”』」]?/` 切分，句 = 修剪后非空段；句长 = 去空白字符数
- `splitParagraphs(text)`：按 `/\n+/` 切分修剪非空（网文一段一换行约定）
- `styleMetrics(text, exclude)` → `{ 句数, 平均句长, 句长方差, 段落数, 平均段长, 段落分布, 高频开头 }`
  - 段落分布：`{短(≤50字), 中(51-150), 长(151-300), 超长(>300)}` 各计数与占比
  - 高频开头：句首 2 字聚合 top5 `[{开头, 次数, 占比}]`，排除名册专名/别名前缀（"林晚…"是人名不是句式）
- `extractImagery(chapters: [{num, text}], exclude: Set)` → `[{phrase, count, chapterCount}]`（全量，调用方取 top-N）
  - 只在连续 CJK 字符段内取 n-gram（标点断开），n = 4..8
  - **Apriori 分层**：先数 4-gram，全书次数 ≥ 阈值（10）的才扩展 5-gram，逐层到 8——内存有界（一把梭全长度 n-gram 在 300 万字级别内存爆炸）
  - **排除**：短语包含任一名册专名/别名（长度 ≥2）即丢弃——人名动作短语（"林晚冷笑一声"）的重复是叙事常态不是意象复读，宁缺勿滥，漏报由编辑审兜底
  - **跨章条件**：chapterCount ≥ 3（单章内猛复读归机检既有"复读"项管，不重复报）
  - **最长优先去重**：按（长度 desc，次数 desc，字典序）稳定排序后逐个保留；候选短语是已保留短语的子串且次数 ≤ 父串次数 ×1.25 → 丢弃（"气仿佛凝固"被"空气仿佛凝固"覆盖）
  - 输出按（次数 desc，字典序 asc）稳定排序
- `extractFingerprint(chapters, exclude)` → cache-design §1.5 五常用列 + `fingerprint_data` 完整 JSON（另含段落分布、高频开头、总字数、章数）
  - `common_phrase_frequency`：本章段内 extractImagery（chapterCount 条件放宽为 ≥1，章段内统计）top10 `{phrase: count}`
  - `vocabulary_richness`：滑动窗口 TTR——剥标点空白后按 1000 字窗口求 unique/窗长 的平均（末窗不足用实际长度）；确定性且跨章段可比（朴素 unique/total 对文本长度敏感，不可比）

### 2.2 体检编排（health-check/index.js 改造）

- 配置：BookConfigReader 读 `文体基线起/止`（默认 1/30）、`体检周期`（默认 50）
- 排除表：`SELECT id FROM entities` + `SELECT alias FROM entity_aliases`（同机检 checkNewProperNouns 取法，index.js:111-118）
- 正文来源：chapters 表 `file_path` 逐章读定稿文件，`parseFrontMatter` 剥头取正文
- 计算与落盘：
  - 意象：全书章 → `extractImagery` → meta `imagery_top` = JSON top20
  - **近段窗口 = [max(1, maxChapter − 体检周期 + 1), maxChapter]**——只依赖书状态不依赖 meta：meta 丢失/缓存重建不改变体检输出（AC3 确定性；若按 lastCheck 起算则 meta 丢失时窗口漂移）
  - 基线段 = [基线起, min(基线止, maxChapter)]；maxChapter < 基线起 → 指纹节人话降级「章数不足基线区间，暂不对比」
  - 两段各 `extractFingerprint` → `INSERT OR REPLACE INTO fingerprints`（基线行 is_baseline=1，近段行 =0）；历史段行自然累积 = 指纹历史（cache-design §1.5 语义），同段重算覆盖
  - 缺时间锚点两种缺法合并：chapters 表 `story_time` 空 → 缺「故事时间」；TimelineReader 读全部卷时间线表收集「章」列章号，定稿章不在其中 → 时间线漏行。报告列章号与缺因
- 报告：占位节（index.js:48-49）替换为四节——`## 高频意象（跨章）`、`## 句式体检`、`## 文体指纹漂移`（基线 vs 近段各指标 + delta + 人话建议：回拉文风或改 book.yaml 基线区间，脚本不自动改）、`## 缺时间锚点`（全齐报「无」）
- 返回：`{ ok, filePath, maxChapter, data, error }`，`data = { 高频意象, 句式, 指纹: {基线, 近段, delta} | null, 缺时间锚点, 悬了太久, 条目活跃率, 连续弱钩 }`——M6「体检不过线」阈值判定的对接面，本任务不判定
- 降级诚实（E3）：三统计与缺锚点各自 try/catch，单项失败该节写「该项计算失败：<人话原因>」，不炸整体；报告照落、meta 照记

### 2.3 机检两候选（mechanical-check/index.js 追加）

走 **candidates 通道**（`{type, value, description}`）——`pass = issues.length === 0`（index.js:41）语义零改动，既有测试不动：

- `checkImageryHits(body, cache, candidates)`：读 meta `imagery_top`；无 → 静默跳过；草稿命中短语 → `{type:'高频意象', value:短语, description:'「空气仿佛凝固」全书已用 47 次，本章又用 2 次，建议换个写法'}`
- `checkStyleDeviation(body, cache, candidates)`：读 fingerprints 基线行；无 → 静默跳过；本章 `styleMetrics` vs 基线，**平均句长偏离 ≥30% 或句长方差偏离 ≥50%**（硬编码默认，参数化已出 scope）→ `{type:'句式偏离', ...}` 人话描述偏了什么

### 2.4 备料接通（prep/index.js:97 一处）

读 meta `imagery_top`：有 → top10 行「-「空气仿佛凝固」全书 47 次（12 章出现），本章避免再用」；无 → 「（尚未体检，暂无数据——首次体检后自动填充）」

### 2.5 report-style-drift 补齐

delta 增加 `sentence_length_variance_delta`；命令契约与输出格式（JSON）不变。

### 2.6 rebuilder 注释同步

rebuilder.js:49 注释改「fingerprints 由体检按需重算（M5.5），重建不填」——行为不变。

## 3. 数据与兼容

- meta 新 key `imagery_top`：派生物，CacheManager 既有 meta 跨重建保留逻辑自动覆盖；丢失 → 备料/机检降级占位、下次体检重建——与「体检记录丢失重测无害」同一语义
- SCHEMA_VERSION 不变（无表结构变更，只是开始往既有表/meta 写数据）
- 机检输出仅 candidates 增型；`runHealthCheck` 返回值增 `data` 字段（既有消费方 router.test.js:190 只断 ok 与 meta 效果，增字段无破坏）
- 运行时依赖零新增（字符 n-gram + 标点分句，无分词库；spec §2.2「仅 js-yaml」口径不破）

## 4. 权衡记录

- **机检句式对比 vs 基线指纹**（而非全书均值）：基线是作者在 book.yaml 钦定的风格锚，偏离基线才是"AI 味漂移"信号；全书均值会被漂移本身污染
- **意象排除"包含专名即丢"**（而非"等于才丢"）：误报毒害报告信任，宁缺勿滥
- **近段窗口滚动**（而非 lastCheck 分段）：确定性只系于书状态（见 §2.2）
- **candidates 而非 blocking:false issue**：后者会让 `pass = issues.length===0` 误判打回，除非改 pass 语义——不动契约是更小的爆炸半径

### 4.1 实施期细化（07-04 落地时补）

- **意象排除按"专名出现处切断字符段"实现**（"包含即丢"的强化版）：严格按含名后置过滤会漏掉跨名碎片——「林晚冷笑一声」滤掉后「晚冷笑一声」以同等次数存活，照样毒害报告；切断后含名短语与跨名碎片都不可能成为 n-gram，名字后的通用搭配（「冷笑一声」）保留可报。方向与"宁缺勿滥"一致。
- **基线段与近段重合只落基线行**：全书尚在基线区间内时两段章段相同，同主键两次 upsert 会让后写的近段行翻转 `is_baseline`、基线丢失。约定重合时只写基线行，指纹节如实说明"重合暂无漂移可比"（写入约定已回填 cache-design §1.5）。
- **报告与代码用真实字段名「书内时间」**：PRD/spec 原文的「故事时间」是转述，front matter 实际字段与 TimelineWriter 表头都是「书内时间」（`story_time` 列）。

## 5. 回滚

全部增量：一个新模块 + 五处既有文件小改，单 commit 粒度分期（见 implement.md），`git revert` 可整体回退；无数据迁移——meta key 与 fingerprints 行是派生物，回退后自然失效，无残留危害。
