# implement.md — v7 边界收口：格式对齐与状态机判定修复

> 执行序：A 格式对齐 → B 状态机判定 → C 缺料补齐 → D 收口审计。每阶段末跑全量测试并 commit（回滚点）。验证一律 `cd v7 && node --test`（Windows 本机即双平台之一，CI 补另一平台）。

## 阶段 A：格式对齐（fix(v7): 格式对齐 spec 0.9——卷纲子目录/卷摘要文件名/信息差字段）

- [x] A0 前置核实：`grep -rn "大纲.*第.*卷\|卷摘要\|谁知道\|读者知道" v7/src v7/test` 列全牵连点（含 `book-status.js` 是否有卷纲/卷规模耦合）
- [x] A1 卷纲路径 → `大纲/卷纲/第NN卷.md`：
  - `OutlineReader.readVolumeOutline` / `listVolumes`（目录与正则）
  - `persist.js` `persistCreateBook`（`大纲/卷纲/第01卷.md`）与 `persistVolumeReview`
  - fixtures：`test/fixtures/sample-book/大纲/第01卷.md` 移入 `卷纲/`
- [x] A2 卷摘要 → `第NN卷.md`：`persistVolumeReview`（及 SummaryWriter 若涉卷摘要）、persist 测试断言
- [x] A3 信息差字段 → `知情人`/`读者已知`：`rebuilder.scanSecrets`、`SecretWriter`（含 JSDoc）、fixtures `信息差-001`、`SecretReader/SecretWriter/read-secret/mechanical-check` 测试
- [x] A4 全量测试绿 + 重建用例绿；commit

## 阶段 B：状态机判定（fix(v7): 状态机判定——收卷声明制/体检距上次/序0清单/序3细纲）

- [x] B0 前置核实：`schema.js` 的版本/重建触发机制（`ensureReady` 对 schema 不匹配的行为）；不支持版本检测则先补
- [x] B1 收卷声明制：
  - `schema.js`：`chapters` 加 `is_volume_end INTEGER DEFAULT 0`；新增 `meta(key TEXT PRIMARY KEY, value TEXT)`；版本 +1
  - `rebuilder.scanChapters`：`收卷 === '是' || === true` → 1
  - `state-machine/index.js` 序 4：改读最新章 `is_volume_end`；DTO `卷` 取该章 `volume_num`
  - `dto.js` 序 6 期望产物：补"提案可含收卷提议（依据卷纲进度与卷规模参考值）"
  - `book-status.js`：当前卷改 `MAX(volume_num)`（若现为章号除法）
  - 测试：AC2 正反用例（带收卷 → 序 4；第 40 章无收卷 → 不触发）
- [x] B2 体检：
  - 序 5 判定 `maxChapter - last_health_check >= 体检周期`（meta 表读）
  - 新增 `src/health-check/index.js`（汇总 悬了太久/条目活跃率/连续弱钩 → `工作区/体检报告.md`；文体小节占位"随 M5.5"；写 meta）+ `src/commands/health-check.js` + bin --help 补行
  - 测试：AC3（触发窗口、执行后不再触发、删缓存后重测不报错）
- [x] B3 序 0 清单：`detectParseFailures` 补 book.yaml / 文风铁律 / 名册 / 时间线（缺失跳过规则见 design §2.3）；测试注入四类损坏样本（AC4），并断言 book.yaml 损坏时不再走默认值路径
- [x] B4 序 3：`hasUnfinishedWork` 计入 `细纲.md`、`本章写作材料.md`；测试 AC5（仅细纲 → 序 3 且文件未被改写）
- [x] B5 全量测试绿；commit

## 阶段 C：缺料补齐（feat(v7): 机检条目形式检查/备料信息差边界/ReviewInput 补料）

- [x] C0 共用解析：`util/` 新增 front matter 条目变动解析（`[{type, verb, id}]`），机检与 review 共用
- [x] C1 机检：`checkThreadDeclarations`（design §2.4 三规则，severity=high/blocking=true）；测试 AC6 三类用例
- [x] C2 备料：`rebuilder` 补 `secrets.short_title` 短题解析；`SecretReader.listUnrevealed` 扩返回 + `readContentFirstLine`；`prep` 输出行按 design §2.5 模板；测试 AC7 前半
- [x] C3 ReviewInput：拟条目变动 + 声明条目附履历尾 3 行（`ThreadLedgerReader`）；`roles/事实审查.md` 输入清单行更新；跑 `build-host-shells --check` + validator；测试 AC7 后半
- [x] C4 全量测试绿；commit

## 阶段 D：收口审计（chore/fix 视内容）

- [x] D1 AC1 全库审计：`grep -rn "谁知道\|读者知道" v7/` 零命中（references 题材模板里的"知情人"文案不属此列）；卷纲扁平路径零命中
- [x] D2 AC8：全量 `node --test`；删 `.cache` 全量重建用例；drift check；package validator
- [x] D3 `git push` 前看 CI 双平台矩阵结果；PRD 验收项逐条勾选
- [x] D4 若实现中发现与 spec 0.9 冲突处：停下修 spec（决策记录 33+）再继续——不得代码侧自行发挥

## 验证命令速查

```bash
cd v7 && node --test                                   # 全量
node --test test/state-machine/ test/cache/           # 判定与缓存
node scripts/build-host-shells.mjs --check            # drift check
```
