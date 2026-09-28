# Webnovel Writer · 网文写作工作台

> 本版 Scriptor preview.7 / 嵌入提供方 0.0.9 面向 **DSH 0.1.7-rc.2**。旧版 preview.6 / 提供方 0.0.8 对应 DSH 0.1.5-rc.2；升级时同时对齐宿主与插件，先备份再重启。

DSH 插件 `@linfengqaqtat/dsh-scriptor`，包含工作台、10 个写作技能和七个脚本入口。
要求 Node.js ^22.19.0 或 ^24.0.0，DSH 0.1.7-rc.2。许可证 GPL-3.0-only。

## 安装预览版

首次创建桌面 profile，再安装并校验本版 tarball：

```powershell
dsh --profile webnovel --from-default-profile web --dump-config
dsh plugin --profile webnovel add C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.7.tgz
dsh --profile webnovel --host 127.0.0.1 --port 6104 --no-open
```

通过该进程输出的带 token 链接打开页面。随包技能自动发现，无需设置技能目录。
不要同时启用旧开发 file patch 与正式安装入口。模型与凭据在宿主设置中配置。
嵌入提供方 `webnovel-embedding-provider` 是可选的独立包，提供语义检索增强。
可执行 `dsh plugin --profile webnovel add C:/scriptor-dist/webnovel-embedding-provider-0.0.9.tgz` 添加嵌入提供方。也可改用同版本的完整版，避免同时保留两种安装入口。

## 更新与卸载

先停止指定 profile 的运行实例，再安装目标精确版本并重启（本版为 `C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.7.tgz`）。
卸载后可执行上面的安装命令重装：

```powershell
dsh plugin --profile webnovel remove @linfengqaqtat/dsh-scriptor
dsh --profile webnovel --dump-config
```

卸载插件不会删除作品书仓。安装不需要源码、安装时构建或 npm 账号。tarball 放在无空格目录，并核对对应 Release 提供的 SHA256。首次下载宿主依赖仍可能需要网络。

## 预览版与公开文档

当前主包 0.1.0-preview.7。完整的安装、配置、首章和备份教程见 [公开使用文档](https://github.com/lingfengQAQ/webnovel-writer/tree/v8/docs/user)。

第三方组件的原始声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可证文本随包放在 licenses/。源码及校验和由对应的 GitHub Release 提供。
