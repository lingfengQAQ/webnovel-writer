# P1 DTO 静默降级显式标记（F6）

## Goal

让「读失败后降级」在送达 AI 的 DTO 上显式可见：AI 必须能区分「没有数据」与「读取失败后拿到的残缺数据」。**真写 50 章（真模型 beta 验证）前置**——验证时若吃到缺料 DTO 而无标记，验证结论失真且无人察觉。

## Background

父任务 F6 备案 + research/2026-07-29 核实文档。典型形态：`storage/adapters/ChapterReader.js:53-55` 缓存查询失败 `catch` 后静默转文件读；adapters/prep/review/dto 一带实测约 21 处 `catch {}` 类吞错点（规划期粗扫，实施 S0 需逐处分类）。

关键区分（实施时按此分类，不是所有 catch 都要标记）：

1. **良性降级**：缓存失败→文件读成功。文件是真源，数据不缺——只需低噪声记录（工作区日志或 DTO 元信息），不必打扰主流程。
2. **有损降级**：读失败→返回空/部分数据继续组装 DTO。这是 F6 的要害，必须显式标记。
3. **合理吞错**：目录不存在=首个条目、可选文件缺失等语义上的「没有」。不标记（这不是失败）。

## Requirements

- [x] **R1**：DTO 增加 `degraded` 标记字段（数组：每项含发生位置/原因摘要），有损降级发生时必填；无降级时字段不出现（省 token，旧消费者零感知）。
- [x] **R2**：备料（`prepare-chapter` 的本章写作材料）与两审输入（`assembleReviewInput` 的 ReviewInput）两条送 AI 主链路优先覆盖；状态机序 0-6 DTO 次之。
- [x] **R3**：SKILL/角色任务书补一句消费约定：见到 `degraded` 须向作者呈报「本次材料可能缺料及原因」，不得基于残缺上下文静默写作/审稿。
- [x] **R4**：`state-machine/dto.js` 与 `persist.js` 为产出/落盘对称结构——新字段须同步进 DTO「期望产物」说明，防契约漂移（父任务 prd 已提示）。（核实：期望产物说明实指 dto.js 内嵌文案，persist.js 无此文案，序 4/序 6 已补 degraded 语义）
- [x] **R5**：良性降级（缓存→文件成功）不进 `degraded`，避免狼来了；可记工作区诊断日志。（签收口径：零处理，连诊断日志也不写——缓存自重建机制已够，不制造未提交工作区噪声）

## Acceptance Criteria

- [x] 故障注入测试：DI 一个 `cache.query` 恒抛 + 文件也缺的场景 → 备料/审稿输入 DTO 带 `degraded`，含位置与原因；同场景仅缓存坏、文件在 → 不带 `degraded`（良性降级）。（`test/prep/degraded.test.js` + `test/review/degraded.test.js` 6 例全绿，留档 `fault-injection-output.txt`）
- [x] 无故障全链路：`degraded` 字段不出现在任何 DTO（现有测试断言结构的用例零改动即绿）。
- [x] 全量测试绿 + drift check 绿（SKILL 有改动须重渲染四宿主壳）。（704/704 全绿，drift check 通过，四宿主壳已重渲染含 degraded 段）
- [x] spec 回填：DTO 契约（story-repo spec 相应节 + 决策条目）写明 degraded 语义与三分类口径。（story-repo-spec 0.20 决策 63）

## Non-Goals

- 不做重试/自愈（缓存重建已有既有机制）；本任务只做「可见性」。
- 不改缓存层错误处理策略本身（fail-open 降级到文件读是既定设计，保留）。

## Notes

- 实施 S0 必须先做 21 处 catch 的三分类清单（留档 research/），再动代码——避免把「合理吞错」误标造成噪声。
- 复杂任务：需 design.md + implement.md 后再 start。
