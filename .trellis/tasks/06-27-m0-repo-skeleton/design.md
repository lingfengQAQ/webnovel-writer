# 技术设计：M0 仓库骨架

## 1. 设计范围

骨架与脚手架，**无业务逻辑**。交付物：`v7/` Node 包雏形、`node:test` 测试骨架、版本门槛检查、双矩阵 CI、文档回填。下游 M1+ 在此骨架上长真实代码。

## 2. 目录布局（落点 `v7/`）

```
v7/
├── package.json                 # name=webnovel-writer, type=module, engines.node>=22.13.0, 零 deps
├── bin/
│   └── webnovel-writer.js       # CLI 入口：先跑版本门槛 → 子命令分发（init/update 占位）
├── src/
│   ├── installer/index.js       # 安装器（占位）
│   ├── state-machine/index.js   # 状态机单入口（占位）
│   ├── mechanical-check/index.js# 机检（占位）
│   ├── prep/index.js            # 备料（占位）
│   ├── finalize/index.js        # 定稿原子提交（占位）
│   ├── cache/index.js           # .cache/index.db 缓存（占位）
│   ├── storage/index.js         # 存储适配器端口（占位，M1 落地小端口）
│   └── runtime/node-version.js  # 版本门槛检查（M0 唯一真实逻辑）
└── test/
    ├── node-version.test.js     # 版本门槛断言
    └── chinese-path.test.js     # 中文路径 UTF-8 往返占位用例
```

**模块划分依据**：实施计划 M0「src/ 模块划分（安装器/状态机/机检/备料/定稿/缓存）」+ spec §1.5 架构原则（拆小端口、状态机只编排）。`storage/` 单列，承接 M1 的 Storage Adapter 接口。

## 3. 关键契约

### 3.1 版本门槛 `src/runtime/node-version.js`

```js
// 纯函数，便于测试：传入版本串，返回 {ok, message}
export function checkNodeVersion(versionString) // "v22.13.0" → {ok:true}
export const MIN_NODE = '22.13.0'
```

- 解析 `process.version`（形如 `v22.13.0`），与 `22.13.0` 做语义比较（按 major/minor/patch 数值，不做字符串比较）。
- 不达标：返回中文人话提示（指明当前版本、所需 `>=22.13.0`、升级指引），调用方打印到 stderr 并 `process.exit(1)`。
- 达标：静默放行。
- **纯函数与副作用分离**：比较逻辑是纯函数（吃版本串吐结果），`process.exit` 在 `bin/` 入口做——这样测试不依赖真实运行版本。

### 3.2 CLI 入口 `bin/webnovel-writer.js`

```
#!/usr/bin/env node
1. checkNodeVersion(process.version) → 不过则人话提示 + exit(1)
2. 解析 argv[2] 子命令：init | update | （其余 → 人话"未知命令"，exit(1)）
3. init/update 当前打印"M0 占位，未实现"，exit(0)——不崩溃
```

### 3.3 package.json 要点

```json
{
  "name": "webnovel-writer",
  "type": "module",
  "engines": { "node": ">=22.13.0" },
  "bin": { "webnovel-writer": "bin/webnovel-writer.js" },
  "scripts": { "test": "node --test" },
  "dependencies": {}
}
```

- `dependencies` 必须为空（零运行时依赖铁律）。`devDependencies` 也尽量空——`node:test` 内置，无需第三方。
- `engines.node` 是声明；真实拦截靠 §3.1 运行时检查（npm 默认不强制 engines）。

## 4. 测试设计（`node:test` + `node:assert`）

- **node-version.test.js**：对 `checkNodeVersion` 喂 `v22.12.0`（不过）、`v22.13.0`（过）、`v24.15.0`（过）、`v21.0.0`（不过），断言 `ok` 与 message 非空。纯函数，跨平台稳定。
- **chinese-path.test.js**：在 `os.tmpdir()` 下建含中文名的目录与文件（如 `测试目录/章节-001.md`），写入中文 UTF-8 内容再读回，断言往返一致、且显式 `encoding:'utf8'`。为 M2+ 的"中文路径全链路 CI"占位。用 `node:test` 的 `after` 清理临时目录。

## 5. CI 设计（GitHub Actions）

落 `.github/workflows/v7-ci.yml`（与 v6 既有 workflow 并存，独立 job 名加 `v7-` 前缀避免混淆）：

```yaml
name: v7 CI
on:
  push: { branches: [v7] }
  pull_request: { branches: [v7] }
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: ['22.13.0', 'lts/*']
    runs-on: ${{ matrix.os }}
    defaults: { run: { working-directory: v7 } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }} }
      - run: node --test
      - run: node bin/webnovel-writer.js --version   # 版本门槛冒烟（达标放行）
```

- 矩阵 4 组合（2 OS × 2 Node）。`22.13.0` 验地板，`lts/*` 验当前。
- `working-directory: v7` 让所有步骤在子目录内跑。
- Windows job 自动覆盖中文路径用例（test 里含 chinese-path）。
- 仅触发于 `v7` 分支与对 `v7` 的 PR，不干扰 master/v6 CI。

> `--version` 子命令需在 bin 入口支持（打印包版本，顺带证明入口可执行）。

## 6. 文档回填（文档先行）

- `directory-structure.md` §2：「（v7 代码目录待定）」→ `v7/` 实际布局（package.json/bin/src/test）。
- `directory-structure.md` §4：填实「src/ 模块划分」「测试目录与命名约定（`v7/test/**/*.test.js`，与 src 镜像，node:test）」；题材模板位置仍留白（知识层平移任务）。

## 7. 边界与非目标

- `src/**/index.js` 只导出占位（空函数/常量），**禁止**写真实逻辑——避免在 RFC 后格式微调时返工。
- 不配 lint/格式化（可下个任务）；不引入 TypeScript（纯 JS + ESM，零构建步骤）。
- 不碰 `webnovel-writer/`（v6）与仓库根 Python 遗产。

## 8. 风险与缓解

- **风险**：`lts/*` 解析到的版本将来变化导致 CI 漂移。**缓解**：地板 `22.13.0` 固定兜底，`lts/*` 仅作前瞻；真出问题锁具体版本。
- **风险**：Windows runner 默认编码非 UTF-8 导致中文用例假阴性。**缓解**：测试内所有 IO 显式 `utf8`，不依赖 locale；这正是该用例要守护的不变量。
- **风险**：`engines.node` 不被 npm 强制，低版本仍能装。**缓解**：运行时 §3.1 检查兜底，入口最早执行。
