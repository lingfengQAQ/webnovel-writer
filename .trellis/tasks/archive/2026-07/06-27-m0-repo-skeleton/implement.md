# 执行计划：M0 仓库骨架

> 前置：已读 prd.md、design.md，以及后端规范 directory-structure / quality-guidelines。
> 落点全部在 `v7/`、`.github/workflows/`、`.trellis/spec/backend/`；不碰 v6 与根 Python 遗产。
> 本机命令：`node`（v24.15.0 可用）；Python 脚本用 `python` 或 `py` 均可（已修），带 `PYTHONUTF8=1`。

## 阶段 A：包骨架

- [ ] A1 建 `v7/package.json`：name=webnovel-writer、type=module、engines.node>=22.13.0、bin、scripts.test=`node --test`、dependencies={}（design §3.3）
- [ ] A2 建 `v7/bin/webnovel-writer.js`：shebang + 版本门槛先行 + 子命令分发（init/update/--version 占位，未知命令人话提示）（design §3.2）
- [ ] A3 建 `v7/src/` 七个占位模块（installer/state-machine/mechanical-check/prep/finalize/cache/storage 各一 index.js，导出占位）
- [ ] A4 建 `v7/src/runtime/node-version.js`：`checkNodeVersion(versionString)` 纯函数 + `MIN_NODE`（design §3.1）

**验证 A**：`cd v7 && node bin/webnovel-writer.js --version`（打印版本不崩）；`node bin/webnovel-writer.js init`（打印占位，exit 0）

## 阶段 B：测试骨架

- [ ] B1 `v7/test/node-version.test.js`：喂 v22.12.0/v22.13.0/v24.15.0/v21.0.0，断言 ok 与 message（design §4）
- [ ] B2 `v7/test/chinese-path.test.js`：tmpdir 下中文目录+文件 UTF-8 往返断言，after 清理（design §4）

**验证 B**：`cd v7 && node --test` → 全绿（本机 Node 24，满足门槛）

**评审门 1**：零 dependencies（`grep -A2 '"dependencies"' v7/package.json` 为空对象）；无第三方 import（`grep -rn "require(\|from '[^.]" v7/src v7/test` 只应见 node: 内置）

## 阶段 C：CI

- [ ] C1 建 `.github/workflows/v7-ci.yml`：matrix [ubuntu,windows]×['22.13.0','lts/*']，working-directory v7，步骤 node --test + 版本冒烟（design §5）
- [ ] C2 确认只触发 v7 分支/PR，不影响 master

**验证 C**：本地 `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/v7-ci.yml',encoding='utf-8'))"` 语法校验（PYTHONUTF8=1）；推分支后看 Actions 双平台绿

## 阶段 D：文档回填（文档先行）

- [ ] D1 directory-structure.md §2：「（v7 代码目录待定）」→ v7/ 实际布局
- [ ] D2 directory-structure.md §4：填 src/ 模块划分 + 测试目录命名约定；题材模板留白
- [ ] D3 directory-structure.md 版本注脚：基线 1.0 → 1.1（M0 落地修订），上游 spec 0.6 → 0.8

**验证 D**：通读 §2/§4 与 `v7/` 实际一致，无"待定"残留

## 阶段 E：收尾

- [ ] E1 全量验证：`cd v7 && node --test` 绿 + 版本门槛低版本路径有测试覆盖
- [ ] E2 过 quality-guidelines §5 评审清单（零依赖/无 Python/UTF-8/错误不崩/文档先行）
- [ ] E3 `task.py current` 确认任务，spec update 评估（阶段 3.3），提交（前缀 feat，作用域 v7 骨架）

**出口判据复核（对齐 prd Acceptance）**：
- [ ] CI ubuntu + windows 双绿
- [ ] 版本门槛 <22.13.0 人话提示 + 非零退出，有测试
- [ ] package.json 零 deps / type module / engines>=22.13.0
- [ ] directory-structure §2/§4 已回填
- [ ] 中文路径占位用例在 Windows job 跑过

## 回滚点

- 阶段 A-D 各自独立，未提交前删 `v7/` 或 `.github/workflows/v7-ci.yml` 即回到原点。
- 全部在新增文件内，不改既有文件（除 directory-structure.md）——回滚 directory-structure.md 用 `git checkout`。

## 提交计划

建议单一 commit（骨架是一个整体）：
`feat(v7): M0 仓库骨架——v7/ npm 包 + node:test + 双矩阵 CI + Node 版本门槛`
文档回填可并入同一 commit（文档与骨架同生）。
