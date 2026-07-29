# 质量规范

> 版本：基线 1.2（2026-07-23，补持久重试预算、alpha hook 边界与严格 npm 文档白名单）。依据：PRD 1.7 §1.4/§3.7/§5；story-repo-spec 0.18。

---

## 1. 运行时与依赖（硬约束）

1.1 Node ≥ 22；**零第三方运行时依赖**。新增依赖的 PR 必须被驳回，除非先修订 PRD。现行唯一例外：`js-yaml`（YAML 解析用；序列化手写防呆方言）——已按本条流程经 PRD 1.1 / story-repo-spec 0.9（决策 32）修订确认，决策记录见 M1 任务 design §8.1。

1.2 禁止引入 Python、pip、.env；安装即用，无环境配置步骤。

1.3 开发期依赖（测试框架等）允许，但必须不进入发布产物。

## 2. 职责分界（宪法级，评审必查）

2.1 **脚本能做的归脚本，做不到的归 AI 语义判断**：可计数项（字数、频次、格式校验、关键词命中）必须用脚本实现，禁止让模型估算；语义判断（是否真泄密、正文是否写到了某事）必须归 AI，**禁止用正则硬凑语义判断**。

2.2 机检必须零 token；首次失败后最多自动修复两个不同草稿版本，同一草稿内容 hash（含章档案 front matter，行尾归一）重检幂等——只改 front matter 也是一次修复，必须消耗额度。两审的自动预算按轮计：**完整模式**初审 2 次调用（事实审查 1 + 编辑审 1）并最多整对重跑一次，自动上限 4 次；**降级模式**初审 1 个顺序审上下文并最多重跑一次，自动上限 2 个。`工作区/重试预算.json` 按章持久化，`review-input`/`runReviews` 必须在调用模型前预约额度；超限转作者，禁止只靠宿主提示软约束。作者用同一 ReviewInput 重提裁决不计重审；显式批准的额外轮次（`--author-approved`/`--author-confirmed`）单独记账，不恢复自动额度。

2.3 **精准读取**：每类数据文件必须配"定位读到所需一段"的脚本接口；写作材料组装默认用片段，禁止默认整文件读取。

2.4 **机检的阻断语义**：`pass = issues.length === 0` 是既有消费方依赖的契约。新增检查项默认走 `candidates` 通道（`{type, value, description}`，提醒不拦截）；只有产品文档（PRD/spec）明确定为阻断项的才进 `issues`。禁止用 `blocking: false` 的 issue 表达提醒——那会让 pass 误判打回。跨章统计项由体检产出存缓存（meta/`fingerprints`），机检只消费，无数据静默跳过，禁止在机检里做全书扫描。

## 3. 编码与平台（CI 强制）

3.1 一切文件 IO 显式 UTF-8 无 BOM；禁止依赖系统 locale。

3.2 Windows 中文环境是一等公民：CI 必须含 Windows 中文路径全链路测试（建库→写章→定稿→重建缓存）。中文路径、中文文件名在任何代码路径上都必须正确处理。

3.3 书仓库工程化由**建书流程**（`persistCreateBook`，序1）负责：`git init` + `git config core.quotepath false` + `.gitignore`（必含 `.cache/` 与 `工作区/`）。`git init` 幂等可重复；`.gitignore` 追加不覆盖既有条目。M5 安装器只负责宿主侧环境，不再代行书仓库初始化。

3.4 缩进两空格。

## 4. 测试要求

4.1 每个 CI 验收项对应 PRD/spec 的一条可验证承诺，最低集合：

- 删光 `.cache/` 全量重建，查询结果不变；
- Windows 中文路径全链路；
- 定稿原子性（中途失败时工作区原样保留）；
- 防呆方言（系统写出的 YAML 平铺/块列表/危险值引号）；
- 安装链路端到端（M5，双平台 install-e2e）：npm pack 产物装进干净中文路径目录 → init → vendored bin 建书 → next → update 幂等；
- 主循环全程 CLI（M5）：建书→细纲→备料→机检→两审→定稿→next 报下一章，子进程 spawn bin，不走进程内调用。

4.2 修 bug 必须附回归测试；同一问题第二次出现视为流程缺陷，必须复盘。

## 5. 评审清单（PR 必过）

- [ ] 不新增运行时依赖、不引入 Python
- [ ] 作者界面文案符合术语表（PRD §8），无废止词、无机器味
- [ ] 错误路径符合错误处理规范（永不带堆栈崩溃）
- [ ] 可计数逻辑在脚本里，语义判断不在正则里
- [ ] 行为变更先改了文档（PRD/spec），代码与文档一致

## 6. 工具链与约定（已定）

6.1 测试框架：Node 内置 `node:test` + `node:assert/strict`（`npm test` = `node --test`）。无第三方测试依赖。

6.2 lint / 格式化：**零依赖铁律下不引入 ESLint/Prettier**。语法用 `node --check` 兜底；确定性用宿主壳 drift check（`node scripts/build-host-shells.mjs --check`）+ package validator 兜底。缩进两空格、行尾 LF 由评审清单人工把关。

6.3 退出码：`0` 成功 / `1` 失败（见错误处理规范 §5）。

6.4 commit message 前缀沿用现状：`feat` / `fix` / `docs` / `chore`（本仓库开发用）。发布产物（marketplace/CHANGELOG）版本走 `docs/operations/plugin-release.md` 流程。

6.5 版本号：`v7/package.json` 在 M5 发版前为预发版号（`7.0.0-alpha`）；发版时升 `7.0.0` 并与 README 徽章、`.claude-plugin/marketplace.json`、`plugin.json`、`CHANGELOG.md` 一致——README 版本表是 `plugin-version.yml` CI 硬约束，发版必须同步。

6.6 宿主通道 I/O（M5）：AI 产物回流命令的 JSON 输入一律走 `--file`/`--payload` 文件路径，禁止 stdin（Windows 中文管道编码不可靠）；小体量 DTO 输出走 stdout（`next --json`），含正文全文的大 JSON 落工作区文件（`review-input`）。相对路径相对书仓库根（无书时相对工作目录）解析。

## 7. 场景：CLI 文件 URL 与 npm 发布可移植性

### 7.1 Scope / Trigger

- CLI 把本地命令模块路径交给动态 `import()` 时适用。
- 修改 `v7/package.json`、lockfile、许可证或 npm `files` 白名单时适用。

### 7.2 Signatures

- 文件路径转模块 URL：`pathToFileURL(commandPath).href`，其中 `commandPath` 是 `path.join` 得到的绝对文件系统路径。
- 版本契约：`package.json.version === package-lock.json.version === package-lock.json.packages[''].version`。
- 许可证契约：包与 lockfile 根包的 SPDX 均为 `GPL-3.0-only`；`v7/LICENSE` 与根 `LICENSE` 字节等值。

### 7.3 Contracts

- 禁止手拼 `file:///` 或只替换反斜杠；`#`、`%`、空格和中文必须由标准 URL API 编码。
- npm `files` 必须包含 `LICENSE`，文档项只允许 `docs/knowledge/` 与 `docs/migration-guide.md`，禁止宽泛 `docs/`；pack 产物必须包含许可证，不得包含 v6 `webnovel-writer/` 树、`story-repo-spec` 文件或 `docs/architecture/`。
- 命令模块不存在时保持既有作者面契约：退出码 1、中文“未知命令”、不输出堆栈。

### 7.4 Validation & Error Matrix

| 条件 | 必须结果 |
|---|---|
| 包路径含 `#`/`%`/空格/中文，命令存在 | 动态导入成功，命令正常执行 |
| 命令不存在 | 退出码 1，中文人话错误，stderr 无堆栈 |
| 包/lockfile 版本或 SPDX 漂移 | 元数据测试失败，禁止发布 |
| `v7/LICENSE` 缺失或与根文件不等值 | 元数据测试失败，禁止发布 |
| tarball 缺许可证或混入 v6 树 | pack 发布门禁失败 |
| tarball/安装目录出现 story-repo-spec 或 `docs/architecture/` | pack/install 发布门禁失败 |

### 7.5 Good / Base / Bad Cases

- Good：真实子进程从同时含四类特殊字符的包路径运行已知命令，并验证未知命令错误契约。
- Base：普通 ASCII 路径行为不变。
- Bad：用字符串拼出 `file:///`；只在 `package.json` 声明许可证却不验证随包文件；用仓库根文件清单代替 tarball 清单。

### 7.6 Tests Required

- `v7/test/integration/cli-spawn-smoke.test.js`：复制真实 `bin/src/node_modules` 到特殊路径，断言已知/未知命令。
- `v7/test/package-metadata.test.js`：断言三处版本、两处 SPDX、精确 docs 白名单和许可证字节等值。
- `npm pack --dry-run --json`：断言 tarball 含 `LICENSE`，不含 v6、story spec 或架构文档；`npm --prefix v7 run e2e:install` 对安装包与 `.webnovel/` 重复负向断言。

### 7.7 Wrong vs Correct

```js
// Wrong: # 和 % 会被当作 URL 语义，Windows 盘符处理也不可靠。
const commandUrl = new URL(`file:///${commandPath.replace(/\\/g, '/')}`).href

// Correct: 把文件系统路径交给 Node 标准 API 编码。
const commandUrl = pathToFileURL(commandPath).href
```
