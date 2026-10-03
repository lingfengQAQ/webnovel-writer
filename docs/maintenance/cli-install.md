# 维护者命令行安装与包名迁移

新手使用 [DSH 插件管理页面](../user/install.md)。本页供维护已有 Web profile 或离线包的用户使用，配套 DSH 0.2.0-rc.2。

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor@8.1.0
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor-retrieval@8.1.0
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor-companion@8.1.0
dsh --profile scriptor
```

已有 profile 不再初始化。Desktop 使用自己的 desktop profile，不套用 Web 模板；优先在桌面插件页管理。

完整版 @linfengqaqtat/dsh-scriptor-full@8.1.0 仅聚合主包与检索，不能与两个单独入口混装；桌宠独立可选。

## 旧包迁移

先停止实例，备份 profile 和作品。只卸载实际安装过的旧入口：webnovel-embedding-provider、@linfengqaqtat/dsh-whale-companion，或旧 full。再安装新版。不要在同一启用配置中保留旧包和新包。

如果 cordis.patch.yml 中有显式 name 覆盖，把模块引用 webnovel-embedding-provider（及 /scenes、/reranking）换为 @linfengqaqtat/dsh-scriptor-retrieval 对应入口，桌宠模块换为 @linfengqaqtat/dsh-scriptor-companion。条目 id 仍是 webnovel-embeddings、webnovel-scenes、webnovel-reranking、whale-companion；保留 config 和凭据引用，不全局替换这些稳定 id。先核对 dump-config，再启动并验证设置。

Windows 替换已加载包可能遇到占用。使用应用菜单完全退出后重装同一发行原件，核对实际安装文件；不要删除 profile 或作品来解决缺包。
