# M6 实施清单

执行方式：inline（M1-M5.5 先例），四期每期一 commit，期末验证绿才进下期。上下文顺序：prd → design → 本清单；Phase 2 起步走 trellis-before-dev。

## P1 staging 模块 + stage/status 命令

- [x] P1.0 前置缺口修复（prd 决策 D7）：`ThreadLedgerWriter.createThread({id, frontMatter, body, 短题})`（拒绝已存在编号/非法类型）+ `finalizeChapter` payload 增 `threadCreates`（进同一 stage/rollback 集合）；`v7/test/finalize/` 补"埋下→定稿→条目文件在→缓存含新条目→下一章推进机检零误报"接力用例
- [x] P1.1 `v7/src/staging/index.js`：readBatch / stagedFacts / stageChapter / judgeStop / judgeBatchQuality / rejectFrom / discardBatch（契约 design §2.1-2.4、§2.7）；目录名净化与 ChapterWriter 同源（抽 `src/util/filename.js` 或等价，两处共用）
- [x] P1.2 BookConfigReader defaults 加 `连写无条目变动上限: 3`
- [x] P1.3 `v7/src/commands/stage-chapter.js` + `batch-status.js`（薄壳，`--payload` 走 readJsonInput 先例）；bin 注册
- [x] P1.4 `v7/test/staging/index.test.js` + `v7/test/commands/stage-chapter.test.js`：
  - 章号连续性（跳章/重章拒绝；批内已存在章号=覆盖重暂存）
  - 前置校验零写入；审稿单缺失拒绝
  - 落盘三件套 + 批次.json 状态/计数；工作区单章文件清干净
  - judgeStop 四件套逐一（写满/收卷/卷纲耗尽/连续无条目变动）；judgeBatchQuality 三判据（弱钩尾/缺书内时间/句式 vs 基线 29% 不停 31% 停）
  - 批次.json 损坏 → 扫描重建、状态保守回「受影响」

验证：`node --test v7/test/staging/ v7/test/commands/stage-chapter.test.js`（注意目录参数怪癖，必要时列文件）
提交：`feat(v7): M6 P1——staging 批次模块与 stage-chapter/batch-status`

## P2 叠加视图三消费点

- [x] P2.1 `prep/index.js`：近章结尾/时间线/信息差/全书近况叠加（design §2.5）；无批次零变化
- [x] P2.2 `review/index.js assembleReviewInput`：相关条目/名册/相关角色/时间线/信息差/近况叠加
- [x] P2.3 `mechanical-check/index.js`：三个 known 集合并入 staged 事实
- [x] P2.4 测试：`v7/test/prep/`、`v7/test/review/`、`v7/test/mechanical-check/` 各补批次两态用例——AC2 批内依赖主用例（K 章埋伏笔+新角色+时间线行 → K+1 备料/审稿输入/机检三面验证）；AC7 前半（批次进行中删缓存重建 → 叠加输出深等不变）（集中在 `test/staging/overlay.test.js`，另含重审不倒灌用例——stagedFacts 增 before 过滤）
- [x] P2.5 既有测试零改动仍绿（AC5 全关矩阵的回归面）——全量 398 绿

验证：`node --test v7/test/prep/ v7/test/review/ v7/test/mechanical-check/`（列文件跑）
提交：`feat(v7): M6 P2——备料/审稿输入/机检叠加视图（批内依赖）`

## P3 批量定稿与污染传播

- [x] P3.1 `staging.finalizeBatch`（design §2.6：入口硬校验全待审收、升序逐章原子、失败停在该章、`--until`、尾部例行体检提示）+ `v7/src/commands/finalize-batch.js`
- [x] P3.2 `batch-reject` / `batch-restage` / `batch-discard` 命令 + rejectFrom 污染标记（K 打回清工件、K+1..N 受影响）
- [x] P3.3 测试 `v7/test/staging/finalize-batch.test.js`（gitBookCtx 先例）：
  - AC1 端到端：stage×3 → finalize-batch → 三 commit 按序、入档内容与手动 finalizeChapter 逐字段一致、批次清空、next 报下一章
  - AC3 注入错误恢复演练：打回第 2 章 → 3..N 受影响 → finalize-batch 拒绝（人话列障碍）→ 重写重审回待审收 → 成功；grep 全部 commit 确认打回章旧内容零泄漏
  - 中途失败按章保留（坏定稿包注入第 4 章，等价 faultAfterWrite）：第 3 章已入档保留、失败章留批次、报告如实
  - AC6 batch-discard：定稿零变化、工作区净、next 回序 6
  - AC7 后半：全程 fingerprints/meta imagery_top 无 staged 数据断言
  - 追加：--until 截断转正 + next 报批次续跑

验证：`node --test v7/test/staging/`（列文件）
提交：`feat(v7): M6 P3——finalize-batch 逐章原子转正与打回污染传播`

## P4 状态机/宿主接线 + 收口

- [x] P4.1 序 3 dto 批次明细 + 序 6 dto `自动确认细纲` 标志（design §2.8）；`v7/test/state-machine/` 补用例，router.test.js 既有断言不改
- [x] P4.2 SKILL.md「自动模式（连写）」段 + 三平台壳重渲染（`node scripts/build-host-shells.mjs`）+ drift check 绿；批次五命令入 SKILL 写章流程/例外流程表
- [x] P4.3 开关矩阵测试（AC5）：四组合行为断言（全关=现状包含在既有回归；单开各一用例；全开=AC1 引用）——`test/state-machine/auto-mode.test.js`
- [x] P4.4 全量 `node --test`（Windows 本机）407 绿 + AC1-AC8 复核、prd.md 打勾（AC8 CI 部分待 push）
- [x] P4.5 spec 回填（Phase 3.3）：story-repo-spec 0.12（§3 `连写无条目变动上限` 键；§8.1 实现口径——批次三件套/三态/污染传播/stage 前置审稿单/质检判据；§8 第 8 步条目创建；决策 36-37）；multi-agent spec v3.7（SKILL 自动模式段 + §5.1 批次不开第二条写入路径）；v7-implementation-plan §M6 出口标注（含两处实现偏离记录）；backend database-guidelines 增 §7 工作区暂存数据四条
- [ ] P4.6 commit + push，CI 双平台绿；prd.md AC8 回填 run 号

提交：`feat(v7): M6 P4——状态机批次感知、SKILL 自动模式段与开关矩阵` + `docs(v7): M6 spec 回填`

## 风险与回滚点

- 机检/备料/审稿是主循环热路径——叠加必须以 `readBatch().exists` 为总开关，无批次分支零额外 IO（AC5 全关矩阵 + 既有全量测试把关）
- `finalizeChapter` 复用时 workspaceFiles 语义：批次章的工作区文件已在 stage 时清过，payload 转正时 workspaceFiles 应为空/仅剩批次目录——finalize-batch 负责置空并自管批次目录删除，防误删他章工件
- 批次.json 是单点：损坏走扫描重建（保守回受影响），测试覆盖
- 每期独立 commit 可 revert；批次数据在工作区，代码回退无残留
