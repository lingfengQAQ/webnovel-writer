# 目录结构规范

> 版本：基线 1.1（2026-06-27，M0 仓库骨架落地，回填 §2/§4）。依据：v7 PRD 1.0、story-repo-spec 0.8。

---

## 1. 分支策略

1.1 `master` 为 v6 维护线，**冻结**：仅允许致命 bug 修复，禁止合入任何 v7 工作。

1.2 `v7` 为主开发分支：所有 v7 工作的 PR base 必须设为 `v7`。

## 2. 仓库顶层布局

```
webnovel-writer/                # 仓库根
├── docs/architecture/          # 设计真源：v7-prd.md（产品决策）、story-repo-spec（格式）、multi-agent-adaptation-spec（多宿主）
├── .trellis/                   # 开发流程层（任务/规范/日志），与产品代码无关
├── webnovel-writer/            # v6 插件本体（遗产，禁止改动）
├── requirements.txt pytest.ini # v6 Python 遗产（禁止改动；v7 禁止引入 Python）
└── v7/                         # v7 产品代码（Node ESM 包，运行时直接依赖仅 js-yaml）：package.json / bin / src / test
```

2.1 **文档先行**：`docs/architecture/v7-prd.md` 是产品决策真源，两份 spec 是格式与多宿主行为真源。代码与文档冲突时以文档为准；变更行为必须先修订文档（走任务流程），再改代码。

## 3. v7 产品代码布局原则（M0 骨架已落地，结构见 §4）

3.1 分发渠道只有 npx（`npx webnovel-writer init` / `update`），即单一 npm 包；禁止恢复插件市场分发。

3.2 运行时必须为 **Node ≥ 22，零第三方运行时依赖**（现行唯一例外：`js-yaml`，见质量规范 §1.1）；缓存必须使用内置 `node:sqlite`。任何引入运行时依赖的设计必须被驳回。

3.3 用户侧安装产物布局（代码必须与之对齐）：

- 工作目录 ⊃ 书目录；插件本体住 `工作目录/.webnovel/`（Node 脚本、角色定义、模板哈希清单、`books.jsonl`）。
- 书仓库内必须**零工程文件**（唯一例外：指路 `AGENTS.md`）；作者可见的目录名、文件名一律中文。
- 书仓库根必须有 `.gitignore`（建书流程写入，见质量规范 §3.3），至少 ignore `.cache/`（派生物，见数据规范 §2.1）与 `工作区/`（草稿/审稿等临时产物，不入档）。二者被跟踪即违反"零工程文件"与"缓存可删"不变量。

3.4 文件排序必须依赖零填充数字前缀（`0152-`、`第05卷`、`伏笔-031`），禁止依赖中文字典序。

## 4. v7 包内布局（M0 骨架落地，M5 填实）

源码根 `v7/`，ESM、运行时依赖仅 js-yaml：

```
v7/
├── package.json            # name=webnovel-writer, type=module, engines.node>=22.13.0
│                           # files 白名单：bin/ src/ roles/ skills/ adapters/ templates/（npm 包=安装源）
├── bin/
│   └── webnovel-writer.js  # CLI 入口：版本门槛先行 + 工作目录定位 + 子命令分发
├── src/
│   ├── runtime/            # 版本门槛、工作目录定位（locate.js，M5）
│   ├── installer/          # 安装器：detect/vendor/manifest/shells/编排（M5）
│   ├── session/            # books.jsonl 读写与 SessionStart 注入（M4 读侧/M5 写侧）
│   ├── commands/           # CLI 薄壳，一命令一文件，全部委托用例层
│   ├── state-machine/      # 状态机单入口（M3）
│   ├── review/             # 两审编排与 schema（M4）
│   ├── host-shells/        # 壳生成器 + validator/drift（M4）
│   ├── mechanical-check/   # 机检（M2）
│   ├── prep/               # 备料（M2）
│   ├── finalize/           # 定稿原子提交（M2）
│   ├── cache/              # .cache/index.db，node:sqlite（M1，见 O4 缓存设计文档）
│   └── storage/            # 存储适配器小端口（M1，spec §1.5）
├── roles/ skills/ adapters/ templates/   # 壳与安装真源（多宿主 spec §6.2）
└── test/                   # node:test，*.test.js 与 src 镜像
```

4.1 测试：Node 内置 `node:test` + `node:assert`，**禁止第三方测试框架**；测试文件命名 `v7/test/**/*.test.js`，与 `src/` 镜像。

4.2 模块为按职责（Use Case）划分，**非通用工具层**；端口拆小，禁止上帝对象（spec §1.5）。

4.3 知识库真源存放于 `v7/references/`（M4 平移）；7.0 运行时尚未接线，**不进 npm files 白名单**——接线里程碑必须同步把它加入白名单并补安装链路断言。

4.4 命令分级协议（M5）：命令模块可选导出 `scope`——`'book'`（缺省，得 `{repoPath, cache}`）/ `'workdir'`（得 `{workdir, packageRoot}`，不建缓存）/ `'workdir-or-book'` / `'anywhere'`；空工作目录仍可跑的命令导出 `allowNoBook = true`（当前仅 `next`，状态机以 `repoPath=null` 判序 1 建书）。定位三分支见 `src/runtime/locate.js`：cwd 含 `book.yaml` 直启 → cwd 含 `.webnovel/` 按当前书解析 → 否则人话提示。

4.5 工作目录 `.webnovel/` 为 vendored 运行时（自包含离线可跑）：`bin/ src/ roles/ package.json + node_modules/<运行时依赖及传递依赖> + manifest.json（哈希清单）+ books.jsonl（用户数据，安装器只保底不覆盖）`。哈希清单键一律正斜杠（跨平台可移植）。
