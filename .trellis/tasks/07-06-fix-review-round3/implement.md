# 执行计划：第三轮 review 修复

按批推进，每批一个 commit（独立回滚点）。每批完成即跑该批验证命令；最后一轮全量。

约定：测试命令在 `v7/` 下跑，Windows 需 `PYTHONUTF8=1`（涉 python 时）与 `$env:NODE_OPTIONS` 不动；node 测试 `npm test`（vitest）。

## 批 0：测试基建（G-1）

- [x] `test/commands/_helper.js` gitBookCtx：写 `.gitignore`（`.cache/`、`工作区/`）+ `core.quotepath false` + 只 add 跟踪面（对齐 persist.js:58-78）
- [x] 跑全量测试，逐条修正依赖旧形态的断言（预期 goto/relink/finalize 相关有波动）
- [x] 验证：`npm test` 全绿；`git -C <tmp仓库> ls-files | grep 工作区` 为空（用一条新断言固化）

**commit**: `test(v7): gitBookCtx 对齐真实建书形态（G-1）`

## 批 1：数据安全 + 互斥守卫（R1 R2 R3 R4 R7 R8 R12 + C2/C4/G-4）

- [x] R7/R8 `serializers/yaml-dialect.js`：needsQuoting 补全 + 双引号分支完整转义；新增往返测试表（review 全部 DRIFT/PARSEFAIL 值）
- [x] R12 `storage/atomic.js`：renamedIn 标志 + restorePlan 三段式；故障注入测试（第 2 文件 writeFile 抛错 → B 原文完好）
- [x] R3 `state-machine/persist.js`：validateRepairContent 按路径分派（book.yaml→parseBookConfig / 名册·时间线→parseMarkdownTable / 其余→parseFrontMatter）；测试覆盖三类文件修复被接受
- [x] R4+C2+G-4+C4：`util/workspace-path.js` normalizeWorkspaceRel（剥前缀+按段拒 `..`）；finalizeChapter/stageChapter/两命令壳接入；finalize 清理 recursive+try/warning 不改写 ok；测试：目录清理失败仍 ok:true、`..` 逃逸被拒、前缀直调不漏清
- [x] R1 `flows/goto-chapter.js` + R2 `commands/finalize.js`：active 批次守卫 + 人话指引；测试：批次在场 goto 被拒、手动 finalize 被拒（用批 0 修正后的 gitBookCtx）
- [x] 验证：`npm test`；针对性重放上轮探针场景 P-1/P-2/P-3/P-7b 断言新语义

**commit**: `fix(v7): 互斥守卫+序列化器+原子写时序——第三轮 review 批1（R1-R4/R7/R8/R12）`

## 批 2：迁移链（R5 R6 R9 R10 R11 + G-3 落点）

- [x] R6 `util/aliases.js` splitAliases 单源；EntityReader:87 / rebuilder:262 / staging 接入（A13 顺带）
- [x] R5 `util/entity-type.js` normalizeEntityType；rebuilder scanEntities/scanCharacters（ON CONFLICT 补 type）+ EntityReader 降级路径接入；fixture 名册类型改中文；测试：中文类型迁移书 list-characters/report/审稿名册可见
- [x] R11 `serializers/markdown-table.js` + `parsers/markdown-table.js`：`\|` 转义读写对称、全角行归一、多余列保留；EntityWriter.upsertRosterRow 合并保额外列；往返测试
- [x] R9 `migrate/transform.js` book.yaml 走 serializeYAML；测试：`[快穿]反派`/`*追读`/纯数字书名迁移后 parseBookConfig ok 且 books.jsonl 扫描重建不丢书
- [x] R10 transform 一对多别名降级（首实体保留+待校对文件）；测试：共享别名 v6 项目迁移成功、待校对文件在、rebuild 无别名冲突
- [x] 验证：`npm test` + migrate e2e（v6-inline/v6-sqlite fixtures）+ 探针场景 P-5/P-6

**commit**: `fix(v7): 迁移链类型/别名/序列化收口——第三轮 review 批2（R5/R6/R9-R11）`

## 批 3：P2/S 清扫 + spawn 冒烟

按 design.md 模块分组执行，可按模块拆多个小 commit：

- [x] storage/adapters：A6 键名统一中文、A9/C3 有界匹配、A10/F-7 角色卡文件名同源、A12 时间线按（卷,章）替换、A14/A15/A16 死代码删除、A17 段匹配收紧
- [x] cache：B1 warning 补齐+catch 收窄、B2 UNIQUE 冒泡 ROLLBACK+卷复盘条目查重、imagery preserveDerived（决策 D5）
- [x] staging/dto：E3 幂等重跑（决策 D3）、E4 清理失败不谎报、E5 --until 建议、E6 打回空目录状态、E8 isWeakHook 单源、D5/D6 readBatch heal 参数+现存口径
- [x] state-machine：D3 区 TRACKED_SOURCE_PREFIXES（决策 D6）、D4 retcon 逐文件回滚、D7/G-7 防御
- [x] migrate/export：F-4 码点截断、F-5 mtime 阈值、F-6 删可写回退（决策 D4）、F-8 错误人话化、F-9 warning+类型归一复用、F-10 保留设备名
- [x] bin/docs：G-9 命令名白名单、G-8 删硬编码计数、G-5 files 加 docs/
- [x] G-6：bin spawn 冒烟 ×2（export/migrate）
- [x] 验证：`npm test` 全量

**commit**: `fix(v7): P2/S 清扫——第三轮 review 批3`（或按模块多 commit）

## 收尾

- [x] spec 回填：story-repo-spec 0.14（G-3/E7/E9 条款 + 决策表）、database-guidelines B-S 条款、SKILL.md rosterUpserts 值域
- [x] 上轮探针脚本拷入本任务目录改造为修复后断言，跑通留档；有代表性的场景确认已固化进正式测试
- [x] 全量验证：`npm test`（429+新增全绿）→ push 观察 CI 六 job
- [x] AC 逐条勾验 → spec 更新（3.3）→ commit → 归档

**commit**: `docs(v7): spec 0.14 回填——第三轮 review 修复收口`

## 回滚点

每批独立 commit；批 1/2 涉及序列化器写路径，若发现写格式回归（存量书读不回），revert 对应批 commit 即可——读路径未动，存量文件安全。

## 风险与注意

- 批 0 的断言修正量未知（gitBookCtx 被 goto/relink/finalize 多处测试用），预留弹性；修正原则=对齐真实形态，不为保绿而弱化断言。
- E3 幂等重跑改了 finalizeBatch 循环顺序（先 meta 后 rm），注意与 readBatch「记录外目录按受影响纳入」的交互——meta 已删行+目录残留时目录会被重新纳入，因此删除失败必须报错止步（不能静默继续），设计已定。
- A6 键名统一会改 read-chapter/read-thread 的缓存命中输出形状——检查 SKILL/roles 是否有依赖英文键的文案（预期无：作者域一直宣称中文）。
