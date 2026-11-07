# 当前源码的工具清单

完整写作模式共有 **37 个 Scriptor 工具：36 个业务工具 + 1 个条件委派工具**。这里不包含 DSH 自带的文件、Shell、普通子代理等工具，也不包含测试专用工具。

唯一名称清单位于 `packages/bundle/src/tool-catalog.ts`：`NOVEL_TOOL_NAMES` 对应业务工厂，`NOVEL_CONDITIONAL_TOOL_NAMES` 对应条件注册，`NOVEL_PRODUCTION_TOOL_NAMES` 是二者合并后的完整清单。

| 环境 | Scriptor 工具数 |
| --- | --- |
| 写作主控，原生 `subagent` 可用 | 37 |
| 写作主控，原生 `subagent` 不可用 | 36 |
| 普通模式或 Scriptor 已卸载 | 0 |

`novel_delegate` 随原生 `subagent` 注册和撤销。五种 role 共用这一个工具，不算五个工具。模型选择、后台执行和取消沿用原生委派；普通研究仍走原生 `subagent`。只有明确角色的目标实例才获得对应写作规则与权限。

## 业务工具（36 个）

| 工具 | 用途 |
| --- | --- |
| `novel_reference_source` | 管理参考小说来源 |
| `novel_reference_analyze` | 渐进拆解参考小说 |
| `novel_reference_query` | 检索参考机制与证据 |
| `novel_reference_report` | 保存拆书报告与灵感 |
| `novel_select_book` | 选择作品 |
| `novel_create_book` | 创建作品 |
| `novel_update_contract` | 更新作品契约 |
| `novel_get_story_status` | 查询当前写作状态 |
| `novel_check_book` | 只读检查书仓，报告问题与检查范围 |
| `novel_begin_chapter` | 新章前只读核对，合并状态与书仓检查，不创建章节 |
| `novel_preview_book_upgrade` | 只读预览整仓升级，报告精确差异、依赖影响与阻断项 |
| `novel_apply_book_upgrade` | 作者批准精确计划后执行整仓升级并核对提交 |
| `novel_resume_book_upgrade` | 按原操作编号核对并续办中断或待提交的升级 |
| `novel_search_finalized` | 检索定稿 |
| `novel_index_manage` | 管理检索索引 |
| `novel_prepare_pack` | 写入定稿准备包 |
| `novel_settle_chapter` | 执行定稿沉淀 |
| `novel_new_outline_draft` | 创建章细纲草案 |
| `novel_confirm_outline` | 确认章细纲 |
| `novel_update_skeleton` | 更新故事骨架 |
| `novel_update_volume_layout` | 更新分卷布局 |
| `novel_roll_window` | 滚动近期窗口 |
| `novel_confirm_worldbook_entry` | 确认世界书条目 |
| `novel_confirm_volume_outline` | 确认卷纲 |
| `novel_assemble_materials` | 保存章节材料包 |
| `novel_apply_revision` | 应用作者给定的小修 |
| `novel_apply_revision_batch` | 批量落实改稿处置 |
| `novel_import_draft` | 导入作者稿 |
| `novel_record_review_findings` | 记录审读发现项 |
| `novel_record_proposal` | 登记修改提案 |
| `novel_resolve_proposal` | 处置修改提案 |
| `novel_apply_retcon` | 执行吃书补偿 |
| `novel_record_memory` | 保存作者或本书记忆 |
| `novel_note_pending` | 记录待补事项 |
| `novel_get_book_progress` | 查询作品进度 |
| `novel_editor_suggest` | 交回编辑器建议 |

## 条件委派工具（1 个）

| 工具 | 注册条件与用途 |
| --- | --- |
| `novel_delegate` | 写作主控的原生 `subagent` 可用时注册；按 role 派发起草、润色、改稿、审读或沉淀对账 |

业务结果卡只覆盖上述 36 个业务工具；委派结果沿用原生格式，不套用业务工具的 `ok` 结果协议。

作者明确开始新章时，用一次 `novel_begin_chapter` 替换原状态查询，不前后再补调 `novel_get_story_status`。普通查询、同章恢复和改稿取审核哈希仍用原状态工具，不附加全仓检查。主动检查使用 `novel_check_book`，不必假装开始新章。

两个检查工具都只接收书 id，不修复、升级、恢复事务或批准写入。开章边界核实后，`novel_begin_chapter` 才执行全仓检查；否则返回未检查原因。未检查、未覆盖、未支持、部分失败与无法核实均不表示健康。检查无发现也不表示指定章节已开始或写作工序已完成。

作者要求升级旧格式时，加载 `novel-maintenance`。预览只收 `bookId`，执行只收 `bookId` 和预览返回的 `fingerprint`，续办只收 `bookId` 和原 `operationId`。工具不接受自填批准、任意路径或新正文。首次执行要求现有章节已收尾、Git 干净、无待处理事务且整仓可升级；任何未支持问题都不能改为局部写入。执行与实际续办使用各自的作者问答，批准后再次核对当前证据。

`written-pending-commit` 表示文件已写入但提交未完成，须按原操作编号续办。`recovered` 只表示中断批次已恢复，升级须重新预览。`already-committed` 表示已核实原提交，无须重复转换。该入口不提供主动撤销。

## 数量验证

- 工具清单测试核对名称唯一、业务工厂与清单一致、本文列举完整。
- 不配置原生委派的 Loader 夹具核对业务清单，共 36 个。
- 原生委派集成测试核对完整名称集，共 37 个；停用原生委派后回到 36，恢复后回到 37，卸载 Scriptor 后为 0。
- 技能和文件打包另行核对：12 个技能、17 份参考文档、8 个脚本入口。打包文件数不代替运行时工具注册数量。
