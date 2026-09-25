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

Node、pnpm、DSH 预期版本分别属于上述范围、11.27.1、0.1.5-rc.2；Git 与 PowerShell 7 应能正常输出版本。安装依赖需要网络。Git 用于建书和保存确认后的版本历史；安装包无需编译，也不需要 npm 账号。若另一个 DSH 已在使用，请先阅读备份说明，并用不同的 profile 名称安装本工作台。

安装插件时如果报 `ERR_PNPM_ADDING_TO_ROOT`，多半是终端里的 pnpm 不是 11.27.1：先执行 `pnpm --version` 核对，版本不对就按上面的命令重装。

## 2. 从 npm 安装（推荐）

首次创建 Web profile，再安装预览版：

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor@preview
dsh --profile scriptor --dump-config
```

需要主插件和嵌入提供方时，在新的 profile 中把上面的主包安装命令替换为 `dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor-full@preview`。完整版默认不开启嵌入 API，也不包含模型额度。两种安装方式选一种，避免组合配置重复加载。

本版精确版本为 `0.1.0-preview.5`；需要固定版本时用 `@0.1.0-preview.5` 替换 `@preview`。公开安装无需 npm 账号。首次创建必须使用 `web` 模板；已有同名 profile 时请换名或先确认用途。

配置应包含 `id: webnovel`；完整版还应包含 `id: webnovel-embeddings`，各一份。安装过程中出现 missing peer（缺少依赖）提示属正常，这些组件由 DSH 自带，不需要另装；若启动时真的报模块缺失，按排错教程核对 DSH 版本。完成后进入第 4 步启动。

## 3. 离线安装包备选：下载并核对

打开 [本版 Release](https://github.com/lingfengQAQ/webnovel-writer/releases/tag/scriptor-v0.1.0-preview.5)，下载主包 `linfengqaqtat-dsh-scriptor-0.1.0-preview.5.tgz` 和 `SHA256SUMS`。

这里的离线备选指本地插件安装包；首次安装宿主及普通依赖仍可能需要网络。

把包放入你有写权限的**无空格目录**。下面以 `C:/scriptor-dist` 为例；可换成另一处无空格目录。当前宿主在 Windows 转发安装参数时存在空格路径限制。

```powershell
Get-FileHash -Algorithm SHA256 C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.5.tgz
```

把输出与 SHA256SUMS 对应文件行比较，大小写不影响判断；不一致时重新下载并停止安装。Release 页面上 GitHub 自动生成的 Source code 压缩包是源代码，不能用来安装。

### 从 tarball 创建 Web profile 并安装

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.5.tgz
dsh --profile scriptor --dump-config
```

首次创建必须使用 `web` 模板；直接向不存在的 profile 添加插件可能只得到无 Web 界面的基础配置。已有同名 profile 时请换名或先确认用途。

配置应包含 `@linfengqaqtat/dsh-scriptor`。安装时的 missing peer 提示同上，无需处理；若启动时真的报模块缺失，按排错教程核对 DSH 版本，不要忽略。

## 4. 启动

先准备一个专门存作品的空白工作目录，在该目录启动：

```powershell
dsh --profile scriptor --host 127.0.0.1 --port 6104 --no-open
```

使用**当前进程输出的完整启动链接**打开页面，链接中的 token 不要发到 Issue 或截图。端口占用时换一个空闲端口。关闭这个终端或按 Ctrl+C 停止实例。

在界面中新建会话，工作区选择准备好的目录。配置主模型后，按 [首书教程](first-book.md) 开始；写作技能随插件自动加载，不需要额外设置。逐屏对照界面安装与首次配置，看 [新手图文教程](beginner.md)。

可选检索提供方见 [配置教程](configuration.md)；界面元素逐个说明见 [界面与按钮参考](ui-reference.md)，检索配置与运行状态见 [增强索引操作指南](enhanced-index.md)。升级或卸载见 [备份与升级](upgrade-backup.md)，启动失败见 [排错](troubleshooting.md)。
