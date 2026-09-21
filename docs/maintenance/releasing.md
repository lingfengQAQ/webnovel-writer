# v8 维护与发行规范

## 分支与提交

公开 v8 只接受基于公开历史的主题 PR。提交标题使用 fix/feat/docs/chore 等类型，写清最终行为；不上传内部开发记录。v6 仍以 master 为默认入口，两条产品线不互相整树合并。

有额外私有开发仓的维护者必须先把公共 PR 回流，再同步新的公共改动。同步应核对增删改和上游 HEAD；不得覆盖未知贡献、强推公开主线或用 `push --all`、`--mirror`、批量标签推送发布。开发仓推送由 pre-push hook 按私有路径硬拦截（`tools/git-hooks/pre-push`，`pnpm install` 自动启用）；`--no-verify` 绕过视同违反公开边界。

## 版本

主包 `packages/bundle/package.json` 是安装包版本真源，根 workspace 同步该版本。`pnpm check:version` 核对 CHANGELOG；发行时 `RELEASE_TAG` 必须等于 `scriptor-v<version>`。

- 同一预览目标递增 preview.1、preview.2；每份公开安装包的版本唯一。
- 兼容修复递增 patch；0.x 的新增能力/不兼容变化递增 minor，并说明迁移影响。
- 1.x 后按 SemVer 承诺：破坏兼容递增 major，兼容功能 minor，修复 patch。
- 纯文档修改不必发包。内部 workspace 包不独立发版；可选提供方按自己的变更递增并列出兼容组合。

tag、CHANGELOG、包版本和附件必须对应。不得替换已发布同版本的字节；有错误就发布新版本。源码/打包位级可复现未作保证，验收和上传必须使用同一份生成的 tgz。

## 发版前

1. 发布 PR 更新版本、锁文件、CHANGELOG、支持矩阵和必要教程。
2. CI 全绿、讨论解决，公共内容扫描和依赖许可证核对通过后合入 v8。
3. 在干净公共 checkout 执行完整测试、构建和实际 tarball 校验。根测试之外，发行还跑 `pnpm -r --workspace-concurrency=1 test`。
4. 确认没有尚未说明的格式迁移、数据恢复或真实模型限制。

## 生成与验收

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm test:release
pnpm -r --workspace-concurrency=1 test
pnpm release:build
```

`release:build` 拒绝脏源码、非公开文件和非空输出目录；构建后核对声明，pack 一次，检查主包和可选包，生成对应源码、第三方源码材料、公开版本清单与 SHA256SUMS。输出默认在 `.tmp/release/<version>/`。

对生成的同一主包、可选包和完整版执行 `pnpm release:smoke -- <main.tgz> <embedding.tgz> <full.tgz>`。它新装固定 DSH，分别创建主包和完整版的独立 Web profile，在源目录不可读的权限环境运行真实 Loader，再核对卸载/重装。首次 npm 发布前，临时本地 registry 提供完整版两个确切依赖的同批 tarball，其他公开依赖转向 npmjs；发布后的 `--registry` 验收全程使用 npmjs。需要 npm 随 Node 提供的 CLI；输出目录保留供故障调查，报告不能冒充真实模型创作验收。

人工再核对浏览器入口、配置与合成首章教程。模型服务的调用费用单独记录；不以程序回归替代模型质量判断。

## 标签与草稿

从已接受的公共 v8 提交创建唯一 `scriptor-v*` tag，显式推送该 tag。v8 Release 工作流会确认提交归属、重复必要检查、生成并验收附件，再创建 draft。工作流不覆盖已经存在的 Release。

Issue/PR 模板在默认 master 生效。v8 的 CI 使用 push/pull_request；发行使用 tag push。只放在 v8 的 workflow_dispatch/schedule 不能作为默认分支上的常规操作入口。

维护者核对 draft 的 tag、公共 SHA、版本、SHA256、附件和说明后发布。预览版设 prerelease=true、latest=false，README 下载链接指向明确版本；不抢占 v6 的默认 Latest。

## npm 预览包发布

三个公开包通过 `v8-npm-publish.yml` 发布；根 workspace 和 `@webnovel/*` 不发布。三个包的 `publishConfig` 固定为 `access: public`、`tag: preview` 和官方 registry。

1. 首次配置：使用拥有 `@linfengqaqtat` scope 及 `webnovel-embedding-provider` 发布权限的 npm 账号创建 granular access token。选择所需包/scope 的读写发布权限，按 npm 当前要求允许自动化发布的 2FA bypass，并设置合适到期时间。未首发的包须确保 token 包含创建它们的权限。token 直接保存到 GitHub 仓库 Settings → Secrets and variables → Actions → `NPM_TOKEN`，不要提交或粘贴到 Issue/对话。
2. Release 草稿生成时已对全部 tarball 执行 npm dry-run。核对附件、校验和和安装报告后，通过 GitHub 界面发布预览 Release；订阅的是 `release: published`，可以覆盖从草稿发布预览版的情况。
3. Ubuntu 发布 job checkout 对应 tag、确认属于公共 v8，下载原 `.tgz`、manifest 与 SHA256SUMS。发布器校验 tag、公共 commit、包版本及哈希，先预检全部包，再按主包 → 嵌入包 → 完整版执行 `npm publish --access public --tag preview --provenance`。不重新打包。
4. 工作流使用 `id-token: write` 生成 provenance，`NPM_TOKEN` 只注入发布步骤；安装 job 不接收 npm token。npm 发布成功后，Windows job 按 registry 上的精确版本安装，并验证主包/完整版真实 Loader。
5. 核对 `npm view <包名> dist-tags --json`：`preview` 为本次版本，预览版不占 `latest`。安装示例必须使用 `@preview` 或精确版本。

本地仅预检：在该公共 tag checkout 中设置 `RELEASE_TAG`，执行 `node scripts/release/publish-npm.mjs --assets <附件目录>`。默认不发布；`--verify-only` 仅验证已发 registry 版本及完整性。

部分发布失败时重跑同一 Actions run，保留原附件。已存在版本只有 tarball 的 SHA512 与 registry integrity 完全一致才跳过；字节不同或 `latest` 错指预览版时停止，由维护者调查。不要以同一版本重新 pack 后重试。实际 registry 发布与安装 job 全绿后才能宣布 npm 安装可用。

## 失败与恢复

失败保留检查记录和草稿，不宣布发布成功。需要改源码时用新提交与新预览版本；发布后的问题以修复版和已知问题说明处理。代码回退不能自动还原已迁移的书仓，应提供备份恢复边界。

## 社区与依赖

外部贡献由维护者审核；单维护者不设置无法满足的第二人必审。保护 v8 的必要检查、已解决讨论和禁强推/禁删除规则。Actions 使用固定 commit、最小权限，fork PR 不获得秘密或发版权限。

依赖变更审查 lockfile、实际内联清单和原始许可；高风险漏洞需修复或给出可核对的范围/处置记录。若未来启用定期更新，在 master 配置并显式指向 v8，避免误改旧产品线。
