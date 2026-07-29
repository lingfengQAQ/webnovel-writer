# P0 路径穿越修复（F1-F5）

## Goal

封死 v7 finalize/卷复盘链路上三处 AI 可控字段的路径穿越写通道，并给原子批写总闸补 repo 边界兜底；顺带统一章号/卷号校验口径。**npm 发版硬阻断项**（父任务 `07-29-v7-review-findings` 的 P0 段）。

## Background

父任务 prd.md F1-F5 + research/2026-07-29 核实文档已备案完整证据链。要点：同一条 finalize 链上 `factChanges.factPath` 已有严格白名单（`isFactPath` + `normalizePosixRelative`，后者显式拒绝 `\`、绝对路径、`../`、`/../`），本次是**把三个漏接的相邻字段接上现成防线**，不是新设计。

规划期勘察补充（2026-07-29）：

- `ThreadLedgerWriter.createThread` 已有严格 id 校验（类型白名单 + `^\S+-\d+$`，`ThreadLedgerWriter.js:23-32`）——finalize 的 `threadCreates` **安全**，F3 范围确认只剩卷复盘支路（`state-machine/persist.js:301-310` 只做撞号检查，id 直拼路径）。
- `sanitizeFileName`（`util/filename.js`）已处理 Windows 非法字符与保留设备名，可作为「文件名干校验」的单源基础。
- `commands/persist-volume-review.js:13` 的「卷号」已校验正整数——F2 的暴露面只在 finalize payload 的 `timelineRows[].volumeNum`（无校验直达 `TimelineWriter.appendRow`）。
- F5 实测 10 处站点：batch-reject / batch-restage / export / finalize / finalize-batch(--until) / goto-chapter / mechanical-check / prepare-chapter / read-chapter / review-input 的 `isNaN` 判定（拦不住 `"3.5"` 截断、负数、`"1e3"` 等）。

## Requirements

- [x] **R1（F1）**：`secretWrites[].id` 在写入前校验为安全文件名干；非法值人话报错、整批拒绝，不静默改写。
- [x] **R2（F2）**：`timelineRows[].volumeNum` 在写入前校验为正整数；非法值人话报错、整批拒绝。
- [x] **R3（F3）**：卷复盘 `伏笔条目[].id` 校验为 `伏笔-` 前缀的安全文件名干；非法值人话报错。
- [x] **R4（F4）**：`writeAtomicBatch` 对每个目标路径做「解析后仍在 repoPath 内」边界检查，越界即整批拒绝（回滚语义不变）。
- [x] **R5（F5）**：新增统一的正整数解析 helper，替换 10 处 `isNaN` 站点；错误文案保持各命令原有人话风格。（实施实测 12 站点，另补清单外同类 save-review/stage-chapter）
- [x] **R6**：staging 链（`stage-chapter` → `finalize-batch`）与手动 finalize 走同一套校验，不开第二条口径。（两链路共用 `knowledge/payload-guards.js`）

## Acceptance Criteria

- [x] `id="../../x"`、`volumeNum="../../x"`、伏笔 `id="../../x"` 三条攻击样例在各自入口被人话拒绝，仓外零写入、零建目录（含 `mkdir recursive` 不先行执行）。（探针 A/B/C 全过，留档 `probe-p0-attack-output.txt`）
- [x] `writeAtomicBatch` 收到 `{path: "../外部.md"}` 时整批拒绝且已写 tmp 全部清理（复用现有回滚断言风格）。（`test/storage/atomic.test.js` 新增三例）
- [x] 合法路径全量回归：现有测试全绿（基线 665 → 含新增 695 全绿），新增测试覆盖攻击样例 + 边界值（`..`、绝对路径、盘符、反斜杠、空串、Windows 保留名）。
- [x] 章号/卷号站点对 `"3.5"`、`"-1"`、`"0"`、`"1e3"`、`"abc"` 一致拒绝，正整数照常通过。（`test/commands/chapter-num-validation.test.js` 12 站点参数化）
- [x] drift check 绿（SKILL/壳无改动，`build-host-shells.mjs --check` 通过）。
- [x] spec 回填：安全校验口径落进 backend error-handling spec §6（基线 1.1）+ story-repo-spec 0.19 决策 62。

## Non-Goals

- F6 静默降级标记（P1，另任务）；F7 OpenCode adapter（P2）；F8-F11 中危合批（P3）。
- `books.jsonl` 读侧校验（F11，待父任务裁决定级）。
- staging God Module / extractSection 单源化等结构债务。
