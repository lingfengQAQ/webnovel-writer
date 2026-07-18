# 知识运行时开发规范

> 版本：基线 1.0（2026-07-18）。产品边界以 PRD 1.6、story-repo-spec 0.17 和 `v7/docs/knowledge/` 为准。

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
| 计划对象 ID、正名或别名冲突 | 写盘前拒绝，零文件变更 |
| `factChanges` 为冲突/歧义、hash 漂移或路径逃逸 | 整章零写入，要求作者裁决或重新审查 |
| installer 缺治理文档或 README 链接目标 | 单测和 pack-install e2e 必须失败 |

## 5. Good / Base / Bad Cases

- Good：同一题材查询得到少量材料，规划者组合并写真实变体，作者确认整份细纲后精准注入。
- Base：某维度为空，细纲写自定义文本，备料/审稿保留该文本并继续。
- Bad：按题材固定选择唯一流派、人物或关系结算答案；从当前通用库覆盖已经冻结的作品契约。

## 6. Tests Required

- 知识查询：每维最多三条、无命中空集、近期历史只降权不排除。
- 建书/契约：必需字段、分类/来源同源、更新版本与批次失效、旧路径不回退。
- 计划/事实：精准读取、重名拒绝、四种 decision、hash 漂移、手动/批量原子一致。
- 审稿：顶层 `factChanges` 经 schema 归一化后仍存在于正式事实报告。
- 分发：installer 文件清单、三条治理链接、host-shell drift、`npm pack → 中文路径 init → 完整契约建书 → next → update`。

## 7. Wrong vs Correct

Wrong：

```js
const choice = topicDefaults[book.类型]
const contract = await readOldStyleGuide()
```

Correct：

```js
const candidates = await queryKnowledge(ctx, { dimension, question, limit: 3 })
const contract = await new ContractReader(repoPath).readWritingSections()
if (!contract.ok) return { ok: false, error: `备料停止：${contract.error}` }
```

前者制造固定答案和双真源；后者只提供材料，并以作者确认的本书契约驱动运行时。
