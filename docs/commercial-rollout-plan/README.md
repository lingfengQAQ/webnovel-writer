# 商业级落地改造计划（按功能闭环拆分）

## 文档使用方式
- 每个功能闭环对应 1 份独立计划文档，可单独分配给 1 个子团队执行。
- 每个文档内的任务均按“1 个任务 = 1 个子智能体可独立完成”拆分。
- 任务表中的“代码边界”是单子智能体的强约束，避免交叉改同一文件导致冲突。

## 文档目录
- F01 初始化与绑定闭环: `F01-init-use-preflight.md`
- F02 写作上下文抽取闭环: `F02-extract-context.md`
- F03 数据层命令闭环: `F03-index-state-rag.md`
- F04 健康报告闭环: `F04-status-report.md`
- F05 Dashboard 后端只读 API 闭环: `F05-dashboard-readonly-api.md`
- F06 Skills 管理闭环: `F06-skills-management.md`
- F07 设定词典闭环: `F07-settings-dictionary.md`
- F08 双纲拆分闭环: `F08-outline-split-resplit.md`
- F09 Edit Assist 闭环: `F09-edit-assist.md`
- F10 Runtime 迁移与运行态 API 闭环: `F10-runtime-migration-api.md`
- F11 Dashboard 前端多页面闭环: `F11-dashboard-frontend-pages.md`

## 并行执行建议（按波次）
- 波次 A（立刻并行）: F07, F11, F10
- 波次 B（A 完成后并行）: F08, F09, F05
- 波次 C（基础稳定后并行）: F01, F03, F02, F04, F06

## 统一门禁（所有功能共享）
- 门禁 1: 生产模式禁止静默 mock fallback。
- 门禁 2: 所有新增/变更接口必须有错误码与失败语义。
- 门禁 3: 每个功能闭环必须提供自动化测试（至少 API/CLI 回归）。
- 门禁 4: 文档中的 DoD（完成定义）必须全部达成才可关闭任务。
