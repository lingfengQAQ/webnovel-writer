# PRD: M0 仓库骨架

## Goal

为 v7 搭起**第一批可运行的工程骨架**：一个零依赖的 Node npm 包雏形、`node:test` 测试骨架、Linux/Windows 双矩阵 CI，以及 Node 版本门槛检查。骨架格式无关（不依赖 story repo 格式细节），RFC 怎么改都不浪费。

本任务**不实现任何业务逻辑**（写章流程、缓存、状态机的真实行为都在 M1+）。M0 只交付"能跑起来、CI 能绿、版本门槛能挡"的空壳与脚手架。

## Background

- 当前 `v7` 分支下 v7 产品代码为 **0 行**：仓库根没有 `package.json`，`webnovel-writer/` 是冻结的 v6 Python 遗产。
- v7 是 **Node ≥ 22.13.0、零第三方运行时依赖**的全新重写（缓存用内置 `node:sqlite`，无需 flag 的最低版本即 22.13.0）。
- 上游已就绪：PRD 1.0、story-repo-spec 0.8、multi-agent-spec v3.4、后端开发规范基线 1.0、O4 缓存设计已定稿。
- 实施计划（`v7-implementation-plan.md` §2）定义 M0 为"立即可开、不等 RFC"的首个里程碑。

## Scope（范围决策，已与作者确认）

- **代码落点**：新建 `v7/` 子目录承载 Node 包；v6 `webnovel-writer/` 与仓库根 Python 遗产**原地不动**。将来 beta 通过合并时再决定是否上提到根。
- **包名**：`webnovel-writer`（对应 `npx webnovel-writer`，npm 发布名）。

## Requirements

### R1: npm 包骨架（`v7/`）

- `v7/package.json`：`name=webnovel-writer`、`type=module`（ESM）、`engines.node>=22.13.0`、`dependencies` 为空（铁律：零运行时依赖）、`bin` 指向入口、`scripts.test` 跑 `node --test`。
- `v7/bin/`：CLI 入口（`webnovel-writer init` / `update` 的命令分发空壳，子命令打印"未实现"占位但不报错崩溃）。
- `v7/src/`：按职责划分的模块目录骨架（安装器 / 状态机 / 机检 / 备料 / 定稿 / 缓存 / 存储适配器），每个目录一个 `index.js` 导出空接口或占位，**不含真实逻辑**。
- 模块划分须与后端规范 directory-structure §3 原则一致，并回填该文件 §4 待补项。

### R2: Node 版本门槛（出口判据之一，必须真实可跑）

- 一个版本检查函数：读 `process.version`，低于 `22.13.0` 时输出**人话提示**（中文、指明需要的版本与升级指引），并以非零退出码终止；满足时静默放行。
- 该检查在 CLI 入口最早期执行（任何子命令之前）。
- 必须有对应测试（构造低版本输入走断言，不真依赖运行环境版本）。

### R3: 测试骨架（`node:test`，零依赖）

- 用 Node 内置 `node:test` + `node:assert`，不引入任何第三方测试框架。
- 测试目录与命名约定：`v7/test/` 下 `*.test.js`，与 `src/` 镜像。约定写回 directory-structure §4。
- 至少含：版本门槛测试、一个**中文路径占位用例**（创建含中文名的临时目录并读写一个 UTF-8 文件，断言往返一致——为后续全链路 CI 占位）。

### R4: CI 双矩阵（出口判据之一）

- GitHub Actions workflow（落 `.github/workflows/`），矩阵 `os = [ubuntu-latest, windows-latest]` × `node = [22.13.0（地板）, lts/*]`。
- 步骤：装 Node → `node --test`（在 `v7/`）→ 版本门槛检查冒烟。
- Windows job 必须实际跑中文路径占位用例（验证 UTF-8 文件 IO 不依赖系统 locale）。
- 文件 IO 一律显式 UTF-8 无 BOM；CI 不依赖系统 locale。

### R5: 文档回填（文档先行铁律）

- `directory-structure.md` §2：把"（v7 代码目录待定）"替换为 `v7/` 实际布局。
- `directory-structure.md` §4：填实 src/ 模块划分、测试目录与命名约定两项（题材模板位置留到知识层平移任务）。

## Acceptance Criteria（出口判据，逐条可验证）

- [ ] `cd v7 && node --test` 在本机绿（含版本门槛测试 + 中文路径占位用例）。
- [ ] CI 在 **ubuntu-latest 与 windows-latest 双双绿**。
- [ ] Node `<22.13.0` 时版本门槛给中文人话提示并非零退出；`≥22.13.0` 放行——有测试覆盖。
- [ ] `v7/package.json` 零 `dependencies`、`engines.node>=22.13.0`、`type=module`。
- [ ] `directory-structure.md` §2/§4 已回填，与实际 `v7/` 布局一致。
- [ ] 全程零第三方运行时依赖、无 Python 引入。

## Out of Scope

- 任何业务逻辑（缓存重建器、精准读取接口、写章八阶段、状态机判定、安装器真实行为）——M1+。
- 平台壳生成、SKILL.md 入口、SessionStart 注入——M4/M5。
- lint/格式化工具选型可在本任务顺带定，也可留到下个任务（非阻塞 M0 出口）。
- 把 v7/ 上提到仓库根——beta 合并时再议。

## Confirmed Facts from Codebase

- 仓库根无 `package.json`；`v7` 分支当前无任何 `.js` 源码、无 `src/`。
- `webnovel-writer/`（v6）为 Python：hooks/skills/scripts/templates/dashboard/evals。
- 后端规范 `directory-structure.md` §2 已预留"（v7 代码目录待定）"、§4 三个待补项。
- 质量规范要求：零依赖、`node:test` 候选、UTF-8 无 BOM、Windows 中文路径 CI、缩进两空格、commit 前缀 feat/fix/docs/chore。
- 本机 Python 必须用 `py`（`python` 是 Store 占位 stub，静默退出 49）。
