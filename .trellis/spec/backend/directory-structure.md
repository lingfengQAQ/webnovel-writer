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
└── v7/                         # v7 产品代码（Node ESM 包，零依赖）：package.json / bin / src / test
```

2.1 **文档先行**：`docs/architecture/v7-prd.md` 是产品决策真源，两份 spec 是格式与多宿主行为真源。代码与文档冲突时以文档为准；变更行为必须先修订文档（走任务流程），再改代码。

## 3. v7 产品代码布局原则（M0 骨架已落地，结构见 §4）

3.1 分发渠道只有 npx（`npx webnovel-writer init` / `update`），即单一 npm 包；禁止恢复插件市场分发。

3.2 运行时必须为 **Node ≥ 22，零第三方运行时依赖**；缓存必须使用内置 `node:sqlite`。任何引入运行时依赖的设计必须被驳回。

3.3 用户侧安装产物布局（代码必须与之对齐）：

- 工作目录 ⊃ 书目录；插件本体住 `工作目录/.webnovel/`（Node 脚本、角色定义、模板哈希清单、`books.jsonl`）。
- 书仓库内必须**零工程文件**（唯一例外：指路 `AGENTS.md`）；作者可见的目录名、文件名一律中文。
- 书仓库根必须有 `.gitignore`（建书流程写入，见质量规范 §3.3），至少 ignore `.cache/`（派生物，见数据规范 §2.1）与 `工作区/`（草稿/审稿等临时产物，不入档）。二者被跟踪即违反"零工程文件"与"缓存可删"不变量。

3.4 文件排序必须依赖零填充数字前缀（`0152-`、`第05卷`、`伏笔-031`），禁止依赖中文字典序。

## 4. v7 包内布局（M0 落地）

源码根 `v7/`，ESM、零运行时依赖：

```
v7/
├── package.json            # name=webnovel-writer, type=module, engines.node>=22.13.0, 零 deps
├── bin/
│   └── webnovel-writer.js  # CLI 入口：版本门槛先行 + 子命令分发（init/update 占位）
├── src/
│   ├── runtime/            # 版本门槛等运行时基础
│   ├── installer/          # 安装器（M5）
│   ├── state-machine/      # 状态机单入口（M3）
│   ├── mechanical-check/   # 机检（M2）
│   ├── prep/               # 备料（M2）
│   ├── finalize/           # 定稿原子提交（M2）
│   ├── cache/              # .cache/index.db，node:sqlite（M1，见 O4 缓存设计文档）
│   └── storage/            # 存储适配器小端口（M1，spec §1.5）
└── test/                   # node:test，*.test.js 与 src 镜像
```

4.1 测试：Node 内置 `node:test` + `node:assert`，**禁止第三方测试框架**；测试文件命名 `v7/test/**/*.test.js`，与 `src/` 镜像。

4.2 模块为按职责（Use Case）划分，**非通用工具层**；端口拆小，禁止上帝对象（spec §1.5）。

4.3 待补：题材模板与知识库在包内的存放位置（知识层平移任务时定）。
