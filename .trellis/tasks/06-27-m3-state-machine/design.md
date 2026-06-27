# 技术设计：M3 状态机单入口 + git 隐身全套

## 1. 范围与分层

M3 是**编排层**：单入口状态机先跑 git 健康检查，再按 §10 序 0-6 命中即停判定「当前该做什么」。状态机只路由、不判业务、不调 AI——AI 态备好 DTO 返回「需 AI」交 M4（架构原则 §1.5）。

执行体分裂：
- **纯脚本（M3 全做）**：git 健康检查、路由器、7 态检测、外环流程（影响分析/回到第N章/吃书/手改补登/分支 git 部分）。
- **AI 态动作（M4）**：建书问答、修复提议、卷复盘对谈、细纲拟提案、推演、圆设定 —— M3 出 DTO + `needsAI`。
- **M3+/后续**：体检文体指纹提取（M3 体检只做条目活跃率/时间线孤儿脚本项）。

模块落点（填 M0 占位 `v7/src/state-machine/`）：
```
v7/src/state-machine/
├── index.js            # determineNextState(ctx)：git健康 → 序0-6 路由
├── git-health.js       # 5 类异常检测 + 激进自动修复（D2，可恢复安全网）
├── detectors.js        # 序0-6 各态检测（命中即停）
├── flows/
│   ├── impact.js       # 影响分析（grep 正文+履历+时间线）
│   ├── goto-chapter.js # 回到第N章（git 回滚包装 + 影响范围）
│   └── retcon.js       # 吃书（retcon commit + 设定/条目同步）
└── dto.js              # AI 态上下文 DTO 组装
```
复用 M1（grep-story/reports/cache）、M2（finalize/git.js 扩展、assembleBookStatus）。

## 2. 单入口契约

```js
// determineNextState(ctx) → 作者的「继续」按钮背后
// @param {{repoPath, cache}} ctx
// @returns {Promise<{
//   ok, gitHealth: {fixed:[], guidance:[], rescued:[]},
//   序: 0..6, state: string, needsAI: boolean, dto?: object,
//   message: string  // 中文，告诉作者/宿主当前该做什么
// }>}
```
CLI 单入口：`v7/src/commands/next.js`（`webnovel-writer next`，run 契约）→ 调 determineNextState，打印 message + 必要数据。SessionStart hook 注入留 M4/M5（无 hook 宿主走这个 CLI 等价路径）。

## 3. git 健康检查（D2：激进自动修 + 可恢复安全网）

`checkGitHealth(ctx) → {ok, fixed:[], guidance:[], rescued:[]}`。在序 0 前跑。**改 git 状态前必先快照**；返回中文小结，作者永不见 git 英文报错（不变量 8）。

| 异常 | 检测 | 处理（B 激进） | 安全网 |
|------|------|--------------|--------|
| 陈旧锁文件 `.git/index.lock` | 文件存在且陈旧（mtime 超阈值，无活跃 git 进程迹象） | 自动删 | 删前记 rescued 日志 |
| 网盘冲突副本 `xxx (1).md`/`xxx 的冲突副本` | 文件名模式匹配 | 自动**归档**到 `工作区/.救援/网盘副本/` | 移动非删除，可找回 |
| 半提交（中断的定稿，工作树脏） | `git status --porcelain` 非空且非正常流程 | 自动 `git stash`（push 到备份） | stash 可 pop 恢复 |
| 合并冲突 | `git status` 含 `UU`/MERGING | 先 `git stash`/备份 ref，再 `git merge --abort` | 备份 ref 可回 |
| `.git` 损坏 | `git fsck`/`git status` 报错 | **例外：不自动修**，检测 + 中文指引（建议备份后 `git fsck`） | 不动用户仓库 |

实现：git 操作复用并扩展 M2 `src/finalize/git.js`（加 `status`/`stash`/`mergeAbort`/`fsck`/`config`）。每次自动修在 `工作区/.救援/修复日志.md` 追加一行（修了什么、时间、怎么撤）。

## 4. 状态机路由（序 0-6，命中即停）

`detectors.js` 导出按序判定函数，determineNextState 依序调用，首个命中返回。

| 序 | 检测（脚本） | needsAI | dto / 动作 |
|----|-------------|---------|-----------|
| 0 修复确认 | 扫源文件，任一 `parseFrontMatter`/`parseMarkdownTable` 失败；全角冒号/逗号在结构位 = 确定性错误（预修复） | 是（AI 提议保意图修复） | dto: {文件, 行, 上下文, 确定性预修复结果} |
| 1 建书引导 | 无 `book.yaml` / `books.jsonl` 当前书不存在 | 是（问答） | 脚本可先建空骨架；dto: {缺什么} |
| 2 手改补登 | `git status --porcelain -- 定稿 大纲` 非空（未登记手改） | 否 | 动作：提议 `fix(...)` commit（复用 M2 git） |
| 3 断点续跑 | `工作区/` 有未完成流程（草稿/审稿/待定稿批次存在但未定稿） | 否 | 动作：返回中断阶段，引导续跑 |
| 4 卷复盘 | 最大已定稿章 = 卷末（卷规模整除 / 卷纲耗尽） | 是（对谈） | 脚本清账（本卷开/收/悬了太久）；dto 给 AI |
| 5 体检 | 章号到体检周期（book.yaml，默认每 50 章） | 部分 | 脚本：条目活跃率(M1)/时间线孤儿；指纹推 M3+ |
| 6 起草细纲 | 其余 | 是（拟提案） | 脚本：assembleBookStatus(M2)；dto 给 AI 拟提案 |

序 0 的「确定性错误预修复」：全角 `：，` 出现在 YAML 键值结构位 → 脚本可确定性替换为半角后只报不问（spec §10）；其余解析失败 → needsAI。

## 5. 外环脚本流程（§9，纯脚本）

- **影响分析** `analyzeImpact(ctx, {关键词|实体})`：grep-story 正文 + 扫条目履历 + 时间线，列引用章号；按「已发布章号」（book.yaml `已发布到章`，默认 0=全未发布）分**已发布/未发布**两清单。返回结构化，不改文件。
- **回到第 N 章** `gotoChapter(ctx, {chapterNum, confirm})`：`git log --grep "ch(N):"` 定位 commit → 先展示影响范围（该章之后的章/commit）→ `confirm=true` 才 `git reset`（**先建备份 ref** `救援/回退前-<时间>`）。不变量 8：作者只说「回到第 N 章」，不碰 git。
- **吃书 retcon** `retcon(ctx, {chapterNum, 原因, 设定变更, 条目变更})`：改定稿 + `retcon(N): 原因` commit + 设定/条目同步（复用 M2 Writer + finalize 编排范式）。圆设定（AI）留 M4。

## 6. AI 态 DTO 缝

`dto.js`：为序 0/1/4/6 + 分支试写组装 AI 所需上下文（不调 AI，只备料）。形如 `{state, 上下文片段, 作者可选项, 期望产物}`。M4 吃 DTO 出结构化产物，回流由 M3 落盘（M3 提供落盘函数，M4 不碰文件）。M3 测试断言 DTO 字段齐全 + `needsAI=true`。

## 7. 测试策略（镜像 src，TDD）

**git 异常样本库**（核心出口）：用 `mkdtemp + git init` 构造每种异常的仓库样本，断言 checkGitHealth 自动修复/归档/指引正确 + 安全网可恢复 + 输出零英文堆栈：
- 造陈旧 `index.lock` → 断言自动删 + rescued 记录
- 造 `章节 (1).md` → 断言归档到 `工作区/.救援/`
- 造脏工作树 → 断言 stash + 可 pop
- 造 MERGING 状态（制造冲突）→ 断言备份 + abort
- 造 `.git` 损坏（截断 HEAD）→ 断言只指引、不乱动、message 中文

**状态机路由**：`test/state-machine/detectors` 构造命中各序 0-6 的仓库，断言 determineNextState 返回正确 序/state/needsAI/dto。命中即停顺序也要测（如同时有手改 + 卷末 → 先报序 2）。

**外环流程**：影响分析（grep 命中 + 已发布/未发布分组）、回到第N章（reset 到目标 + 备份 ref 存在）、吃书（retcon commit message + 设定同步）。

**不变量回归**：删 `.cache` 重建一致、定稿原子不破坏。

## 8. 边界与非目标

- ❌ AI 态真实动作（建书问答/修复提议/卷复盘对谈/细纲提案/推演/圆设定）→ M4
- ❌ 体检文体指纹提取 → M3+/M4
- ❌ 自动模式连写/批次/污染传播 → M6
- ❌ SessionStart hook 真实注入 → M4/M5（M3 给 CLI 等价入口）
- ❌ `.git` 损坏的自动修复（D2 例外，只指引）
