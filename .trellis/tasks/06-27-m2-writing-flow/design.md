# 技术设计：M2 写章流程脚本面（零 AI 全通）

## 1. 设计范围与分层

实现八阶段中「执行体=脚本」的四块（spec §8 步骤 1脚本部分/3/5/8），全部零 AI：

```
全书近况组装  ──┐
               ├─→ 备料(prep) ─→ [写稿 AI=M4] ─→ 机检(check) ─→ [两审 AI=M4] ─→ [审稿 作者] ─→ 定稿(finalize, 原子)
(M1 报表复用) ──┘
```

模块落点（填 M0 占位 + 新增 Writer 端口）：
- `v7/src/prep/` —— 全书近况组装 + 备料 `prepareChapterMaterials`
- `v7/src/mechanical-check/` —— 机检 `mechanicalCheck`（7 项，D2）
- `v7/src/finalize/` —— 定稿 `finalizeChapter`（原子编排）
- `v7/src/storage/adapters/` —— Writer 端口真实现 + 新增（见 §3）

复用 M1：41 读接口/Storage Reader 端口、`run(args,options,ctx)` 命令契约、防呆序列化（serializeFrontMatter/yaml-dialect，保留未知字段=不变量 9）、`.cache` 重建器、`parseFrontMatter`。

## 2. 数据流与工作区契约（spec §7）

工作区四件套（默认 gitignored，实现**不得假设**其未被 git 跟踪）：
- `工作区/细纲.md` —— 四段（全书近况/本章提案/本章要写到的事/备选）；M2 读"本章要写到的事"与定位
- `工作区/本章写作材料.md` —— 备料产出
- `工作区/草稿-*.md` —— 写稿产出（M2 测试用手工伪造）
- `工作区/审稿.md` —— 草稿+审意见+待确认新专名+章摘要（M2 测试用手工伪造；定稿读其中的章摘要定稿版）

`.gitignore` 须含 `.cache/` 与 `工作区/`（spec §2 行 67）。

## 3. Writer 端口（Q4 决策：小端口 + finalize 编排）

延续 M1「小端口、职责最小」。定稿写多种文件 → 每文件类型一个 Writer（防呆序列化 + 保留未知字段），**原子性不在 Writer 层，在 finalize 编排**：

| Writer | 职责 | 状态 |
|--------|------|------|
| `ChapterWriter` | 写 `定稿/正文/NNNN-标题.md`（front matter 章档案 + 正文） | M1 占位 → 真实现 |
| `ThreadLedgerWriter` | 三类条目 front matter 更新 + `## 履历` 追加 | M1 占位 → 真实现 |
| `EntityWriter`（新） | 角色卡 front matter 更新（位置/状态/境界/持有/最后变更章）+ 名册行 upsert | 新增 |
| `TimelineWriter`（新） | `定稿/设定/时间线/第NN卷.md` 追加表格行 | 新增 |
| `SecretWriter`（新） | `定稿/设定/信息差/` 写/更新 | 新增 |
| `SummaryWriter`（新） | `定稿/摘要/章摘要/NNNN.md` 写出 | 新增 |

每个 Writer 方法返回 `{ok, error}`，纯文件 IO，不碰 git、不清工作区。所有 front matter 写出走 `serializeFrontMatter`（块列表/危险值引号/保留未知字段）。

## 4. 定稿原子性（Q3 决策：git commit 为原子单元）

`finalizeChapter(ctx, {chapterNum, title, draftPath, reviewSheet, ledgerChanges, settingChanges})`：

```
1. 前置校验：草稿/审稿单存在；机检结果=pass（不 pass 不进定稿）；章号未占用
2. 写工作树（全部落 定稿/，非 工作区）：
   - ChapterWriter 写正文 + 章档案 front matter
   - EntityWriter/TimelineWriter/SecretWriter 落 设定 变更
   - ThreadLedgerWriter 落 条目 front matter + 履历
   - SummaryWriter 落 章摘要
3. git add <上述具体文件>  →  git commit -m "ch(NNN): 标题\n\n条目: ...\n设定: ..."   ← 原子点
4. 清工作区（rm 草稿-*/细纲/本章写作材料/审稿）  ← 必须在 commit 成功之后
返回 {ok, commitHash, error}
```

**断电安全论证**（对齐出口"工作区原样保留"）：
- **commit 前中断**：`定稿/` 的写入只是未提交的工作树改动，git 历史未变；恢复 = `git restore --staged --worktree 定稿/ 大纲/`（或回退到 HEAD），把半成品丢弃；`工作区/` 草稿在第 4 步才删，**原样保留** → 可重跑定稿。
- **commit 后、清工作区前中断**：章已定稿（commit 在），仅工作区残留；重跑 finalize 检测到该章已提交 → 幂等地补清工作区。
- **保证**：要么 commit 发生（整章定稿），要么没发生（`定稿/` git 历史不变 + 工作区草稿不丢）。**不存在「半章入档」**。
- commit message `ch(NNN):` ASCII 前缀是机器协议（spec §8，便于 `git log --grep`）。

**git 操作**：M2 用 `node:child_process` 跑 `git`（add/commit/restore/log）。git 健康检查（半提交/锁/损坏）是 M3 状态机职责，M2 假设 git 仓库健康，只保证自身原子性。

## 5. 备料与全书近况

**全书近况组装**（`assembleBookStatus(ctx)`）复用 M1：卷进度（list-volumes + chapters MAX）、悬了太久（report-overdue-threads）、连续弱钩（report-weak-hook-streak）、全书统计（report-book-stats）→ 结构化对象 + Markdown 段（喂细纲 step1 与备料 step3）。

**备料**（`prepareChapterMaterials(ctx, {chapterNum})`）组装 `工作区/本章写作材料.md`，八组件（spec §8 step3）：全书近况 + 本章要写到的事（读细纲）+ 事实切片（精准片段：当前卷+上一卷时间线、相关条目、近章结尾）+ 信息差边界（未揭晓 list-secrets）+ 近章结尾（read-chapters --recent --tail）+ 反复读清单（高频意象，M2 占位/空）+ 文风锚点（文风铁律 铁律/节奏偏好 + 金句库）+ 反和解规则（文风铁律 `## 反和解`）。默认精准片段（§11.1）。

## 6. 机检（7 项，D2）

`mechanicalCheck(ctx, {chapterNum, draftPath})` → `{ok, pass, issues:[], candidates:[]}`。不过关（pass=false）= 存在硬性违规（字数越界/禁词/禁句式/front matter 缺失/新专名…按项定阻断性）。候选（信息差关键词）只列不拦。

| # | 项 | 数据源 | 阻断? |
|---|---|--------|------|
| 1 | 字数区间 | book.yaml `每章目标字数` ± 容差 | 是 |
| 2 | 禁词 | 文风铁律 front matter `禁词` | 是 |
| 3 | 禁句式 | 文风铁律 `禁句式`（正则） | 是 |
| 4 | 本章内复读 | 草稿自身（n-gram 重复短语阈值） | 是（高于阈值） |
| 5 | 新专名比名册 | 草稿专名候选 vs entities/aliases | 否（进审稿单待确认） |
| 6 | front matter 格式完整性 | 草稿/章档案必填字段 | 是 |
| 7 | 信息差关键词候选 | secrets `关键词` 命中正文 | 否（只出候选） |

统计项（跨章高频意象、句式体检）**留 M3+ 体检**（D2），`mechanicalCheck` 预留 `checks` 注册表便于扩展。专名抽取用保守规则（连续中文 + 已知专名表比对），不做 NLP。

## 7. fixture 扩展

`v7/test/fixtures/sample-book/` 补：
- `文风/文风铁律.md`（front matter 禁词/禁句式/口癖 + ## 铁律/反和解/节奏偏好）
- `工作区/细纲.md`（四段）、`工作区/草稿-A.md`（伪造草稿）、`工作区/审稿.md`（含章摘要定稿版）—— 注意 `工作区/` 在被测仓库里要存在但 fixture 仓库非真 git，测试用临时 git 仓库验证定稿 commit

定稿/git 类测试用 `mkdtemp` + `git init` 临时书仓库（同 M1 rebuilder 测试模式），不污染 fixture。

## 8. 测试策略（镜像 src，TDD）

- `test/prep/`：assembleBookStatus、prepareChapterMaterials（喂 fixture，断言材料文件含八组件锚点）
- `test/mechanical-check/`：7 项逐项正例+反例（字数越界/命中禁词/禁句式正则/复读超阈/缺 front matter 字段/新专名进候选/信息差候选）
- `test/finalize/`：
  - 正常：伪造草稿+审稿单 → finalize → 断言 定稿/正文 落档、设定/条目/章摘要更新、工作区清空、git log 出现 `ch(NNN):`
  - **原子性（出口）**：注入 step2 与 step3 之间抛错 → 断言无新 commit + 工作区草稿原样 + `git status` 可净恢复
  - 删 `.cache` 重建后查询与定稿前后一致（不破坏不变量 2）
- `test/storage/adapters/`：6 个 Writer 各正例（写出走防呆、保留未知字段）

## 9. 边界与非目标

- ❌ AI 步骤（拟提案/写稿/两审）、作者交互、状态机编排（M3/M4）
- ❌ 自动模式/批次/叠加视图/污染传播（M6）
- ❌ 统计型机检（句式体检/高频意象）→ M3+ 体检
- ❌ 增量缓存更新（定稿后只写变化行）→ M6；M2 定稿后靠 M1 全量重建保持缓存一致
- ❌ git 健康检查/异常修复（M3）；M2 假设仓库健康
