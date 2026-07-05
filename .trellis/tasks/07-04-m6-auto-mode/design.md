# M6 自动模式 design

## 1. 总体结构：批次是工作区数据，脚本判定、宿主执行

```
工作区/待定稿/
  批次.json                    批次元数据（真源，机器域 JSON）
  0006-夜探藏经阁/
    草稿.md                    front matter + 正文（终稿形态）
    定稿包.json                完整 finalize payload（预登记的机器形态）
    审稿单.md                  该章两审产物（批量审稿呈报用）
  0007-.../

src/staging/index.js（新模块，批次真源的唯一读写点）
  ├─ readBatch(repoPath)                → {exists, 起章, 章列表:[{章号,标题,状态,目录}], 连续无条目变动}
  ├─ stagedFacts(repoPath)              → 叠加视图用事实包（见 §2.2）
  ├─ stageChapter(ctx, {chapterNum, payload}) → 校验+落盘+清工作区+停止判定
  ├─ judgeStop(ctx, batch)              → {stop: bool, reasons: string[]}（四件套，纯脚本）
  ├─ judgeBatchQuality(staged, baselineFp, config) → 质检判据（纯函数，零 IO）
  ├─ rejectFrom(repoPath, chapterNum)   → K=打回，K+1..N=受影响
  ├─ finalizeBatch(ctx)                 → 逐章 finalizeChapter，按章原子
  └─ discardBatch(repoPath)             → 删批次

commands/：stage-chapter / batch-status / finalize-batch / batch-reject / batch-discard（薄壳）
消费点小改：prep/index.js、review/index.js、mechanical-check/index.js、state-machine/{index,dto}.js
```

写章八阶段与状态机零改动（spec §8.1）；自动模式只是"第 7-8 步的确认与入档推迟到批末"。

## 2. 模块契约

### 2.1 批次.json（机器域，staging 模块独占读写）

```json
{
  "起章": 6,
  "章列表": [
    { "章号": 6, "标题": "夜探藏经阁", "状态": "待审收", "目录": "0006-夜探藏经阁" },
    { "章号": 7, "标题": "…", "状态": "受影响", "目录": "0007-…" }
  ],
  "连续无条目变动": 0
}
```

- 状态 ∈ `待审收` | `打回` | `受影响`。stage-chapter 写入/覆盖时置`待审收`并重算计数；rejectFrom 置`打回`/`受影响`。
- 目录名 = `NNNN-净化标题`（复用 ChapterWriter 的 sanitize 规则，抽公共 util 或复制口径并测一致）。
- 损坏/缺失容错：批次.json 读不了但目录存在 → 从章目录扫描重建元数据（状态全部回`受影响`并人话说明——宁保守勿臆断）；空目录=无批次。

### 2.2 stagedFacts（叠加视图的数据面，全部来自批次文件，不碰缓存）

```js
{
  chapters: [{ 章号, 标题, frontMatter, body }],        // 升序；来自各章 草稿.md
  threads:  Map<id, {status, lastAdvanced}>,            // 由各定稿包 threadUpdates + 草稿声明推导
  newEntities: Set<string>, newAliases: Set<string>,    // rosterUpserts 的 正名/别名
  characterUpdates: Map<name, updates合并>,             // 后章覆盖前章同字段
  timelineRows: [{volumeNum, row}],
  secretWrites: [{id, frontMatter, content}],
  总字数, 弱钩尾计数                                      // 近况叠加用的派生值
}
```

- threads 推导口径：`threadUpdates[].updates.状态` 直接采信；开启类声明（草稿 front matter「埋下/设下/萌芽」）产生新条目 `进行` 态。与机检/审稿共用 `parseThreadDeclarations`，不双写。
- 全部同步纯读文件；任何单章文件损坏 → 该章事实跳过并在返回 `warnings` 里如实说明（消费点原样透传给报告/材料，不静默）。

### 2.3 stage-chapter（A3）

前置校验（不过则零写入）：
- 章号 = 定稿 maxChapter + 已 staged 数 + 1（批内连续，不跳章不重章）
- payload 完整性同 finalizeChapter 前置（章号整数、frontMatter.标题在）
- `工作区/审稿.md` 存在（先审后暂存——与手动模式"作者过目审稿单"对应的自动模式不变量：**审稿单必须已生成**，作者批末统一看）

落盘（writeAtomicBatch 原子批）：草稿.md（payload.frontMatter+body 组回）、定稿包.json、审稿单.md（搬 `工作区/审稿.md` 内容）、批次.json 更新；随后清工作区单章文件（细纲/本章写作材料/草稿-A/审稿/评审报告——payload.workspaceFiles 并集）。
返回：`{ok, staged: N, 停止: judgeStop 结果, output 人话}`。

### 2.4 judgeStop 四件套（C1-C4，全零 token）

1. 写满：`staged ≥ config.连写批次大小`
2. 收卷/卷纲耗尽：末 staged 章 `收卷: 是` → 停（转卷复盘）；下一章卷号（末 staged 章卷号，或其 +1 若收卷）无 `大纲/卷纲/第NN卷.md` → 停
3. 连续无条目变动：批次.json 计数 ≥ `config.连写无条目变动上限`（默认 3；BookConfigReader defaults 加键）
4. 质检不过线 judgeBatchQuality（staged 章、基线指纹行、config）：
   - 弱钩尾：staged 末尾连续弱钩数（口径同 book-status：`包含'弱钩'或以'-弱'结尾`）≥ `连续弱钩上限`
   - 缺锚点：任一 staged 章 front matter 无「书内时间」
   - 句式偏离：staged 全部正文合并 styleMetrics vs fingerprints 基线行，平均句长偏 ≥30% 或句长方差偏 ≥50%（复用 mechanical-check 容差常量，抽到 style-stats 或公共常量避免双写）；无基线行 → 该判据静默跳过
   返回 `{过线: bool, 原因: string[]}`，原因人话（"批内连续 3 章弱钩，建议人工过一眼节奏"）。

### 2.5 叠加消费点（B2-B4，每处小改）

- **prep**：`stagedFacts` 有章时——近章结尾取 staged 末两章 body 尾 150 字（不足再回定稿章补）；时间线片段追加 staged rows（标注「批内预登记」）；信息差边界并入 staged secretWrites（listUnrevealed 结果 + staged 未揭晓）；全书近况行加「批内已暂存 X 章（第 A-B 章）」且总章数/字数/连续弱钩计入 staged。
- **review-input**：相关条目并入 staged threads（新开条目以 `{id, type, 简述: 声明原文, 状态, 开启章}` 形态出现）；名册/相关角色并入 newEntities/characterUpdates；时间线/信息差/近况同 prep 口径。
- **mechanical-check**：`checkThreadDeclarations` 的 known Map 并入 staged threads；`checkNewProperNouns` 的 known 并入 newEntities/newAliases；`checkSecretKeywords` 增 staged 未揭晓秘密。签名不动——staging 事实在 mechanicalCheck 入口读一次传下去。
- 三处都以 `readBatch().exists` 为开关：无批次零行为变化（AC5 全关矩阵）。

### 2.6 finalize-batch（D3）

1. readBatch；空 → 人话拒绝。任一章状态 ≠ 待审收 → 拒绝并列出（"第 7 章打回未重写、第 8 章受影响未重审"）。
2. 升序逐章：读定稿包.json → `finalizeChapter(ctx, payload)`（每章自身原子 commit + 缓存刷新）→ 成功删该章批次目录并更新批次.json。失败 → 立即停，返回已入档/未入档清单与人话原因（已入档的保留——按章原子；工作区剩余批次原样，续跑=修复后再跑 finalize-batch）。
3. 全部成功：删 批次.json 与 待定稿/ 空壳 → 跑 `runHealthCheck`（例行，只算定稿）→ 输出附体检一句话状态。
4. `--until=<章号>`：只转正到第 K 章（作者"前几章先发"），其余留批次。

### 2.7 batch-reject / batch-discard / batch-status

- `batch-reject <章号>`：章号必须在批次内；置 K=打回（清该章目录内容，保留目录与元数据行——重写后 stage-chapter 覆盖）、K+1..N=受影响（工件保留）。受影响章重审通道：宿主重跑 review-input（叠加视图已反映 K 重写后事实）→ save-review → `stage-chapter <章号> --payload=…` 覆盖式重暂存（章号连续性校验对"批内已存在的章号"放行为覆盖）。
- `batch-discard`：`fs.rm 待定稿/` 整树；输出确认人话。**破坏性：宿主必须先向作者确认**（SKILL.md 写明），脚本本身不再二次确认（CLI 无交互约定）。
- `batch-status [--json]`：readBatch + judgeStop + judgeBatchQuality + 各章审稿单阻断数摘要；`--json` 给宿主，无参出人话表。

### 2.8 状态机与宿主（E1-E3）

- 序 3：`unfinishedWorkDetail` 的待定稿分支充实——dto 加 `批次: {起章, 章数, 各章状态摘要, 建议}`；「从哪继续」细分：有打回/受影响 → "重写打回章/重审受影响章"；全待审收且停止命中 → "呈报作者批量审稿"；未满 → "继续批内下一章"。
- 序 6 dto：`自动确认细纲: config.自动确认细纲` 布尔直出 + 期望产物文案条件化；连写指引一句话（"作者要连写时走 stage-chapter 批次流，见 SKILL 自动模式段"）。
- SKILL.md 新段「自动模式（连写）」：进入条件（作者说连写/挂机）→ 批内循环（next→细纲[自动确认开则直接 persist-outline]→prepare→写→mechanical-check→review-input→两审→save-review→**stage-chapter**→看返回停止判定）→ 停止后 batch-status 呈报作者 → 三形态裁决（finalize-batch / 改后重审再 finalize / batch-reject→重写重审）→ batch-discard 需作者明确说整批不要。渲染三平台壳 + drift。

## 3. 数据与兼容

- 无缓存 schema 变更（SCHEMA_VERSION 不动）；staged 数据不进任何缓存表/meta（AC7）。
- 批次文件是工作区文件：不入 git、不受防呆方言约束（YAML 方言只管作者可见源文件；批次.json/定稿包.json 是机器域）。草稿.md 的 front matter 用防呆序列化器组回（作者可能打开看）。
- 既有命令零签名变更；mechanicalCheck/prep/review 内部叠加，消费方（CLI/测试）无感。
- `连写无条目变动上限` 进 BookConfigReader defaults（值 3）+ spec §3 回填。
- Windows 中文路径：批次目录名含中文标题——沿用 ChapterWriter 净化规则，e2e 在 CI windows job 覆盖。

## 4. 权衡记录

- **stage 前置"审稿单必须存在"**（而非允许无审直暂存）：自动模式砍掉的是"逐章问作者"，不是"逐章审"——两审是质量闸门也是批量审稿的呈报材料，无审稿单的批次作者没法批。
- **finalize-batch 中途失败不整批回滚**：spec 明文"原子性按章保留"；已 commit 的章是作者敲定过的合法定稿，回滚反而制造"已批准内容消失"。
- **批次质检在 stage 时逐次判、不在批末补算**：早停少浪费（漂移第 3 章就停，不写满 8 章）；判据纯函数批末 batch-status 重算同口径。
- **受影响章不强制重写只强制重审**：spec"需重新审核或重写"二选一，作者裁量；入口硬校验只认"待审收"，重审通道即 stage 覆盖。

## 5. 回滚

- P1-P4 每期独立 commit，`git revert` 单期可退；批次数据全在工作区（gitignore），代码回退不留残留状态。
- 最坏情况（批次数据结构有 bug）：`batch-discard` 清工作区即回到手动模式，定稿零污染——宪法级路径（作者敲定才入 git）保证爆炸半径限于工作区。
