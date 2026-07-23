# 父任务 A1–A32 证据映射（2026-07-22）

## 判定口径

- 逐条从父 PRD 原文回查生产数据流、治理产物、测试和人工语义样例；不以父 `implement.md` 阶段勾选反推 AC。
- “行为测试”必须经过真实生产函数；静态任务书/字符串断言只能证明指令存在。必须由 AI 判断的语义（作者状态、善良与叙事失真、异名同质）另有人工 AI 走查，并明确其非自动宿主回放。
- A17 按父 R14 已确认的**分层粒度**解释：书级保存最终选择/变体/来源版本；对象级保存最终本书化对象及知识依据；章级刻意只保存 canonical 选择与真实变体，不把临时候选或知识 hash 扩成长期反馈表。

## 映射

| AC | 状态 | 主要证据 | 验收判断 |
|---|---|---|---|
| A1 | 达成 | `research/挂账清算表.md`；父 `research/决策状态清单.md` 的历史快照声明 | 17 项均有证据、状态、最终处置/重开条件和影响范围；当前作者未决 0、无去向转交 0，清算表是唯一当前真源。 |
| A2 | 达成 | `v7/docs/knowledge/维度宪章.md` §3–5；`research/结构审计报告.md`、`近重复裁决-批次1.md` | 十维逐项有目的、准入/排除、主要调用者和相邻边界；12 组边界盲样能按调用者/产物稳定裁决。 |
| A3 | 达成 | 维度宪章 §6–8；`调用者与字段矩阵.md` §1/§3；父 design §3/§5 | 新顶层维度必须有独立问题、调用时机、产物和消费者；否则使用分维字段或不新增，且禁止无消费者公共元数据。 |
| A4 | 达成 | `v7/docs/knowledge/策展规则.md` §3–6/§9；references README | 准入、近重复、合并、拆分、移动、废弃、别名与回滚流程完整，均要求证据和签收。 |
| A5 | 达成 | 父 `166条重分类基线.csv`；四个归档内容/运行时子任务 research；本审计挂账表 | 已知边界、近重复、诊断族、桥段/对象/技法候选均按同一宪章压力测试，不靠孤立拍板。 |
| A6 | 达成 | `166条重分类基线.csv`；归档书级/故事对象/篇章任务的逐条裁决 CSV/MD；references README 的 286 最终基线 | 原 166 条有分批责任与规则依据，新增 v6 候选也逐条裁决；最终十维 286 条可回溯到各内容批。 |
| A7 | 达成 | 父 `design.md` §2/§8/§9、`implement.md` 风险表；五个子任务 design/implement | 目标目录、一次性切换、验证、源码回滚均冻结；十维知识切换未新增旧 v7 知识路径双读、知识 schema 兼容层或知识迁移器。既有 v6→v7 书仓迁移不在此断言范围。 |
| A8 | 达成 | `调用者与字段矩阵.md` §2/§4/§6；`research/行为审计报告.md` | 建书、对象、规划、写作、事实审、编辑审、finalize、卷复盘和开发策展均有输入、选择键、切片、产物及行为证据。 |
| A9 | 达成 | 父 design §6；`research/反同质化实测.md`；`book-level-diversity.test.js` | 固定路由只归一且保持确定性；同一分类可形成机制不同的合法契约。硬约束进契约，章级软策略可拒绝/组合/自定义。 |
| A10 | 达成 | `src/knowledge/contract.js` writing/review sections；`src/review/index.js`；`roles/编辑审.md`；pipeline/contract 测试；`语义审查样例.md` | 三条差异化点有结构校验，且进入写作/审稿真实切片；审稿核对它与大纲、人物、设定的具体连接。章级四维仍支持组合、变体和自定义。 |
| A11 | 达成 | 归档书级任务 `research/v6创意资产裁决.md`、`反同质化验收.md`；`references/创意约束/`；query/contract/review 测试 | v6 反套路能力被重写为可选创意约束：少量候选→作者选择/拒绝→本书约束→写作/审稿闭环，未回流成品模板。 |
| A12 | 达成 | `src/knowledge/contract.js`；`commands/knowledge-pack.js`；book diversity/pipeline 测试 | `类型` 与 `副题材[]` 分离，流派另字段；复合输入必须完成七项融合协议且无固定比例。 |
| A13 | 达成 | 创意约束正式目录与归档 content review；`query-command.test.js`、contract/pipeline 测试 | 独立 schema、建书/改纲调用、按真实问题候选、契约落地和审稿消费均可验证；格式审查禁止具体剧情模板。 |
| A14 | 达成 | `调用者与字段矩阵.md`；归档故事对象任务三份裁决 CSV 与 content review；design/query/fact 测试 | 命名/设定/人物各有受控 schema、对象设计消费者、计划持久化、事实边界和 v6 逐条裁决；命名结果附着对象而非平行实体。 |
| A15 | 达成 | 维度宪章 §6；归档篇章 `节拍/场景/技法/桥段` 裁决；挂账 #9–#13 | 桥段、结构、兑现、诊断与特殊对象均被归位、拆分、删除或明确排除；没有兜底顶层目录。 |
| A16 | 达成 | 父 `task.json` 的五个 children；父 design §8/§9；各子任务 PRD/design/implement/task | 运行时、书级、对象、篇章四子任务已独立验收归档；本集成子任务承担跨子任务最终审计，边界、依赖和回滚均独立。 |
| A17 | 达成 | 父 PRD R14；`src/knowledge/contract.js`、`design.js`、`chapter.js`、`state-machine/persist.js`；contract/design/chapter 测试 | 书级固化最终选择与同维安全来源；对象 `知识依据` 的每个来源必须是安全 canonical `维度/文件.md@sha256:<64 位小写十六进制>` 或精确自定义/共创，且必须且只能有一行非空 `本书适配`；章级在确认细纲时原子冻结 `维度｜名称｜来源`、独立整章变体和细纲 hash。未选候选不落盘，真实拒绝/修改/问题才记录。 |
| A18 | 达成 | `ContractReader`；`state-machine/dto.js`、`state-machine/persist.js`、`prep/`、`review/index.js`；pipeline/persist/router 测试；fixture 防回流 | 建书、序6规划、备料、编辑审与卷复盘写盘边界均只读同一作品契约，缺/坏阻断且零文件/零 commit；旧路径无双读。八节覆盖骨架、融合、差异化、结算、毒点、节奏和来源能力。 |
| A19 | 达成 | 父 R16；`roles/编辑审.md`；references format/fixture 测试；`research/语义审查样例.md` | 生产/正式库/fixture 不含恩怨枚举、题材默认或“圣母”分类；四案语义走查正确区分合理宽恕/有代价救赎与无成本洗白/无动机让渡底线。 |
| A20 | 达成 | contract validator、state-machine detectors；序6 DTO、prep/review；contract/pipeline 测试 | 建书缺契约、结构不全或未确认均失败；成功后规划/备料/审稿从同一真源读取，缺失/损坏不会回退旧文件。 |
| A21 | 达成 | `persist-contract.test.js`；`review/outcome.test.js`；`state-machine/dto.test.js`；`staging/index.test.js` | 作者即时修改、阻断冲突立即停、重复非阻断延迟呈报、卷末固定复盘四路均有行为证据；所有落盘仍需作者确认。 |
| A22 | 达成 | `src/knowledge/contract.js`、`commands/persist-contract.js`、`state-machine/persist.js`、`staging/contract-invalidation.js`、`staging/index.js`、`finalize/index.js`、`review/input-binding.js`、`review/index.js`、`review/outcome.js`；contract/persist-contract/review/staging/finalize 与 CLI/host-shell 测试 | 修订必含版本、生效章、原因、非空证据和影响范围，且 `生效起章 === nextChapter`；缓存无法确认下一章或既有 guard 未收口时阻断。全部未发布批次/工作区工件进入持久待重做集合；重做与审查后仅生成绑定章号、契约版本、批次目录和原始定稿包 hash 的待提交证明，批量定稿重验并只在 commit confirmed 后精确释放。完整 ReviewInput 令牌绑定章号、草稿/章档案、契约版本/内容和全部审稿上下文；外层与两份报告三处回传，save-review 锁内重组，暂存/重审/定稿复核 sidecar。坏 guard/meta、状态洗回、包篡改、旧审稿延迟回流、同版本上下文漂移、提交失败/未知、restage/reject/discard 与二次更新均有 fail-closed 证据。 |
| A23 | 达成 | 序1 DTO/技能与 pipeline 测试；query-command 测试；序6/chapter 测试；反同质化报告 | 书级、创意约束、三对象维和四章级维均按各自时机给候选；明确作者不被强制发散，空白作者先问答后少量整体包，章级利用问题与历史。 |
| A24 | 达成 | `调用者与字段矩阵.md` §3/§6；references format 测试；行为审计负向扫描 | 三组分维 schema 都有真实消费者和行为测试；无统一填充字段、僵尸字段或普遍“全部”占位。 |
| A25 | 达成 | persist-design/design-pipeline/fact-changes/finalize 测试 | 覆盖计划创建、修改、改名、放弃、首次定稿转正和既成事实修改；一次性对象不建档，计划与事实分离，命名附着对象。 |
| A26 | 达成 | `src/knowledge/fact-changes.js` 及事实审查角色/阶段呈报链；commands/knowledge/finalize/staging fact-changes 测试 | 无冲突事实与章节原子提交；冲突/歧义/hash 漂移零写入，并向作者呈现差异、影响和每项带 `applyChange:boolean` 的处理选项。作者裁决保留原 options，以 `optionId` 派生执行；false 在事实写入、计划删除、碰撞、暂存 payload 和叠加视图中均无副作用。 |
| A27 | 达成 | 序6 DTO/技能；`chapter.test.js`、staging/chapter-knowledge-validation.test.js、pipeline、persist-contract/fact-changes 边界测试 | 软策略随整份细纲确认，不逐项二次确认；确认时把细纲与来源快照原子冻结，引用修改/删除不改 H1，缺/旧/hash 漂移 fail closed；无细纲路径严格校验现行档案。未选候选不持久化，选中切片精准调用；越过契约或事实边界仍走独立确认闸门。 |
| A28 | 达成 | `state-machine/dto.js` 的近期历史与比较要求；pipeline/chapter 测试；`语义审查样例.md` | DTO 的 `选择[]` 提供维度、名称、来源、叙事功能、实现方式，`本章整体变体[]` 独立作为章上下文；同名有递进允许复用，异名同实现提示，近期历史只软降权，不牺牲本章匹配度。 |
| A29 | 达成 | contract/contract-issues/chapter 测试；行为审计负向断言 | 只保存真实最终选择、变体与实际发生的裁决/问题；无逐条评分、满意度、章后反馈、占位效果或自动回写排名。 |
| A30 | 达成 | 策展规则 §1/§4；生产命令负向扫描；references README 与各内容签收 | 作品作者没有投稿、审核、评分回传或自动扩库入口；候选与裁决只在 Trellis，正式库只含签收条目。 |
| A31 | 达成 | 策展规则 §2/§9；维度宪章 §7/§8；归档子任务越界转交记录 | 普通策展与架构变更判定、影响分析和审批明确；实际子任务遇错维只登记转交，未静默加维度/改调用契约。 |
| A32 | 达成 | 维度宪章 §2；策展规则 §5–6；结构/近重复报告；`语义审查样例.md` A32；故事对象裁决 | 全库 canonical 名称重复 0、每条单一路径；不同名近重复经人工语义抽样。可拆材料分开归位，不可拆“契约绑定与双向责任”按规则设计调用者整体归设定，跨维只组合不复制。 |

## 总结

A1–A32：**32 / 32 达成**。本映射所列新增纠偏均已进入生产契约、测试或人工语义证据，不以待办承诺代替验收。最终命令级质量门结果见任务 `implement.md` 批次 5 与 session 收口记录。
