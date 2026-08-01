# P3 中危合批（F8-F11 + v7 路由 #135 同构核查）

## Goal

一批四个中危修复 + 一个独立核查项，合并推进（每项改动小、彼此独立，不值得各开任务）。**建议在 npm 发版前完成**（中危不阻断 alpha 内测，但不该带给外部用户）。

## Requirements

每项自带修法口径（来源：父任务 prd F8-F11 + 评审核实）：

- [ ] **F8 YAML 序列化器 key 零转义**：`storage/serializers/yaml-dialect.js:18-36` value 侧转义完备但 key 原样输出；AI 可控 updates 键含 `\n`/`:` 可注入 front matter 结构。修法：key 走同等 needsQuoting/转义（优先），或 key 白名单。攻击样例进测试。
- [ ] **F9 契约互斥锁无陈旧回收**：`staging/contract-invalidation.js:29-67` 进程被 kill 后锁文件永久残留，堵死全部写路径且报错不给位置/删除指引。修法：锁文件带 pid/startedAt，陈旧判定（pid 不存活或超时阈值）自动回收 + 报错文案给锁路径与人话指引。注意与 07-23 整改遗留「锁自愈」债务条目对表（`archive/2026-07/07-23-v7-global-review-remediation/research/后置债务清单.md`），若已有方案沿用其口径。
- [ ] **F10 git index.lock 陈旧阈值仅 3 秒**：`state-machine/git-health.js:5`，杀软/索引器锁盘超 3 秒被误删 → 双 git 进程并发写损坏窗口。修法：阈值提到分钟级（建议 ≥60s）+ 尽可能加持锁进程存活判断；改动须过既有 git 健康检查异常样本库测试。
- [ ] **F11 books.jsonl 读侧无形状校验**（**待作者裁决定级**，见 Notes）：`session/index.js` 逐行 JSON.parse 不校验；`runtime/locate.js:50` 消费 `目录` 字段，写坏后 `git clean -fd`/`reset --hard`/递归 `fs.rm` 可作用于工作目录外。修法：读侧复用 `persist-book` 同款校验（书名/目录非空字符串、目录为安全相对段——可复用 P0 的 `isSafeFileStem`），坏行走既有 corrupt 计数 + 自愈回写通道。
- [ ] **F12 v7 路由 #135 同构核查**（核查项，可能零改动收口）：v6 的 explicit_genre_fallback 会继承首条细分流派（issue #135，master 线 PR #136 已修）。v7 路由是独立实现（`references/路由.csv` + `knowledge-pack` 固定路由，spec 决策「固定路由只归一书级名称，不选择创意答案」）。核查：书级建档只给大类题材时，知识包/契约是否会隐式继承某条子流派的调性/桥段默认值。产出：核查记录留档 research/（有问题→修复进本批，无问题→写明证据收口）。

## Acceptance Criteria

- [ ] F8：注入样例（key 含 `\n`/`:`/引号）序列化后可安全 round-trip 或被拒绝；现有 front matter 全量 round-trip 测试绿。
- [ ] F9：kill -9 模拟（或直接放置陈旧锁文件）后下一次写路径操作自动回收并继续；活锁（pid 存活）仍拒绝且文案含锁路径。
- [ ] F10：阈值常量更新 + 存活判断测试；异常样本库全绿。
- [ ] F11（若裁决执行）：坏 `目录` 字段的行被拒/自愈，`locate` 不再消费越界目录；模拟坏行时定位失败给人话而非作用于仓外。
- [ ] F12：核查记录含复现命令与结论。
- [ ] 全量测试绿 + drift 绿；spec 回填（各项对应决策/规范条目）。

## Non-Goals

- P0 已完成项、P1 降级标记、P2 OpenCode adapter。
- 结构债务（staging 拆分、extractSection 单源化）。

## Notes

- **规划期勘察修正（2026-07-31，详见 implement.md）**：F9 按后置债务清单口径=陈旧检测 + `next` 序 0 提议清理保留作者确认，**非静默自动回收**（锁文件已写 pid/startedAt，数据在位）；F10 的 index.lock 不含 pid，「进程存活判断」不可行，收窄为阈值 60s + 删前二次 stat；F11 勘察发现**写侧 registerBook 本就无安全校验**，修法改为写读双侧（isSafeFileStem 复用 P0 单源）；F8 按防呆方言既有姿势 throw 人话（决策 62 拒绝不改写）；F12 实测 v7 路由设计上无 fallback 行选择机制，同构问题大概率不存在，以实测取证收口。
- **F11 定级**：按 claude 建议留本批（触发前提=文件先被外因写坏，写侧修复后攻击面进一步收窄）；作者如裁决升级随时可拆出，不阻塞其余四项。
- 五项彼此独立可任意顺序；lightweight 合批 PRD+implement 启动，不写 design.md（单项设计决策已内联）。分工沿用：kimi 实施 / claude 检查（review gates 见 implement.md）。
