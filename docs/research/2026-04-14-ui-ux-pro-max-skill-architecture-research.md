# UI/UX Pro Max Skill 架构调研报告

> 文档状态：`draft`（2026-04-14）

## 文档目标

本文档调研 `ui-ux-pro-max` skill 的真实工程结构，重点回答四个问题：

- 它不是一个单文件 prompt，那它到底是什么结构
- 它为什么能稳定工作，而不是只靠文案堆砌
- 其中哪些思想和架构值得 `webnovel-writer` 学习
- 哪些做法可以借鉴，哪些不能直接照搬

说明：

- 本次调研基于本地源码目录  
  `C:\Users\lcy\.gemini\tmp\webnovel-writer\ui-ux-pro-max-skill\src\ui-ux-pro-max`
- 调研目标不是做逐文件复述，而是提炼其可迁移的系统设计
- 结论将服务于后续 `references/csv` 与 `story-system` 的收束型 spec

## 一句话结论

`ui-ux-pro-max` 能工作的核心，不是”提示词写得长”，而是它把 skill 做成了一个 **外置知识库 + 通用检索内核 + 上层推理聚合器 + 持久化主文件/覆盖文件 + 平台分发适配** 的小型知识系统。

我们真正缺的不是聚合器（`StorySystemEngine` 已经承担了这个角色），而是一套**显式、结构化、可审查的裁决层**——当前很多裁决逻辑仍散落在 engine 代码、CSV、context_manager 和 skill 文本里，还没有被收束成独立的配置层。

对我们最值得学习的，不是 UI 数据本身，而是这五个架构动作：

1. 把知识从 prompt 文本里拆到结构化表
2. 用统一检索 primitive 查询不同知识域
3. 用显式 reasoning 层把”查到什么”变成”最后该怎么裁决”
4. 把运行时结果落成 `Master + Override` 层级真源
5. 把平台差异收束到模板/元数据层，而不是污染主知识层

但有一个关键区别必须前置：`ui-ux-pro-max` 本质上是一套”查询时聚合”的准静态知识系统，它的知识域（风格、配色、字体、技术栈 best practices）不会随运行时事件演进。而我们的故事系统会——角色状态、关系、设定、世界规则都随章节提交持续变化。这意味着即使完整复刻它的前四层，仍然还要额外解决 `Chapter Commit Layer` 与 `Projection Layer` 的运行时演进问题。

## 调研范围

本次重点查看了以下内容：

- `scripts/core.py`
- `scripts/design_system.py`
- `scripts/search.py`
- `data/*.csv`
- `data/stacks/*.csv`
- `data/_sync_all.py`
- `templates/base/*.md`
- `templates/platforms/*.json`

## 它的真实系统分层

从目录结构看，`ui-ux-pro-max` 至少有三层物理结构，加一条独立运行路径：

```text
ui-ux-pro-max/
├── data/        # 结构化知识库
├── scripts/     # 检索、推理、聚合、持久化
└── templates/   # skill 内容模板、平台安装元数据
```

运行路径则是：

```text
query
  -> search.py
  -> core.py / design_system.py
  -> 结构化输出或持久化产物
```

### 1. 数据层：不是一张大表，而是“主题表 + 推理表 + 技术栈表”

它的数据层明显分了三类：

#### 1.1 主题知识表

例如：

- `styles.csv`
- `colors.csv`
- `charts.csv`
- `landing.csv`
- `products.csv`
- `ux-guidelines.csv`
- `typography.csv`
- `icons.csv`
- `react-performance.csv`
- `app-interface.csv`
- `google-fonts.csv`

这些表并不追求统一成一个超大表，而是按“知识域”拆分。  
对应证据见：

- `scripts/core.py:17`
- `scripts/core.py:18`
- `scripts/core.py:68`

其关键特点是：

- 每个 domain 有独立 `file`
- 每个 domain 有独立 `search_cols`
- 每个 domain 有独立 `output_cols`

也就是说，它不是“查整张表”，而是为每类知识定义了**检索字段**和**展示字段**。

#### 1.2 推理表

它额外有一张 `ui-reasoning.csv`，不承担原始知识条目职责，而是承担：

- 类别到模式的映射
- 风格优先级
- 关键 effect
- 反模式
- decision rules

证据见：

- `scripts/design_system.py:24`
- `scripts/design_system.py:43`
- `scripts/design_system.py:88`

这很关键：  
它把“检索结果”和“最终裁决”分开了。

#### 1.3 技术栈表

它还单独维护：

- `data/stacks/react.csv`
- `data/stacks/nextjs.csv`
- `data/stacks/vue.csv`
- `data/stacks/react-native.csv`
- `data/stacks/threejs.csv`
  等 16 张表

这些不是产品知识，而是**实现层 best practices**。

证据见：

- `scripts/core.py:75`
- `scripts/core.py:95`
- `data/stacks/react.csv`

这说明它的数据分层并不是按文件类型，而是按职责分层：

- 产品/风格/颜色/字体等“设计知识”
- reasoning“裁决知识”
- stack“实现知识”

## 运行时架构

### 2. 通用检索内核：一个 BM25 primitive 服务全部 domain

`core.py` 的核心并不复杂，但架构很干净：

1. `CSV_CONFIG` 注册 domain
2. `_load_csv()` 统一读表
3. `_search_csv()` 统一走 BM25
4. `search()` 做 domain 查询
5. `search_stack()` 做 stack 查询

证据见：

- `scripts/core.py:17`
- `scripts/core.py:166`
- `scripts/core.py:221`
- `scripts/core.py:243`

这里最值得学习的不是 BM25 本身，而是：

- 所有 domain 共用一个搜索 primitive
- 变化点全部下沉到配置表
- 脚本层只关心“读哪张表、查哪些列、吐哪些列”

这让它的数据表可以持续增加，而不用每加一张表就重写一套逻辑。

关键摘录如下：

```python
CSV_CONFIG = {
    "style": {
        "file": "styles.csv",
        "search_cols": [...],
        "output_cols": [...]
    },
    "color": {
        "file": "colors.csv",
        "search_cols": [...],
        "output_cols": [...]
    },
}
```

这里也要顺手校准我们当前实现和它的真实差距。  
`webnovel-writer/scripts/reference_search.py` 目前仍然是**全局硬编码字段**，而不是 per-domain 注册：

```python
_SEARCH_FIELD_WEIGHTS = {
    "意图与同义词": 4,
    "关键词": 3,
    "核心摘要": 2,
    "详细展开": 1,
}

_CONTENT_COLUMNS = [
    "技法名称", "桥段名称", "人设类型", ...
]
```

这意味着当前更准确的对应关系不是  
`core.py -> reference_search.py`，而是：

- `core.py -> reference_search.py + 尚未存在的 CSV_CONFIG 注册层`

### 3. 自动域识别：先判“查哪类知识”

`detect_domain()` 用关键词表先做 domain 猜测，再决定默认查什么。

证据见：

- `scripts/core.py:198`
- `scripts/core.py:202`
- `scripts/core.py:216`

这一步虽然简单，但很有启发：

- skill 不要求调用者总是显式指定表
- 系统先把自然语言问题归类到知识域
- 再进统一检索

对我们来说，这对应的是：

- 题材输入路由
- 任务意图到知识表映射
- 写前不同 step 的表选择

### 4. 上层聚合器：不是“查完就返回”，而是“查完再推理再组装”

`design_system.py` 才是这个 skill 真正的中枢。

其逻辑顺序是：

1. 先查 `product`
2. 从 `product` 结果得到 category
3. 用 `ui-reasoning.csv` 找对应 reasoning rule
4. 带着 `style_priority` 做多 domain 检索
5. 从 style / color / typography / landing 中挑最佳项
6. 组装成统一 `design_system` 字典

证据见：

- `scripts/design_system.py:51`
- `scripts/design_system.py:64`
- `scripts/design_system.py:88`
- `scripts/design_system.py:163`
- `scripts/design_system.py:197`

这比单纯 `reference_search` 高了一层，因为它已经不是“返回搜索命中项”，而是：

- 有路由
- 有裁决
- 有优先级
- 有最终统一输出对象

这其实已经很接近一个轻量 contract 生成器。

## 持久化架构

### 5. Master + Overrides：把运行时结果落成层级真源

它的另一个关键设计是：  
运行时生成的设计系统可以被持久化为：

- `design-system/<project>/MASTER.md`
- `design-system/<project>/pages/<page>.md`

证据见：

- `scripts/search.py:13`
- `scripts/design_system.py:561`
- `scripts/design_system.py:589`
- `scripts/design_system.py:612`
- `scripts/design_system.py:886`

这套模式的意义非常大：

- `MASTER.md` 承担全局真源
- `pages/*.md` 只记录局部偏离
- 覆盖关系是显式的，不是隐式拼接

这和我们现在的 Story System 其实是同构的：

- `MASTER_SETTING` ≈ `MASTER.md`
- `VOLUME / CHAPTER / REVIEW contract` ≈ `page override`

也就是说，`ui-ux-pro-max` 的核心思想并不是 UI 专属，而是：

- 先统一主真源
- 再允许局部覆盖
- 覆盖必须被显式表达

## 分发与平台适配

### 6. 平台元数据与 skill 内容是分开的

`templates/platforms/*.json` 说明它不是只为一个 agent 平台准备的。

例如：

- `templates/platforms/claude.json`
- `templates/platforms/codex.json`
- `templates/platforms/gemini.json`

这些 JSON 负责定义：

- 安装根目录
- skillPath
- frontmatter
- title / description
- 是否附带 quickReference

证据见：

- `templates/platforms/claude.json`
- `templates/platforms/codex.json`
- `templates/platforms/gemini.json`

这意味着它把三类东西彻底分开了：

1. **知识内容**
2. **运行时逻辑**
3. **平台适配壳**

这是一个非常值得抄的边界。

## 数据维护策略

### 7. 它允许工程脚本维护一致性，但不把脚本当 runtime 主逻辑

`data/_sync_all.py` 的作用很明确：

- 同步 `products.csv`、`colors.csv`、`ui-reasoning.csv`
- 处理 rename / remove / add
- 衍生一些默认配色与 reasoning 行

证据见：

- `data/_sync_all.py:1`
- `data/_sync_all.py:63`
- `data/_sync_all.py:136`

这个脚本说明它有“离线数据维护流水线”，而不是在 runtime 临时 patch 数据。

但这部分对我们要谨慎学习：

- **可以学它的“离线校验/同步”思想**
- **不能照抄它的“程序生成内容”方式**

因为我们的硬约束是：

- `md -> csv` 知识迁移必须人工完成
- 禁止自动抽取、自动翻译、自动拆句入库

所以对我们来说，应当保留：

- schema 校验脚本
- 编号唯一性校验
- 别名覆盖校验
- 路由表与规则表一致性校验

但不能写：

- 自动从 md 批量生成故事知识条目

## 对我们最值得迁移的思想

### 8. 我们应该学的，不是 UI 数据，而是把它映射进我们的六层主链

为避免和 `story-system-evolution-spec.md` 的六层术语打架，后文统一按 `evolution-spec 6.1` 的六层来描述迁移：

```text
Knowledge Layer
    -> Reasoning Layer
        -> Contract Layer
            -> Runtime Assembly Layer
                -> Chapter Commit Layer
                    -> Projection Layer
```

`ui-ux-pro-max` 主要覆盖的是前四层，加上一套 `MASTER.md + page override` 的持久化真源；  
而我们的故事系统还必须额外补上 `Chapter Commit` 和 `Projection`，因为知识会随章节运行时演进。

映射到我们项目里，更准确的对照应是：

| `evolution-spec` 六层 | `ui-ux-pro-max` 参照物 | `webnovel-writer` 现状 / 目标 | 当前完成度 |
|------|------|------|------|
| `Knowledge Layer` | `products.csv`、`styles/colors/...`、stack tables | `references/csv` 基础表、动态表、路由基础表 | 已有基础骨架：7 张规则表、路由表、README schema 已在位 |
| `Reasoning Layer` | `core.py` 的 `CSV_CONFIG + detect_domain()`，以及 `design_system.py` 的 reasoning rule | `题材与调性推理.csv`、`StorySystemEngine._route()`、未来显式 `CSV_CONFIG` 与 reasoning config | 半成品：已有 route 与 engine 裁决，但还没抽成显式配置层 |
| `Contract Layer` | `design_system` 统一对象与 `MASTER.md/pages/*.md` | `MASTER_SETTING / VOLUME_BRIEF / CHAPTER_BRIEF / REVIEW_CONTRACT / anti_patterns` | 已接上主骨架：`engine.build()` 可产出 `MASTER/CHAPTER/ANTI`，`RuntimeContractBuilder` 可产出 `VOLUME/REVIEW` |
| `Runtime Assembly Layer` | 生成页面时“先 page override，再 MASTER”的装配逻辑 | `context_manager(contract-first)` 与运行时上下文装配 | 半成品：`context_manager` 已读 runtime contracts，但整体仍是运行时装配器，尚未完全收束到 contract-first SSOT |
| `Chapter Commit Layer` | 无完整对应；UI/UX skill 没有事件提交主链 | `CHAPTER_COMMIT` + `override ledger` | 已接线待治理：`ChapterCommitService` 已能生成 commit、写 event log、触发 amend proposal 与 projection writers，但 rejected/backlog 治理仍未完全闭合 |
| `Projection Layer` | 无完整对应；没有状态投影链 | `state / index / summaries / memory / dashboard` | 已接线待降级：已有四类 projection writer，但旧的 state/index/memory 散写与双写链路仍未完全退居投影层 |

如果只看搜索 primitive 和聚合器，对应关系要写得更严格一些：

- `core.py` ≈ `reference_search.py + 尚未存在的 CSV_CONFIG 注册层`
- `design_system.py` ≈ `StorySystemEngine + story_system.py + RuntimeContractBuilder`

### 8.1 我们真正缺的不是”聚合器”，而是”显式可审查的裁决层”

当前我们已经有：

- `题材与调性推理.csv`
- 7 张规则表
- `reference_search.py`
- `story_system_engine.py`

而且当前系统已经不是“只有搜索，没有聚合”。  
`story_system.py` 已经串起了 `build -> persist story seed -> build runtime contracts -> persist runtime contracts` 的主链：

```python
contract = engine.build(...)
persist_story_seed(...)
volume_brief, review_contract = RuntimeContractBuilder(project_root).build_for_chapter(...)
persist_runtime_contracts(project_root, args.chapter, volume_brief, review_contract)
```

`StorySystemEngine.build()` 也已经直接产出 `MASTER_SETTING` / `CHAPTER_BRIEF` / `anti_patterns`：

```python
return {
    "master_setting": {
        "meta": {"contract_type": "MASTER_SETTING"},
        ...
    },
    "chapter_brief": {
        "meta": {"contract_type": "CHAPTER_BRIEF"},
        ...
    },
    "anti_patterns": anti_patterns,
}
```

这意味着当前的 `StorySystemEngine + RuntimeContractBuilder`，实际上已经共同承担了
route / aggregate / persist 主链中的大部分职责。

所以现状并不是“还缺一个像 `design_system.py` 那样的聚合器”，而是：

- 已经有聚合器
- 但聚合裁决逻辑仍散落在 engine 代码、CSV、`context_manager.py` 和 skill 文本里
- 还没有像 `ui-reasoning.csv` 那样被提炼成一套显式、结构化、可审查、可测试的规则层

目前很多裁决还散落在：

- `story_system_engine.py`
- `context_manager.py`
- skill 文本
- 经验性 prompt

后续建议把这类规则显式收束为 Python 配置层，或落成一张独立 reasoning 表。

不一定非要 CSV，但必须是**结构化、可审查、可测试**的。

### 8.2 我们也应该继续强化”Master + Override”心智

这一点其实我们已经部分做到，但还需要在 spec 层写得更硬：

- `MASTER_SETTING` 是全局真源
- `VOLUME_BRIEF` 是卷级偏移
- `CHAPTER_BRIEF` / `REVIEW_CONTRACT` 是章级偏移
- accepted `CHAPTER_COMMIT` 是写后事实真源

这和 `ui-ux-pro-max` 的 `MASTER.md + page override` 是同一类思想。

但这里必须补一条关键校准：  
`ui-ux-pro-max` 实际上是**二层覆盖**：

- `MASTER.md`
- `pages/*.md`

而我们已经是**四层合同覆盖 + 写后事实层**：

- `MASTER_SETTING`
- `VOLUME_BRIEF`
- `CHAPTER_BRIEF`
- `REVIEW_CONTRACT`
- accepted `CHAPTER_COMMIT`

这意味着同一个 field 可能在多个层级被覆盖，复杂度显著高于  
`page override trumps master` 这种二层规则。  
所以我们不能直接照搬它的覆盖判定逻辑，必须与 `evolution-spec 8.5` 的 `override ledger` 一起设计。

### 8.3 我们要学它的”注册式配置”，不是学它的数据体量

对我们真正重要的是建立一个统一注册表，明确：

- 每张表的职责
- 检索列
- 输出列
- 毒点列
- 是否属于基础表 / 动态表 / 路由表
- 是否允许进入 contract 主链

也就是做出属于我们的 `CSV_CONFIG`。

但这一步的起点应该是：承认当前 `reference_search.py` 只是一个**通用 BM25 primitive**，还不是注册式配置层。  
它现在的检索列和展示列都是全局硬编码，不区分 domain：

```python
_SEARCH_FIELD_WEIGHTS = {
    "意图与同义词": 4,
    "关键词": 3,
    "核心摘要": 2,
    "详细展开": 1,
}
_CONTENT_COLUMNS = [...]
```

因此下一步不是重写搜索算法，而是在它上面补一层 per-table / per-domain 的元数据注册。

### 8.4 我们要学它的”消费适配层隔离”

后续我们自己的 CSV / contract 系统，不应该直接把表结构暴露给所有消费者。

正确方向是：

- `story-system` 负责产出统一 contract
- `context-agent` / `webnovel-write` / `webnovel-query` / `dashboard` 只消费 contract
- 平台/skill 差异只停留在消费入口层

### 8.5 上下文窗口成本是一个被低估的差异

`ui-ux-pro-max` 的 CSV 检索结果直接进 prompt，单次交互的上下文窗口足够消化。但我们的写作任务书需要织入前文摘要、长期记忆、RAG 线索、当前状态、追读信号等多源数据，context-agent 自身的 research 阶段就要消耗大量上下文。

这意味着 reasoning 层不能照搬它"查完全部再推理"的模式，而是要考虑：

- 哪些数据源在 research 阶段按需查询（而非全量灌入）
- 最终任务书的信息密度要做取舍，不是"查到的都塞进去"
- reasoning 规则本身也要轻量，不能再额外占用大段上下文

这个差异直接影响"reasoning 层该做多重"的设计决策：我们的 reasoning 层应该是轻量配置 + 按需路由，而不是像 `design_system.py` 那样在单次调用中串联五六个 domain 的检索结果。

## 不能直接照抄的地方

### 9.1 不能照抄自动数据生成

`ui-ux-pro-max` 的 `_sync_all.py` 有一定“程序生成衍生数据”的倾向。  
这对 UI 配色数据可以接受，但对故事知识库不适合。

我们的硬边界仍然要保持：

- 知识条目内容必须人工整理
- 脚本只能做校验、补空、对齐、去重、编号检查
- 不能自动从 md 迁移内容

### 9.2 不能把自动 domain detect 当成唯一真理

它的 `detect_domain()` 主要靠关键词启发式。  
这在 UI 场景可以用，但故事系统不能只靠这个。

我们更适合的顺序是：

1. 用户显式题材 / `.story-system` contract
2. `题材与调性推理.csv`
3. alias / fallback
4. 最后才是启发式猜测

注：这里说的是**题材路由判定顺序**，不同于 `evolution-spec 7.2` 的**运行时上下文装配优先级**。  
后者是在合同已存在时，按 `chapter -> volume -> master -> 题材与调性推理.csv -> genre-profiles.md -> templates/genres/*.md` 组装输入。

### 9.3 不能让平台模板反向主导知识结构

平台适配层必须是壳，不应该反向决定 CSV 结构。

## 对我们下一步 spec 的直接启发

如果把这次调研落成一份可执行 spec，最应该写进 spec 的不是“继续加几百条 CSV”，而是以下结构要求：

### 10.1 建立我们的 `CSV_CONFIG`

这里的 `CSV_CONFIG` 不应取代 `references/csv/README.md`，两者应该明确分工：

- `CSV_CONFIG`：Python 代码层注册字典，供 runtime 的检索、路由、contract 注入直接消费
- `README.md`：人类可读的 schema / 录入规范 / 表边界说明
- 校验脚本：保证 `CSV_CONFIG` 与 `README.md` 的列定义、表角色、前缀约定保持一致

当前 `README.md` 已经承担了 schema 文档职责，例如：

```md
| `关键词` | 是 | 高权重触发词，多值字段，统一使用 `|` |
| `核心摘要` | 是 | 供高权重召回与结果展示使用的简明摘要 |

### 命名规则.csv
| `命名对象` | 角色、书名、地点、势力、功法、道具等 |
```

因此更合理的落地方向不是”README 或 `CSV_CONFIG` 二选一”，而是：

- README 讲人话
- `CSV_CONFIG` 讲机器话
- **硬约束**：必须有 CI 校验脚本保证两边对齐。两套 schema 定义如果没有自动化校验，很快就会漂移——这不是建议，是必须做的事

至少明确：

- 表名 / 文件名
- 角色
- 检索字段
- 输出字段
- 毒点字段
- 是否基础表 / 动态表 / 路由表
- contract 注入位置
- 是否允许进入主链
- 与 README 对应的 schema 章节

### 10.2 明确”route -> reasoning -> rule tables -> contract”的流水线

这一步是本次调研最关键的迁移结论。

### 10.3 为 CSV 主线补”研究-录入-校验-验收”的闭环

也就是：

- 人工选题
- 人工提炼
- CSV 录入
- schema / alias / route 校验
- contract 抽样验证

### 10.4 把 skills / agents / dashboard 都降级为消费层

消费统一 contract，而不是各自重新拼知识。

## 最终判断

`ui-ux-pro-max` 的成功，本质上说明了一件事：

> 一个强 skill 的核心，不是写一篇更长的说明书，而是把知识、检索、推理、持久化和消费边界做成明确分层。

对 `webnovel-writer` 来说，最值得学习的最终不是：

- 继续写更长的 skill 文本
- 继续堆更多零散 md
- 继续让每个入口自己决定查哪些 reference

而是：

- 用 `references/csv` 承担 `Knowledge Layer`（见 `evolution-spec 6.1`, `12.3`）
- 用 `story_system + 显式 reasoning 配置` 承担 `Reasoning / Contract Layer`（见 `evolution-spec 6.1`, `7`）
- 用 `.story-system` 承担主真源与覆盖层（见 `evolution-spec 7`, `8.5`）
- 用 `CHAPTER_COMMIT + override ledger + canonical event log` 承担运行时演进主链（见 `evolution-spec 9`, `10`）
- 让 skills / agents / dashboard 只消费统一输出与投影视图（见 `evolution-spec 9.4`, `12`）

这才是它真正值得迁移过来的思想和架构。
