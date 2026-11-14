# DSH Scriptor 完整版

Scriptor 8.4.1 适配 DSH 0.2.2-rc.3。安装范围为 `>=0.2.2-rc.1 <0.3.0-0`，Node最低24.9；实际验证按具体版本记录。

[产品主页](https://lingfengqaq.github.io/webnovel-writer/) · [安装教程](https://lingfengqaq.github.io/webnovel-writer/docs/install.html)

> Scriptor 8.4.1 配套 **DSH 0.2.2-rc.3**。旧格式先备份并使用书仓维护预览，按明确批准执行升级。

`@linfengqaqtat/dsh-scriptor-full` 同时安装主插件和可选嵌入提供方，通过 DSH 组合配置各加载一份。

## 安装

配套 DSH 0.2.2-rc.3。在侧栏“插件 → 添加插件”输入 `@linfengqaqtat/dsh-scriptor-full@8.4.1`，核对后安装并应用变更。步骤见[安装教程](https://lingfengqaq.github.io/webnovel-writer/docs/install.html)。

完整版绑定写作工作台和检索增强 8.4.1，不包含鲸鱼娘。它与分别安装写作/检索二选一，不要同时启用两个入口。旧版本先备份、卸载旧入口，再安装新版本，详见 [安装与迁移](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/install.md)。

检索辅助功能默认关闭，需要自行配置模型和凭据；主聊天模型也由用户配置，包不包含模型额度。

## 更新与卸载

8.4.1修复升级预览、草稿身份与留档检查，以及DSH 0.2.2-rc.3的委派和侧栏兼容。旧版本准备的待定稿包须重新准备、重新核对。更新full会同步更新主包与检索，检索功能保持不变。旧格式先备份、检查并预览整仓升级；安装本身不迁移作品。操作见 [编辑器教程](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/editor.md) 和 [升级指南](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/upgrade-backup.md)。

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
