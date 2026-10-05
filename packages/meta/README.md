# DSH Scriptor 完整版

> Scriptor 8.2.0 正式版配套 **DSH 0.2.0-rc.2**，三个功能插件与完整版均为 8.2.0。旧版升级先备份，参阅安装与升级说明。

`@linfengqaqtat/dsh-scriptor-full` 同时安装主插件和可选嵌入提供方，通过 DSH 组合配置各加载一份。

## 安装

配套 DSH 0.2.0-rc.2。在 DSH 侧栏“插件 → 添加插件”输入 `@linfengqaqtat/dsh-scriptor-full@8.2.0`，核对预览并安装，按提示启用或重启。Desktop 自带运行时，不需要另装 Node/pnpm。

完整版绑定写作工作台和检索增强 8.2.0，不包含鲸鱼娘。它与分别安装写作/检索二选一，不要同时启用两个入口。旧版本先备份、卸载旧入口，再安装新版本，详见 [安装与迁移](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/install.md)。

检索辅助功能默认关闭，需要自行配置模型和凭据；主聊天模型也由用户配置，包不包含模型额度。

## 更新与卸载

8.2.0 带来新编辑器、确定性正文计数和契约篇幅核对；旧项目须保留原契约内容，补充并确认“章节篇幅”后启用范围核对。操作见 [新编辑器教程](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/editor.md) 和 [旧项目升级指南](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/upgrade-backup.md)。检索功能本次仅同步兼容版本。

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
