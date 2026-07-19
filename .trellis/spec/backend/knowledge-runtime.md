# 知识运行时开发规范

> 版本：基线 1.1（2026-07-18）。产品边界以 PRD 1.6、story-repo-spec 0.17 和 `v7/docs/knowledge/` 为准。

## 1. Scope / Trigger

修改十维知识查询、建书、作品契约、计划对象、章级知识、事实转正、宿主壳或 installer 时适用。目标是保持“通用知识是可选材料，本书文件是运行时真源”：固定路由禁止替作者选择创意，知识缺失可自定义继续，作品契约缺失必须停止。

## 2. Signatures

```text
knowledge-pack --类型=<主题材> [--副题材=a,b] [--流派=a,b]
knowledge-query --维度=<十维之一> --问题=<真实未决问题>
persist-book --file=<json> [--dir=<目录>]
persist-contract --file=<json>
persist-design --file=<json>
read-design <ID或名称>
finalize <章号> --payload=<json>
```

章级细纲只认六个声明：`本章节拍`、`本章场景`、`本章技法`、`本章追读`、`知识变体`、`本章对象`。禁止恢复全量索引 DTO 或旧声明桥。

## 3. Contracts

- `persist-book` 必须收到作者确认、完整作品契约和非空 `知识选择`；分类与来源版本必须和 `book`、选择记录一致。
- 题材/流派路由只做 canonical 归一和兼容提醒：空流派兼容范围表示无需窄范围提醒，禁止用“全部”占位；有副题材时 `knowledge-pack` 必须输出中央融合协议检查，不得输出固定比例或唯一创意答案。
- 作品契约的 `类型 / 副题材` 只能保存正式题材名称。`类型=衍生` 时至少有一个非“衍生”的正式副题材；流派名、别名和任意非题材字符串均不能充当实际世界副题材。校验器的正式题材名单必须由格式测试与 `路由.csv` 的题材行逐项对齐。
- `节奏与兑现参数` 没有数值配额时不增加占位；出现比例、固定章位或单位周期内次数时，必须分别提供非空的“统计对象 / 使用目的 / 失效条件”。仅出现三个空标签仍应拒绝。
- `persist-contract` 只保存作者确认的新版本；版本严格递增，生效起章不得早于下一未定稿章。
- `persist-design` 写 `大纲/创作设计/设定|人物/`；对象至少含 `ID`、`名称`、`## 本书设计`、`## 一致性边界`。目录即计划状态。
- 事实审查可在报告顶层输出 `factChanges`；`validateReviewReport`、合并和 `工作区/评审报告/事实审查.json` 必须保留该数组。finalize 在任何写盘前校验冲突、路径和 hash，并把事实写入、计划删除、章节提交纳入同一原子边界。
- 章档案的 `知识选择` 只保存 `维度｜名称` 与真实 `变体｜说明`，是近期软降权的唯一输入；不保存评分、满意度或空反馈。
- npm 包和 vendored 运行时必须同时包含 `references/` 与 `docs/knowledge/`；治理 README 链接不得失效。

## 4. Validation & Error Matrix

| 条件 | 必须行为 |
|---|---|
| 通用维度目录缺失、查询无命中 | 返回空候选；允许 AI/作者自定义，创作不停 |
| 作品契约缺失或结构损坏 | 建书/备料/审稿停止并给中文错误；禁止读旧路径补造 |
| canonical 路由未命中 | 原样报告未命中，禁止伪装成正式条目 |
| 流派兼容范围为空 | 不产生兼容提醒；禁止恢复“全部”占位兼容分支 |
| `类型 / 副题材` 含非正式题材名称 | 建书或契约更新失败，要求先完成 canonical 归一 |
| `类型=衍生` 但没有非“衍生”的正式副题材 | 建书或契约更新失败，要求补充实际世界题材 |
| 数值节奏配额缺任一非空说明 | 建书或契约更新失败，指出须补统计对象、使用目的和失效条件 |
| 计划对象 ID、正名或别名冲突 | 写盘前拒绝，零文件变更 |
| `factChanges` 为冲突/歧义、hash 漂移或路径逃逸 | 整章零写入，要求作者裁决或重新审查 |
| installer 缺治理文档或 README 链接目标 | 单测和 pack-install e2e 必须失败 |

## 5. Good / Base / Bad Cases

- Good：同一组主题材、副题材和流派按不同未决问题采用不同创意约束；融合协议写清共同冲突、副题材介入条件和失焦风险，作者确认后保存。
- Base：流派兼容范围或某知识维度为空，不制造提醒或默认答案；允许对谈自定义继续。
- Bad：把快穿流写进衍生作品的副题材；只写“统计对象：/使用目的：/失效条件：”三个空标签；按题材固定选择唯一创意或关系结算答案。

## 6. Tests Required

- 知识查询：每维最多三条、无命中空集、近期历史只降权不排除。
- 建书/契约：必需字段、分类/来源同源、更新版本与批次失效、旧路径不回退。
- 书级路由：题材名单与契约校验名单完全一致；流派兼容范围不含“全部”，空值不提醒；歧义词与跨维词保持未命中。
- 衍生/配额：非题材副题材被拒；至少一个正式世界副题材才能通过；“每三章”“每章 2 个”“每卷 1 次”和空说明标签均有反例，完整三项说明有正例。
- 反同质化：相同主题材/副题材/流派至少形成两套机制不同且都能通过校验的作品契约，固定路由输出不含创意约束答案。
- 计划/事实：精准读取、重名拒绝、四种 decision、hash 漂移、手动/批量原子一致。
- 审稿：顶层 `factChanges` 经 schema 归一化后仍存在于正式事实报告。
- 分发：installer 文件清单、三条治理链接、host-shell drift、`npm pack → 中文路径 init → 完整契约建书 → next → update`。

## 7. Wrong vs Correct

Wrong：

```js
const choice = topicDefaults[book.类型]
const contract = await readOldStyleGuide()
const actualWorld = contract.副题材.find((name) => name !== '衍生')
const quotaOk = ['统计对象', '使用目的', '失效条件'].every((label) => pacing.includes(label))
```

Correct：

```js
const contract = validateWorkContract(contractContent)
if (!contract.ok) return { ok: false, error: contract.errors.join('；') }
const candidates = await queryKnowledge(packageRoot, dimension, { 问题: question, limit: 3 })
```

前者制造固定答案和双真源，还会把任意副题材或空说明误当有效；后者验证正式分类与非空说明，并以作者确认的本书契约驱动运行时。
