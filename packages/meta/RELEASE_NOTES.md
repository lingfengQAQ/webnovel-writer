# 完整版 0.1.0-preview.6

- 主插件：`@linfengqaqtat/dsh-scriptor@0.1.0-preview.6`。
- 嵌入提供方：`webnovel-embedding-provider@0.0.8`。
- `dsh.bundle` 组合配置同时启用两个插件；嵌入模型默认关闭。
- 从 npm 安装：`dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor-full@preview`。
- 在全新 Web profile 安装，或先停止并移除分别安装的旧入口。不要叠加主包和完整版。
- GitHub Release 保留同字节 tarball；依赖仍由 registry 下载。

旧内部名称 `@webnovel/embedding-provider` 不用于公开安装。升级前停止实例并备份，使用 DSH 的 `plugin remove` 移除旧安装入口后按 [README](README.md) 安装。
