# OpenSpec 接口冻结清单（W0 / T00）

## 1. 文档元信息

| 项 | 内容 |
|---|---|
| Freeze ID | IFZ-WNW-20260325-T00 |
| 生效日期 | 2026-03-25 |
| 适用波次 | W1 ~ W5 |
| 基线输入 | `docs/openspec-execution-plan.md`、`docs/srs-codex-exclusive-rebuild.md` |
| 变更策略 | 进入 W1 后，路由前缀、模型名、页面骨架 ID 视为冻结项；若需变更，先提交接口变更申请再改码 |

> 路径说明：执行计划中的 `dashboard/...` 为逻辑路径；当前仓库实现位于 `webnovel-writer/dashboard/...`。本清单冻结的是接口契约与命名，不绑定目录层级差异。

## 2. 后端路由前缀冻结

### 2.1 存量只读前缀（保持兼容）

| 前缀 | 现状 | 约束 |
|---|---|---|
| `/api/project` | 已存在 | 保持只读 |
| `/api/entities` | 已存在 | 保持只读 |
| `/api/relationships` | 已存在 | 保持只读 |
| `/api/relationship-events` | 已存在 | 保持只读 |
| `/api/chapters` | 已存在 | 保持只读 |
| `/api/scenes` | 已存在 | 保持只读 |
| `/api/reading-power` | 已存在 | 保持只读 |
| `/api/review-metrics` | 已存在 | 保持只读 |
| `/api/state-changes` | 已存在 | 保持只读 |
| `/api/aliases` | 已存在 | 保持只读 |
| `/api/overrides` | 已存在 | 保持只读 |
| `/api/debts` | 已存在 | 保持只读 |
| `/api/debt-events` | 已存在 | 保持只读 |
| `/api/invalid-facts` | 已存在 | 保持只读 |
| `/api/rag-queries` | 已存在 | 保持只读 |
| `/api/tool-stats` | 已存在 | 保持只读 |
| `/api/checklist-scores` | 已存在 | 保持只读 |
| `/api/files` | 已存在 | 保持只读 |
| `/api/events` | 已存在 | SSE 保持兼容 |

### 2.2 新增能力前缀（冻结）

| 模块 | 冻结前缀 | 冻结端点（最小集合） |
|---|---|---|
| Runtime | `/api/runtime` | `GET /profile`、`POST /migrate` |
| Skills | `/api/skills` | `GET /`、`POST /`、`PATCH /{skill_id}`、`POST /{skill_id}/enable`、`POST /{skill_id}/disable`、`DELETE /{skill_id}`、`GET /audit` |
| Settings Files | `/api/settings/files` | `GET /tree`、`GET /read` |
| Settings Dictionary | `/api/settings/dictionary` | `POST /extract`、`GET /`、`POST /conflicts/{id}/resolve` |
| Outlines | `/api/outlines` | `GET /`、`POST /split/preview`、`POST /split/apply`、`GET /splits`、`POST /resplit/preview`、`POST /resplit/apply`、`POST /order/validate` |
| Edit Assist | `/api/edit-assist` | `POST /preview`、`POST /apply`、`GET /logs` |

## 3. 关键请求/响应模型名冻结

## 3.1 通用模型

| 类型 | 模型名 | 最小字段 |
|---|---|---|
| 错误响应 | `ApiErrorResponse` | `error_code`, `message`, `details`, `request_id` |
| 分页查询 | `PageQuery` | `limit`, `offset` |
| 工作区上下文 | `WorkspaceContext` | `workspace_id`, `project_root` |

## 3.2 模块模型（按接口）

| 接口 | 请求模型 | 响应模型 |
|---|---|---|
| `GET /api/runtime/profile` | `RuntimeProfileQuery` | `RuntimeProfileResponse` |
| `POST /api/runtime/migrate` | `RuntimeMigrateRequest` | `RuntimeMigrateResponse` |
| `GET /api/skills` | `SkillListQuery` | `SkillListResponse` |
| `POST /api/skills` | `SkillCreateRequest` | `SkillCreateResponse` |
| `PATCH /api/skills/{skill_id}` | `SkillUpdateRequest` | `SkillUpdateResponse` |
| `POST /api/skills/{skill_id}/enable` | `SkillToggleRequest` | `SkillToggleResponse` |
| `POST /api/skills/{skill_id}/disable` | `SkillToggleRequest` | `SkillToggleResponse` |
| `DELETE /api/skills/{skill_id}` | `SkillDeleteRequest` | `SkillDeleteResponse` |
| `GET /api/skills/audit` | `SkillAuditQuery` | `SkillAuditListResponse` |
| `GET /api/settings/files/tree` | `SettingsFileTreeQuery` | `SettingsFileTreeResponse` |
| `GET /api/settings/files/read` | `SettingsFileReadQuery` | `SettingsFileReadResponse` |
| `POST /api/settings/dictionary/extract` | `DictionaryExtractRequest` | `DictionaryExtractResponse` |
| `GET /api/settings/dictionary` | `DictionaryListQuery` | `DictionaryListResponse` |
| `POST /api/settings/dictionary/conflicts/{id}/resolve` | `DictionaryConflictResolveRequest` | `DictionaryConflictResolveResponse` |
| `GET /api/outlines` | `OutlineBundleQuery` | `OutlineBundleResponse` |
| `POST /api/outlines/split/preview` | `OutlineSplitPreviewRequest` | `OutlineSplitPreviewResponse` |
| `POST /api/outlines/split/apply` | `OutlineSplitApplyRequest` | `OutlineSplitApplyResponse` |
| `GET /api/outlines/splits` | `OutlineSplitHistoryQuery` | `OutlineSplitHistoryResponse` |
| `POST /api/outlines/resplit/preview` | `OutlineResplitPreviewRequest` | `OutlineResplitPreviewResponse` |
| `POST /api/outlines/resplit/apply` | `OutlineResplitApplyRequest` | `OutlineResplitApplyResponse` |
| `POST /api/outlines/order/validate` | `OutlineOrderValidateRequest` | `OutlineOrderValidateResponse` |
| `POST /api/edit-assist/preview` | `EditAssistPreviewRequest` | `EditAssistPreviewResponse` |
| `POST /api/edit-assist/apply` | `EditAssistApplyRequest` | `EditAssistApplyResponse` |
| `GET /api/edit-assist/logs` | `EditAssistLogQuery` | `EditAssistLogListResponse` |

## 3.3 关键领域实体模型名

| 领域 | 模型名 |
|---|---|
| Skill | `SkillMeta`, `SkillAuditEntry` |
| 设定词典 | `DictionaryEntry`, `DictionaryConflictEntry` |
| 双纲拆分 | `OutlineSplitRecord`, `OutlineSegment`, `OutlineAnchor` |
| 重拆回退 | `OutlineRollbackPlan` |
| 协助修改 | `EditAssistProposal`, `EditAssistLogEntry` |

## 4. 前端页面骨架冻结（`src/pages/*`）

| 页面 ID | 文件名（冻结） | 作用 | 依赖前缀 |
|---|---|---|---|
| `dashboard` | `DashboardPage.jsx` | 数据总览与聚合视图 | `/api/project`, `/api/*` 只读聚合 |
| `entities` | `EntitiesPage.jsx` | 设定词典（现有实体视图） | `/api/entities`, `/api/state-changes` |
| `graph` | `GraphPage.jsx` | 关系图谱 | `/api/entities`, `/api/relationships` |
| `chapters` | `ChaptersPage.jsx` | 章节清单 | `/api/chapters` |
| `files` | `FilesPage.jsx` | 文件树与阅读 | `/api/files` |
| `reading` | `ReadingPowerPage.jsx` | 追读力展示 | `/api/reading-power` |
| `skills` | `SkillsPage.jsx` | 工作区技能管理 | `/api/skills` |
| `settings` | `SettingsPage.jsx` | 设定集与词典入口 | `/api/settings/files`, `/api/settings/dictionary` |
| `outline` | `OutlineWorkspacePage.jsx` | 总纲/细纲同屏、拆分与重拆入口 | `/api/outlines` |

## 5. 骨架目录冻结（供 W1 并行）

| 目录 | 预期骨架文件（仅命名冻结） |
|---|---|
| `dashboard/routers/` | `runtime.py`, `skills.py`, `settings.py`, `outlines.py`, `edit_assist.py`, `__init__.py` |
| `dashboard/services/` | `runtime/`, `skills/`, `dictionary/`, `split/`, `edit_assist/` |
| `dashboard/frontend/src/pages/` | 第 4 节所列页面文件 |

## 6. 冻结外事项

1. 业务算法与提示词策略不在本次冻结范围。
2. 数据库表结构可在不改模型名的前提下细化。
3. 仅在必要时新增字段；禁止在 W1~W3 改动已冻结前缀与模型名。
