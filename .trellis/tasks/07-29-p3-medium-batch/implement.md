# 实施计划：P3 中危合批（F8-F11 + F12）

前置：v7 分支 887dc1a 之后；716 测试绿基线。分工沿用：kimi 实施 / claude 检查。TDD 每项先攻击/故障样例红测。

## 规划期勘察修正（2026-07-31，逐文件核实）

- **F9 口径以后置债务清单为准**（`tasks/archive/2026-07/07-23-v7-global-review-remediation/research/后置债务清单.md` 行 15）：陈旧检测（pid 存活或年龄阈值）+ **由 `next` 序 0 提议清理并保留作者确认**——**不做静默自动回收**；现有并发互斥与锁内不变量测试不回退。勘察红利：锁文件已写 `{pid, operation, startedAt}`（`contract-invalidation.js:36-38`），自愈所需数据在位，只缺读侧判定 + 序 0 接线 + EEXIST 文案补锁路径。
- **F10 修正**：git 的 `index.lock` 是 git 自身产物**不含 pid**，「持锁进程存活判断」不可行；口径收窄为=阈值 3s→60s + 删除前二次 stat 确认年龄（防 TOCTOU 误删活锁）。
- **F11 勘察发现**：写侧 `registerBook`（`session/index.js:109-113`）只查非空，**「目录」字段本就无安全校验**——PRD"读侧复用 persist-book 同款校验"的前提不成立。修法改为**写读双侧**：写侧 `目录` 过 `isSafeFileStem`（复用 P0 单源），读侧同款过滤、坏行走既有 corrupt 计数 + 自愈回写通道。
- **F8 修法定向**：防呆方言对非法形态的既有姿势是 **throw 人话**（嵌套映射即先例，`yaml-dialect.js:19-21`），与决策 62「校验拒绝而非静默改写」一致——key 非法（含 `\n`/`:`/`#`/首尾空白/引号引导）直接 throw，不做引号转义。
- **F12 现场**：v7 路由=`knowledge/index.js:92-96` 读 `路由.csv` 只做 canonical 归一（注释明言「不选择创意约束或作品方案」「内容按空降级」）——设计上无 fallback 行选择机制，#135 同构问题**大概率不存在**，核查以实测取证收口为主。
- **F11 定级**：按 claude 建议留本批（中危，触发前提=文件先被外因写坏）；作者如裁决升级随时可拆出，不阻塞其余四项。

## 步骤（顺序可调，五项彼此独立）

- [ ] **S1 F8 YAML key 校验**：红测（key 含 `\n`/`:`/`#` 的注入样例期望 throw 人话）→ `serializeYAML` 循环头加 key 白名单判定（合法=非空、无控制字符、无 `:`/`#`/引号引导、无首尾空白）→ 全量 front matter round-trip 回归。
- [ ] **S2 F10 index.lock 阈值**：`STALE_LOCK_MS` 3000→60000 + 删除前二次 stat 年龄确认；异常样本库全绿；spec 决策注明理由（杀软/索引器锁盘场景）。
- [ ] **S3 F9 契约锁陈旧自愈**：红测（放置陈旧锁文件：pid 已死 / startedAt 超阈值）→ 读侧 `readStaleContractLock(repoPath)`（pid 存活探测 + 年龄阈值双判）→ `next` 序 0 检测到陈旧锁时进 `dto.failures` 提议清理（走既有序 0 修复确认流，作者确认后 persist-repair 删锁）→ EEXIST 报错文案补锁文件路径与「若确认无并发进程可经序 0 清理」指引。活锁（pid 存活）保持拒绝。现有互斥测试零回退。
- [ ] **S4 F11 books.jsonl 写读双侧**：红测（`目录: "../../x"` 写侧拒绝；手工坏行读侧过滤入 corrupt 计数且 locate 不消费）→ 写侧 `registerBook` 校验 `书名` 非空字符串 + `目录` 过 `isSafeFileStem`；读侧 `readBooks` 行级形状校验（书名/目录字符串 + 目录 isSafeFileStem），坏行 corrupt++ 走既有自愈回写；`runtime/locate.js` 消费面零改动（上游已滤净）。
- [ ] **S5 F12 路由同构核查（核查项）**：实测三场景取证——只给大类题材（如 玄幻）建书时 `knowledge-pack` 返回集、`路由.csv` 归一行为、书级契约是否隐式带入某子流派调性/桥段默认值；结论 + 复现命令留档本任务 `research/route-isomorphism-check.md`。有问题→修复并补测试；无问题→写明证据收口。
- [ ] **S6 收尾**：全量回归 + drift 绿；spec 回填（story-repo 决策条目：F8 key 校验口径 / F9 序 0 清理流 / F10 阈值 / F11 双侧校验；error-handling 如涉补条）；提交分层（实现+测试一 commit、任务工件一 commit）；父任务 F8-F11 勾选 + F12 记录结论。

## Review gates（claude）

1. S3 完成后：序 0 清理流走查（不得绕过作者确认、活锁不得误删）。
2. S6 前：F12 核查记录 + 全部攻击样例输出贴任务目录；claude 独立复跑（含 WSL 过一遍平台相关测试——P0/P2 两次 ubuntu CI 教训）。

## 回滚点

五项独立，每项单 commit 粒度可 revert；S3 若序 0 接线复杂度超预期，可先落陈旧检测+文案（不自动清理），清理流拆后续——比现状（永久死锁无指引）已是净改善。
