# Reference Loading Map

> 本文件记录当前 `skills/*/SKILL.md` 的实际 reference 消费关系。
> 口径：只登记 skill 明确要求直接读取的 md/template，以及明确调用 `reference_search.py` 或 `story-system` 间接消费的 CSV。
> 不登记普通项目数据读取，例如 `.webnovel/state.json`、`设定集/*.md`、`大纲/*.md`、`index.db`。

---

## 直接 Read 的 md/template

| Skill | 阶段 | 触发 | Reference |
|-------|------|------|-----------|
| webnovel-init | Step 1 | always | `skills/webnovel-init/references/system-data-flow.md` |
| webnovel-init | Step 1 | always | `skills/webnovel-init/references/genre-tropes.md` |
| webnovel-init | 卖点/题材采集 | always | `references/genre-profiles.md` |
| webnovel-init | Step 2 | 用户人物扁平 | `skills/webnovel-init/references/worldbuilding/character-design.md` |
| webnovel-init | Step 4 | always | `skills/webnovel-init/references/worldbuilding/faction-systems.md` |
| webnovel-init | Step 4 | 涉及修仙/玄幻/高武/异能 | `skills/webnovel-init/references/worldbuilding/power-systems.md` |
| webnovel-init | Step 4 | always | `skills/webnovel-init/references/worldbuilding/world-rules.md` |
| webnovel-init | Step 5 | always | `skills/webnovel-init/references/creativity/creativity-constraints.md` |
| webnovel-init | Step 5 | always | `skills/webnovel-init/references/creativity/selling-points.md` |
| webnovel-init | Step 5 | 复合题材 | `skills/webnovel-init/references/creativity/creative-combination.md` |
| webnovel-init | Step 5 | 卡顿 | `skills/webnovel-init/references/creativity/inspiration-collection.md` |
| webnovel-init | Step 5 | 题材映射命中 | `skills/webnovel-init/references/creativity/anti-trope-*.md` |
| webnovel-init | Step 6 | always | `skills/webnovel-init/references/worldbuilding/setting-consistency.md` |
| webnovel-plan | Step 4 | always | `templates/output/大纲-卷节拍表.md` |
| webnovel-plan | Step 5 | always | `templates/output/大纲-卷时间线.md` |
| webnovel-plan | Step 6 | always | `references/genre-profiles.md` |
| webnovel-plan | Step 6 | always | `references/shared/strand-weave-pattern.md` |
| webnovel-plan | 章纲拆分 | always | `references/outlining/plot-signal-vs-spoiler.md` |
| webnovel-plan | Step 6 | 需要爽点设计 | `references/shared/cool-points-guide.md` |
| webnovel-plan | Step 6/7 | 需要冲突设计 | `skills/webnovel-plan/references/outlining/conflict-design.md` |
| webnovel-plan | Step 7 | 需要追读力分析 | `references/reading-power-taxonomy.md` |
| webnovel-plan | Step 7 | 需要章纲细化 | `skills/webnovel-plan/references/outlining/chapter-planning.md` |
| webnovel-plan | Step 6/7 | 特定题材节奏 | `skills/webnovel-plan/references/outlining/genre-volume-pacing.md` |
| webnovel-write | Step 4 | always | `skills/webnovel-write/references/polish-guide.md` |
| webnovel-write | Step 4 | always | `skills/webnovel-write/references/writing/typesetting.md` |
| webnovel-write | Step 4 | always | `skills/webnovel-write/references/style-adapter.md` |
| webnovel-review | Step 2 | always | `references/shared/core-constraints.md` |
| webnovel-review | Step 2 | always | `references/review-schema.md` |
| webnovel-review | Step 2 | 审查涉及爽点或钩子分析 | `references/shared/cool-points-guide.md` |
| webnovel-review | Step 2 | 审查涉及多线交织 | `references/shared/strand-weave-pattern.md` |
| webnovel-review | Step 2 | ai_flavor issue >= 3 | `skills/webnovel-write/references/anti-ai-guide.md` |
| webnovel-review | Step 6 | blocking issue 需用户决策 | `references/review/blocking-override-guidelines.md` |
| webnovel-query | 查询识别后 | 所有查询 | `skills/webnovel-query/references/system-data-flow.md` |
| webnovel-query | 查询识别后 | 伏笔分析 | `skills/webnovel-query/references/advanced/foreshadowing.md` |
| webnovel-query | 查询识别后 | 节奏分析 | `references/shared/strand-weave-pattern.md` |
| webnovel-query | 查询识别后 | 格式查询 | `skills/webnovel-query/references/tag-specification.md` |

## CSV 检索：直接调用 `reference_search.py`

| Skill | 阶段 | 触发 | 实际调用 |
|-------|------|------|----------|
| webnovel-init | 角色/书名/势力设定 | 用户开始设定命名 | `--skill init --table 命名规则 --query "{命名对象} {题材}" --genre {题材}` |
| webnovel-plan | 卷级规划 | always | `--skill plan --table 场景写法 --query "卷级结构 叙事功能"` |
| webnovel-plan | 卷级规划 | 需要爽点/冲突设计 | `--skill plan --table 爽点与节奏 --query "{卷级核心冲突}" --genre "${GENRE}"` |
| webnovel-plan | 卷级规划 | 需要桥段模板 | `--skill plan --table 桥段套路 --query "{卷级核心冲突}" --genre "${GENRE}"` |
| webnovel-plan | 章纲拆分 | 新增角色出现 | `--skill plan --table 命名规则 --query "角色命名" --genre {题材}` |
| webnovel-write | Step 2 | 新角色首次出场 | `--skill write --table 命名规则 --query "角色命名" --genre {题材}` |
| webnovel-write | Step 2 | 战斗/对峙场景 | `--skill write --table 场景写法 --query "战斗描写" --genre {题材}` |
| webnovel-write | Step 2 | 多角色对话 | `--skill write --table 写作技法 --query "对话声线 口吻区分" --genre {题材}` |
| webnovel-write | Step 2 | 情感/心理描写 | `--skill write --table 写作技法 --query "情感描写 心理" --genre {题材}` |
| webnovel-write | Step 2 | 高频桥段 | `--skill write --table 场景写法 --query "{桥段类型}" --genre {题材}` |

## CSV 检索：`story-system` 间接消费

| 入口 Skill | 阶段 | 触发 | 间接消费 |
|------------|------|------|----------|
| webnovel-init | Story System 初始化 | init 完成后 `story-system "${GENRE}" --genre "${GENRE}" --persist --format json` | `题材与调性推理.csv` 路由；按路由的 `推荐基础检索表`/`推荐动态检索表` 检索基础表和动态表；`裁决规则.csv` 注入风格/节奏/毒点裁决 |
| webnovel-plan | runtime 合同刷新 | 规划直接落到具体章节时 `--persist --emit-runtime-contracts --chapter {chapter_num}` | 同上，并由 `RuntimeContractBuilder` 生成 volume/chapter/review 合同 |
| webnovel-write | 准备阶段 | 起草前 `--persist --emit-runtime-contracts --chapter {chapter_num}` | 同上；`chapter_{NNN}.json` 的 `chapter_focus` 仅作 CSV 参考，章节目标仍以章纲为准 |
| webnovel-review | Step 1 | 目标章缺 runtime 合同时补齐 | 同上；review 优先依据 `.story-system/reviews/chapter_{NNN}.review.json` 与 latest accepted commit |

`StorySystemEngine` 的真实数据流：

| 步骤 | 数据源 | 说明 |
|------|--------|------|
| `_route()` | `题材与调性推理.csv` | 根据 query、显式 genre、题材别名和 canonical genre 选路由 |
| `_collect_tables()` | 路由行推荐的基础/动态表 | 内部以 `skill="write"` 调 `reference_search.search()`，因此推荐表中的知识行需要匹配 write 可见性 |
| `_load_reasoning()` | `裁决规则.csv` | 按 canonical genre 读取风格优先级、节奏默认策略、毒点权重、冲突裁决 |
| `_apply_reasoning()` | 基础/动态检索结果 + 裁决规则 | 给结果加优先级，决定注入合同的排序 |
| `_rank_anti_patterns()` | 路由毒点 + 推荐表毒点 + 裁决反模式 | 合并并排序 `anti_patterns.json` |

## 无独立 reference 的 Skill

| Skill | 说明 |
|-------|------|
| webnovel-dashboard | 只读面板启动流程，不加载独立 reference；核心校验接口是 `/api/story-runtime/health` 与 `/api/preflight` |
| webnovel-learn | 只读 state 后追加 `.webnovel/project_memory.json`，不加载独立 reference 或 CSV |

## 当前非直接调用项

以下文件当前存在，但没有被当前 `SKILL.md` 明确要求直接加载；除非后续 skill 增加触发条件，否则不计入 direct loading map：

| 文件 | 现状 |
|------|------|
| `skills/webnovel-write/references/style-variants.md` | 未在当前 write 流程中直接加载 |
| `skills/webnovel-write/references/writing/combat-scenes.md` | 由 CSV `场景写法` 承担战斗触发，不直接 Read |
| `skills/webnovel-write/references/writing/dialogue-writing.md` | 由 CSV `写作技法` 承担对话触发，不直接 Read |
| `skills/webnovel-write/references/writing/emotion-psychology.md` | 由 CSV `写作技法` 承担情感触发，不直接 Read |
| `skills/webnovel-review/references/common-mistakes.md` | 未在当前 review 流程中直接加载 |
| `skills/webnovel-review/references/pacing-control.md` | 未在当前 review 流程中直接加载 |
