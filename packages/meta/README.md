# DSH Scriptor 完整版

> 本版 Scriptor preview.7 / 嵌入提供方 0.0.9 面向 **DSH 0.1.7-rc.2**。旧版 preview.6 / 提供方 0.0.8 对应 DSH 0.1.5-rc.2；升级时同时对齐宿主与插件，先备份再重启。

`@linfengqaqtat/dsh-scriptor-full` 同时安装主插件和可选嵌入提供方，通过 DSH 组合配置各加载一份。

## 安装

本版要求 Node.js 24.15.0（也支持 22.19.0 起的 Node 22）、pnpm 11.27.1 和 DSH 0.1.7-rc.2。组合包绑定主包 preview.7 与提供方 0.0.9。

以下为本版安装命令：

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor-full@0.1.0-preview.7
dsh --profile scriptor --host 127.0.0.1 --port 6104 --no-open
```

本版为 `0.1.0-preview.7`，固定版本可使用 `@linfengqaqtat/dsh-scriptor-full@0.1.0-preview.7`。
完整版与分别安装二选一。full 不会自动接管已有的主包或提供方：直接叠加安装会留下重复配置，即使包文件被包管理器复用也是如此。已经单装时，先停止实例，安装 full 成功后移除原来的单装入口，核对配置各一份再重启。具体步骤见 [切换为完整版](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/install.md#从单装切换为完整版)。

嵌入 API 默认关闭，需要在宿主设置中配置模型、维度和凭据。主聊天模型也由用户配置，包不包含模型额度。

## 更新与卸载

停止该 profile 的实例后，安装新精确版本并重启。卸载完整版：

```powershell
dsh plugin --profile scriptor remove @linfengqaqtat/dsh-scriptor-full
dsh --profile scriptor --dump-config
```

仅通过 full 安装（或已完成上述切换）时，卸载 full 会撤掉主包和提供方的组合配置。若仍保留独立安装项，卸载 full 不会移除它们；没有安装 full 时，也不能用删除 full 的命令卸载单装包。完整卸载需移除该 profile 实际安装的各入口，见 [卸载与重装](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/upgrade-backup.md#卸载与重装)。

卸载不删除作品、设置和凭据，也不清空 pnpm 的共享下载缓存。
GitHub Release 同时提供完整版 tarball；其两个依赖仍需从 npm 下载，不能当作完全离线的一体包。

完整安装与使用教程：[公开使用文档](https://github.com/lingfengQAQ/webnovel-writer/tree/v8/docs/user)。
许可证：[GPL-3.0-only](LICENSE)。
