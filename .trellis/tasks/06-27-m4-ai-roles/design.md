# 技术设计：M4 AI 角色层与一级宿主壳

> 前置:已读 实施计划 §M4/§1.5、多智能体 spec v3.4、story-repo-spec 0.8 §8/§2.0/§10/§11、v6 reviewer.md + 知识抽样。
> 落点全部在 `v7/`(包自包含);AI 协作层只吃 DTO、只吐结构化,落盘走 M2 Writer 小端口。

## 1. 落点布局（v7/ 下,全绿地）

```
v7/
├── roles/                      # 角色单源(markdown + frontmatter),真源
│   ├── 事实审查.md
│   └── 编辑审.md
├── skills/
│   └── webnovel-writer/SKILL.md   # 状态机单入口,平台条件块,真源
├── references/                 # 知识层平移(逐文件审查后入)
│   ├── 题材模板/ 追读力/ 爽点节奏/
│   └── 迁移报告.md
├── adapters/
│   ├── registry.json           # 三级分级
│   ├── claude-code/support.md
│   └── codex/support.md
├── templates/AGENTS.md         # 工作目录公约数层模板(标记块)
├── scripts/build-host-shells.mjs   # 生成器 CLI(薄壳)
└── src/
    ├── review/                 # 两审编排 Use Case(确定性,零真 AI)
    │   ├── index.js            # assembleReviewInput / runReviews / mergeReviews / persistReviewReport
    │   └── schema.js           # ReviewIssue 校验 + 阻断规则
    ├── dto/                    # 跨层稳定 DTO 组装器
    │   ├── chapter-brief.js    # ChapterBrief
    │   └── character-context.js# CharacterContext
    ├── session/index.js        # readBooksRegistry / assembleSessionContext / scanRebuildBooks
    ├── host-shells/generate.js # 生成器逻辑(可单测)+ drift check
    └── state-machine/persist.js# AI 态产物回流落盘(序0/1/4/6)
```

**约定**(延续 M1-M3):`scripts/build-host-shells.mjs` 与 `bin/` 同为薄入口,逻辑在 `src/host-shells/`;命令走 `run(args,options,ctx)` 纯返回契约;零第三方依赖。

## 2. 两审编排（R1,确定性核心）

### 2.1 边界:JS 做编排,AI 做审稿
v7 铁律:状态机/脚本不做业务判断,AI 吃 DTO 吐结构化。两审的"读整章找问题"是 AI 的活;JS 负责**组装输入 + 校验输出 + 合并落盘 + 诚实声明**。用**依赖注入**把 AI 隔在确定性层之外:

```js
// reviewers 由宿主壳接线(完整=两个 subagent;降级=主 agent 顺序);测试注入假函数→零真 AI
runReviews(ctx, { chapterNum, draftPath, mode, reviewers })
//   1. input = assembleReviewInput(...)            // DTO,无文件路径
//   2. fact = reviewers.factCheck(input)           // AI 出 ReviewIssue[]
//      edit = reviewers.editorial(input)           // mode='degraded' 时顺序
//   3. validateReviewReport(fact|edit)             // schema + 阻断规则
//   4. merged = mergeReviews({fact,edit},{mode})   // 合并 + counts + 诚实声明
//   5. persistReviewReport(...)                    // 落盘 工作区/审稿.md + 评审报告/
```

### 2.2 ReviewInput DTO（AI 不见路径）
`{ 章号, 草稿全文, 本章要写到的事[], 全书近况片段, 相关角色:CharacterContext[], 相关条目(伏笔/悬念/感情线), 时间线片段, 信息差关键词候选[], 名册待确认新专名[] }`。全部经 M1 读接口 + M2 备料组装,值进 DTO,路径不进。

### 2.3 ReviewIssue schema 与阻断规则（src/review/schema.js）
- 字段:`severity / category / location / description / evidence / fix_hint / blocking`。
- **分域**:事实审查 category ∈ {setting,timeline,continuity,character,logic,requirement,leak,evidence,unregistered_thread};编辑审 ∈ {structure,pacing,commercial,motivation}。越界拒绝。
- **阻断规则**:`critical`→`blocking=true`;`unregistered_thread`(D3)→**强制 `blocking=false`**(即兴伏笔非缺陷,只出候选交作者);其余 severity 由 AI 判 blocking。
- 复核 `issues_count/blocking_count/has_blocking` 与 `issues` 一致(校验器覆盖写回,继承 v6 review-pipeline 复核纪律)。

### 2.4 落盘
`工作区/审稿.md` = 草稿 + 两审意见 + 待确认新专名 + 章摘要(spec §8 第7步);`工作区/评审报告/{事实审查,编辑审}.json` 原始输出。模式声明写在审稿单头部(降级:"本次兼容模式,审稿隔离度低于完整两审")。

## 3. AI 态 DTO 与落盘（R2）

- `src/dto/`:`CharacterContext`(角色快照,境界/状态/位置/持有,无路径)——`ReviewInput` 与备料复用。`ChapterBrief` 不另造:M2 `工作区/本章写作材料.md` 即 chapter brief(无新消费者,避免冗余 DTO)。
- `src/state-machine/persist.js`:AI 产物回流落盘,与 `dto.js`(读侧组装)对称:
  - 序0 修复确认 → 写回修复后的源文件(经 parser 校验)
  - 序1 建书 → `book.yaml` + `大纲/总纲.md` + 第一卷卷纲(经 Writer)
  - 序4 卷复盘 → 卷摘要 + 下卷卷纲 + 勾选的伏笔条目
  - 序6 细纲 → `工作区/细纲.md`
- 落盘**只经 M2 Writer 小端口**;AI 提交结构化 DTO,M4 落盘,AI 全程不碰文件路径。

## 4. SessionStart 与书单自愈（R3）

- `readBooksRegistry(workdir)`:读 `.webnovel/books.jsonl`(每行一本:书名/目录/是否当前/最后打开);JSON 行损坏跳过并标记。
- `scanRebuildBooks(workdir)`:缺失/全损 → 扫描含 `book.yaml` 子目录重建(spec §0 可重建);"当前在写"标记缺失时返回 needsAuthorPick。
- `assembleSessionContext(workdir)`:产"当前在写哪本/共几本/全书近况入口"注入文本。
- **无 hook 等价**:状态机入口启动调同一函数 → 与 Claude Code SessionStart hook 注入文本逐字一致(测试断言等价)。
- **写侧不做**:books.jsonl 写入/换书对话属 M5;M4 只读 + 重建。

## 5. 宿主壳生成器 + drift check（R4）

### 5.1 生成器（src/host-shells/generate.js）
- 读 `roles/`、`skills/`、`adapters/registry.json` → `dist/<host>/`(agent 壳按平台:Claude Code md+frontmatter / Codex TOML / Gemini md;编译后 SKILL.md)。
- **平台条件块**(§5.9):零依赖手写最小渲染器——`{{#if agentCapable}}…{{/if}}`、`{{#if hasHooks}}…{{/if}}`、变量插值(命令引用语法/路径)。布尔集只留 `agentCapable`/`hasHooks`(不维护大能力矩阵)。
- **降级编译进生成物**:无 subagent 平台,生成的 SKILL.md 正文就是顺序执行版 + 兼容声明(不靠运行时判断)。
- 生成物 `dist/` 不提交(§6.2)。

### 5.2 drift check = 确定性(spec v3.4 §6.2)
`build-host-shells --check`:同输入连跑两次,断言**逐字节一致**(determinism)+ 生成物过 validator。CI 必跑。(dist 不提交,故非"对比已提交生成物",而是确定性验证。)

### 5.3 package validator
校验:registry schema、逐宿主 `support.md` 存在、`description` ≤ Codex 8k 预算、生成物**无本机绝对路径**、roles frontmatter 完整。

### 5.4 角色单源:重构而非拷贝 v6
`roles/事实审查.md`、`roles/编辑审.md` 任务书:
- **吃 `ReviewInput` DTO**,声明输出 §8 schema;**不含** `python`/脚本调用/文件路径读取(对照 AC6 grep)。
- 事实审查维度 = v6 五维(setting/timeline/continuity/character/logic)+ v7 新增(requirement 要写到的事核对 / leak 泄密候选判断 / evidence 履历证据验证 / unregistered_thread D3)。
- 编辑审 = structure/pacing/commercial/motivation;明确排除"自由评文笔好坏"。

## 6. 知识层平移（R5,逐文件审查 + 单一真源）

- 范围严守 spec §11 平移表:**题材模板 / 追读力分类 / 爽点与节奏知识库**,其余 v6 references 不迁。
- **先选真源,后迁移(用户指令:题材以 CSV 最新版为准,不维护双表)**。v6 同一知识体有新旧两层(新 CSV `references/csv/`+`taxonomy/` vs 老 markdown `skills/*/references/`+`references/genre-profiles.md`),重叠即"两张表"——v7 每体只留一份:

  | 知识体 | v7 唯一真源(取) | v6 弃/折叠 |
  |---|---|---|
  | 题材模板 | `taxonomy/genre-index.csv` + `csv/题材与调性推理.csv` | `genre-profiles.md`、`skills/.../genre-tropes.md`、`anti-trope-*.md`(独有内容折叠进 CSV,否则丢) |
  | 爽点与节奏 | `csv/爽点与节奏.csv` | `genre-hook-payoff-library.md`、`pacing-control.md` 重复部分 |
  | 追读力分类 | `references/reading-power-taxonomy.md` | (唯一源,无双表) |

- 流程:**P4.1 产真源选定表** → 逐份真源清 v6 问题 → 入 `v7/references/<分类>/` → `迁移报告.md` 记"选谁/弃谁/为什么 + 逐文件改了什么"。
- **v6 问题清单(grep 把关,AC7)**:
  | 类别 | 命中样例 | 处置 |
  |---|---|---|
  | 双表 | 题材同时存在 CSV 与 markdown 表 | **只留 CSV**,markdown 独有内容折叠进 CSV |
  | 旧路径 | `设定集/`、`正文/`(非"定稿/正文")、`.webnovel/state.json` | 改 v7 路径或删 |
  | 退场术语 | "卡"(卡点义)、"棘轮" | 换 spec 术语 |
  | v6 机制 | `state.json`、doctor、dashboard、v6 skill 名(webnovel-write/plan…)、`python webnovel.py`;CSV 的 `适用技能`/`大模型指令` 列、跨 CSV `推荐检索表` 列 | 删/重写为 v7 中性 |
  | 反模式 | "评文笔好坏""打分" | 删(两审职责排除) |
- craft 内容(钩子/兑现/节奏/题材原型/调性/毒点)架构无关,保留。CSV 保持 CSV 形态(机器友好、即单源),不另起 markdown 表复刻。
- `genre-index.csv` 的 `template_file` 列引用 `templates/genres/*.md`:迁移时一并核对引用完整性(引用的模板要么迁入要么清列),不留悬空引用。

## 7. 取舍

- **DI 注入 reviewers**:把 AI 隔在确定性层外,P0-P5 主体全可 TDD/CI 绿;真模型只在推迟的 smoke 接线。代价:多一层注入接口——值,换来零真 AI 的可测性。
- **drift = 确定性**(非比对已提交物):符合 v3.4"dist 不提交";代价:不防"手改已分发壳",但分发由 M5 安装器哈希追踪兜底。
- **角色重构而非拷贝**:这是"不带 v6 问题进 v7"的核心落点;代价:多写,不能 copy——必须,v6 reviewer 直调 runtime 违反铁律。
- **资产放 v7/ 下**(非仓库根):包自包含,安装器(M5)从 v7/ 取源分发。

## 8. 回滚点

- 各 P 独立、全为**新增目录/文件**(`roles/`、`skills/`、`references/`、`adapters/`、`scripts/`、`src/{review,dto,session,host-shells}`);对 M1-M3 唯一改动是 `state-machine/persist.js` 新增(不改 dto.js 读侧)。
- 未提交前 `git restore v7/<子目录>` 即回滚;知识迁移是纯新增,删 `references/` 即净。
