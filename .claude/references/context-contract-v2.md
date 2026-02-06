# Context Contract v2

## 目的
- 为 `Context Agent`、`Writer`、`Review` 提供统一、可排序、可追踪的上下文契约。
- 在不破坏旧调用方的前提下，增强上下文稳定性与命中率。

## 输出结构
- 根字段保持兼容：`meta`、`sections`、`template`、`weights`。
- `meta` 新增：
  - `context_contract_version`: 固定为 `v2`
  - `ranker`: 当前排序器配置快照（用于复现）

## Section 排序规则
- `core.recent_summaries`
  - 主要按章节新近度排序（越近越高）
  - 含“钩子/悬念/反转/冲突”提示时额外加分
- `core.recent_meta`
  - 主要按章节新近度排序
  - 有 `hook` 的条目优先
- `scene.appearing_characters`
  - 综合新近度 + 出场频次排序
  - 带 `warning`（如 pending invalid）降权
- `story_skeleton`
  - 按新近度优先，兼顾摘要信息密度
- `alerts`
  - 优先 `critical/high` 或包含关键风险词的项

## 兼容性约束
- 不改变既有 key 名和字段语义。
- 仅重排列表顺序；内容不删改（除已有过滤逻辑）。
- 调用方若忽略 `meta.context_contract_version`，行为与 v1 等价。

## 推荐调用时机
- `Context Agent` 在 Step 1 聚合上下文时调用。
- `webnovel-write`、`webnovel-review` 开始阶段调用。
- 恢复流程（`webnovel-resume`）在 `detect` 后重建上下文时调用。

## 配置项（DataModulesConfig）
- `context_ranker_enabled`
- `context_ranker_recency_weight`
- `context_ranker_frequency_weight`
- `context_ranker_hook_bonus`
- `context_ranker_length_bonus_cap`
- `context_ranker_alert_critical_keywords`
- `context_ranker_debug`

