# Implement：故事对象知识策展

> 当前状态：ready_for_commit（2026-07-19）。三维内容、运行时窄修、独立审查与完整质量门均已完成。

## 门 0：启动前检查

- [x] 0.1 核对父任务 PRD/design/implement、维度宪章、字段矩阵和策展规则。
- [x] 0.2 核对运行时 `knowledge-query`、`persist-design`、`read-design`、prep/review 和 factChanges 的真实消费者。
- [x] 0.3 盘点三份 CSV：设定 104、人物 101、命名 79；确认旧字段、模板化和跨维风险。
- [x] 0.4 补齐本子任务 PRD、design 与本实施计划，明确不设条目数量目标。
- [x] 0.5 对 PRD/design/implement 做一致性与 convergence 检查，确认没有未决架构问题。
- [x] 0.6 作者确认规划后运行 `task.py start 07-10-story-object-knowledge-migration`；进入实现前加载 `trellis-before-dev`。

## 批次 1：最小 schema 与调用样例

- [x] 1.1 扩展 `v7/test/references/format.test.js`：三维正式条目只允许各自字段并要求非空 `规划时`。
- [x] 1.2 将设定对象类型、人物类别和命名对象受控值写入测试；禁止 `全部`、来源编号、适用题材、关键词、毒点和正反例回流。
- [x] 1.3 删除 `v7/src/knowledge/index.js` 中没有独立命令消费者的 `关系类别` 索引字段；人物类型只使用 `角色 / 关系`。
- [x] 1.4 增加真实问题和 `--类型` 查询测试，证明三维各自最多三条、空结果可自定义、固定字段不决定具体对象答案。
- [x] 1.5 增加“候选 → 计划对象 → prep/review → factChanges”行为样例，证明通用条目不被下游持续回读。
- [x] 1.6 更新 `v7/skills/webnovel-writer/SKILL.md` 的故事对象说明，只保存最终来源、本书适配和真实变更。

## 批次 2：设定策展

- [x] 2.1 建立 `research/设定候选裁决.csv`，覆盖 SY-001 至 SY-104 及书级任务转交的世界/规则候选；检查漏号与重复。
- [x] 2.2 对候选做问题/动作/失败模式聚类，删除具体金手指、数值表、事件模板和题材化复述。
- [x] 2.3 对拆出的创意约束或篇章技法只记录转交，不在 `设定/` 复制。
- [x] 2.4 先落世界/规则/机制，再落能力/物品/组织/制度/地点正式条目；每批同步查询样例和近重复检查。
- [x] 2.5 建立 `research/content-review/设定.md`，逐条核对对象类型、可实例化问题、一致性边界和非模板化。

## 批次 3：人物策展

- [x] 3.1 建立 `research/人物候选裁决.csv`，覆盖 CH-001 至 CH-101 及反派镜像、关系阻力、内鬼等转交项；检查漏号与重复。
- [x] 3.2 把来源聚类为角色方法与关系方法；删除具体主角/配角配置、题材换皮和单场呈现技巧。
- [x] 3.3 先落角色设计，再落关系设计；同一方法只保留一个 canonical 路径，不因主角/反派/题材标签复制。
- [x] 3.4 用主角驱动、反派职责、人物弧、利益关系、权力关系等真实问题验证候选差异。
- [x] 3.5 建立 `research/content-review/人物.md`，核对长期行为机制、关系变化、OOC 边界和技法排除。

## 批次 4：命名策展

- [x] 4.1 建立 `research/命名候选裁决.csv`，覆盖 NR-001 至 NR-079；检查漏号与重复。
- [x] 4.2 删除具体书名、人名、正反例和题材词表，把题材化命名规则合并为语系、功能、可读性与区分度方法。
- [x] 4.3 先落书名/卷名/章节名，再落角色/地点/组织/能力/物品/制度/术语/任务/副本/赛事/代号方法。
- [x] 4.4 用现有名册、近名、正名/别名、跨语系和可读性问题验证查询与计划对象落盘。
- [x] 4.5 建立 `research/content-review/命名.md`，核对候选生成方法、冲突检查、对象附着和非模板化。

## 批次 5：跨维审计与分发

- [x] 5.1 对三维及题材/流派/创意约束/技法边界做近重复审计；洪荒、克苏鲁、诡秘和反派镜像等转交项必须有唯一去向。
- [x] 5.2 证明明确作者可直接自定义，空白作者只得到少量相关候选；不展示 284 条全量菜单。
- [x] 5.3 更新 `v7/references/README.md` 的正式条目数量、schema 和故事对象调用说明。
- [x] 5.4 核对 installer vendoring、host shells、技能和 fixture；正式库只含签收条目，研究记录留在任务目录。
- [x] 5.5 运行定向测试、全量测试、installer e2e、任务 validate 和 `git diff --check`。

## 验证命令

```powershell
node --test v7/test/references/format.test.js
node --test v7/test/knowledge/index.test.js
node --test v7/test/knowledge/query-command.test.js
node --test v7/test/commands/persist-design.test.js
node --test v7/test/knowledge/design.test.js
node --test v7/test/knowledge/fact-changes.test.js
node --test v7/test/knowledge/pipeline.test.js
npm --prefix v7 test
npm --prefix v7 run e2e:install
python ./.trellis/scripts/task.py validate 07-10-story-object-knowledge-migration
git diff --check
```

## 验证结果

- 定向故事对象与知识链路：53 项通过。
- `npm --prefix v7 test`：574 项通过。
- `npm --prefix v7 run e2e:install`：pack、中文路径安装、建书、next、update 全通过，安装产物写入 420 个文件。
- `build-host-shells.mjs --check`、任务 validate 与 `git diff --check` 全通过。

## 风险与回滚点

| 风险 | 受影响范围 | 回滚边界 |
|---|---|---|
| 最小 schema 与运行时定义不一致 | `src/knowledge/index.js`、format/query 测试 | 只回退批次 1，不回退计划/事实框架 |
| 设定条目变成金手指模板库 | `references/设定/`、设定裁决与审查 | 整批撤销设定正式条目，保留裁决重新策展 |
| 人物条目按题材/角色身份重复 | `references/人物/`、人物裁决与审查 | 按角色或关系批次回退，重新聚类 canonical |
| 命名条目携带具体名称模板 | `references/命名/`、命名裁决与审查 | 整批撤销对应命名对象组，不影响对象持久化 |
| installer 与源码内容漂移 | installer vendor、技能、README | 与对应内容批次同回滚，不保留双份知识 |

## 完成条件

- [x] 284 条来源和全部转交项均有唯一裁决，无漏号、重复或悬空去向。
- [x] 三维正式条目只有最小字段与单一 `规划时` 切片，且全部有真实查询消费者。
- [x] 每个正式条目有唯一 canonical 路径，内容不含可直接复刻的对象或名称模板。
- [x] 查询、本书化、计划/事实两阶段和分发行为测试全部通过。
- [x] 三份独立内容审查关闭所有发现，README、spec、技能、代码和测试一致。
