# P3 中危合批（F8-F11 + v7 路由 #135 同构核查）

## Goal

一批四个中危修复 + 一个独立核查项，合并推进（每项改动小、彼此独立，不值得各开任务）。**建议在 npm 发版前完成**（中危不阻断 alpha 内测，但不该带给外部用户）。

## Requirements

每项自带修法口径（来源：父任务 prd F8-F11 + 评审核实）：

- [x] **F8 YAML 序列化器 key 零转义**：`storage/serializers/yaml-dialect.js:18-36` value 侧转义完备但 key 原样输出；AI 可控 updates 键含 `\n`/`:` 可注入 front matter 结构。修法：key 走同等 needsQuoting/转义（优先），或 key 白名单。攻击样例进测试。✅ 实施口径=白名单 throw 人话（决策 62 拒绝不改写，与嵌套检测同款姿势；覆盖 `\n`/`:`/`#`/首尾空白/引号引导/空/控制字符八类，报错指认字段名）
- [x] **F9 契约互斥锁无陈旧回收**：`staging/contract-invalidation.js:29-67` 进程被 kill 后锁文件永久残留，堵死全部写路径且报错不给位置/删除指引。修法：锁文件带 pid/startedAt，陈旧判定（pid 不存活或超时阈值）自动回收 + 报错文案给锁路径与人话指引。✅ 实施按后置债务清单口径=**序0 确认流非静默回收**（pid 探测优先/EPERM 保守/30 分钟 mtime 兜底；`persistRepair` 新增 `action:'delete'` 且删除面白名单钳死只放行该锁路径；EEXIST 文案补锁路径+序 0 指引）
- [x] **F10 git index.lock 陈旧阈值仅 3 秒**：`state-machine/git-health.js:5`，杀软/索引器锁盘超 3 秒被误删 → 双 git 进程并发写损坏窗口。修法：阈值提到分钟级（建议 ≥60s）+ 尽可能加持锁进程存活判断；改动须过既有 git 健康检查异常样本库测试。✅ 60s + 删除前二次 stat（git 锁不含 pid 不可判活锁，勘察修正已收窄）
- [x] **F11 books.jsonl 读侧无形状校验**（**待作者裁决定级**，见 Notes）：✅ 作者默认 claude 建议=留本批执行完毕——写读双侧：`registerBook` 与 `readBooksRegistry` 共用 `isValidBookEntry`（目录=`isSafeFileStem` 复用 P0 单源）；形状非法行计入 corrupt 走自愈回写；写侧 8 类非法目录拒绝（含 `../../x`、`/abs`、`C:\x`、保留名）
- [x] **F12 v7 路由 #135 同构核查**（核查项，可能零改动收口）：✅ **零改动收口**——`research/route-isomorphism-check.md`：v7 无 fallback/默认选择机制（resolveLabel 未命中返 null 进未命中清单显式列名；别名归一走声明表非继承）；实测三场景（大类/别名/显式流派对照）均无隐式携带。

## Acceptance Criteria

- [x] F8：注入样例（key 含 `\n`/`:`/引号）序列化后被拒绝；现有 front matter 全量 round-trip 测试绿。（43/43 绿）
- [x] F9：放置陈旧锁文件（pid 死/超龄）后序0 提议清理、作者确认经 persist-repair delete 清除；活锁（pid 存活）仍拒绝且文案含锁路径。（contract-lock 5 + router 2 + persist 3 绿）
- [x] F10：阈值常量更新 + 5s 新鲜锁不误删 / 90s 超龄才删测试；异常样本库全绿。（git-health 7 绿）
- [x] F11（裁决=执行）：坏 `目录` 字段的行被拒/自愈，`locate` 不再消费越界目录；模拟坏行时定位失败给人话而非作用于仓外。（session 20 绿）
- [x] F12：核查记录含复现命令与结论。（`research/route-isomorphism-check.md`，三无携带证据链）
- [x] 全量测试绿 + drift 绿；spec 回填（各项对应决策/规范条目）。（733/733 全绿、drift 绿、story-repo 0.21 决策 64）

## Non-Goals

- P0 已完成项、P1 降级标记、P2 OpenCode adapter。
- 结构债务（staging 拆分、extractSection 单源化）。

## Notes

- **规划期勘察修正（2026-07-31，详见 implement.md）**：F9 按后置债务清单口径=陈旧检测 + `next` 序 0 提议清理保留作者确认，**非静默自动回收**（锁文件已写 pid/startedAt，数据在位）；F10 的 index.lock 不含 pid，「进程存活判断」不可行，收窄为阈值 60s + 删前二次 stat；F11 勘察发现**写侧 registerBook 本就无安全校验**，修法改为写读双侧（isSafeFileStem 复用 P0 单源）；F8 按防呆方言既有姿势 throw 人话（决策 62 拒绝不改写）；F12 实测 v7 路由设计上无 fallback 行选择机制，同构问题大概率不存在，以实测取证收口。
- **F11 定级**：按 claude 建议留本批（触发前提=文件先被外因写坏，写侧修复后攻击面进一步收窄）；作者如裁决升级随时可拆出，不阻塞其余四项。
- 五项彼此独立可任意顺序；lightweight 合批 PRD+implement 启动，不写 design.md（单项设计决策已内联）。分工沿用：kimi 实施 / claude 检查（review gates 见 implement.md）。
