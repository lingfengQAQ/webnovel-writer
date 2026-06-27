# 执行计划：M3 状态机单入口 + git 隐身全套

> 前置：已读 spec §9（外环/例外）/§10（启动序列与状态机）、不变量 8、v7-implementation-plan §1.5、M3 prd/design。
> 落点 `v7/src/state-machine/`、`v7/src/commands/next.js`、`v7/test/`。复用 M1 读接口、M2 finalize/git.js。
> 本机：`cd v7 && PYTHONUTF8=1 node --test`；零依赖延续；命令走 `run(args,options,ctx)` 契约。
> 工作方式：不开子代理；TDD（先红后绿）；诚实分期 commit。

## 分期（D1：单任务分期，git健康 → 路由+检测 → 外环流程 → DTO 缝）

```
P0 git.js 扩展 + git 健康检查（5 异常 + 安全网）+ git 异常样本库
   ↓
P1 状态机路由器 determineNextState + 序0-6 检测 + next CLI
   ↓
P2 外环脚本流程（影响分析 / 回到第N章 / 吃书 retcon）
   ↓
P3 AI 态 DTO 缝 + 落盘函数
   ↓
P4 全量 AC 复核 + 推送验证 CI（git 异常在 Windows 跑）
```

## P0 git 健康检查（D2：激进自动修 + 可恢复安全网）

- [ ] P0.1 扩展 `src/finalize/git.js`：加 `status()`、`stash(msg)`、`mergeAbort()`、`fsck()`、`config(k,v)`、`createBackupRef(name)`（错误转中文）
- [ ] P0.2 `src/state-machine/git-health.js`：`checkGitHealth(ctx) → {ok, fixed, guidance, rescued}`
  - 陈旧 `index.lock` → 自动删（记 rescued）
  - 网盘副本 `xxx (1).md`/`的冲突副本` → 归档到 `工作区/.救援/网盘副本/`（移动非删）
  - 半提交脏工作树 → `git stash`（可恢复）
  - 合并冲突 → 备份 ref + `merge --abort`
  - `.git` 损坏 → **例外**只检测 + 中文指引
  - 每次自动修在 `工作区/.救援/修复日志.md` 追加「修了什么 + 怎么撤」
- [ ] P0.3 `test/state-machine/git-health.test.js`：git 异常样本库逐个（mkdtemp+git init 造各异常），断言修复/归档/指引 + 安全网可恢复 + **零英文堆栈**

**验证 P0**：`node --test test/state-machine/git-health.test.js` 全绿
**提交 P0**：`feat(v7): M3 P0——git 健康检查激进自动修 + 可恢复安全网`

## P1 状态机路由器 + 7 态检测

- [ ] P1.1 `src/state-machine/detectors.js`：序 0-6 各检测函数（解析失败/无书/手改/工作区未完成/卷末/体检周期/其余）
- [ ] P1.2 `src/state-machine/index.js`：`determineNextState(ctx)` —— 先 checkGitHealth，再序 0-6 命中即停，返回 `{序, state, needsAI, dto?, message, gitHealth}`
- [ ] P1.3 序 0 确定性预修复：全角 `：，` 在 YAML 结构位 → 半角替换后只报不问；其余解析失败 needsAI
- [ ] P1.4 `src/commands/next.js`：`run` 契约调 determineNextState，打印中文 message
- [ ] P1.5 `test/state-machine/router.test.js`：构造命中各序的仓库，断言判定正确 + 命中即停顺序

**验证 P1**：`node --test test/state-machine/` 全绿；`webnovel-writer next` 冒烟
**提交 P1**：`feat(v7): M3 P1——状态机单入口路由 + 序0-6 检测 + next CLI`

## P2 外环脚本流程

- [ ] P2.1 `src/state-machine/flows/impact.js`：`analyzeImpact(ctx,{关键词})` grep 正文+履历+时间线，按 `已发布到章` 分两清单
- [ ] P2.2 `src/state-machine/flows/goto-chapter.js`：`gotoChapter(ctx,{chapterNum,confirm})` 定位 ch(N) commit → 展示影响 → confirm 才 reset（先建备份 ref）
- [ ] P2.3 `src/state-machine/flows/retcon.js`：`retcon(ctx,{chapterNum,原因,...})` retcon commit + 设定/条目同步（复用 M2 Writer/finalize 范式）
- [ ] P2.4 CLI：`impact`/`goto-chapter`/`retcon` 命令（run 契约）
- [ ] P2.5 `test/state-machine/flows/`：影响分析分组、回到第N章(reset+备份 ref)、吃书(retcon message+同步)

**验证 P2**：`node --test test/state-machine/flows/` 全绿
**提交 P2**：`feat(v7): M3 P2——外环脚本流程（影响分析/回到第N章/吃书）`

## P3 AI 态 DTO 缝

- [ ] P3.1 `src/state-machine/dto.js`：为序 0/1/4/6 + 分支试写组装 AI 上下文 DTO（不调 AI）
- [ ] P3.2 落盘函数：AI 产物回流由 M3 落盘（M4 不碰文件）的接口占位 + 契约
- [ ] P3.3 `test/state-machine/dto.test.js`：各 AI 态 DTO 字段齐全 + needsAI=true

**验证 P3**：`node --test test/state-machine/` 全绿
**提交 P3**：`feat(v7): M3 P3——AI 态 DTO 缝 + 落盘契约`

## P4 AC 复核 + 推送

- [ ] P4.1 全量 `node --test` 绿；过 prd Acceptance（7 态 e2e / git 异常样本库零英文堆栈 / 外环流程）
- [ ] P4.2 不变量回归（删缓存重建、定稿原子）
- [ ] P4.3 推送验证 CI 双平台（git 异常处理在 Windows 跑）

**提交 P4**：`feat(v7): M3 P4——AC 复核 + CI 双平台`

## 回滚点

- 各 P 独立，未提交前 `git restore v7/` 对应子目录
- P0 git.js 扩展单点；P2 回到第N章/吃书涉及 git reset，务必先备份 ref

## 出口判据（对齐 prd Acceptance）

> 重建后状态（2026-06-27，全量 `node --test` 200 绿）：

- [x] 7 个态各有端到端测试（router.test 命中各序 0-6 + 命中即停）
- [x] git 异常样本库逐个演练（陈旧锁/网盘副本/半提交/合并冲突/.git 损坏），零英文堆栈，安全网可恢复（git-health.test）
- [x] 影响分析/回到第N章/吃书 纯脚本流程有测试（flows/*.test）
- [x] 不破坏 M1/M2 不变量（删缓存重建、定稿原子；M1/M2 测试仍全绿）
- [ ] CI 双平台绿（git 异常处理在 Windows 验证）：**待推送验证**
