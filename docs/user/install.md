# 安装 v8 预览版

适用于 Windows。推荐 Node.js 24.15.0；也支持 22.19.0 起的 Node 22。DSH 固定为 0.1.5-rc.2，宿主插件管理使用 pnpm 11.27.1。v6 的 Claude Code 安装方式不适用于此分支。

## 1. 准备运行环境

先安装对应的 Node.js、Git for Windows 和 PowerShell 7，再在 PowerShell 执行：

```powershell
node --version
git --version
pwsh --version
npm install --global pnpm@11.27.1 @deepseek-ai/dsh@0.1.5-rc.2
pnpm --version
dsh --version
```

Node、pnpm、DSH 预期版本分别属于上述范围、11.7.0、0.1.5-rc.2；Git 与 PowerShell 7 应能正常输出版本。安装依赖需要网络。Git 用于建书和保存确认后的版本历史；预构建包无需 TypeScript 或 npm 账号。若另一个 DSH 已在使用，请先阅读备份说明，并用不同的 profile 名称安装本工作台。

源码仓库的 packageManager 与宿主插件管理同为 pnpm 11.27.1。遇到 `ERR_PNPM_ADDING_TO_ROOT` 时先核对启动 DSH 的终端中 `pnpm --version`，不要随意忽略工作区保护或安装第二份宿主 peer。

## 2. 下载并核对

打开 [本版 Release](https://github.com/lingfengQAQ/webnovel-writer/releases/tag/scriptor-v0.1.0-preview.3)，下载主包 `linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz` 和 `SHA256SUMS`。

把包放入你有写权限的**无空格目录**。下面以 `C:/scriptor-dist` 为例；可换成另一处无空格目录。当前宿主在 Windows 转发安装参数时存在空格路径限制。

```powershell
Get-FileHash -Algorithm SHA256 C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz
```

把输出与 SHA256SUMS 对应文件行比较，大小写不影响判断；不一致时重新下载并停止安装。GitHub 自动生成的 Source code 压缩包用于开发，不是插件安装包。

## 3. 创建 Web profile 并安装

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz
dsh --profile scriptor --dump-config
```

首次创建必须使用 `web` 模板；直接向不存在的 profile 添加插件可能只得到无 Web 界面的基础配置。已有同名 profile 时请换名或先确认用途。

配置应包含 `@linfengqaqtat/dsh-scriptor`。安装时五个宿主共享 peer 的提示不代表需要再装一份 Cordis/React；它们由 DSH 提供。若实际启动报模块缺失，按排错教程核对宿主版本，不能仅忽略错误。

## 4. 启动

先准备一个专门存作品的空白工作目录，在该目录启动：

```powershell
dsh --profile scriptor --host 127.0.0.1 --port 6104 --no-open
```

使用**当前进程输出的完整启动链接**打开页面，链接中的 token 不要发到 Issue 或截图。端口占用时换一个空闲端口。关闭这个终端或按 Ctrl+C 停止实例。

在界面中创建任务，工作目录选择准备好的目录。配置主模型后，按 [首书教程](first-book.md) 开始；随包技能自动挂载，无需设置技能目录，也不要同时加载开发用 file patch。

可选检索提供方见 [配置教程](configuration.md)。升级或卸载见 [备份与升级](upgrade-backup.md)，启动失败见 [排错](troubleshooting.md)。
