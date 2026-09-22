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

### 首次发布：当前工作流

1. 使用拥有 `@linfengqaqtat` scope 及 `webnovel-embedding-provider` 发布权限、已启用 2FA 的 npm 账号创建短期 granular access token。Packages and scopes 的权限选择 **Read and write (publish and stage)**，启用 **Bypass two-factor authentication**。不能选择 **stage only**，否则当前 `npm publish` 会报 `E_STAGE_REQUIRED`。未首发的包须确保 token 包含创建它们的权限；只勾选已存在包不能代表已授权新包，Organizations 管理权限也不等于包发布权限。token 保存到 GitHub 仓库 Settings → Secrets and variables → Actions → `NPM_TOKEN`，不要提交或粘贴到 Issue/对话。
2. Release 草稿生成时已对全部 tarball 执行 npm dry-run。核对附件、校验和和安装报告后，通过 GitHub 界面发布预览 Release；订阅的是 `release: published`，可以覆盖从草稿发布预览版的情况。
3. Ubuntu 发布 job checkout 对应 tag、确认属于公共 v8，下载原 `.tgz`、manifest 与 SHA256SUMS。发布器校验 tag、公共 commit、包版本及哈希，先检查全部包的 registry 状态，再预检所有待上传包，按主包 → 嵌入包 → 完整版上传原 tarball。不重新打包。实际命令形状为：

   ```text
   npm publish <已验收的原件.tgz> --dry-run --ignore-scripts --access public --tag preview --registry=https://registry.npmjs.org/
   npm publish <同一原件.tgz> --ignore-scripts --access public --tag preview --registry=https://registry.npmjs.org/ --provenance
   ```

   第一条须对所有待上传包成功执行后，才能执行任何第二条。dry-run 不证明账号具备发布权限，也不验证完整 provenance 上传链路。
4. 工作流使用 `id-token: write` 生成 provenance，`NPM_TOKEN` 只注入发布步骤；安装 job 不接收 npm token。npm 发布成功后，Windows job 按 registry 上的精确版本安装，并验证主包/完整版真实 Loader。
5. 核对 `npm view <包名> dist-tags --json`：`preview` 为本次版本，预览版不占 `latest`。安装示例必须使用 `@preview` 或精确版本。

本地仅预检：在该公共 tag checkout 中设置 `RELEASE_TAG`，执行 `node scripts/release/publish-npm.mjs --assets <附件目录>`。默认不发布；`--verify-only` 仅验证已发 registry 版本及完整性。

部分发布失败时重跑同一 Actions run，保留原附件。已存在版本只有 tarball 的 SHA512 与 registry integrity 完全一致才同时跳过 dry-run 和上传，最后仍核对全部包的字节与 `preview`。npm 11/12 对已发布正式版本连 dry-run 也会拒绝，因此嵌入包 `0.0.8` 已成功、完整版失败时不能再预检嵌入包。字节不同或 `latest` 错指本次版本时停止，由维护者调查。不要以同一版本重新 pack 后重试。实际 registry 发布与安装 job 全绿后才能宣布 npm 安装可用。

2026-09-22 的真实首发确认了两个 registry 行为：发布前的 404 可被 CDN 缓存五分钟；即使上传指定 `--tag preview`，三个新包仍同时出现指向本次版本的 `latest`。发布器现用独立查询参数绕过旧缓存，并为每包进行至多 40 轮、间隔 3 秒的可见性检查（单次请求超时 30 秒）。不能仅凭 CLI 的上传成功行或指定过 `--tag preview` 就宣布发行验收通过。

首发标签恢复工具 `node scripts/release/repair-first-publish.mjs --assets <原附件目录>` 默认只列计划。它核对 tag 属于公共 v8、附件清单和全部 registry 字节，要求每个包只有这一个版本且 `preview` 正确。只有 `latest` 缺失或正指向本次版本才接受；多版本历史、异字节或其他 latest 均拒绝。在 GitHub Actions 中显式加 `--apply` 后，只移除该首次发行的隐式 latest，再验证 preview/integrity。该工具不会重新上传包，也不能用于清理已经存在正式版历史的包。

`v8-npm-recovery.yml` 仅处理 `scriptor-v0.1.0-preview.5`，由专用公共主题分支触发标签恢复与无 token 的 Windows registry 安装验收。旧上传运行的失败记录保留；恢复运行提供补完验收的证据。

### 后续自动发布：推荐迁移到 Trusted Publishing

截至 2026-09-22，npm 推荐 OIDC Trusted Publishing，避免长期保存发布 token。npm 官方已宣布 **2027 年 1 月移除 granular token 直接发布新版本的能力**；当前 token 工作流可用于首次发布，但需要在此之前迁移。

Trusted Publisher 要求包已存在，staged publishing 也不能用于创建全新包。因此先完成三个包的真实首发，再为每个包配置可信发布者：

| npm 设置项 | 本项目值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `lingfengQAQ` |
| Repository | `webnovel-writer` |
| Workflow filename | `v8-npm-publish.yml`（只填文件名） |
| Environment name | 当前工作流未声明 environment，留空 |
| Allowed actions | 允许 `npm publish`，保持当前自动发布方式 |

2026-09-03 后创建的可信发布者默认允许暂存；要直接发布须额外允许 `npm publish`。使用 GitHub-hosted runner、`id-token: write`、Node ≥22.14.0 和 npm ≥11.5.1，三个包的 `repository.url` 必须与公共 GitHub 仓库精确匹配。公开仓库和公开包在 OIDC 发布时自动生成 provenance。

**当前发布器仍强制要求 `NODE_AUTH_TOKEN`，尚未迁移为无 token 发布。** 迁移时须修改该断言、验证工作流使用的 npm 版本并补无 token 的认证回归；仅在 npm 网站设置 Trusted Publisher 不够。验证 OIDC 实际发布成功后，再撤销首发 token 并移除 GitHub 的 `NPM_TOKEN`。`npm whoami` 不反映 OIDC 发布认证状态，不能当作它的预检。

如果希望每个版本增加人工确认，可改为 `npm stage publish <原件.tgz>`，维护者用 2FA 审查并批准，再运行 registry 安装验收。这会改变当前自动发布与安装 job 的衔接，不能只替换 token 权限或一条命令。

官方依据（核对于 2026-09-22）：[发布命令](https://docs.npmjs.com/cli/v12/commands/npm-publish/)、[创建 granular token](https://docs.npmjs.com/creating-and-viewing-access-tokens/)、[token 权限与淘汰时间](https://docs.npmjs.com/about-access-tokens/)、[Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[首次配置的前提](https://docs.npmjs.com/cli/v12/commands/npm-trust/)、[provenance](https://docs.npmjs.com/generating-provenance-statements/)、[staged publishing](https://docs.npmjs.com/staged-publishing/)。

## 失败与恢复

失败保留检查记录和草稿，不宣布发布成功。需要改源码时用新提交与新预览版本；工作流 checkout 的是 tag，分支上的发布器修复不会自动进入旧 tag 的重跑，也不能重写旧 tag。发布后的问题以修复版和已知问题说明处理。代码回退不能自动还原已迁移的书仓，应提供备份恢复边界。

## 社区与依赖

外部贡献由维护者审核；单维护者不设置无法满足的第二人必审。保护 v8 的必要检查、已解决讨论和禁强推/禁删除规则。Actions 使用固定 commit、最小权限，fork PR 不获得秘密或发版权限。

依赖变更审查 lockfile、实际内联清单和原始许可；高风险漏洞需修复或给出可核对的范围/处置记录。若未来启用定期更新，在 master 配置并显式指向 v8，避免误改旧产品线。
