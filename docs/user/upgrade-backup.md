# 备份、升级与卸载

## 备份两类资产

停止相关实例，再分别备份：

- 作品工作目录：书仓全部文件、书仓 `.git`、草稿区以及工作范围内的书房素材。书仓 Git 不能代替包含草稿和书房内容的完整备份。
- DSH home：profile 配置、设置及需要保留的会话。它可能包含凭据，备份应私下加密保管，不能提交公共仓库。

记录主包、可选包、DSH 和 Node 版本。

## 更新

1. 阅读目标版本的 Compatibility、已知问题与迁移说明。
2. 完成备份，停止指定 profile 的运行实例。
3. 向同一个 profile 安装 npm 上的新精确版本，或下载并校验对应 `.tgz` 后安装，随后重启。
4. 检查书房入口、技能是否各一份，核对实际书仓状态；先用合成副本试写。

```powershell
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor@0.1.0-preview.6
dsh --profile scriptor --dump-config
```

上面展示命令写法，更新时换成实际目标版本。

完整版安装对应使用 `@linfengqaqtat/dsh-scriptor-full@0.1.0-preview.6`。不要在保留完整版时另外安装主包；切换安装方式前先移除原组合包。

## 回退

代码回退与数据回退不同。目标版本若改变书仓格式，安装旧包不能自动还原已经迁移的数据。停止实例，保存故障现场，按发行说明使用兼容旧包与对应完整备份恢复；未提供迁移/回退证据时不要在唯一原稿上尝试。

从完整备份恢复时，先停止实例，把损坏的书仓目录整个移走或删除，再整体复制备份目录回原位置。Windows 上书仓 `.git/objects` 内的文件带只读属性，普通删除会中途失败；用资源管理器、`robocopy /MIR` 或先清除只读属性再删除。恢复后运行 `git -C <书仓> status` 和 `git -C <书仓> fsck`，两者都干净才算恢复完成。

本预览版不支持自动迁移 v6/v7 书仓。

## 卸载与重装

```powershell
dsh plugin --profile scriptor remove @linfengqaqtat/dsh-scriptor
dsh --profile scriptor --dump-config
```

如果安装的是完整版，卸载命令改为 `dsh plugin --profile scriptor remove @linfengqaqtat/dsh-scriptor-full`。

卸载移除插件及其配置贡献，不删除作者书仓、书房或已有模型凭据。确认配置已无主包后，可重新按安装教程添加；可选 embedding-provider 需要单独卸载。
