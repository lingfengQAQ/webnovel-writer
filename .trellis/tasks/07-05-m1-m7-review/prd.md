# M1-M7 全量 review（M6/M7 落地后的第三轮通审）

## Goal

M6（自动模式）/M7（导出与迁移）落地后，对 v7 全部代码（110 源文件）做第三轮全量 review。前两轮定性结论：**流程自身绿、流程间接力没人测**（M1-M4 轮抓到"主循环跑不通"被测试脚手架掩盖；M1-M5 轮抓到三条支路成环缺口）。本轮重点 = M6/M7 新代码 + 新旧流程交叉接缝 + 历轮修复仍在位复查。**本任务只审不修**：产出验证过的发现清单与修复 backlog，修复经用户裁决后另行执行。

## 方式（用户暂离按推荐默认，可推翻）

- 并行找 + 探针核：7 个只读子代理分区精读（trellis-research，产出落 research/），主会话汇总去重后**真 CLI/库探针逐个复现**——复现了才 CONFIRMED，复现不了降 PLAUSIBLE 或剔除（M5 轮 review-probe.mjs 先例）。
- 分区：A 存储层（adapters/parsers/serializers/util）；B 缓存与统计（cache/style-stats/health-check）；C 写章流程（prep/mechanical-check/review/finalize/dto）；D 状态机与外环（state-machine/session/runtime）；E M6 staging 与三消费点叠加 + 批次×手动流程交叉；F M7 export/migrate 与建书/书单接力；G 命令壳/bin/installer/host-shells + 测试脚手架掩盖审计。

## 历史 bug 模式（子代理"闻味"清单）

1. 空壳/占位实现（M1 教训）；2. 流程接力断裂——A 流程完成后 B 流程判定错（不 commit 误触序2、改源不刷缓存、无执行通道）；3. 测试脚手架掩盖真实路径（手动 git init/rebuild）；4. 工件清理静默漏（workspaceFiles 前缀）；5. 全局 ignore/路径规则吞文件（两次踩）；6. Windows 中文路径/编码；7. 双源漂移（SKILL vs 实现、常量双写）；8. 回滚边界过宽/过窄；9. 缓存当真源读、staged 数据入缓存/指纹；10. 作者界面域混机器味（英文/堆栈）。

## 本轮新增关注（M6/M7 特有接缝）

- 批次进行中 × 手动例外流程交叉：stage 后 goto-chapter / relink / 体检 / 卷复盘 / 手动 finalize 单章会怎样？
- finalize-batch 复用 finalizeChapter 的 workspaceFiles 语义；threadCreates 手动/批次两路径一致性
- migrate 产物再进主循环全程（migrate→next→细纲→备料→机检→两审→定稿→再 next）
- export 对批次章/工作区草稿的边界；migrate 与既有书名/books.jsonl 冲突面
- M5.5 统计确定性在 M6/M7 改动后仍守（fingerprints/imagery_top 无 staged/迁移污染）

## Acceptance Criteria

- [x] AC1 七区 research 报告齐（research/review-{A..G}.md，每条候选带 file:line + 怀疑理由 + 建议探针）
- [x] AC2 候选全部过探针裁决：CONFIRMED 11 P1（probe-m1-m7.mjs 7 探针 + probe-followup.mjs 2 补充 + 子代理现场复现 A×6/F×4）/ PLAUSIBLE 1（R12 需故障注入，逻辑确凿）/ REFUTED 4（记录在报告防复审）
- [x] AC3 汇总报告 `review-m1-m7.md` 落任务目录：P0×0 / P1×12 / P2×18 / S×10 分层 + 三批修复 backlog
- [x] AC4 历轮修复在位复查：M1-M4 P0/P1、M1-M5 三条 P1（主会话 grep 与 D 区双验证）、M5.5 确定性、M6 不变量——全在位
- [x] AC5 全量测试仍绿（429 pass 0 fail；v7/ 零改动，探针脚本落任务目录）

## Out of Scope

- ❌ 修复实施（另行任务，按本轮 backlog）
- ❌ 性能优化建议（除非构成正确性问题）
- ❌ v6 遗产代码（webnovel-writer/ 冻结）
