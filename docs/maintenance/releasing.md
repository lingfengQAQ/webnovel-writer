# v8 维护与发行规范

## 分支与提交

公开 v8 只接受基于公开历史的主题 PR。提交标题使用 fix/feat/docs/chore 等类型，写清最终行为；不上传内部开发记录。v6 仍以 master 为默认入口，两条产品线不互相整树合并。

有额外私有开发仓的维护者必须先把公共 PR 回流，再同步新的公共改动。同步应核对增删改和上游 HEAD；不得覆盖未知贡献、强推公开主线或用 `push --all`、`--mirror`、批量标签推送发布。开发仓推送由 pre-push hook 按私有路径硬拦截（`tools/git-hooks/pre-push`，`pnpm install` 自动启用）；`--no-verify` 绕过视同违反公开边界。

## 版本

主包 `packages/bundle/package.json` 是安装包版本真源，根 workspace 同步该版本。`pnpm check:version` 核对 CHANGELOG；发行时 `RELEASE_TAG` 必须等于 `scriptor-v<version>`。

- 从 8.0.0 起仅发布正式 SemVer，兼容修复递增 patch，功能更新递增 minor；每份公开安装包版本唯一。
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

标签创建后只修复发行工具时，可从已审阅的新公共工具 checkout 运行 `pnpm release:build -- --source <干净的原标签目录> --out <新空目录>`，并设置 `RELEASE_TAG`。源码 HEAD 必须等于该标签，版本与 manifest.publicCommit 仍来自原源码。若前次打包已完成、仅源码附件收集失败，额外传 `--packages <原四包目录>` 复用原 tgz，重新执行实包检查；禁止用它替换已发布附件或绕过源码/安装验收。

第三方源码定位来自已审阅工具中的 upstream-sources.json。默认必须提供准确上游提交；个别旧包确实只提供随 npm 分发的 TypeScript 源码时，只能按确切版本显式记录 registry 原件 integrity、源码文件数量和内容摘要。缺文件、内容或字节不符仍拒绝，清单明确 sourceKind 和无上游提交，不伪造 gitHead。

对生成的同一主包、可选包和完整版执行 `pnpm release:smoke -- <main.tgz> <embedding.tgz> <full.tgz>`。它新装固定 DSH，分别创建主包和完整版的独立 Web profile，在源目录不可读的权限环境运行真实 Loader，再核对卸载/重装。首次 npm 发布前，临时本地 registry 提供完整版两个确切依赖的同批 tarball，其他公开依赖转向 npmjs；发布后的 `--registry` 验收全程使用 npmjs。需要 npm 随 Node 提供的 CLI；输出目录保留供故障调查，报告不能冒充真实模型创作验收。

人工再核对浏览器入口、配置与合成首章教程。模型服务的调用费用单独记录；不以程序回归替代模型质量判断。

## 标签与草稿

从已接受的公共 v8 提交创建唯一 `scriptor-v*` tag，显式推送该 tag。v8 Release 工作流会确认提交归属、重复必要检查、生成并验收附件，再创建 draft。工作流不覆盖已经存在的 Release。

Issue/PR 模板在默认 master 生效。v8 的 CI 使用 push/pull_request；发行使用 tag push。只放在 v8 的 workflow_dispatch/schedule 不能作为默认分支上的常规操作入口。

维护者核对 draft 的 tag、公共 SHA、版本、SHA256、附件和说明后发布。正式版设 prerelease=false、latest=true，README 下载链接指向明确版本；默认分支保持 master，v6 历史与安装入口不变。

## npm 正式包发布

从 8.0.0 起，写作、检索增强、鲸鱼娘、完整版四个公开包同步版本，publishConfig 固定 public/latest/npmjs。根 workspace 与 @webnovel/* 不发布。旧 preview 标签保留历史，不再更新。

Release 草稿生成时，发布器核对公共 SHA、tag、四包身份、版本、校验和、许可证与 full 精确依赖，对所有待发布包先 dry-run，再允许上传。同版本只能接受字节一致的重试，不能重新打包覆盖。

正式 Release 设 prerelease=false、latest=true。发布使用 v8-npm-publish.yml，由仓库 NPM_TOKEN secret 在发布步骤中注入 NODE_AUTH_TOKEN；setup-node 为 npmjs 配置认证。token 须允许四包直接发布，并满足包的 2FA 要求，不能使用仅暂存权限的 token。id-token: write 仅用于 provenance 来源证明。验证 npm latest 与 SHA512 后，再跑空白 profile 的 registry 安装、卸载与重装验收。token 缺失、过期或无权限时保留发行草稿和产物，不能宣布发布完成。

本地默认只预检：node scripts/release/publish-npm.mjs --assets <附件目录>。--verify-only 检查 registry；--publish 只在 Actions 中可用。

安装验收必须传入 --companion <同批桌宠.tgz>。full 只依赖写作与检索，桌宠独立安装。用户通过侧栏插件页安装，进阶命令见 [CLI 维护说明](cli-install.md)。

### 早期 preview 发行记录

以下内容保留早期预览发行的 registry 经验，不是 8.x 发布步骤。

### 首发后的 `latest`：npm 的固定行为

npm 会把包的**首个版本**同时标为 `latest`，即使上传指定了 `--tag preview`；registry 不允许删除 `latest`（`npm dist-tag rm <包> latest` 返回 403），只能用 `npm dist-tag add <包>@<版本> latest` 移到别的版本（[npm/cli#8490](https://github.com/npm/cli/issues/8490)）。因此：

- 首发后 `latest` 与 `preview` 同指首个预览版是正常状态，不需要也无法「恢复」。发布器只在 registry 已有正式版本、而 `latest` 仍指向预览版时才判定为污染。
- 首个正式版发布时 npm 会自动把 `latest` 移过去；之后的预览版用 `--tag preview` 上传不会再碰 `latest`。
- 面向用户的安装命令一律写 `@preview` 或精确版本；`dsh plugin add @linfengqaqtat/dsh-scriptor` 不带标签会装到 `latest`，首发期间恰好也是预览版，正式版发布后则装到正式版。

2026-09-22 的真实首发（`scriptor-v0.1.0-preview.5`）确认了两个 registry 行为：发布前的 404 可被 CDN 缓存五分钟；三个新包在显式 `--tag preview` 上传后都同时出现 `preview` 与 `latest`。当时的发布器把后者当作污染而在上传后的校验阶段失败（三包已上传、字节与附件一致、provenance 正常），随后尝试清除 `latest` 的恢复工作流在 registry 处 403，两者都已按上述规则修正。发布器现用独立查询参数绕过旧缓存，并为每包进行至多 40 轮、间隔 3 秒的可见性检查（单次请求超时 30 秒）。不能仅凭 CLI 的上传成功行或指定过 `--tag preview` 就宣布发行验收通过。

### Trusted Publishing 历史配置与首次初始化

2026-10-03 起按维护者要求恢复 npm token 认证，上节为当前流程。以下保留此前 OIDC 配置与首次初始化经验；已有 trust 不代替当前工作流要求的 NPM_TOKEN。

npm >=11.5.1、Node >=22.14.0 支持 GitHub-hosted Actions 的 OIDC 发布；工作流固定安装 npm 12.0.1，授予 id-token: write，发布器要求 Actions 的 OIDC 环境而非长期 npm token。

每个包的 npm Settings → Trusted Publisher 使用 GitHub Actions，owner 为 lingfengQAQ，repository 为 webnovel-writer，workflow 为 v8-npm-publish.yml，environment 留空。启用 Allow npm publish，才能直接发布；只允许 stage publish 时仍须维护者批准候选。

包必须先存在才能配置 trust。npm 最新 [staged publishing](https://docs.npmjs.com/staged-publishing/)（2026-09-29 更新）支持新包：交互登录后暂存真实发行 tgz，会公开创建 0.0.0-stage 占位；维护者通过网页或 CLI 加 2FA 批准后才发布候选内容。npm stage 要求 >=11.15.0。不能从 GitHub OIDC 直接初始化完全不存在、尚未配置 trust 的包；也不要为占位随意发布虚假代码。

对于已经生成的不可变 tag，不能移动 tag 或重打包。可从默认分支注册的 workflow_dispatch 入口选择 v8 分支及原 release_tag：工具从已审阅 v8 取得，源码按原 tag checkout，校验 manifest.publicCommit 与原 tag HEAD 后消费原附件。registry 安装验收通过后由工作流发布 draft 为 Latest；GitHub token 发布不会重复触发旧标签中的发布流程。

浏览器保存信任关系可能要求密码和 2FA。维护者自行完成账户验证，不把密码或验证码写进仓库或日志。npm whoami 只反映 CLI 登录，不代表 Actions OIDC 配置有效。实际四包发布与 registry 安装验证才是成功证据。

官方资料：[Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) · [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/) · [Staged publishing](https://docs.npmjs.com/staged-publishing/)。

## 失败与恢复

失败保留检查记录和草稿，不宣布发布成功。需要改源码时用新提交与新预览版本；工作流 checkout 的是 tag，分支上的发布器修复不会自动进入旧 tag 的重跑，也不能重写旧 tag。发布后的问题以修复版和已知问题说明处理。代码回退不能自动还原已迁移的书仓，应提供备份恢复边界。

## 社区与依赖

外部贡献由维护者审核；单维护者不设置无法满足的第二人必审。保护 v8 的必要检查、已解决讨论和禁强推/禁删除规则。Actions 使用固定 commit、最小权限，fork PR 不获得秘密或发版权限。

依赖变更审查 lockfile、实际内联清单和原始许可；高风险漏洞需修复或给出可核对的范围/处置记录。若未来启用定期更新，在 master 配置并显式指向 v8，避免误改旧产品线。
