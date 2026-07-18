# Implement：知识库运行时调用框架

> 父任务治理真源已于 2026-07-16 冻结并通过全量测试。本子任务只实现运行时接口与书仓闭环，不承担知识内容批量策展。

## 门 0：子任务规划

- [x] 0.1 读取父任务 PRD、design、implement 与三份治理真源。
- [x] 0.2 勘察 knowledge、DTO、persist、prep、review、finalize、staging、storage、installer、skills、roles、fixtures 和测试调用链。
- [x] 0.3 补齐本子任务 design 与分阶段 implement，并把代码证据暴露的契约缺口写回 PRD。
- [x] 0.4 对 PRD/design/implement 做一致性审查，确认没有新增无消费者字段或内容策展范围。
- [x] 0.5 启动子任务，状态切换为 `in_progress`。

## 阶段 1：十维读取内核

- [x] 1.1 建立十维注册表和分维索引适配器；读取器只扫描正式维度直接目录。
- [x] 1.2 扩展书级 canonical 归一到 `类型`、`副题材`、`流派`，兼容题材只提醒、不替作者删选项。
- [x] 1.3 为条目读取增加规划/落笔/审稿切片和 `路径@sha256` 来源版本。
- [x] 1.4 实现有限候选查询和 `knowledge-query`；每维默认最多 3 条，空结果可自定义继续。
- [ ] 1.5 删除全量章级索引的运行时出口，补 canonical 不等于创意选择、缺目录降级和候选限量测试。
- [x] 1.6 定向运行 knowledge、references 和 DTO 测试后提交“知识内核”单元（`c6a0146`）。

## 阶段 2：作品契约唯一真源

- [x] 2.1 定义作品契约必需 front matter、小节、知识选择和实际裁决结构；校验分类/来源一致、差异化点数量和冲突结算五项，不设恩怨档位或题材默认。
- [x] 2.2 改造 knowledge-pack、create-book DTO、persist-book 和 persistCreateBook，一次性写入目标目录。
- [x] 2.3 最终选择、来源版本和真实变体固化进契约 front matter；持久化层另行渲染 `知识选择记录.md`，只保存实际采用证据和真实发生的拒绝/修改/自定义过程。
- [x] 2.4 新增显式 `persist-contract`，校验版本、生效起章、原因和类型，原子更新契约和选择记录并独立提交，不自动升级。
- [x] 2.5 将 `作品契约/` 接入手改检测、relink、git 健康和解析失败检测。
- [x] 2.6 改造 prep/review，只读冻结契约；彻底移除旧路径、文风反和解回退和当前通用题材/流派回读。
- [x] 2.7 只在实际发生时持久化契约审稿问题；实现阻断立即停、连续两章/同卷三次延迟呈报和卷末契约复盘信号。
- [x] 2.8 契约更新使生效起章后的待定稿章和生成工件失效，要求重新备料与审查，不影响已定稿章。
- [x] 2.9 补必需契约、缺失阻断、四类更新路径、版本冻结、批次失效、生成/审查同源和无双读测试后提交“书级真源”单元。

## 阶段 3：故事对象两阶段生命周期

- [x] 3.1 新增计划对象 Reader/Writer、ID/名称索引和安全路径规则。
- [x] 3.2 新增 `persist-design` 与 `read-design`，命名结果附着对象；重复 ID/正名/别名冲突前置拒绝。
- [x] 3.3 扩展细纲解析 `本章对象`，prep/review 只读取显式引用对象。
- [x] 3.4 定义并校验 `factChanges`，覆盖 decision、resolution、expectedHash 和计划删除语义。
- [x] 3.5 把事实写入、计划删除、章节与其他账本纳入同一 finalize 提交和精确回滚集合。
- [x] 3.6 让 stagedFacts 叠加批内 factChanges，保证批内后章能看见前章待转正事实且不能看见后章事实。
- [x] 3.7 补计划创建/修改/放弃、精准读取、无冲突转正、作者裁决、hash 漂移、故障回滚和批量一致性测试后提交“故事对象”单元。

## 阶段 4：章级少量候选与精准切片

- [ ] 4.1 draft-outline DTO 改为按本章语料查询四维少量候选，不再发送全量菜单。
- [ ] 4.2 一次性切换细纲声明到节拍/场景/技法/追读/变体/对象，并允许多选与自定义。
- [ ] 4.3 prepare 只注入所选落笔切片，review 只注入所选审稿切片；规划切片确有消费者。
- [ ] 4.4 手动 finalize 与 stage-chapter 在清理细纲前固化 `知识选择`，finalize-batch 保持同构。
- [ ] 4.5 从近期定稿章和批内前章读取历史，只做降权与重复提醒，合法递进不硬禁。
- [ ] 4.6 补候选限量、整体确认、自定义降级、精准切片、近期软信号和手动/批量一致性测试后提交“章级调用”单元。

## 阶段 5：分发与文档一次性切换

- [ ] 5.1 更新 CLI help、webnovel-writer skill、编辑审 role 和 host shells，删除题材流派指导与恩怨档位话术。
- [ ] 5.2 更新 sample-book、命令/state/prep/review/finalize fixtures 和测试到 0.17 目标书仓。
- [ ] 5.3 installer vendoring 加入 `docs/knowledge/`，验证安装后 references README 的治理链接存在。
- [ ] 5.4 激活 story repo spec 0.17，更新架构文档当前态；不留下“待运行时实施”的错误状态。
- [ ] 5.5 全库搜索旧路径、旧字段、全量菜单和无消费者字段，允许的历史归档材料单独列明。
- [ ] 5.6 运行完整质量门后提交“分发收口”单元。

## 质量门

每个阶段至少运行受影响测试；最终必须运行：

    Set-Location v7
    npm test
    npm run e2e:install
    node scripts/build-host-shells.mjs --check
    Set-Location ..
    git diff --check

最终 cross-layer 审计：

- create-book 输入 -> book.yaml / 作品契约 / 选择记录 -> prep/review 读取完整往返；
- 计划对象 -> 细纲引用 -> review factChanges -> finalize -> 定稿事实完整往返；
- 细纲知识选择 -> prepare/review -> 手动或批量定稿 -> 近期历史完整往返；
- 源码包 -> npm pack -> installer vendoring -> 中文路径工作目录完整往返；
- 所有旧路径均无运行时读写点，所有新字段均能指向唯一消费者和行为测试。
