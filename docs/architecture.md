# 系统架构与模块设计

## 核心理念

### 防幻觉三定律

| 定律 | 说明 | 执行方式 |
|------|------|---------|
| **大纲即法律** | 遵循大纲，不擅自发挥 | Context Agent 强制加载章节大纲 |
| **设定即物理** | 遵守设定，不自相矛盾 | Consistency Checker 实时校验 |
| **发明需识别** | 新实体必须入库管理 | Data Agent 自动提取并消歧 |

### Strand Weave 节奏系统

| Strand | 含义 | 理想占比 | 说明 |
|--------|------|---------|------|
| **Quest** | 主线剧情 | 60% | 推动核心冲突 |
| **Fire** | 感情线 | 20% | 人物关系发展 |
| **Constellation** | 世界观扩展 | 20% | 背景/势力/设定 |

节奏红线：

- Quest 连续不超过 5 章
- Fire 断档不超过 10 章
- Constellation 断档不超过 15 章

## 总体架构图

```text
┌─────────────────────────────────────────────────────────────┐
│                     Codex Runtime                          │
├─────────────────────────────────────────────────────────────┤
│  Skills (7个): init / plan / write / review / query / ... │
├─────────────────────────────────────────────────────────────┤
│  Agents (8个): Context / Data / 多维 Checker               │
├─────────────────────────────────────────────────────────────┤
│  Data Layer: state.json / index.db / vectors.db            │
└─────────────────────────────────────────────────────────────┘
```

## 双 Agent 架构

### Context Agent（读）

职责：在写作前构建“创作任务书”，提供本章上下文、约束和追读力策略。

### Data Agent（写）

职责：从正文提取实体与状态变化，更新 `state.json`、`index.db`、`vectors.db`，保证数据链闭环。

## 六维并行审查

| Checker | 检查重点 |
|---------|---------|
| High-point Checker | 爽点密度与质量 |
| Consistency Checker | 设定一致性（战力/地点/时间线） |
| Pacing Checker | Strand 比例与断档 |
| OOC Checker | 人物行为是否偏离人设 |
| Continuity Checker | 场景与叙事连贯性 |
| Reader-pull Checker | 钩子强度、期待管理、追读力 |

## 实现对齐（2026-03-26）

> 本节仅同步仓库中已落地实现，计划态/目标态不在此声明为完成事实。

### 已实现目录结构（代码侧）

| 路径 | 角色 |
|------|------|
| `webnovel-writer/dashboard/app.py` | FastAPI 应用入口，注册 `/api/runtime`、`/api/skills`、`/api/settings/*`、`/api/outlines`、`/api/edit-assist` |
| `webnovel-writer/dashboard/routers/*.py` | 分模块路由层（runtime/skills/settings/outlines/edit_assist） |
| `webnovel-writer/dashboard/services/runtime/` | 运行时画像与迁移编排（profile + migrate） |
| `webnovel-writer/dashboard/services/skills/` | Skills 注册表 CRUD、启停、审计日志 |
| `webnovel-writer/dashboard/services/dictionary/` | 设定集文件树读取、词典抽离、冲突查询与处理 |
| `webnovel-writer/dashboard/services/split/` | 总纲拆分、重拆回退、顺序校验与幂等保护 |
| `webnovel-writer/dashboard/services/edit_assist/` | 协助修改 preview/apply/logs、版本冲突校验、失败回滚 |
| `webnovel-writer/scripts/data_modules/webnovel.py` | 统一 CLI 入口（where/preflight/dashboard/migrate 等） |
| `webnovel-writer/scripts/data_modules/skill_manager.py` | 独立 Skills CLI（list/add/update/enable/disable/remove/audit） |
| `webnovel-writer/dashboard/frontend/src/pages/*` | Skills/Settings/Outline 页面实现与 API 对接 |

### 已实现模块职责与关键落盘

| 模块 | 职责 | 实际落盘 |
|------|------|---------|
| Runtime | 返回 pointer/legacy 状态、迁移预览，执行迁移并返回报告路径 | `.webnovel/migrations/codex-migrate-*.json` |
| Skills | 技能元数据 CRUD、启停、删除、审计检索（过滤/分页） | `.webnovel/skills/registry.json`、`.webnovel/logs/skill-audit.jsonl` |
| Settings & Dictionary | 设定文件树/内容读取，词典抽离、冲突列表与冲突处理 | `.webnovel/dictionaries/setting-dictionary.json` |
| Outlines Split/Resplit | 拆分预览与落盘、重拆回退、顺序校验、幂等键回放 | `.webnovel/outlines/split-map.json`、`.webnovel/outlines/detailed-segments.jsonl`、`大纲/细纲.md` |
| Edit Assist | 选区改写预览、确认后应用、日志查询、版本冲突阻断与失败回滚 | `.webnovel/edits/assist-log.jsonl` |

### 已实现关键流程

1. Outline 拆分流程：`POST /split/preview` 仅返回建议片段，`POST /split/apply` 执行写入并记录 `idempotency`。
2. Outline 重拆流程：`POST /resplit/preview` 计算回退策略，`POST /resplit/apply` 执行回退+重拆+重排，写入 history。
3. Edit Assist 流程：`POST /preview` 生成 proposal，`POST /apply` 校验 `expected_version/selection_version` 后应用；冲突时返回 `409` 且记录失败日志。
4. Skills 流程：API 与 CLI 共用服务层；所有写操作记录到 `skill-audit.jsonl`。
5. Runtime 迁移流程：`GET /profile` 返回迁移预览，`POST /migrate` 支持 `dry_run` 并返回 `report_path`。

### 配置项、依赖与运行方式（已实现）

1. 工作区上下文参数统一使用 `workspace_id + project_root`；多个模块会做一致性校验，不匹配返回 `403`。
2. 路径安全使用 `safe_resolve`；写入侧使用文件锁与原子写（`filelock` + `security_utils.atomic_write_json`）。
3. Dashboard 启动方式：
   - `python webnovel-writer/scripts/webnovel.py --project-root <PROJECT_ROOT> dashboard --port 8765`
4. Skills CLI（当前实现）：
   - `python webnovel-writer/scripts/data_modules/skill_manager.py list --project-root <PROJECT_ROOT>`

### 无法确认

1. `split/resplit` 性能指标（如 p95 <= 10s）在当前仓库未发现实测报告，无法确认。
