# Reference Gap Register

> 本文件记录本轮 skills/references 重构的基线状态与确认缺口。
> 来源：`docs/superpowers/specs/2026-04-09-skills-restructure-and-reference-gaps.md`

---

## 一、Skills 现状与重写方向


| Skill              | Priority | Current problem               | Target role                       | Existing references                                                                                                                       | Missing references                      |
| ------------------ | -------- | ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| webnovel-write     | P0       | 326 行，主链过重，references 平铺式列出   | 主链总控 skill：流程+闸门+交付物+恢复           | anti-ai-guide, polish-guide, style-adapter, style-variants, writing/* (6 files), reading-power-taxonomy, genre-profiles, core-constraints | 命名规则 CSV, 场景写法 CSV, 写作技法 CSV          |
| webnovel-review    | P0       | 135 行，阻断裁决链不够清楚               | 独立审查入口：reviewer 调用→报告→blocking 处理 | review-schema, core-constraints                                                                                                           | blocking-override-guidelines            |
| webnovel-plan      | P0       | 272 行，题材/冲突/节奏规则混在正文          | 规划流程入口：卷纲→时间线→章纲                  | (无独立 reference 文件)                                                                                                                        | plot-signal-vs-spoiler, 场景写法 CSV (卷级结构) |
| webnovel-init      | P1       | 434 行，接近 mini-spec，采集/策略/约束混杂 | 初始化访谈与生成工作流                       | genre-profiles                                                                                                                            | 命名规则 CSV                                |
| webnovel-query     | P1       | 192 行，偏操作手册，低层命令暴露过多          | 查询/分析型 skill                      | (内联)                                                                                                                                      | 暂无刚需                                    |
| webnovel-dashboard | P2       | 74 行，过轻，缺验证与恢复结构              | 工具启动型 skill                       | (无)                                                                                                                                       | 暂无刚需                                    |
| webnovel-learn     | P2       | 45 行，过轻，缺边界与恢复                | 轻量记录型 skill                       | (无)                                                                                                                                       | 暂无刚需                                    |


## 二、确认缺口清单

### 新增 md reference


| Reference                                           | Main skill                        | Step/trigger                  | Gap type  | Why not inline                   |
| --------------------------------------------------- | --------------------------------- | ----------------------------- | --------- | -------------------------------- |
| `references/review/blocking-override-guidelines.md` | webnovel-review                   | Step 6 / blocking issue 需用户决策 | 缺陷补偿      | 涉及可/不可 override 场景判断，需独立正反例      |
| `references/outlining/plot-signal-vs-spoiler.md`    | webnovel-plan                     | 章纲拆分 / always                 | 提醒 + 知识补充 | 信号 vs 剧透的判断标准需独立说明，skill 一句话覆盖不了 |
| `references/shared/naming-and-voice-gaps.md`        | webnovel-write (主), init/plan (次) | Step 2 / 多角色对话、新角色命名          | 缺陷补偿      | 命名同质化、口吻趋同、题材语汇漂移涉及多类稳定错误        |


### 新增 CSV 知识库


| CSV 文件                        | 主来源                      | 服务 skill          | 说明                        |
| ----------------------------- | ------------------------ | ----------------- | ------------------------- |
| `references/csv/命名规则.csv`     | 新建                       | init, plan, write | 角色/地点/势力/功法/道具/书名命名规则与正反例 |
| `references/csv/场景写法.csv`     | 从现有 writing/*.md 迁移 + 新建 | write, plan       | 战斗/对话/情感/桥段/卷级结构写法与正反例    |
| `references/csv/写作技法.csv`     | 从现有 writing/*.md 迁移      | write             | 对话声线、情感描写、场景描写、节奏技法条目      |


### 从现有 md 迁移到 CSV 的文件


| 现有 md                                         | 迁移到 CSV              | 迁移后处置         |
| --------------------------------------------- | -------------------- | ------------- |
| `writing/combat-scenes.md` (229 行)            | 场景写法.csv（场景类型=战斗）    | 删除或保留空壳指向 CSV |
| `writing/dialogue-writing.md` (231 行)         | 写作技法.csv（分类=对话）      | 同上            |
| `writing/emotion-psychology.md` (265 行)       | 写作技法.csv（分类=情感）      | 同上            |
| `writing/scene-description.md` (263 行)        | 写作技法.csv（分类=场景）      | 同上            |
| `writing/desire-description.md` (311 行)       | 写作技法.csv（分类=情感）      | 同上            |
| `writing/genre-hook-payoff-library.md` (85 行) | 场景写法.csv（场景类型=钩子/兑现） | 同上            |


### 延迟（当前不纳入，条件触发后补回）


| 原提案                                      | 过滤理由                         | 恢复条件                 |
| ---------------------------------------- | ---------------------------- | -------------------- |
| init/title-patterns-and-anti-patterns.md | 可作为命名规则.csv 中几行条目            | CSV 覆盖不够、书名模板化严重时升级  |
| init/protagonist-flaw-patterns.md        | Claude 通用能力可覆盖               | 网文场景缺陷设计空泛化时补 CSV 条目 |
| query/entity-alias-resolution.md         | 别名解析是代码逻辑 (entity_linker.py) | 语义歧义频发时补             |
| query/foreshadowing-urgency-rules.md     | 紧急度排序已在 context-agent 实现     | 输出解释不稳定时补            |
| learn/pattern-taxonomy.md                | 分类规则可内联 skill                | 分类质量持续不稳时补 CSV       |

---

## 三、2026-04-16 References 完善状态

| 项目 | 状态 | 说明 |
|------|------|------|
| `references/review/blocking-override-guidelines.md` | 已完成 | review blocking 决策参考已落位 |
| `references/outlining/plot-signal-vs-spoiler.md` | 已完成 | plan 章纲拆分参考已落位 |
| `references/shared/naming-and-voice-gaps.md` | 已完成 | 命名与口吻缺陷补偿参考已落位 |
| `references/README.md` | 已完成 | 顶层 references 索引已新增 |
| `references/csv/genre-canonical.md` | 已完成 | 15 个 canonical genre + platform_tag 映射已落位 |
| `reference_search.py` canonical 题材解析 | 已完成 | 支持 canonical、platform_tag、legacy 值归一 |
| `CSV_CONFIG` 结构元数据 | 已完成 | 已补 `prefix`、`required_cols`、`contract_inject` |
| `validate_csv.py` | 已完成 | 校验列头、编号、前缀、必填列、分隔符、题材、路由/裁决覆盖 |
| `题材与调性推理.csv` | 已补厚 | 由 8 行扩展到 26 行，覆盖 15 个 canonical genre |
| `裁决规则.csv` | 已补厚 | 由 7 行扩展到 17 行，覆盖 15 个 canonical genre |
| CSV `适用题材` canonical 迁移 | 已完成 | `validate_csv.py` 当前 0 errors / 0 warnings |

## 四、后续知识层缺口

| 缺口 | 优先级 | 说明 |
|------|--------|------|
| 女频命名规范扩展 | P1 | 继续补 `命名规则.csv` 中古言、现言、甜宠、娱乐圈命名差异 |
| 言情核心场景扩展 | P1 | 继续补 `场景写法.csv` 中暧昧、误会、重逢、分手、追妻等场景 |
| 悬疑推理技法扩展 | P1 | 继续补 `写作技法.csv` 与 `桥段套路.csv` 中线索、公平误导、真相揭露 |
| shared md 可迁移审查 | P2 | `cool-points-guide.md`、`naming-and-voice-gaps.md` 的可条目化内容留待人工逐条录入 |

