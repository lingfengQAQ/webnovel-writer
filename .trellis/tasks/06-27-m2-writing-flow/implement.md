# 执行计划：M2 写章流程脚本面

> 前置：已读 spec §6.1（文风铁律）/§7（工作区）/§8（八阶段）、v7-implementation-plan §1.5、M2 prd/design。
> 落点 `v7/src/{prep,mechanical-check,finalize,storage/adapters}` 与 `v7/test/`。
> 本机：`cd v7 && PYTHONUTF8=1 node --test`；零依赖铁律延续；命令走 M1 `run(args,options,ctx)` 契约。
> 工作方式：不开子代理；TDD（先红后绿）；诚实分期 commit。

## 分期（D1：单任务分期，紧依赖链）

```
P0 fixture + Writer 端口（finalize 的地基）
   ↓
P1 全书近况组装 + 备料（用 M1 读端口）
   ↓
P2 机检 7 项（用 文风铁律 + readers）
   ↓
P3 定稿原子编排 + 原子性/出口测试
   ↓
P4 CLI 接口 wire + 全量 AC 复核
```

## P0 fixture 扩展 + Writer 端口真实现

- [ ] P0.1 fixture 补 `文风/文风铁律.md`（front matter 禁词/禁句式/口癖 + ## 铁律/反和解/节奏偏好），`工作区/{细纲.md,草稿-A.md,审稿.md}`（伪造，含章摘要定稿版）
- [ ] P0.2 `v7/.gitignore` 确认含 `工作区/`（已有 `.cache/`）
- [ ] P0.3 ChapterWriter 真实现：`writeChapter(num,title,frontMatter,body)` → `定稿/正文/NNNN-标题.md`，front matter 走 serializeFrontMatter（防呆、保留未知字段）
- [ ] P0.4 ThreadLedgerWriter 真实现：`updateThread(id,updates)` front matter 改 + `appendHistory(id,entry)` `## 履历` 追加
- [ ] P0.5 EntityWriter（新）：`updateCharacter(name,updates)` 角色卡 front matter + `upsertRosterRow(row)` 名册行
- [ ] P0.6 TimelineWriter（新）：`appendRow(volumeNum,row)` 时间线表格追加
- [ ] P0.7 SecretWriter（新）：`write(id,frontMatter,content)` 信息差
- [ ] P0.8 SummaryWriter（新）：`writeChapterSummary(num,text)` `定稿/摘要/章摘要/NNNN.md`
- [ ] P0.9 `storage/index.js` 导出新 Writer；`test/storage/adapters/*Writer.test.js` 各正例（写出走防呆、保留未知字段、临时仓库验证）

**验证 P0**：`node --test test/storage/adapters/` 全绿
**提交 P0**：`feat(v7): M2 P0——Writer 端口真实现（6 端口）+ 文风/工作区 fixture`

## P1 全书近况组装 + 备料

- [ ] P1.1 `src/prep/book-status.js`：`assembleBookStatus(ctx)` 复用 report-overdue-threads/weak-hook-streak/book-stats + list-volumes → `{结构化, markdown}`
- [ ] P1.2 `src/prep/index.js`：`prepareChapterMaterials(ctx,{chapterNum})` 组装八组件，写 `工作区/本章写作材料.md`
- [ ] P1.3 读细纲"本章要写到的事"、文风锚点（文风铁律）、反和解段、信息差边界（list-secrets）、近章结尾（read-chapters --recent --tail）
- [ ] P1.4 `test/prep/`：book-status 断言四指标；prepareChapterMaterials 断言材料文件含八组件锚点 + 精准片段

**验证 P1**：`node --test test/prep/` 全绿
**提交 P1**：`feat(v7): M2 P1——全书近况组装 + 备料（prepareChapterMaterials）`

## P2 机检 7 项

- [ ] P2.1 `src/mechanical-check/index.js`：`mechanicalCheck(ctx,{chapterNum,draftPath})` → `{ok,pass,issues,candidates}`，checks 注册表（预留统计项扩展点）
- [ ] P2.2 七项：字数区间 / 禁词 / 禁句式(正则) / 本章内复读(n-gram) / 新专名比名册 / front matter 完整性 / 信息差关键词候选
- [ ] P2.3 阻断性：1-4、6 阻断；5（新专名）、7（信息差候选）只列不拦
- [ ] P2.4 `test/mechanical-check/`：每项正例+反例（越界/命中禁词/禁句式/复读超阈/缺字段/新专名进候选/信息差候选）

**验证 P2**：`node --test test/mechanical-check/` 全绿
**提交 P2**：`feat(v7): M2 P2——机检 7 项可计数（统计项留 M3+ 体检）`

## P3 定稿原子编排 + 出口

- [ ] P3.1 `src/finalize/git.js`：薄封装 `node:child_process` git（add/commit/restore/log/status），错误转中文
- [ ] P3.2 `src/finalize/index.js`：`finalizeChapter(ctx,{...})` 四步编排（校验→写工作树→git commit→清工作区）；commit message `ch(NNN): 标题` + 条目/设定行
- [ ] P3.3 `test/finalize/`：
  - 正常：伪造草稿+审稿 → finalize → 定稿/正文 落档、设定/条目/章摘要更新、工作区清空、`git log` 含 `ch(NNN):`
  - **原子性（AC 出口）**：注入 step2↔step3 抛错 → 无新 commit + 工作区草稿原样 + git 可净恢复
  - 删 `.cache` 重建一致（不变量 2）

**验证 P3**：`node --test test/finalize/` 全绿（含原子性注入）
**提交 P3**：`feat(v7): M2 P3——定稿原子 commit + 断电安全（出口达成）`

## P4 CLI wire + AC 复核

- [ ] P4.1 `src/commands/prepare-chapter.js`、`mechanical-check.js`、`finalize-chapter.js`：run 契约薄封装上述 Use Case，bin 可跑
- [ ] P4.2 `test/commands/` 三命令冒烟
- [ ] P4.3 全量 `node --test` 绿；过 prd Acceptance（细纲→定稿零 AI 跑通 / 断电注入 / 缓存可重建）
- [ ] P4.4 推送验证 CI 双平台（含 git 操作在 Windows 跑）

**提交 P4**：`feat(v7): M2 P4——写章流程 CLI 接口 + AC 复核`

## 回滚点

- 各 P 独立，未提交前 `git restore v7/` 对应子目录
- P3 git 封装单点，定稿逻辑出问题回退 P2 末

## 出口判据（对齐 prd Acceptance）

> 重建后状态（2026-06-27，全量 `node --test` 172 绿）：

- [x] 伪造草稿+细纲，备料→机检→定稿 全程脚本跑通、零 AI（test/prep + test/mechanical-check + test/finalize）
- [x] 定稿中断注入后工作区原样保留（test/finalize 断电注入：无新 commit + 工作区原样 + 定稿净恢复）
- [x] 定稿后删 `.cache` 全量重建一致（test/finalize 不变量 2 用例）
- [x] CI 双平台绿（git 操作在 Windows 验证）：4 矩阵 job 全绿（run 28287204899，含两个 windows-latest，定稿 git 原子操作验证通过）
- [x] 6 Writer 端口 + prep/check/finalize 各有镜像测试
