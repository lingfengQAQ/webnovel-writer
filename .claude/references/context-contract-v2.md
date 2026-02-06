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

## Phase B 扩展段
- `reader_signal`
  - 聚合最近章节追读力元数据（钩子/爽点/微兑现）
  - 聚合最近窗口的模式使用统计（`pattern_usage` / `hook_type_usage`）
  - 聚合审查趋势与低分区间（`review_trend` / `low_score_ranges`）
- `genre_profile`
  - 基于 `state.json -> project.genre` 自动选取题材策略片段
  - 引用 `.claude/references/genre-profiles.md` 与 `reading-power-taxonomy.md`
  - 输出 `reference_hints` 供 Writer 快速执行

## Phase C 扩展段
- `writing_guidance`
  - 基于 `reader_signal` + `genre_profile` 生成章节级执行建议
  - 优先提示低分区间修复、钩子差异化、爽点模式优化、题材锚定
  - 输出 `guidance_items` 与 `signals_used`

## 紧凑文本策略
- 当 section 超出预算时，文本采用紧凑截断（头部 + 截断标记 + 尾部）
- 截断标记固定为 `…[TRUNCATED]`
- 保留 `content` 原始结构，`text` 用于快速注入模型上下文

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

Phase B:
- `context_reader_signal_enabled`
- `context_reader_signal_recent_limit`
- `context_reader_signal_window_chapters`
- `context_reader_signal_review_window`
- `context_reader_signal_include_debt`
- `context_genre_profile_enabled`
- `context_genre_profile_max_refs`
- `context_genre_profile_fallback`

Phase C:
- `context_compact_text_enabled`
- `context_compact_min_budget`
- `context_compact_head_ratio`
- `context_writing_guidance_enabled`
- `context_writing_guidance_max_items`
- `context_writing_guidance_low_score_threshold`
- `context_writing_guidance_hook_diversify`

Phase E:
- `context_writing_checklist_enabled`
- `context_writing_checklist_min_items`
- `context_writing_checklist_max_items`
- `context_writing_checklist_default_weight`

Phase F:
- `context_writing_score_persist_enabled`
- `context_writing_score_include_reader_trend`
- `context_writing_score_trend_window`
- `writing_guidance.checklist_score` 写入 `index.db -> writing_checklist_scores`

Phase H:
- `context_dynamic_budget_enabled`
- `context_dynamic_budget_early_chapter`
- `context_dynamic_budget_late_chapter`
- 新增 `meta.context_weight_stage`（early/mid/late）

Phase I:
- `context_genre_profile_support_composite`
- `context_genre_profile_max_genres`
- `context_genre_profile_separators`
- 新增 `genre_profile.genres/composite/composite_hints`
