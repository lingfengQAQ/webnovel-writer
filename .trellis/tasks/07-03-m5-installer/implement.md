# M5 执行计划

> 依赖序推进，每步含测试（node:test，零第三方）。验证基线命令见 §V。

## 0. 前置

- [x] `task.py start`（用户确认后）；分支即 v7（沿 M1-M4 惯例，不另开）

## 1. 基座：工作目录定位 + books.jsonl 写侧（PRD B1/B2）

- [x] 1.1 `src/session/index.js` 扩写侧：`registerBook(workdir, {书名,目录})`（置当前、去重、补最后打开）、`setCurrentBook(workdir, 书名)`、`touchLastOpened(workdir, 目录)`；行格式测试与 M4 读侧同文件
- [x] 1.2 `bin/webnovel-writer.js` 命令分级：命令模块可选 `export const scope`；workdir 级不建 CacheManager；书级三分支定位（book.yaml 直启 / .webnovel+当前书 / 人话提示）——design §1.1
- [x] 1.3 新命令 `list-books` / `switch-book <书名>` / `session-context`（scope=workdir）
- [x] 1.4 测试：定位三分支、换书后书级命令作用于新书、session-context 与 M4 assembleSessionContext 输出逐字一致、损坏 books.jsonl 自愈路径经 CLI 仍成立

## 2. F1 CLI 缝（PRD C，不依赖安装器）

- [x] 2.1 `next --json`：完整 DTO 上 stdout；缺省人读不变（改 `src/commands/next.js`）
- [x] 2.2 `persist-outline` / `persist-volume-review` / `persist-repair`：`--file=` 读 JSON → 委托既有用例；persist-repair 内算 allowedFiles（detectParseFailures）
- [x] 2.3 `persist-book`：scope=workdir-or-book；目录判定（design §3.4）；`persistCreateBook` 扩指路 AGENTS.md（`templates/` 加书仓库模板）；工作目录模式落盘后 registerBook 置当前
- [x] 2.4 `src/review/index.js` 抽 `saveReviews`（校验+合并+落盘），`runReviews` 改调它；新命令 `review-input <章号> [--draft=]`（落 `工作区/审稿输入.json`）与 `save-review <章号> --file=`
- [x] 2.5 `finalize <章号> --payload=`：读 JSON → `finalizeChapter` → 报 commit 短哈希与下一步
- [x] 2.6 逐命令测试：正常路径 + 文件缺失/JSON 坏/schema 不过的人话报错与退出码；`--file` 中文内容往返
- [x] 2.7 集成测试（D2 出口）：`test/integration/` 子进程 spawn bin 跑通 建书→细纲→草稿→机检→review-input→save-review(桩JSON)→finalize→`next --json` 报第 2 章——主循环全程 CLI

## 3. 安装器（PRD A）

- [x] 3.1 `adapters/registry.json` 每宿主加 `detect_bin` / `install_dir`；`src/host-shells/validator.js` 同步校验；跑 drift check 确认不破
- [x] 3.2 `src/installer/detect.js`：PATH 探测（注入 env 可测，win32 PATHEXT）；`--hosts` 覆盖解析
- [x] 3.3 `src/installer/vendor.js`：包根定位 + `.webnovel/` 复制清单（bin/src/roles/package.json + js-yaml 目录，design §1.2）；books.jsonl 只建不覆盖
- [x] 3.4 `src/installer/manifest.js`：sha256 清单读写 + update 三态判定（AGENTS.md 记块内哈希）
- [x] 3.5 `src/installer/shells.js`：generateHostShells 产物平移进 `install_dir`；claude-code settings.json SessionStart 幂等合并（不进清单）
- [x] 3.6 `src/installer/index.js` 编排 init（检测→布局→壳→AGENTS.md→manifest→报告）与 update（哈希三态 + `--force` + AGENTS.md 块内更新 + settings 幂等合并 + vendored 内自更新提示）；`src/commands/init.js` / `update.js` 薄壳
- [x] 3.7 测试：init 布局逐项断言（AC2）、重复 init=update 语义、update 三态（AC3）、未检测到宿主→公约数层 + 指引、`.webnovel/` 里的 bin 可 `node` 直跑（spawn 验证 vendored 自包含）

## 4. 壳接线（PRD A4/B4）

- [x] 4.1 生成器上下文加 `cmd`；SKILL.md 全部命令引用改 `{{cmd}}`；写章流程接 F1 通道（`review-input`→两审→`save-review`→`finalize`，「继续」= `next --json`）
- [x] 4.2 `node scripts/build-host-shells.mjs --check` 绿；host-shells 既有测试更新（文案级断言按需改——测试是探针不是约束）

## 5. 发布产物与 CI（PRD D）

- [x] 5.1 `package.json` 加 `files` 白名单（bin/src/roles/skills/adapters/templates）；`npm pack --dry-run` 核对清单
- [x] 5.2 CI（v7-ci.yml）加安装链路 job：npm pack → 干净**中文路径**临时目录 npm install 产物 → init → persist-book 建第一本书 → 布局断言 → `next --json`；ubuntu + windows 双平台（AC1 CI 半）
- [x] 5.3 本地全量：`node --test` 绿 + drift check 绿 + pack e2e 本地演练

## 6. 收尾

- [x] 6.1 `--help` 增新命令段；bin 帮助文案与实际命令清单一致性测试（如已有惯例则从之）
- [ ] 6.2 手测（AC1 手测半，用户执行）：Windows 中文用户名真机 npx（pack 产物）init → 建书 → 写一章走到定稿；记录进任务 notes
- [x] 6.3 spec 更新（3.3）：实施计划 M5 打勾与偏差记录；registry/support.md 如有字段变化同步；memory 更新
- [ ] 6.4 提交（3.4）：分批 commit（基座 / F1 / 安装器 / 壳与 CI）

## V. 验证命令

```bash
cd v7
node --test                                # 全量（含新增）
node scripts/build-host-shells.mjs --check # drift + validator
npm pack --dry-run                         # 发布清单
node bin/webnovel-writer.js --help         # 人话面
```

## 风险与回滚点

- `bin/webnovel-writer.js`：所有命令的入口，改坏波及全部——第 1 步单独 commit，作为回滚锚
- `skills/webnovel-writer/SKILL.md` + `registry.json`：与 drift check/validator 联动，改动必须同轮跑 §V 第二条
- `src/review/index.js` 抽函数：对外签名不变，review 既有测试是守门
- Windows 本地跑 node 测试无需 PYTHONUTF8（那是 pytest 的坑）；spawn 子进程一律 args 数组不走 shell
- 回滚：各步独立 commit，`git revert` 单步可退；安装产物层面 init/update 幂等，重跑即修复

## 执行偏差与决策记录（实施中新增）

1. `persistCreateBook` 补 **init commit（`init: 建书《书名》`）+ git 身份局部兜底**：不提交则建书完 `next` 立刻误触序 2 手改检测（main-loop 旧测试靠手工 commit 掩盖）；作者机器可能没配 git 身份，`ensureIdentity` 只设书仓库局部。超出原计划清单，属 D2 出口必需。
2. `finalize` CLI 归一 `workspaceFiles` 的「工作区/」前缀：用例层约定是工作区内相对名，宿主必然写 repo 相对路径，`rm force` 会静默漏清（CLI e2e 抓到）。
3. 根 `.gitignore` 的全局 `AGENTS.md` 规则收窄为 `/AGENTS.md`：M4 遗留——`v7/templates/AGENTS.md` 从未入库，干净 checkout 下 init 布局残缺、CI 安装链路必红。
4. `references/` 知识库不进 npm `files` 白名单：运行时（src/SKILL/roles）均未消费；归属与接线义务记入 backend 目录结构规范 §4.3。
5. 安装链路 e2e 走 `npm run e2e:install`：用 `npm_execpath` 定位 npm、全程 args 数组不经 shell，规避 Windows 中文路径引号与 .cmd spawn 限制。
6. 安装器报告的支持等级直引 registry `verified` 原文（「结构就绪，真模型 smoke 推迟 beta」），不夸大为「亲测」。
