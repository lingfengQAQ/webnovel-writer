# 备份、升级与卸载

## 升级到 8.1.0

8.1.0 新增参考小说分析、故事图谱和写作流程状态，继续配套 DSH 0.2.0-rc.2。从 8.0.0 升级无需更换宿主；更新所用插件到同一版本，已有作品按原文件读取，不自动重写设计与正文。参考库作为书房的一部分纳入备份。

## 旧包名迁移（8.0.0 起）

8.0.0 起将旧 webnovel-embedding-provider 更名为 @linfengqaqtat/dsh-scriptor-retrieval，旧 @linfengqaqtat/dsh-whale-companion 更名为 @linfengqaqtat/dsh-scriptor-companion。所有新版安装包为 8.1.0，使用 DSH 0.2.0-rc.2。

先备份作品、profile 配置及凭据引用，停止会话。在 DSH 侧栏“插件”中卸载旧入口，按提示重启，再安装新入口；不要同时启用新旧包。自定义模块 name 覆盖需按 [维护者迁移说明](../maintenance/cli-install.md) 更新，稳定条目 id 和 config 保留。完整版与写作/检索单装二选一。


## 备份两类资产

停止相关实例，再分别备份：

- 作品工作目录：书仓全部文件、书仓 `.git`、草稿区以及工作范围内的书房素材。书仓 Git 不能代替包含草稿和书房内容的完整备份。
- DSH home：profile 配置、设置及需要保留的会话。它可能包含凭据，备份应私下加密保管，不能提交公共仓库。

记录主包、可选包、DSH 和 Node 版本。

## 更新

1. 阅读目标版本的 Compatibility、已知问题与迁移说明，并按 [版本对应表](install.md#为什么要固定-dsh-版本) 同时对齐宿主与插件。安装插件不会自动更新全局 DSH；版本不符按 [修复步骤](troubleshooting.md#dsh-版本不对怎么修复) 处理。
2. 完成备份，停止指定 profile 的运行实例。
3. 向同一个 profile 安装 npm 上的新精确版本，或下载并校验对应 `.tgz` 后安装，随后重启。
4. 检查书房入口、技能是否各一份，核对实际书仓状态；先用合成副本试写。

```powershell
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor@8.1.0
dsh --profile scriptor --dump-config
```

上面展示命令写法，更新时换成实际目标版本。

完整版安装对应使用 `@linfengqaqtat/dsh-scriptor-full@8.1.0`。不要在保留完整版时另外安装主包；单装转 full 按 [切换步骤](install.md#从单装切换为完整版) 操作，切回单装时先停机并移除 full，再安装所需单包。

## 回退

代码回退与数据回退不同。目标版本若改变书仓格式，安装旧包不能自动还原已经迁移的数据。停止实例，保存故障现场，按发行说明使用兼容旧包与对应完整备份恢复；未提供迁移/回退证据时不要在唯一原稿上尝试。

从完整备份恢复时，先停止实例，把损坏的书仓目录整个移走或删除，再整体复制备份目录回原位置。Windows 上书仓 `.git/objects` 内的文件带只读属性，普通删除会中途失败；用资源管理器、`robocopy /MIR` 或先清除只读属性再删除。恢复后运行 `git -C <书仓> status` 和 `git -C <书仓> fsck`，两者都干净才算恢复完成。

本版不支持自动迁移 v6/v7 书仓。

## 卸载与重装

先停止该 profile 的实例，运行 `dsh plugin --profile scriptor list --depth 0` 查看直接安装项。`remove` 只移除指定的直接安装项，full 不能替单装包办理卸载。

| 实际安装组合 | `dsh plugin --profile scriptor remove` 后的参数 |
| --- | --- |
| 仅 full，或已切换完成 | `@linfengqaqtat/dsh-scriptor-full` |
| 仅主包 | `@linfengqaqtat/dsh-scriptor` |
| 仅提供方 | `@linfengqaqtat/dsh-scriptor-retrieval` |
| 主包与提供方分别安装 | `@linfengqaqtat/dsh-scriptor @linfengqaqtat/dsh-scriptor-retrieval` |
| full 与单装包混装 | full 加上列表中实际存在的单装包名 |

例如两个单包都装过、希望整套卸载：

```powershell
dsh plugin --profile scriptor remove @linfengqaqtat/dsh-scriptor @linfengqaqtat/dsh-scriptor-retrieval
dsh --profile scriptor --dump-config
```

不要把未安装的包名一起传入，否则 pnpm 会拒绝该次卸载。仅删除 full 后，独立安装的主包或提供方仍会保留；完全没有安装 full 时，删除 full 命令报错且不会移除单装包。

整套卸载后，核对配置已无 `webnovel`、`webnovel-embeddings`、`webnovel-scenes`、`webnovel-reranking`，直接安装列表也无上述三个包，再按安装教程重装。卸载不删除作者书仓、书房、设置或模型凭据，不清空 pnpm 的共享缓存；保留的作者资料不属于重复安装。
