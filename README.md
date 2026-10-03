# DSH Scriptor · Webnovel Writer v8

> Scriptor 8.1.0 正式版配套 **DSH 0.2.0-rc.2**，三个功能插件与完整版均为 8.1.0。旧版升级先备份，参阅安装与升级说明。

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的长篇小说写作工作台。把构想、设定、大纲、写章、审读、修改、定稿、记忆与导出放进一个能够暂停和继续的工作流程，作品以本地文件保存。

**正式版：8.1.0。** Windows 首发；重要作品使用前请备份。模型服务由你配置，调用可能产生费用。

DSH Scriptor is a local-first fiction writing workspace for DeepSeek Harness. Version 8.1.0 adds reference analysis, story graphs, and live workflow status. Runtime prompts and skills are included; model services are configured by the user.

## 选择版本

| 产品线 | 运行环境 | 入口 |
| --- | --- | --- |
| v6 | Claude Code 插件 | [v6 文档与安装](https://github.com/lingfengQAQ/webnovel-writer/tree/master) |
| v8（本分支） | DeepSeek Harness 工作台 | [下载正式版](https://github.com/lingfengQAQ/webnovel-writer/releases/tag/scriptor-v8.1.0) · [安装教程](docs/user/install.md) |

两个版本安装方式不同。当前没有经过验证的 v6/v7 书仓直接迁移方案。`v8` 是产品线名称，`8.1.0` 是工作台安装包版本。

## 能做什么

- 从开放式灵感探索逐步收敛到作品契约、世界书和卷章大纲。
- 导入本地 TXT/EPUB，确认范围与模型服务后渐进分析参考小说，保留证据和机制。
- 生成章节草稿，执行审读、修改与定稿流程；关键写入保留作者确认。
- 从实际文件校准进度，暂停后继续，记录故事账本和本书记忆。
- 在书房查看、编辑和引用材料，浏览章节、故事图谱及当前会话的写作流程状态。
- 检索已定稿内容；可选安装嵌入/场景/重排提供方。
- 生成卷摘要候选、核对卷末状态、导出定稿合集和来源清单。

主包包含 11 个运行技能和 7 个脚本入口。嵌入提供方是独立可选包，基础写作无需先配置向量服务。模型创作质量、长篇一致性和费用会随模型与操作方式变化，不承诺无人值守完成整本书。

## 开始使用

1. 安装配套的 **DSH 0.2.0-rc.2** 桌面端，打开侧栏 **插件 → 添加插件**。
2. 输入 `@linfengqaqtat/dsh-scriptor@8.1.0`，核对预览并安装，按提示应用变更。
3. 配置聊天模型与凭据，选择作品工作区，按 [第一本书与第一章](docs/user/first-book.md) 开始。

逐步说明见 [安装教程](docs/user/install.md) 和 [新手图文教程](docs/user/beginner.md)。正式版发布到 npm latest，教程使用精确版本便于核对宿主。

| 可选插件 | 安装标识 | 用途 |
| --- | --- | --- |
| 检索增强 | `@linfengqaqtat/dsh-scriptor-retrieval@8.1.0` | 嵌入、场景识别、重排，分别配置和启用 |
| 鲸鱼娘 | `@linfengqaqtat/dsh-scriptor-companion@8.1.0` | 窗口内陪伴与会话状态反馈，不调用模型 |
| 完整版 | `@linfengqaqtat/dsh-scriptor-full@8.1.0` | 聚合写作和检索，不含桌宠；与单独安装二选一 |

旧包迁移与备份见 [升级说明](docs/user/upgrade-backup.md)，不要同时启用旧检索包和新检索包。

## 文档

- [新手图文教程：从安装到第一章](docs/user/beginner.md)
- [界面与按钮参考](docs/user/ui-reference.md) · [增强索引操作指南](docs/user/enhanced-index.md)
- [参考小说分析](docs/user/reference-analysis.md)
- [日常写作与暂停恢复](docs/user/workflows.md)
- [备份、升级、回退与卸载](docs/user/upgrade-backup.md)
- [故障排查](docs/user/troubleshooting.md)
- [模型费用、数据流与隐私](docs/user/privacy.md)
- [从源码构建](docs/development.md) · [书仓格式与修改边界](docs/book-format.md)
- [贡献与 PR 规范](CONTRIBUTING.md) · [发行规范](docs/maintenance/releasing.md) · [更新记录](CHANGELOG.md)

## 反馈与许可证

[Bug / 功能建议](https://github.com/lingfengQAQ/webnovel-writer/issues/new/choose) 请注明 **v8 和精确安装包版本**。使用交流到 [Discussions](https://github.com/lingfengQAQ/webnovel-writer/discussions)。安全问题按 [SECURITY.md](SECURITY.md) 私下报告，不公开粘贴密钥或作品。

项目继承 [GPL-3.0-only](LICENSE)，可依照许可证使用、修改及分发，包括商用；保留必要声明，并在分发时履行相应源码等义务。仅使用本工具创作不会自动要求你的小说采用 GPL。模型服务及第三方素材适用各自条款。

保留 Webnovel Writer 项目来源及贡献者署名。主包的 [第三方声明](packages/bundle/THIRD_PARTY_NOTICES.md) 随发行件提供。
