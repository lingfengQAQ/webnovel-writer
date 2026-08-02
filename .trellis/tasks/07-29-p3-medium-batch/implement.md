# 实施计划：P3 中危合批（F8-F11 + F12）

前置：v7 分支 887dc1a 之后；716 测试绿基线。分工沿用：kimi 实施 / claude 检查。TDD 每项先攻击/故障样例红测。

> 状态（2026-07-31 kimi 收尾）：**S1-S6 全部完成，全量 733/733 绿 + drift 绿，等 claude review gates（S3 序 0 走查 + S6 全证据复跑）**

## 规划期勘察修正（2026-07-31，逐文件核实）

- **F9 口径以后置债务清单为准**（`tasks/archive/2026-07/07-23-v7-global-review-remediation/research/后置债务清单.md` 行 15）：陈旧检测（pid 存活或年龄阈值）+ **由 `next` 序 0 提议清理并保留作者确认**——**不做静默自动回收**；现有并发互斥与锁内不变量测试不回退。勘察红利：锁文件已写 `{pid, operation, startedAt}`（`contract-invalidation.js:36-38`），自愈所需数据在位，只缺读侧判定 + 序 0 接线 + EEXIST 文案补锁路径。
- **F10 修正**：git 的 `index.lock` 是 git 自身产物**不含 pid**，「持锁进程存活判断」不可行；口径收窄为=阈值 3s→60s + 删除前二次 stat 确认年龄（防 TOCTOU 误删活锁）。
- **F11 勘察发现**：写侧 `registerBook`（`session/index.js:109-113`）只查非空，**「目录」字段本就无安全校验**——PRD"读侧复用 persist-book 同款校验"的前提不成立。修法改为**写读双侧**：写侧 `目录` 过 `isSafeFileStem`（复用 P0 单源），读侧同款过滤、坏行走既有 corrupt 计数 + 自愈回写通道。
- **F8 修法定向**：防呆方言对非法形态的既有姿势是 **throw 人话**（嵌套映射即先例，`yaml-dialect.js:19-21`），与决策 62「校验拒绝而非静默改写」一致——key 非法（含 `\n`/`:`/`#`/首尾空白/引号引导）直接 throw，不做引号转义。
- **F12 现场**：v7 路由=`knowledge/index.js:92-96` 读 `路由.csv` 只做 canonical 归一（注释明言「不选择创意约束或作品方案」「内容按空降级」）——设计上无 fallback 行选择机制，#135 同构问题**大概率不存在**，核查以实测取证收口为主。
- **F11 定级**：按 claude 建议留本批（中危，触发前提=文件先被外因写坏）；作者如裁决升级随时可拆出，不阻塞其余四项。

## 步骤（顺序可调，五项彼此独立）

- [x] **S1 F8 YAML key 校验**：红测（8 类注入样例 throw 人话指认字段名 + 合法键不受影响）→ `serializeYAML` 循环头 `assertSafeYamlKey` 白名单判定 → 全量 front matter round-trip 43 绿。
- [x] **S2 F10 index.lock 阈值**：`STALE_LOCK_MS` 3000→60000（导出常量供测试断言下限）+ 删除前二次 stat 年龄确认；git-health 7 例全绿（5s 新鲜锁保留/90s 超龄删/二次 stat 覆盖）。
- [x] **S3 F9 契约锁陈旧自愈**：红测（死 pid→陈旧 / 活 pid 超龄→拒 / 无 pid+超龄→年龄兜底 / EEXIST 文案）→ `readStaleContractLock`（pid 存活探测优先，EPERM 保守活锁；无 pid 回退 30 分 mtime）→ 序 0 独立检测并入 failures（动作=delete + 修复指引；**非静默回收**）→ `persistRepair` 新增 `action:'delete'`（`REPAIR_DELETE_ALLOWED` 白名单只放行契约锁路径）→ EEXIST 文案。活锁拒绝零回退（router 2 例实证序 0 不被活锁触发）。
- [x] **S4 F11 books.jsonl 写读双侧**：红测（形状非法行 10 样例全 corrupt、写侧 8 类非法目录拒绝、自愈回写清坏行）→ 共用 `isValidBookEntry`（目录=`isSafeFileStem` P0 单源）；读侧形状非法一行入 corrupt 走原有回写通道；`runtime/locate.js` 消费面零改动。session 20 例全绿。
- [x] **S5 F12 路由同构核查（核查项）**：实测三场景取证实拍（玄幻=无携带；修仙=canonical 归一仙侠声明表；玄幻+凡人流=显式指定才进包）+ resolveBookKnowledge 源码逐行审（未命中显式列出、零 fallback/默认选择/继承分支）→ **零改动收口**，`research/route-isomorphism-check.md`。
- [x] **S6 收尾**：全量回归 **733/733 绿** + drift check 绿；spec 回填 story-repo 0.21 决策 64（四条口径合批记录）；父任务 F8-F11 全勾选 + F12 结论记录；提交分层（实现+测试一 commit、任务工件一 commit——待作者/claude 检查后执行）。

## Review gates（claude）

1. S3 完成后：序 0 清理流走查（不得绕过作者确认、活锁不得误删）。
2. S6 前：F12 核查记录 + 全部攻击样例输出贴任务目录；claude 独立复跑（含 WSL 过一遍平台相关测试——P0/P2 两次 ubuntu CI 教训）。

## 回滚点

五项独立，每项单 commit 粒度可 revert；S3 若序 0 接线复杂度超预期，可先落陈旧检测+文案（不自动清理），清理流拆后续——比现状（永久死锁无指引）已是净改善。
