# 从公开源码开发

使用公开 v8 分支，推荐 Node 24.15.0、pnpm 11.27.1（源码构建与宿主插件管理统一为该版本）。无需私人任务文件或原书。

```text
git clone --branch v8 --single-branch https://github.com/lingfengQAQ/webnovel-writer.git
cd webnovel-writer
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm test:release
pnpm build
pnpm --filter @linfengqaqtat/dsh-scriptor typecheck
pnpm --filter @linfengqaqtat/dsh-scriptor dump-config-check
pnpm --filter @linfengqaqtat/dsh-scriptor pack-check
pnpm check:public
```

常规检查使用合成夹具与固定响应，无需 API key。`SCALE_BENCH=1` 的容量测试和真实模型评测单独运行，不是普通 PR 的前提。大规模容量报告写入 `.tmp/scale-benchmark/`。

## 目录

| 目录 | 职责 |
| --- | --- |
| packages/core | 书仓、状态推导、规划、账本、记忆、检索、导出与安全写入 |
| packages/bundle | 宿主接线、原生客户端、随包技能和打包 |
| packages/drafting、review、polish | 写稿、审读和修改相关实现 |
| packages/embedding-provider | 独立可选模型提供方与原生设置 |
| scripts/release | 公开源码检查、版本、许可证、发行与安装验收 |

阅读 [书仓契约](book-format.md) 后修改涉及数据的代码。变更行为带回归测试，文件写入复用现有事务、路径和作者授权通道。

安装已构建的 DSH 后，可使用 `packages/bundle/scripts/start-local.mjs`，传入该 CLI 的实际 `lib/bin.js` 路径；启动器动态生成本机 patch，不需要仓库里的绝对路径文件。开发用 patch 与正式安装入口不要同时启用。

发行构建只内联项目实现和普通依赖，Cordis/DSH/React 等宿主共享模块保留 peer 身份。构建生成原始第三方声明，并通过实际 tarball 检查证明随包内容。

提交前查看 [CONTRIBUTING](../CONTRIBUTING.md)。主线只合入审阅后的 PR；首次发行和后续更新见 [发行说明](maintenance/releasing.md)。
