# DSH Scriptor 完整版

`@linfengqaqtat/dsh-scriptor-full` 同时安装主插件和可选嵌入提供方，通过 DSH 组合配置各加载一份。

## 安装

准备 Node.js 24.15.0、pnpm 11.27.1 和 DSH 0.1.5-rc.2，首次创建 Web profile：

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor-full@preview
dsh --profile scriptor --host 127.0.0.1 --port 6104 --no-open
```

本版为 `0.1.0-preview.4`，固定版本可使用 `@linfengqaqtat/dsh-scriptor-full@0.1.0-preview.4`。
完整版与主包单独安装二选一。已经分别安装两个插件时，先停机并移除旧安装入口，再安装完整版，避免组合配置重复加载。

嵌入 API 默认关闭，需要在宿主设置中配置模型、维度和凭据。主聊天模型也由用户配置，包不包含模型额度。

## 更新与卸载

停止该 profile 的实例后，安装新精确版本并重启。卸载完整版：

```powershell
dsh plugin --profile scriptor remove @linfengqaqtat/dsh-scriptor-full
dsh --profile scriptor --dump-config
```

卸载会撤掉两个插件的组合配置，不删除作品、设置和凭据。
GitHub Release 同时提供完整版 tarball；其两个依赖仍需从 npm 下载，不能当作完全离线的一体包。

完整安装与使用教程：[公开使用文档](https://github.com/lingfengQAQ/webnovel-writer/tree/v8/docs/user)。
许可证：[GPL-3.0-only](LICENSE)。
