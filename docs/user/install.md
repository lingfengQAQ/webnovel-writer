# 安装 v8 预览版

> 本版 Scriptor preview.7 / 嵌入提供方 0.0.9 面向 **DSH 0.1.7-rc.2**。旧版 preview.6 / 提供方 0.0.8 对应 DSH 0.1.5-rc.2；升级时同时对齐宿主与插件，先备份再重启。

适用于 Windows。推荐 Node.js 24.15.0；也支持 22.19.0 起的 Node 22。DSH 固定为 0.1.7-rc.2，宿主插件管理使用 pnpm 11.27.1。v6 的 Claude Code 安装方式不适用于此分支。

## 为什么要固定 DSH 版本

Scriptor 运行在 DSH 内部，使用它提供的设置、会话、工具和侧栏接口。DSH 目前仍是预发布版本，这些接口会变化。例如 0.1.7 更换了设置接口和消息来源格式，并把会话格式升为 v4；只升级宿主而保留旧插件，可能出现设置卡片消失、插件加载失败或会话读取报错。

因此这里固定的是**已一起验证的宿主与插件组合**，并非“版本越新越好”。安装或更新插件不会自动替你切换全局 DSH；不要把命令里的精确版本改成 `latest`、`next` 或不带版本号。

| 插件来源 | 配套 DSH |
| --- | --- |
| Scriptor 0.1.0-preview.7 / 提供方 0.0.9，以及本分支源码 | **0.1.7-rc.2** |
| 旧版 Scriptor preview.6 / 提供方 0.0.8 | **0.1.5-rc.2** |

每次升级先查目标版本的兼容说明，再同时对齐宿主和插件。下面的命令均面向 preview.7。

## 1. 准备运行环境

先安装对应的 Node.js、Git for Windows 和 PowerShell 7，再在 PowerShell 执行：

```powershell
node --version
git --version
pwsh --version
npm install --global pnpm@11.27.1 @deepseek-ai/dsh@0.1.7-rc.2
pnpm --version
dsh --version
```

Node、pnpm、DSH 预期版本分别属于上述范围、11.27.1、0.1.7-rc.2；Git 与 PowerShell 7 应能正常输出版本。安装依赖需要网络。Git 用于建书和保存确认后的版本历史；安装包无需编译，也不需要 npm 账号。若另一个 DSH 已在使用，请先阅读备份说明，并用不同的 profile 名称安装本工作台。

安装插件时如果报 `ERR_PNPM_ADDING_TO_ROOT`，多半是终端里的 pnpm 不是 11.27.1：先执行 `pnpm --version` 核对，版本不对就按上面的命令重装。

## 2. 安装插件

首次创建 Web profile，再安装精确版本的主包：

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor@0.1.0-preview.7
# 可选：增加嵌入、场景识别与重排；默认关闭
dsh plugin --profile scriptor add webnovel-embedding-provider@0.0.9
```

也可下载对应 Release 的 tarball，核对 SHA256 后放到无空格目录安装。源码构建方式见 [开发说明](../development.md)。以下本地包命令与上面的 npm 安装方式二选一：

```powershell
dsh --profile scriptor --from-default-profile web --dump-config
dsh plugin --profile scriptor add C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.7.tgz
# 可选：增加嵌入、场景识别与重排；默认关闭
dsh plugin --profile scriptor add C:/scriptor-dist/webnovel-embedding-provider-0.0.9.tgz
dsh --profile scriptor --dump-config
```

配置应包含 `id: webnovel`；增加提供方后还应包含 `webnovel-embeddings`、`webnovel-scenes`、`webnovel-reranking`，各一份。首次必须使用 `web` 模板；已有同名 profile 时请换名。

安装时 missing peer 提示本身无需处理，宿主提供这些组件；实际启动缺模块时按排错教程处理。若希望一次安装主包和提供方，可改用 `@linfengqaqtat/dsh-scriptor-full@0.1.0-preview.7`；不要同时保留完整版和分别安装入口。

### 从单装切换为完整版

full 不会自动接管已经单独安装的主包或提供方。包管理器复用依赖文件，也不代表 DSH 会合并安装入口；混装会叠加重复配置。

先停止该 profile 的实例，按 [备份说明](upgrade-backup.md) 保存资料，再查看当前直接安装的包：

```powershell
dsh plugin --profile scriptor list --depth 0
dsh plugin --profile scriptor add @linfengqaqtat/dsh-scriptor-full@0.1.0-preview.7
```

只有上面的安装成功后才继续。根据列表移除原有的单装入口；如果原来两个都安装了，执行：

```powershell
dsh plugin --profile scriptor remove @linfengqaqtat/dsh-scriptor webnovel-embedding-provider
dsh --profile scriptor --dump-config
```

只单装了一个包时，`remove` 后只写那个包名。不要把未安装的包名一起传入，pnpm 会拒绝该次卸载。full 会继续保留所需依赖，这一步只是撤掉独立安装入口。整个切换期间不要启动实例；确认 `webnovel`、`webnovel-embeddings`、`webnovel-scenes`、`webnovel-reranking` 各一份后再启动。

完成切换后，移除 full 即可撤掉整套插件入口。尚未切换的混装或单装状态，需要按 [实际安装组合卸载](upgrade-backup.md#卸载与重装)。

## 3. 核对安装包

首次安装宿主及依赖仍可能需要网络。使用构建方提供的校验和核对实际 tarball：

```powershell
Get-FileHash -Algorithm SHA256 C:/scriptor-dist/linfengqaqtat-dsh-scriptor-0.1.0-preview.7.tgz
```

校验和应来自同一份 [preview.7 Release](https://github.com/lingfengQAQ/webnovel-writer/releases/tag/scriptor-v0.1.0-preview.7) 的 SHA256SUMS；不能拿旧版本的校验和核对新包。

## 4. 启动

先准备一个专门存作品的空白工作目录，在该目录启动：

```powershell
dsh --profile scriptor --host 127.0.0.1 --port 6104 --no-open
```

使用**当前进程输出的完整启动链接**打开页面，链接中的 token 不要发到 Issue 或截图。端口占用时换一个空闲端口。关闭这个终端或按 Ctrl+C 停止实例。

在界面中新建会话，工作区选择准备好的目录。配置主模型后，按 [首书教程](first-book.md) 开始；写作技能随插件自动加载，不需要额外设置。逐屏对照界面安装与首次配置，看 [新手图文教程](beginner.md)。

可选检索提供方见 [配置教程](configuration.md)；界面元素逐个说明见 [界面与按钮参考](ui-reference.md)，检索配置与运行状态见 [增强索引操作指南](enhanced-index.md)。升级或卸载见 [备份与升级](upgrade-backup.md)，启动失败见 [排错](troubleshooting.md)。
