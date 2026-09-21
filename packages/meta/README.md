# DSH Scriptor 完整版（暂缓发行）

`@linfengqaqtat/dsh-scriptor-full` 是便捷 meta 包，设计目标是让安装一条命令同时获得：

- **主插件** `@linfengqaqtat/dsh-scriptor`：完整的写作工作台
- **可选嵌入提供方** `webnovel-embedding-provider`：语义检索增强

## 当前状态：未随预览版发行

主插件与嵌入提供方目前只以 tarball 形式随 Release 分发，均未发布到 npm。
meta 包打包后依赖会被改写为确切版本号，`pnpm add` 该 tarball 时 pnpm 会到
registry 解析上述依赖并返回 404，因此本预览版不提供完整版 tarball。

需要嵌入功能时，请分别安装两个 tarball：

```powershell
# 先装主插件
dsh plugin --profile scriptor add D:/path/to/linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz

# 需要语义检索再装
dsh plugin --profile scriptor add D:/path/to/webnovel-embedding-provider-0.0.8.tgz
```

待包发布到 npm 后，本目录的 meta 包将恢复随发行提供。

## 文档

完整使用文档：https://github.com/lingfengQAQ/webnovel-writer/tree/v8/docs/user
