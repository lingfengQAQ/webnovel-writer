# OpenSpec 规范执行计划（仅保留未完成任务）

## 0. 文档元信息

| 项 | 内容 |
|---|---|
| Plan ID | OSP-WNW-CODEX-20260325-01 |
| 版本 | v1.1（2026-03-26） |
| 基线输入 | `docs/srs-codex-exclusive-rebuild.md`（v1.1，2026-03-25） |
| 适用仓库 | `D:\code\webnovel-writer` |
| 说明 | 本文档已删除“已落地模块”的计划内容，仅保留未完成任务与验证缺口 |

## 1. 未完成任务总览

| 任务ID | 模块 | 当前状态 | 未完成点 |
|---|---|---|---|
| U01 | Runtime & Migration | 部分完成 | 运行时仍兼容 `.claude` 读取路径，尚未收敛为纯 `.codex` 主链路 |
| U02 | Workspace Skills CLI | 部分完成 | 已有独立 `skill_manager.py`，但未落地统一 `webnovel skill ...` 子命令 |
| U03 | Settings/Outlines CLI | 未完成 | 未发现 `webnovel setting extract-dictionary` 与 `webnovel outline resplit --start --end` |
| U04 | Global Edit Assist（前端） | 部分完成 | 接口已实现，但前端尚未形成“设定/大纲/正文全编辑区统一完整闭环” |
| U05 | Settings 前端链路治理 | 部分完成 | `settings.js` 在非生产模式默认允许 mock fallback，真实链路强约束未完成 |
| U06 | 非功能验收证据 | 未完成 | 缺少 `split/resplit` p95（<=10s）等性能实测与可追踪报告 |
| U07 | 文档收口 | 部分完成 | 仍需全量巡检 README 与其余文档，清理残留 Claude 主链路叙述 |

## 2. 未完成任务明细

## U01 Runtime 收敛为 Codex-only

1. 目标：运行时主链路不再读取 `.claude`，仅保留可控迁移入口。
2. 当前依据：
   - `webnovel-writer/scripts/project_locator.py` 中 `POINTER_DIR_NAMES = (".codex", ".claude")`
   - `webnovel-writer/dashboard/server.py` 启动解析仍遍历 `.codex/.claude`
3. 验收：
   - 运行时定位与启动逻辑仅依赖 `.codex`
   - `.claude` 仅出现在迁移脚本输入，不出现在运行时读取路径

## U02 Skills 统一 CLI 子命令

1. 目标：补齐 `webnovel skill list/add/update/enable/disable/remove/audit`。
2. 当前依据：
   - 已有 `webnovel-writer/scripts/data_modules/skill_manager.py`
   - `webnovel-writer/scripts/data_modules/webnovel.py` 未提供 `skill` 子命令
3. 验收：
   - 统一入口命令可直接覆盖现有 `skill_manager.py` 能力
   - 帮助文档与操作手册命令一致

## U03 Settings/Outlines 统一 CLI 子命令

1. 目标：补齐计划中的词典抽离与重拆 CLI 入口。
2. 当前依据：
   - 未发现 `webnovel setting extract-dictionary`
   - 未发现 `webnovel outline resplit --start --end`
3. 验收：
   - CLI 能触发与 API 对等的抽离/重拆能力
   - 参数、错误码、输出格式文档化

## U04 Global Edit Assist 前端闭环

1. 目标：设定/大纲/正文编辑区统一右键入口，形成 preview -> apply -> logs 可追踪链路。
2. 当前依据：
   - 后端接口已实现：`/api/edit-assist/preview|apply|logs`
   - 现有前端主要在 `OutlineWorkspacePage.jsx` 发起 preview 流程
3. 验收：
   - 三类编辑区可用同一协议触发协助修改
   - apply 成功/失败在 UI 可见并可追踪日志

## U05 Settings mock fallback 治理

1. 目标：明确 mock fallback 的启用条件与生产禁用策略。
2. 当前依据：
   - `dashboard/frontend/src/api/settings.js` 在非 production 模式默认可回落 mock
3. 验收：
   - 提供显式配置开关与文档说明
   - 生产链路默认只走真实接口

## U06 非功能验收证据

1. 目标：补齐性能与可靠性量化证据。
2. 当前缺口：
   - 未发现 `split/resplit` p95 指标报告
   - 未发现发布级性能基线文件
3. 验收：
   - 形成可复现压测脚本与结果归档路径
   - 报告包含输入规模、p95、失败重试结果

## U07 文档全量收口

1. 目标：完成 `README.md + docs/*.md` 全量叙事一致性检查。
2. 当前缺口：
   - 本轮仅同步了目标三类文档与执行计划，未完成全量巡检
3. 验收：
   - 无过时 Claude 主链路描述
   - 命令、接口、脚本入口与实际实现一致

## 3. 发布 Gate（待完成）

1. U01~U07 全部关闭。
2. 对应自动化/手工验收记录可追溯。
3. 无 P0/P1 未关闭缺陷。

## 4. 无法确认项（暂不判定为完成）

1. `split/resplit` 性能是否满足 p95 <= 10s。
2. 全编辑区 edit-assist E2E 是否已覆盖到发布门槛。
