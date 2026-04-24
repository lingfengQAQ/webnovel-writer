# References 完善 Spec

> 文档状态：`implemented`（2026-04-16）
> 依赖：`2026-04-09-skills-restructure-and-reference-gaps.md`、`2026-04-12-story-system-evolution-spec.md`、`2026-04-14-ui-ux-pro-max-skill-architecture-research.md`
> 配套：`references/csv/genre-canonical.md`（题材权威枚举表）

## 完成记录

- Phase 1 结构层已完成：`CSV_CONFIG` 已补 `prefix` / `required_cols` / `contract_inject`，`validate_csv.py`、`references/README.md`、loading-map、gap-register 已落位。
- Phase 2 裁决层已完成：`题材与调性推理.csv` 已扩展到 26 行，`裁决规则.csv` 已扩展到 17 行，覆盖 15 个 canonical genre。
- 验证状态：`validate_csv.py --format json` 当前输出 0 errors / 0 warnings；相关 reference/story-system 测试通过。
- Phase 3 知识层补录未在本 spec 内继续扩大范围，后续缺口已登记到 `references/index/reference-gap-register.md`。

## 目标

把 `webnovel-writer/references/` 从"骨架已就位但裁决层极薄、缺少校验闭环"的状态，推进到"init → plan → write → review 全链路可依赖"的状态。

本 spec 不做知识条目补录——条目缺口另见 [附录 A](#附录-a知识条目缺口登记表)。本 spec 只解决结构、配置、校验、索引四类问题。

## 现状诊断

### 当前资产清单

```
references/
├── csv/                         # 9 张 CSV
│   ├── README.md                # schema 文档（人类可读）
│   ├── 命名规则.csv      (45 行)  # NR- | base
│   ├── 场景写法.csv      (52 行)  # SP- | base
│   ├── 写作技法.csv      (64 行)  # WT- | base
│   ├── 桥段套路.csv      (62 行)  # TR- | dynamic
│   ├── 人设与关系.csv    (58 行)  # CH- | base
│   ├── 爽点与节奏.csv    (60 行)  # PA- | dynamic
│   ├── 金手指与设定.csv  (59 行)  # SY- | base
│   ├── 题材与调性推理.csv  (8 行)  # GR- | route    ← 极薄
│   └── 裁决规则.csv        (7 行)  # RS- | reasoning ← 极薄
├── genre-profiles.md            # 题材 profile (已标记 fallback only)
├── reading-power-taxonomy.md    # 追读力分类
├── review-schema.md             # 审查输出 schema
├── index/
│   ├── reference-loading-map.md # skill→step→trigger→ref 映射
│   └── reference-gap-register.md# 基线缺口登记
├── outlining/
│   └── plot-signal-vs-spoiler.md
├── review/
│   └── blocking-override-guidelines.md
└── shared/
    ├── core-constraints.md
    ├── cool-points-guide.md
    ├── naming-and-voice-gaps.md
    └── strand-weave-pattern.md
```

### 代码侧已就位的配套设施

| 组件 | 位置 | 状态 |
|------|------|------|
| `CSV_CONFIG` 注册字典 | `reference_search.py:89-154` | ✅ 已存在，per-table `search_cols`/`output_cols`/`poison_col`/`role` |
| BM25 搜索 primitive | `reference_search.py:160-244` | ✅ |
| `StorySystemEngine._route()` | `story_system_engine.py:115-159` | ✅ 消费 `题材与调性推理.csv` |
| `StorySystemEngine._collect_tables()` | `story_system_engine.py:161-185` | ✅ 按 route 推荐表查询 |
| `StorySystemEngine._apply_reasoning()` | `story_system_engine.py:278-338` | ✅ 消费 `裁决规则.csv` |
| `RuntimeContractBuilder` | `runtime_contract_builder.py` | ✅ 读 MASTER + plot → volume_brief + review_contract |
| `ContextManager` | `context_manager.py` | ✅ 读 contracts + genre-profiles + state + summaries |

### 核心问题

| # | 问题 | 影响范围 | 严重度 |
|---|------|---------|--------|
| P1 | **裁决规则.csv 只有 7 条**（西方奇幻/东方仙侠/科幻末世/都市日常/悬疑惊悚/历史武侠/玄幻）。大量子流派无裁决规则，`_apply_reasoning()` 退化为无优先级排序 | write 全链路 | 高 |
| P2 | **题材与调性推理.csv 只有 8 条**（退婚流/规则怪谈/压抑后爆/赘婿流/系统流/无限流/重生流/宫斗流）。未覆盖的题材走 `default_seed_fallback`，路由退化 | init → write 全链路 | 高 |
| P3 | **无校验脚本**。编号唯一性、前缀一致性、必填列、分隔符规范、列头与 README 对齐——全靠人工自觉 | 数据质量 | 中 |
| P4 | **CSV_CONFIG 与 README.md 存在双源漂移风险**。README 定义的 schema 和代码里的 `CSV_CONFIG` 没有自动化校验保证对齐 | 维护成本 | 中 |
| P5 | **`reference-loading-map.md` 与实际 skill 实现有偏移**。部分 skill 已新增/修改 reference 触发条件，map 未同步 | 可审查性 | 低 |
| P6 | **`references/` 目录缺顶层 README**。新读者无法快速理解 csv vs md vs index vs shared 的边界 | 可读性 | 低 |
| P7 | **CSV_CONFIG 缺少 `contract_inject` 字段**。裁决规则有 `contract注入层` 列，但 CSV_CONFIG 没有声明这个映射关系，注入点散落在 engine 代码中 | 可审查性 | 低 |

---

## 全链路 Reference 消费分析

### init 阶段

```
用户输入题材/卖点
  → Read genre-tropes.md, genre-profiles.md
  → Read worldbuilding/*.md (faction, world-rules, power-systems, character-design)
  → Read creativity/*.md (constraints, selling-points, combination, inspiration)
  → CSV: 命名规则 (--skill init --query "{object} {genre}")
  → story-system CLI (--persist, MASTER_SETTING only)
      → StorySystemEngine._route()    消费 题材与调性推理.csv
      → StorySystemEngine._collect()  消费 推荐的 base/dynamic 表
      → StorySystemEngine._reason()   消费 裁决规则.csv
  → 输出: .story-system/MASTER_SETTING.json + anti_patterns.json
```

**init 对 references 的需求**：
- 题材路由必须命中——用户在 init 时给出的题材/流派/标签是整个系统的起点
- 如果 `题材与调性推理.csv` 没有匹配行，MASTER_SETTING 的 `core_tone`、`pacing_strategy`、推荐表列表全部为空或退化
- 如果 `裁决规则.csv` 没有匹配行，anti_patterns 缺少 `反模式` 和 `毒点权重`

### plan 阶段

```
用户输入卷/章规划
  → Read genre-profiles.md, strand-weave-pattern.md
  → Read plot-signal-vs-spoiler.md
  → Read cool-points-guide.md (按需)
  → Read reading-power-taxonomy.md (按需)
  → Read outlining/*.md (conflict-design, chapter-planning, genre-volume-pacing)
  → CSV: 场景写法 (--skill plan --query "卷级结构 叙事功能")
  → CSV: 命名规则 (新角色命名时)
  → CSV: 爽点与节奏 (冲突设计时)
  → CSV: 桥段套路 (冲突设计时)
  → story-system CLI (--emit-runtime-contracts)
      → RuntimeContractBuilder.build_for_chapter()
  → 输出: volume_brief + review_contract
```

**plan 对 references 的需求**：
- 卷级规划需要从 `场景写法` 和 `爽点与节奏` 获取结构性指导
- `桥段套路` 在冲突设计时提供可选套路模板
- 命名规则在新角色出场时触发
- plan 阶段的 outlining 子目录目前只有 `plot-signal-vs-spoiler.md`，但 skill 引用了 `conflict-design.md`、`chapter-planning.md`、`genre-volume-pacing.md`（均为 skill-local references）

### write 阶段

```
context-agent 组装写作任务书
  → ContextManager.build_context()
      → 读 .story-system/ 下所有 contracts
      → 读 genre-profiles.md (fallback)
      → 读 reading-power-taxonomy.md
      → 读 设定集/*.md
      → 读 state.json, summaries, outlines, index.db
  → 输出: JSON context pack

Step 2 (起草)
  → Read core-constraints.md
  → CSV: 命名规则 (新角色)
  → CSV: 场景写法 (战斗/对峙)
  → CSV: 写作技法 (对话/情感)
  → CSV: 场景写法 (高频桥段)

Step 3 (审查)
  → Read review-schema.md, core-constraints.md
  → Read cool-points-guide.md (按需)
  → Read strand-weave-pattern.md (按需)
  → Read blocking-override-guidelines.md (按需)

Step 4 (润色)
  → Read polish-guide.md, typesetting.md, style-adapter.md
  → Read anti-ai-guide.md (ai_flavor issue 存在)
```

**write 对 references 的需求**：
- contracts（来自 init + plan 的持久化产物）是第一真源
- CSV 在 Step 2 按条件触发，是对 contract 的补充
- md references 在 Step 3-4 是流程闸门和润色指南
- 如果 init 阶段的 MASTER_SETTING 因路由/裁决空缺而质量差，这里的 contracts 就质量差

### review 阶段

```
  → Read core-constraints.md, review-schema.md
  → Read blocking-override-guidelines.md (blocking issue)
  → Read cool-points-guide.md (爽点分析)
  → Read strand-weave-pattern.md (多线审查)
  → Read anti-ai-guide.md (ai_flavor >= 3)
```

**review 对 references 的需求**：
- 纯 md 消费，不直接查 CSV
- 依赖 review_contract（来自 plan 阶段的 RuntimeContractBuilder）
- 如果 review_contract 的 `genre_specific_risks` 空缺，genre-specific 审查项缺失

---

## 设计决策

### D1: 裁决规则.csv 的补全策略

**目标**：覆盖 `genre-profiles.md` 中定义的全部高频题材 + `题材与调性推理.csv` 中出现的全部流派。

**当前覆盖**（7 条）：西方奇幻、东方仙侠、科幻末世、都市日常、悬疑惊悚、历史武侠、玄幻

**需要新增**（至少）：

| 题材 | 理由 |
|------|------|
| 系统流 | `题材与调性推理.csv` 已有路由 GR-005，但裁决规则无对应 |
| 无限流 | 同上 GR-006 |
| 重生流 | 同上 GR-007 |
| 宫斗/权谋 | 同上 GR-008 |
| 现代言情 | 女频高频题材，当前完全空缺 |
| 古代言情 | 同上 |
| 轻小说 | 番茄分类中的独立题材 |
| 游戏/电竞 | 番茄分类中的独立题材 |

**方法**：人工逐条编写。每条裁决行需要填写：`风格优先级`、`爽点优先级`、`节奏默认策略`、`毒点权重`、`冲突裁决`、`contract注入层`、`反模式`。

**硬约束**：裁决规则内容必须人工提炼，禁止程序生成。

### D2: 题材与调性推理.csv 的补全策略

**目标**：覆盖用户在 init 阶段可能输入的全部常见题材/流派/标签组合。

**当前覆盖**（8 条）：退婚流、规则怪谈、压抑后爆、赘婿流、系统流、无限流、重生流、宫斗流

**需要新增**：参见 [附录 A](#附录-a知识条目缺口登记表) 中的 `题材与调性推理` 缺口表。

**关键原则**：`题材别名` 列要充分——这是路由命中率的关键。一个流派的常见叫法、黑话、俗语都应该作为别名录入。

### D3: CSV_CONFIG 增强

在 `reference_search.py` 的 `CSV_CONFIG` 中为每张表补充：

```python
"裁决规则": {
    "file": "裁决规则.csv",
    "search_cols": {"题材": 4},
    "output_cols": [...],
    "poison_col": "",
    "role": "reasoning",
    # ---- 新增 ----
    "contract_inject": "CHAPTER_BRIEF.writing_guidance",  # 注入目标
    "prefix": "RS",                                        # 编号前缀
    "required_cols": ["题材", "风格优先级", "爽点优先级",     # 必填列
                      "节奏默认策略", "毒点权重", "冲突裁决"],
},
```

新增字段说明：

| 字段 | 用途 |
|------|------|
| `contract_inject` | 声明该表的检索结果最终注入 contract 的哪个位置，使注入点从散落在 engine 代码中收束到注册层 |
| `prefix` | 编号前缀，供校验脚本验证一致性 |
| `required_cols` | 必填列清单，供校验脚本检查非空 |

### D4: 校验脚本设计

新增 `scripts/validate_csv.py`，检查项：

| 检查项 | 规则 | 退出码 |
|--------|------|--------|
| 编号唯一性 | 所有 CSV 中 `编号` 列全局唯一 | 1 |
| 前缀一致性 | 每张表的编号前缀必须与 `CSV_CONFIG[table].prefix` 匹配 | 1 |
| 必填列非空 | `CSV_CONFIG[table].required_cols` + 通用必填列（编号/适用技能/分类/层级/关键词/适用题材/核心摘要）不为空 | 1 |
| 分隔符规范 | `适用技能`/`关键词`/`意图与同义词`/`适用题材` 中不含中文逗号 `，` | 1 |
| 列头对齐 | CSV 文件的实际列头是 `CSV_CONFIG[table].search_cols` + `output_cols` + `required_cols` 的超集 | 1 |
| 适用题材范围 | `适用题材` 值（拆分后）在番茄分类范围内，或为 `全部` | 警告 |
| 路由覆盖 | 每条 `裁决规则.csv` 的 `题材` 在 `题材与调性推理.csv` 中至少有一条对应行 | 警告 |
| 裁决覆盖 | 每条 `题材与调性推理.csv` 的 `题材/流派` 在 `裁决规则.csv` 中至少有一条对应行 | 警告 |

脚本从 `CSV_CONFIG` 读取元数据，不硬编码表名或列名。

### D5: 顶层 README

在 `references/README.md` 新增目录级索引：

```markdown
# References

## 目录结构

| 子目录/文件 | 职责 | 消费方式 |
|-------------|------|----------|
| `csv/` | 结构化知识条目 | `reference_search.py` BM25 检索 |
| `csv/README.md` | CSV schema 规范 | 人工参考 |
| `genre-profiles.md` | 题材 profile (fallback) | ContextManager 直接 Read |
| `reading-power-taxonomy.md` | 追读力分类学 | Skills 直接 Read |
| `review-schema.md` | 审查输出格式 | webnovel-review Read |
| `index/` | 元数据索引 | 人工参考 |
| `outlining/` | 大纲相关参考 | webnovel-plan Read |
| `review/` | 审查相关参考 | webnovel-review Read |
| `shared/` | 跨 skill 共享参考 | 多 skill Read |

## md vs CSV 边界

- **md**：流程规范、方法论、审查 schema、硬约束、润色指导
- **CSV**：可条目化的写作知识、命名规则、场景技法、桥段模板

## 消费链路

init → plan → write → review 的完整 reference 消费路径见
`index/reference-loading-map.md`。
```

### D6: reference-loading-map 同步

对照实际 skill 文件更新 `index/reference-loading-map.md`，补充：

- webnovel-plan 引用的 skill-local references（`conflict-design.md`、`chapter-planning.md`、`genre-volume-pacing.md`）
- webnovel-init 引用的 worldbuilding 和 creativity 子目录中的全部条件加载项
- webnovel-write 通过 `StorySystemEngine` 间接消费的 CSV 表

### D7: reference-gap-register 更新

当前 gap register 中部分项已完成但未标记，需要刷新：

- `blocking-override-guidelines.md` → 已创建 ✅
- `plot-signal-vs-spoiler.md` → 已创建 ✅
- `naming-and-voice-gaps.md` → 已创建 ✅
- 三张初始 CSV（命名规则/场景写法/写作技法）→ 已创建 ✅
- 追加当前 spec 新发现的缺口

### D8: shared md 条目迁移审查

对 `shared/` 下的 md 进行内容审查，判断是否有可迁移到 CSV 的条目：

| 文件 | 处置建议 |
|------|---------|
| `core-constraints.md` | **保留原样**——流程硬约束，不适合条目化 |
| `strand-weave-pattern.md` | **保留原样**——方法论型（三线比例/警告规则），不是条目库 |
| `cool-points-guide.md` | **审查**——其中"六种爽点执行模式"和"打脸四步法"可能提炼为 `爽点与节奏.csv` 条目，但"信息不对称设计"和"密度指南"保留 md |
| `naming-and-voice-gaps.md` | **审查**——其中"题材命名风格表"和"口吻区分表"可能提炼为 `命名规则.csv`/`写作技法.csv` 条目，但"缺陷补偿策略"段保留 md |

审查结果记入 [附录 A](#附录-a知识条目缺口登记表)，实际迁移留待后续执行。

---

## 实施计划

### Phase 1: 结构层（不涉及内容填充）

| 任务 | 产出 | 依赖 |
|------|------|------|
| 1.1 CSV_CONFIG 增强 | `reference_search.py` 中每张表补 `contract_inject`/`prefix`/`required_cols` | 无 |
| 1.2 校验脚本 | `scripts/validate_csv.py` | 1.1 |
| 1.3 顶层 README | `references/README.md` | 无 |
| 1.4 loading-map 同步 | `index/reference-loading-map.md` 更新 | 无 |
| 1.5 gap-register 刷新 | `index/reference-gap-register.md` 更新 | 无 |

### Phase 2: 裁决层补厚（人工内容填充）

| 任务 | 产出 | 依赖 |
|------|------|------|
| 2.1 裁决规则.csv 补全 | 从 7 条扩至 15+ 条 | 附录 A 缺口表 |
| 2.2 题材与调性推理.csv 补全 | 从 8 条扩至 20+ 条 | 附录 A 缺口表 |
| 2.3 校验脚本通过 | `validate_csv.py` 全量通过 | 1.2, 2.1, 2.2 |

### Phase 3: 知识层补充（人工内容填充）

| 任务 | 产出 | 依赖 |
|------|------|------|
| 3.1 shared md 审查 | 标记可迁移条目 | D8 |
| 3.2 可迁移条目手工录入 CSV | 相关 CSV 新增条目 | 3.1 |
| 3.3 7 张知识表查漏 | 基于全链路分析补充遗漏主题 | 附录 A |

### Phase 4: 验证

| 任务 | 产出 | 依赖 |
|------|------|------|
| 4.1 端到端冒烟测试 | 对 3 个不同题材执行 `story_system.py`，验证 route → collect → reason 全链路不退化 | 2.3 |
| 4.2 loading-map 回归 | 对照更新后的 map，逐条验证 skill 实际加载行为 | 1.4 |

---

## 附录 A：知识条目缺口登记表

> 本附录只登记缺口，不做内容填充。所有内容必须人工逐条编写。

### A1: 题材与调性推理.csv 缺口

当前 8 条覆盖：退婚流、规则怪谈、压抑后爆、赘婿流、系统流、无限流、重生流、宫斗流。

| 缺失题材/流派 | 优先级 | 理由 |
|---------------|--------|------|
| 穿越流（男频/女频） | P0 | 高频流派，影响古言/历史/玄幻多种题材路由 |
| 都市异能 | P0 | 与"都市日常"的裁决规则完全不同（有战斗、有体系） |
| 修真/仙侠（区分东方仙侠大类的传统修真子类） | P1 | 修炼-斗法-宗门-天劫 有独立节奏 |
| 末世求生 | P1 | 区分于"科幻末世"——不一定有科幻要素 |
| 甜宠/轻甜 | P1 | 女频主流，当前完全无路由 |
| 悬疑推理 | P1 | 区分于"悬疑惊悚"——强调逻辑链和信息控制 |
| 种田/经营 | P2 | 近年热门流派（男频种田、女频种田） |
| 娱乐圈 | P2 | 女频热门 |
| 体育竞技 | P2 | 番茄分类独立题材 |
| 克苏鲁/诡秘 | P2 | 近年热门，有独特节奏和裁决需求 |
| 学院流 | P3 | 横跨多题材的通用叙事结构 |
| 副本流 | P3 | 与无限流相近但有差异 |

### A2: 裁决规则.csv 缺口

当前 7 条覆盖：西方奇幻、东方仙侠、科幻末世、都市日常、悬疑惊悚、历史武侠、玄幻。

原则：`裁决规则.csv` 的粒度是**大题材类型**，不是子流派——子流派差异由 `题材与调性推理.csv` 的路由参数处理。

| 缺失题材 | 优先级 | 理由 |
|----------|--------|------|
| 现代言情 | P0 | 女频最大流量入口，裁决逻辑（情感驱动 > 冲突驱动）与当前全部男频裁决不同 |
| 古代言情 | P0 | 古言特有的身份/礼教/宫廷约束需要独立裁决 |
| 系统流/游戏化 | P0 | `题材与调性推理` 已路由到此，但裁决层无对应——数值、面板、升级构成独立裁决维度 |
| 轻小说 | P1 | 番茄分类独立题材，二次元审美/节奏/爽点逻辑独特 |
| 游戏/电竞 | P1 | 赛事结构+团队配合+技术描写有独立裁决需求 |
| 种田/日常经营 | P2 | 低冲突高积累型叙事，与当前所有裁决模式不同 |
| 克苏鲁/诡秘 | P2 | 未知恐惧+信息限制+理智值裁决 |

### A3: 7 张知识表缺口审查

> 此部分需要对每张表的现有条目做覆盖度分析后填写。当前为初始框架。

#### 命名规则.csv (45 行)

| 缺失主题 | 优先级 | 来源线索 |
|----------|--------|---------|
| 女频命名规范（古言/现言/甜宠） | P1 | 当前条目偏男频 |
| 势力/组织命名（宗门/帮派/公司/家族） | P1 | 只有角色和地点，缺组织实体 |
| 书名/标题命名规则 | P2 | gap-register 曾提及但延迟 |

#### 场景写法.csv (52 行)

| 缺失主题 | 优先级 | 来源线索 |
|----------|--------|---------|
| 日常/种田/经营场景 | P1 | 当前偏战斗/对峙 |
| 言情核心场景（暧昧/误会/重逢/分手） | P1 | 女频主线场景空缺 |
| 悬疑推理场景（线索发现/推理对质/真相揭露） | P2 | |

#### 写作技法.csv (64 行)

| 缺失主题 | 优先级 | 来源线索 |
|----------|--------|---------|
| 信息控制技法（悬念设置/信息差/视角限制） | P1 | 悬疑/推理/诡秘类需要 |
| 甜宠/糖分技法（心动描写/CP 互动设计） | P1 | 女频需求 |
| 幽默/吐槽技法（轻小说/都市轻喜剧） | P2 | |

#### 桥段套路.csv (62 行)

| 缺失主题 | 优先级 | 来源线索 |
|----------|--------|---------|
| 女频经典桥段（替嫁/冲喜/和离/重生复仇） | P1 | 完全空缺 |
| 系统流桥段（首次激活/隐藏任务/系统升级） | P1 | |
| 悬疑桥段（密室/不在场证明/真凶反转） | P2 | |

#### 人设与关系.csv (58 行)

| 缺失主题 | 优先级 | 来源线索 |
|----------|--------|---------|
| 女频核心人设（白月光/绿茶/霸总/病娇/竹马） | P1 | |
| 团队/CP 关系模板（搭档/对手/师徒） | P2 | |

#### 爽点与节奏.csv (60 行)

| 缺失主题 | 优先级 | 来源线索 |
|----------|--------|---------|
| 女频爽点类型（打脸白莲花/甜蜜暴击/身份揭露） | P1 | |
| 种田/经营类积累爽点 | P2 | |
| cool-points-guide.md 中可迁移的执行模式条目 | P2 | D8 审查结果 |

#### 金手指与设定.csv (59 行)

| 缺失主题 | 优先级 | 来源线索 |
|----------|--------|---------|
| 女频金手指（空间/药园/前世记忆/读心术） | P1 | |
| 非战斗型金手指（鉴定/制造/交易/信息） | P2 | |

### A4: shared md 可迁移条目审查

> 待 Phase 3 审查后填写。

| 源文件 | 可迁移段落 | 目标 CSV | 预估条目数 | 状态 |
|--------|-----------|---------|-----------|------|
| `cool-points-guide.md` | 待审查 | `爽点与节奏.csv` | - | 未开始 |
| `naming-and-voice-gaps.md` | 待审查 | `命名规则.csv` / `写作技法.csv` | - | 未开始 |

---

## 验收标准

| 阶段 | 验收条件 |
|------|---------|
| Phase 1 完成 | `validate_csv.py` 可运行，当前数据全部通过（warnings 允许，errors 不允许）；`references/README.md` 存在；loading-map 与实际 skill 一致 |
| Phase 2 完成 | `裁决规则.csv` ≥ 14 条；`题材与调性推理.csv` ≥ 16 条；`validate_csv.py` 零 warning；3 个不同题材的 `story_system.py` 端到端不退化 |
| Phase 3 完成 | shared md 审查完毕，可迁移条目已录入 CSV；7 张知识表 P1 缺口已补 |
| Phase 4 完成 | 全链路冒烟测试通过；loading-map 回归通过 |
