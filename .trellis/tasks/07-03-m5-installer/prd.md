# M5 安装器与多本书

## Goal

作者在干净环境（含 Windows 中文用户名路径）一条命令装出可用的工作目录，建起第一本书；写章八阶段的每一步都有宿主可调的 CLI 通道，`finalize→next` 主循环可全程经 CLI 跑通。

对应实施计划 0.3 §2「M5 安装器与多本书」，上游依据：`multi-agent-adaptation-spec` v3.5 §8（init/update）、`story-repo-spec` 0.9 §2.0（工作目录层）、M1-M4 review follow-up F1（宿主 CLI 缝清单）。

## Background（已确认事实）

- M0-M4 已交付：格式层 41 读接口、写章脚本面（prepare-chapter/mechanical-check）、状态机 7 态 + git 隐身、AI 角色层 + 壳生成器（`src/host-shells/generate.js` + `scripts/build-host-shells.mjs --check` 已进 CI）。边界收口任务已归档，292 测试绿。
- `src/installer/index.js` 是占位空文件。
- **落盘用例已齐但无 CLI 通道**：`persistDraftOutline` / `persistCreateBook` / `persistVolumeReview` / `persistRepair`（`src/state-machine/persist.js`）、`assembleReviewInput` / `runReviews`（`src/review/index.js`）、`finalizeChapter`（`src/finalize/index.js`）只能进程内调用——真宿主（AI 会话）无法驱动写章后半段，M4 真模型 smoke 因此推迟 beta（registry `smoke_status: deferred-beta`）。
- **工作目录定位未做**：`bin/webnovel-writer.js` 写死 `repoPath = process.cwd()`（M1 design 注释「M3 后续处理」，M3 未做）。装出的工作目录里跑 CLI 会把 `.cache` 建在工作目录而非书仓库，M5 必须先解决。
- `books.jsonl` 读侧 + 扫描重建自愈已在 M4（`src/session/index.js`，含 `writeBooksRegistry` 自愈回写）；**写侧（建书登记/换书）归 M5**（源码注释明示）。
- 工作目录 `AGENTS.md` 模板已有（`v7/templates/AGENTS.md`，含 `<!-- WEBNOVEL:START/END -->` 标记块）；书仓库指路 `AGENTS.md`（spec §2.1「建书时自动生成」）尚无实现——`persistCreateBook` 不写它。
- 壳生成器产物形状：`{ <host>: { 'skills/webnovel-writer/SKILL.md', 'agents/<角色>.md|.toml' } }`，无 hook 接线；claude-code 的 SessionStart hook 注入（multi-agent spec §5.5）需要 M5 在装出的 `.claude/` 里接线。
- SKILL.md 当前硬编码 `webnovel-writer <命令>` 调用形式；spec §5.9 要求命令引用语法做成平台上下文变量。
- Node 版本门槛（≥ 22.13.0）与人话提示已在 `src/runtime/node-version.js`，bin 已接。
- 运行时依赖仅 `js-yaml`（spec §2.2），`.webnovel/` 自带脚本时需一并解决其可用性。
- CI 现状（`.github/workflows/v7-ci.yml`）：双平台 × 双 Node 版本，`node --test` + drift check + `--version` 冒烟；无安装器链路用例。

## Requirements

### A. 安装器 `init` / `update`（multi-agent spec §8）

- A1 `init`：环境检测（Node 门槛复用现有函数；按 registry 顺序探测已装 agent CLI）→ 生成工作目录布局：
  - `AGENTS.md`（公约数层，标记块管理；块外用户内容保留）
  - `.webnovel/`（Node 脚本 + 角色定义 + 模板哈希清单 + `books.jsonl` 占位）——工作目录自包含，脚本离线可跑
  - 检测到的各平台壳（`.claude/`、`.codex/` 等，由 M4 生成器按条件块编译；claude-code 含 SessionStart hook 接线）
  - 结束输出报告：装到了哪、各宿主支持等级、降级说明、下一步人话指引
- A2 `update`：模板哈希追踪——哈希未变的文件直接更新；用户改过的提示并跳过（不静默覆盖），非交互默认跳过并列清单，`--force` 显式覆盖；`AGENTS.md` 只更新标记块内内容
- A3 边界（spec §8.3）：不装 Node 之外的运行时、不改用户全局配置、不联网、不把工作目录变成 git 仓库；重复 `init` 幂等（等价于 update 语义或明确提示）
- A4 平台壳 SKILL.md 的命令引用语法改为模板变量（§5.9），指向装出的 `.webnovel/` 内脚本；SKILL.md 写章流程同步接 F1 通道（`review-input`→两审→`save-review`→`finalize`，「继续」吃 `next --json` DTO）

### B. 多本书与工作目录定位（story-repo spec §2.0）

- B1 `books.jsonl` 写侧：建书登记（字段含 书名/目录/当前/最后打开）、换书（改「当前」标记）、书单列出；与 M4 读侧/自愈共用一个模块，不双写格式
- B2 工作目录定位：bin 启动时判定——cwd 含 `book.yaml` → 书仓库直启（兼容开发/测试）；cwd 含 `.webnovel/` → 按 `books.jsonl` 当前书解析 `repoPath`，无当前书给人话指引；两者都不是 → 人话提示「请从工作目录启动」。`init` 等工作目录层命令不受此约束
- B3 书仓库指路 `AGENTS.md`：并入建书落盘（`persistCreateBook`），内容按 spec §2.1（误启动/单独 clone 时指回工作目录）
- B4 SessionStart 注入接线：claude-code 壳带 hook 配置调 CLI 的会话上下文命令（输出复用 M4 `assembleSessionContext`，两宿主路径注入逐字一致）

### C. F1 宿主 CLI 缝（实施计划 0.3 M5 清单，逐条）

- C1 `next --json`：输出完整状态机 DTO（`{ok, gitHealth, 序, state, needsAI, message, dto}`）；不带 flag 保留现有人读 message
- C2 `review-input <章号>`：组装 ReviewInput 并落盘供宿主读取
- C3 `save-review <章号> --file=<两审json>`：读文件 → schema 校验 → 合并 → 落审稿单与评审报告（复用 `runReviews` 的校验/合并/落盘路径）
- C4 `persist-outline` / `persist-book` / `persist-volume-review` / `persist-repair`：AI 态产物回流，`--file=<json>` 进；`persist-book` 同时完成 books.jsonl 登记 + 指路 AGENTS.md（B1/B3）
- C5 `finalize <章号> --payload=<定稿包json路径>`：调 `finalizeChapter`，定稿后刷新缓存
- C6 JSON 一律走 `--file`/`--payload` 文件路径，不走 stdin（Windows 中文管道编码雷区）；出错人话报错、退出码非零、永不带栈崩溃

### D. CI 与验收链路

- D1 Windows 中文路径安装链路 CI：干净临时目录（路径含中文，模拟中文用户名）→ 一条命令 init → 建书（经 CLI）→ 布局断言（beta 判据「Windows 中文路径全链路」的 M5 补全）
- D2 `finalize→next` 端到端经 CLI（子进程 spawn bin，非进程内调用）跑通：细纲→草稿→机检→审稿→定稿→next 报下一章

## Acceptance Criteria

- [ ] AC1 干净 Windows 中文用户名环境一条命令装出工作目录并建第一本书：CI 用例绿（npm pack 产物 + 中文路径临时目录全链路）+ 手测一次通过 —— CI job 已建（install-e2e，双平台）本地全通过；待推送后 CI 绿 + 用户手测
- [x] AC2 `init` 装出的布局逐项存在且内容正确：`AGENTS.md`（标记块）、`.webnovel/`（脚本可 `node` 直跑、`books.jsonl`、哈希清单）、检测到的平台壳；报告输出含支持等级与下一步指引
- [x] AC3 `update`：未改文件被更新；手改文件被跳过且列出；`AGENTS.md` 块外内容保留；`--force` 可覆盖
- [x] AC4 写章八阶段每一步都有宿主可调 CLI 通道：F1 清单 8 个命令逐个有测试（含 schema 校验失败、文件缺失的人话报错）
- [x] AC5 `finalize→next` 端到端经 CLI 子进程跑通，next 报「起草第 N+1 章」不重抄
- [x] AC6 工作目录定位三分支（书仓库直启 / 工作目录+当前书 / 无处可依）各有测试；换书后 next 作用于新书
- [x] AC7 SessionStart 注入：hook 路径与无 hook 宿主状态机入口路径输出逐字一致（既有测试延伸到 CLI 通道）
- [ ] AC8 全量测试绿 + CI 双平台绿；drift check 对新增模板变量仍确定性通过 —— 本地 335 绿 + drift 绿；CI 待推送验证

## Out of Scope

- 真实 npm 发布——「一条命令」验收用 npm pack 产物在 CI/手测模拟（与 npx 消费同一份包内容），真发 alpha 推迟 beta 入口：alpha 阶段没有外部用户，提前发包只引来不完整版本的使用（决策 D-1，start 评审可推翻）。随之推迟的发版联动：升 7.0.0、README 版本表 / marketplace / CHANGELOG 同步（版本 CI 不查 v7/package.json，保持 7.0.0-alpha 无风险）
- 真模型 smoke（Claude Code / Codex 亲测）——推迟 beta（registry 已记 `deferred-beta`），M5 只负责让它可行
- M5.5 体检统计项（高频意象/句式/文体指纹）
- M6 自动模式、M7 导出与 /migrate
- 二级宿主（gemini-cli / cursor）的实测核验——壳照常生成，支持等级按 registry 如实标注

## 规划决策（用户暂离，按推荐采纳；start 评审时可推翻）

- D-1 发布形态：npm pack 模拟，真发推迟 beta（见 Out of Scope 首条）
- D-2 检测缺省：init 未检测到任何 agent CLI → 只装公约数层（AGENTS.md + `.webnovel/`）并在报告指引 `--hosts` 补装——忠于 spec「按检测生成」，不掩盖探测失败
- D-3 任务结构：单任务推进，沿 M1-M4 先例；三块交付物（基座与多本书 / F1 缝 / 安装器）在 implement.md 里按依赖序分步、分批 commit，可独立回滚
