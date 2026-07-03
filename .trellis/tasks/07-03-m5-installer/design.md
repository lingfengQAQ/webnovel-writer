# M5 设计：安装器与多本书 + F1 宿主 CLI 缝

> 上游：prd.md（同目录）。行为依据 multi-agent spec v3.5 §5.5/§5.8/§5.9/§8/§9、story-repo spec 0.9 §2.0/§2.1、实施计划 0.3 M5。

## 1. 架构与边界

新增/改动集中在五处，互不越界：

| 模块 | 职责 | 不做 |
|---|---|---|
| `bin/webnovel-writer.js` | 命令分级（工作目录级 / 书级）+ 工作目录定位 | 业务逻辑 |
| `src/installer/` | init/update 编排：环境检测、vendor 复制、模板哈希清单、壳落位、AGENTS.md 标记块 | 不联网、不改全局配置、不建 git 仓库 |
| `src/session/`（扩展） | books.jsonl 写侧：登记 / 换书 / 最后打开；与 M4 读侧同模块，格式单源 | 不碰书仓库内容 |
| `src/commands/`（新增 12 个） | F1 缝 + 多本书 + 安装器的 CLI 薄壳，全部委托用例层 | 不自带业务判断 |
| `skills/` + `src/host-shells/` + `adapters/` | 命令引用语法模板变量、SKILL.md 写章流程接 F1 通道、registry 扩字段、hook 接线 | 生成器仍不联网、确定性不变 |

### 1.1 命令分级与工作目录定位（B2）

命令模块新增可选导出 `export const scope = 'workdir'`（缺省 `'book'`）。bin 启动流程：

1. `--version` / `--help` / 无命令：现状不变。
2. `scope === 'workdir'` 的命令（init / update / list-books / switch-book / session-context）：ctx 给 `{ workdir: process.cwd(), packageRoot }`，**不建 CacheManager**（init 时书都不存在）。
3. `scope === 'book'` 的命令，按序判定 repoPath：
   - cwd 含 `book.yaml` → 书仓库直启，`repoPath = cwd`（兼容现有全部测试与开发场景）；
   - cwd 含 `.webnovel/` → 读 `books.jsonl`（复用 M4 `readBooksRegistry` + 自愈），取「当前」书 → `repoPath = cwd/<目录>`，并更新该书「最后打开」；无当前书 → 人话指引（「说“建书”开始第一本 / 用 switch-book 选一本」）退出码 1；
   - 两者皆无 → 人话提示「请从工作目录启动（目录下应有 .webnovel/），或在书仓库根目录运行」。
4. 例外：`persist-book` 声明 `scope = 'workdir-or-book'`——建书时书目录还不存在（见 §3.4）。

### 1.2 `.webnovel/` 内容（vendoring，spec §2.0 既定）

```text
.webnovel/
├── bin/webnovel-writer.js      # 与包同源复制
├── src/**                      # 运行时全量
├── roles/*.md                  # 角色任务书单源（三级宿主兜底可读，spec §2.0「角色定义」）
├── node_modules/js-yaml/**     # 唯一运行时依赖，从安装器自身的解析位置复制
├── package.json                # 供 --version
├── manifest.json               # 模板哈希清单（§3.2），installer 写
└── books.jsonl                 # 用户数据，installer 只在缺失时建空文件，永不覆盖
```

- 复制源 = 安装器自身包根（`import.meta.url` 上溯），js-yaml 用 `createRequire(import.meta.url).resolve('js-yaml/package.json')` 定位后整目录复制——npx / npm pack / repo 内直跑三种形态同一逻辑。
- `skills/ adapters/ templates/` 不进 `.webnovel/`：它们只在 init/update 时由**当前运行的包**消费。vendored 副本里跑 `update` 时检测到自己位于 `.webnovel/` 下，提示改用 `npx webnovel-writer update`（自己更新自己是空转）。

### 1.3 平台壳落位与 hook 接线（A1/B4）

- registry.json 每宿主扩两个字段：`detect_bin`（PATH 探测的可执行名：claude / codex / gemini / cursor-agent）、`install_dir`（`.claude` / `.codex` / `.gemini` / `.cursor`）。validator 同步校验一二级宿主必有这两字段。
- 落位 = 生成器输出的相对布局平移进 `install_dir`：`skills/webnovel-writer/SKILL.md`、`agents/<角色>.md|.toml`。
- claude-code（`hasHooks: true`）额外接线 SessionStart：`.claude/settings.json` 的 `hooks.SessionStart` 加一条 `node .webnovel/bin/webnovel-writer.js session-context`。settings.json 已存在时做保留式合并（只增本项，按 command 字符串幂等判重）；不存在时新建最小结构。settings.json **不进哈希清单**（用户主权文件，update 只做同样的幂等合并）。
- 检测：扫 `PATH` 各目录找 `detect_bin`（win32 追加 PATHEXT 扩展名）；纯函数 + 注入 env，可测。`--hosts=a,b` 显式覆盖探测；一个都没检测到 → 只装公约数层（AGENTS.md + `.webnovel/`），报告里指引用 `--hosts` 补装。

### 1.4 命令引用语法模板变量（A4）

- 生成器上下文加 `cmd: 'node .webnovel/bin/webnovel-writer.js'`；SKILL.md 里所有 `webnovel-writer <子命令>` 改写 `{{cmd}} <子命令>`。各宿主当前同值，仍走变量（spec §5.9）。
- SKILL.md 写章流程同步接 F1 通道：备料/机检不变，第 3 步接 `review-input` → 两审（subagent 或顺序自审）→ `save-review`，第 4 步接 `finalize`；「继续」接 `next --json`（AI 吃 DTO）。drift check 逻辑不变（仍是确定性对比）。

## 2. F1 CLI 缝契约（C）

通则：JSON 输入一律 `--file=<路径>`（UTF-8 文件，杜绝 stdin 编码雷区）；stdout 输出人话或 JSON（`--json` 时）；失败人话报错 + 退出码 1，永不带栈。

| 命令 | 入 | 出 | 委托 |
|---|---|---|---|
| `next [--json]` | — | `--json`：完整 `{ok, gitHealth, 序, state, needsAI, message, dto}`；缺省人读不变 | `determineNextState` |
| `review-input <章号> [--draft=路径]` | draft 缺省 `工作区/草稿-A.md`（与 mechanical-check 一致） | 写 `工作区/审稿输入.json`，stdout 报路径（大 JSON 走文件，宿主用读文件工具吃） | `assembleReviewInput` |
| `save-review <章号> --file=<两审json>` | `{factCheck, editorial, mode?, 待确认新专名?, 章摘要?}` | schema 校验→合并→落 `工作区/审稿.md` + `评审报告/`，stdout 报阻断数与路径 | 从 `runReviews` 抽出 `saveReviews`（校验+合并+落盘），两处共用不双写 |
| `persist-outline --file=` | `{细纲}` | 落 `工作区/细纲.md` | `persistDraftOutline` |
| `persist-book --file= [--dir=目录名]` | `{book, 总纲, 卷纲}` | 建书目录（workdir 模式下 `--dir` 或书名）+ 落盘 + git init + **指路 AGENTS.md + books.jsonl 登记并置当前** | `persistCreateBook`（扩展）+ `registerBook` |
| `persist-volume-review --file=` | `{卷号, 卷摘要, 下卷卷纲?, 伏笔条目?}` | 落卷摘要/下卷卷纲/伏笔条目 | `persistVolumeReview` |
| `persist-repair --file=` | `{repairs:[{file,content}]}` | 安全网校验后写回（allowedFiles = 当前检测失败清单，命令内现算） | `persistRepair` + `detectParseFailures` |
| `finalize <章号> --payload=<json路径>` | 定稿包（`finalizeChapter` payload 全字段） | 原子 commit + 缓存刷新，stdout 报 commit 与下一步 | `finalizeChapter` |

多本书命令：`list-books`（书单+当前标记）、`switch-book <书名>`（改「当前」+ 最后打开；模糊匹配失败列候选）、`session-context`（输出 `assembleSessionContext().text`，hook 与无 hook 宿主同源，注入逐字一致）。

## 3. 数据契约

### 3.1 books.jsonl 行

`{"书名": "...", "目录": "...", "当前": true|false, "最后打开": "2026-07-03"}`——M4 读侧已容忍未知字段；写侧保证单一「当前」。扫描重建行缺「最后打开」可（重建即丢，属可再生信息）。

### 3.2 manifest.json（模板哈希清单）

```json
{ "version": "7.0.0-alpha", "files": { "<工作目录相对路径>": "sha256-hex" } }
```

- 覆盖 installer 写出的所有文件；例外：`books.jsonl`（用户数据）、`.claude/settings.json`（合并式，见 §1.3）。
- `AGENTS.md` 记**标记块内容**的哈希（update 只动块内，块外用户区不参与判改）。
- update 三态：磁盘哈希 == 清单哈希 → 覆写新版并更新清单；!= → 用户改过，跳过并列出（`--force` 覆盖）；文件缺失 → 重建。
- 重复 `init` 检测到 manifest.json 存在 → 直接走 update 语义并在报告言明。

### 3.3 init 报告（stdout，人话）

装到哪、Node 版本判定、检测到/未检测到的宿主与支持等级（tier + support.md 口径）、降级说明（无 subagent → 兼容模式声明）、下一步（「打开 <宿主> 对它说：开始写书」）。

### 3.4 persist-book 的目录判定

- 书仓库直启（cwd 有 book.yaml）：落 cwd，不登记（无工作目录层，兼容测试）。
- 工作目录模式：目录名 = `--dir` 或 payload 书名 → `workdir/<目录>/`；已存在同名目录且含 book.yaml → 人话报错防覆盖。落盘成功后 `registerBook` 置当前。

## 4. 兼容与迁移

- 现有测试全部不动仍绿：书仓库直启分支保证 `repoPath = cwd` 行为不变；`next` 缺省输出不变；`runReviews` 对外签名不变（内部抽 `saveReviews`）。
- dist/ 布局、drift check、validator 兼容：registry 新字段过 validator 需同步 validator 规则（一二级宿主必备 detect_bin/install_dir）。
- `package.json` 加 `files` 白名单（bin/src/roles/skills/adapters/templates），npm pack 产物即安装源——CI 用 pack 产物验收（PRD Q1 决策：真发 npm 推迟 beta）。
- `persistCreateBook` 新增指路 AGENTS.md 落盘：main-loop 测试建书断言不受影响（新增文件，不改旧文件）。

## 5. 关键取舍

| 决策 | 取 | 舍与理由 |
|---|---|---|
| 运行形态 | vendoring 进 `.webnovel/`（spec 既定） | npx 每次解析：离线不可用、版本漂移、可诊断性差（v6 「装哪了/读的哪份」教训） |
| JSON 输出 | `next --json` 走 stdout；`review-input` 落文件 | ReviewInput 含草稿全文（大），落文件让宿主用读文件工具分段吃；DTO 小，stdout 管道友好 |
| CLI 探测 | PATH 纯函数探测 + `--hosts` 覆盖，非交互 | 交互问答会卡死「AI 替作者跑 init」的主场景 |
| 未检测到宿主 | 只装公约数层 + 指引 | 无条件全装偏离 spec「按检测生成」，且掩盖探测失败 |
| settings.json | 幂等合并，不进哈希清单 | 全量覆盖会毁用户自己的 hooks/权限配置 |
| update 冲突 | 默认跳过列清单 + `--force` | 交互确认在非交互环境挂死；静默覆盖违反 spec §8.2 |

## 6. 运维与回滚

- init/update 幂等可重跑；中途失败重跑即修复（哈希清单最后写，半程失败下次按缺失/未变重建）。
- 不产生 git 操作（工作目录非 git 仓库；书仓库 git 仍只由建书/定稿路径管）。
- 回滚 = 删工作目录重装；书仓库是独立 git 仓库，安装层操作永不触碰书内容（books.jsonl 登记除外，且可扫描重建）。
- 发布判据联动：AC1 的 CI 用例即 beta 判据「Windows 中文路径全链路」的 M5 补全，M7 前持续绿。
