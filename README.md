# DSH Scriptor · Webnovel Writer v8

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的长篇小说写作工作台。把构想、设定、大纲、写章、审读、修改、定稿、记忆与导出放进一个能够暂停和继续的工作流程，作品以本地文件保存。

**开发预览版：0.1.0-preview.3。** Windows 首发；重要作品使用前请备份。模型服务由你配置，调用可能产生费用。

DSH Scriptor is a local-first fiction writing workspace for DeepSeek Harness. This is the v8 developer preview. Runtime prompts and skills are included; model services are configured by the user.

## 选择版本

| 产品线 | 运行环境 | 入口 |
| --- | --- | --- |
| v6 | Claude Code 插件 | [v6 文档与安装](https://github.com/lingfengQAQ/webnovel-writer/tree/master) |
| v8（本分支） | DeepSeek Harness 工作台 | [下载预览版](https://github.com/lingfengQAQ/webnovel-writer/releases/tag/scriptor-v0.1.0-preview.3) · [安装教程](docs/user/install.md) |

两个版本安装方式不同。当前没有经过验证的 v6/v7 书仓直接迁移方案。`v8` 是产品线名称，`0.1.0-preview.3` 是工作台安装包版本。

## 能做什么

- 从灵感收敛到作品契约、世界书和卷章大纲。
- 生成章节草稿，执行审读、修改与定稿流程；关键写入保留作者确认。
- 从实际文件校准进度，暂停后继续，记录故事账本和本书记忆。
- 在书房查看、编辑和引用材料，浏览章节、索引及关联信息。
- 检索已定稿内容；可选安装嵌入/场景/重排提供方。
- 生成卷摘要候选、核对卷末状态、导出定稿合集和来源清单。

主包包含 10 个运行技能和 7 个脚本入口。嵌入提供方是独立可选包，基础写作无需先配置向量服务。模型创作质量、长篇一致性和费用会随模型与操作方式变化，不承诺无人值守完成整本书。

## 开始使用

1. 准备 **Git for Windows、PowerShell 7**，安装 **Node.js 24.15.0**（也支持 22.19.0 起的 Node 22）及 **pnpm 11.27.1**（宿主插件管理与源码构建统一为该版本）。
2. 安装 **DSH 0.1.5-rc.2**，下载此预览版的 `.tgz`，按 [安装教程](docs/user/install.md) 核对 SHA256 并创建 Web profile。
3. 在宿主设置中配置主模型与凭据，阅读 [最小配置](docs/user/configuration.md)。
4. 用 [合成练习素材](examples/first-book.md) 走一遍 [第一本书与第一章](docs/user/first-book.md)，熟悉确认、定稿和恢复。

不要把源码压缩包当作可安装插件；普通用户下载 Release 中的 `linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz`。安装包不需要在用户电脑上编译，也不要求 npm 账号。


### 可选嵌入提供方

如需语义检索增强，在安装主插件后再单独安装可选嵌入包：
- 主插件：`linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz`
- 可选嵌入：`webnovel-embedding-provider-0.0.8.tgz`

完整版 meta 包（`@linfengqaqtat/dsh-scriptor-full`）将在包发布到 npm 后提供；当前请分别安装上述两个 tarball。

## 文档

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
