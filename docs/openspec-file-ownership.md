# OpenSpec 文件 Ownership（W0 / T00）

## 1. 文档元信息

| 项 | 内容 |
|---|---|
| Ownership ID | OWN-WNW-20260325-T00 |
| 生效日期 | 2026-03-25 |
| 覆盖任务 | T01 ~ T12 |
| 来源 | `docs/openspec-execution-plan.md` 4.2 任务包明细 |

## 2. 路径口径

| 口径 | 路径 |
|---|---|
| 仓库根 | `D:/code/webnovel-writer` |
| 代码根（当前实现） | `D:/code/webnovel-writer/webnovel-writer` |
| 文档根 | `D:/code/webnovel-writer/docs` |

> 规则：执行计划中的 `dashboard/...`、`scripts/...`、`README.md` 默认相对“代码根”；`docs/...` 相对“文档根”。

## 3. 独占映射（T01~T12）

| 任务 | Owner | 独占文件域（可写） | 只读依赖（不可改） |
|---|---|---|---|
| T01 | `worker-runtime` | `scripts/project_locator.py`、`scripts/data_modules/webnovel.py`、`scripts/migrations/*` | `dashboard/*`、`frontend/*` |
| T02 | `worker-backend-core` | `dashboard/app.py`、`dashboard/routers/__init__.py`、`dashboard/models/*` | `dashboard/services/*`（仅引用） |
| T03 | `worker-frontend-core` | `dashboard/frontend/src/App.jsx`、`dashboard/frontend/src/pages/*`、`dashboard/frontend/src/components/*` | `dashboard/routers/*`、`dashboard/services/*` |
| T04 | `worker-skill-be` | `dashboard/routers/skills.py`、`dashboard/services/skills/*`、`scripts/data_modules/skill_manager.py` | `dashboard/app.py`（仅读取已注册前缀） |
| T05 | `worker-setting-be` | `dashboard/routers/settings.py`、`dashboard/services/dictionary/*` | `dashboard/app.py`（仅读取已注册前缀） |
| T06 | `worker-split-be` | `dashboard/routers/outlines.py`、`dashboard/services/split/*` | `dashboard/app.py`（仅读取已注册前缀） |
| T07 | `worker-assist-be` | `dashboard/routers/edit_assist.py`、`dashboard/services/edit_assist/*` | `dashboard/app.py`（仅读取已注册前缀） |
| T08 | `worker-skill-fe` | `dashboard/frontend/src/pages/SkillsPage.jsx`、`dashboard/frontend/src/api/skills.js` | `dashboard/frontend/src/App.jsx`（不改导航主骨架） |
| T09 | `worker-setting-outline-fe` | `dashboard/frontend/src/pages/SettingsPage.jsx`、`dashboard/frontend/src/pages/OutlineWorkspacePage.jsx`、`dashboard/frontend/src/api/settings.js`、`dashboard/frontend/src/api/outlines.js` | `dashboard/frontend/src/App.jsx`（不改导航主骨架） |
| T10 | `worker-resplit-fe-be` | `dashboard/services/split/resplit.py`、`dashboard/frontend/src/components/ResplitDialog.jsx` | `dashboard/routers/outlines.py`（仅契约对齐） |
| T11 | `worker-qa` | `scripts/tests/*`、`dashboard/tests/*`、`dashboard/frontend/tests/*` | 业务实现文件 |
| T12 | `worker-docs` | `README.md`、`docs/*` | 业务实现文件 |

## 4. 共享热点与冲突规避

| 热点文件 | 允许改动任务 | 规避策略 |
|---|---|---|
| `dashboard/app.py` | T00、T02 | W0 后冻结主入口；W1/W2 各任务仅改各自 router/service 文件 |
| `dashboard/frontend/src/App.jsx` | T03 | 后续页面任务通过新增 `src/pages/*` 与 `src/api/*` 对接，不反复改主壳 |
| `docs/*` | T00、T12 | T00 产出契约文档；T12 仅做发布一致性更新，不回写契约语义 |

## 5. 并行执行规则（强约束）

1. 不在自己独占域内的改动，统一忽略，不回滚。
2. 需要跨域改动时，先提“接口变更申请”，获批后由文件 owner 执行。
3. 同一任务只提交本域文件；评审时若出现跨域改动，直接驳回。
4. 发现目录层级差异（如多一层 `webnovel-writer/`）时，不改契约名，只在说明中标注路径映射。
5. 所有任务提交都必须附带：变更文件列表、测试结果、未决风险。

## 6. 交接清单模板

| 字段 | 要求 |
|---|---|
| `task_id` | `Txx` |
| `changed_files` | 仅本任务独占域 |
| `api_contract_delta` | 无变更填 `none`；有变更需附申请编号 |
| `tests` | 命令 + 结果（pass/fail/skip） |
| `risks` | 未决风险与影响范围 |

## 7. 版本策略

1. 本文档是 W0 基线，后续仅允许追加，不允许重写既有 ownership 边界。
2. 若任务拆分新增 Txx，必须先补本文档再开工。
