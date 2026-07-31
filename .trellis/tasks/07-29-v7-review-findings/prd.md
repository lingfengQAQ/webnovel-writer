# v7 全局评审发现记录（P0安全/P1降级标记/OpenCode适配/中危合批）

## Goal

记录 2026-07-29 对 v7 重写的多维度评审（架构/边界/代码质量/安全/数据完整性/人机交互）发现的问题与商定落地顺序。本任务先做**发现备案**，实施时按优先级拆子任务或转独立任务。

评审口径：v7 为 Node.js ESM 全量重写（133 源文件 / 113 测试文件 / 629 用例 / 53 命令 / 287 条知识引用），版本 `7.0.0-alpha`，npm 发版前预发。所有安全发现均经源码逐行复核（两轮独立核实，结论一致）。

## Requirements

### P0 · 发版硬阻断：路径穿越写通道（必须在 npm 发版前修复）

- [x] **F1：`secretWrites[].id` 路径穿越**。`v7/src/storage/adapters/SecretWriter.js:25-26` 对 id 零校验直接 `path.join(dir, <id>.md)`，`mkdir recursive` 会递归建目录；`id="../../x"` 可写出书仓外且回滚路径够不到。触发链：`finalize --payload` / `stage-chapter` → `finalize-batch`（`finalize/index.js:237-241`）。✅ 2026-07-29 子任务 07-29-p0-path-traversal 修复（Writer 自卫 + 共享 payload 校验层）
- [x] **F2：`timelineRows[].volumeNum` 同类穿越**。`v7/src/storage/adapters/TimelineWriter.js:27`，`String(volumeNum).padStart(2,'0')` 不过滤任何字符。触发链：`finalize/index.js:229-234`。✅ 2026-07-29 同子任务修复
- [x] **F3：`persist-volume-review` 伏笔条目 id 同类穿越**。`v7/src/commands/persist-volume-review.js:17-19` 只查数组类型；`state-machine/persist.js:301-310` 只做撞号检查。✅ 2026-07-29 同子任务修复（persist 层撞号前白名单校验）
- [x] **F4：`writeAtomicBatch` 总闸补 repo 边界检查**。`v7/src/storage/atomic.js:20` 不做目标路径内边界校验；作为所有敏感写入的最后一道防线，加「解析结果必须仍在 repoPath 内」检查（可参照 `staging/contract-invalidation.js:365-389` 的 `workspaceRemovalIsContained` 前缀判定）。✅ 2026-07-29 同子任务修复（词法级断言，mkdir 前判定，回滚语义不变）
- [x] **F5（顺手统一）**：各命令章号/卷号只查 `isNaN` 不查正整数——加统一的 ChapterNum/VolumeNum 校验 helper。✅ 2026-07-29 同子任务修复（`parsePositiveInt` 单源，实测 12 站点：批次 3 + export + finalize + finalize-batch --until + goto + 机检 + 备料 + 读章 + review-input + save-review + stage-chapter）
- 修法口径：源头复用现成的 `normalizePosixRelative` 白名单校验（`knowledge/design.js:228-234`，已显式拒绝 `\`、绝对路径、`../`）+ 总闸边界兜底，两层都要。
- 注：同链上 `factChanges.factPath` 已有严格 `isFactPath` 白名单——本项是「防线代码已存在但三处没接上」，不是新设计。

### P1 · 真模型验证前置：DTO 静默降级显式标记

- [x] **F6：Cache/Reader 失败静默降级为空数据**。如 `storage/adapters/ChapterReader.js:53-56` 缓存失败吞错降级为文件读；prep/review 多处 `catch {}` → 送达 AI 的 DTO 可能悄悄缺料，AI 无法区分「没有数据」与「读取失败」。✅ 2026-07-30 子任务 07-29-p1-dto-degraded-flag 修复（S0 普查 85 站三分类、11 有损点 + 3 锚点全接；收集器 ctx 随行、三链路收口 drain、SKILL/任务书消费约定；spec 0.20 决策 63）
- 危害叠加：与「4 宿主真模型 smoke 全部 deferred-beta」叠加时，beta 真写 50 章若吃到缺料 DTO，验证结论失真且无人察觉。
- 修法口径：DTO 增加 `degraded` 标记字段（降级发生位置+原因）；注意 `state-machine/dto.js` 与 `persist.js` 为产出/落盘对称结构，新字段须同步进 DTO `期望产物` 说明防契约漂移。

### P2 · OpenCode 宿主适配（参照 codex 形状，不碰核心 src）

- [x] **F7：`adapters/registry.json` 无 opencode 条目**，当前落 `_default`（tier 3，agentCapable:false → 两审降级为同上下文自审，评审独立性受损）。经核实 OpenCode 具备 tier-1 全部能力：SKILL.md 原生支持（`.opencode/skills/`）、subagent（`.opencode/agents/*.md` + `mode: subagent`）、会话启动注入（plugin `chat.message` hook，本仓库 Trellis 即活证据）、`opencode` 命令在 PATH。属于**适配清单遗漏而非能力缺口**。✅ 2026-07-30 子任务 07-29-p2-opencode-adapter 修复+复核整改（claude 退回后补：S0 十六项能力实测 + install-e2e 全过 → 插件行为单测 8 例 + OpenCode 1.18.4 真产物最小 smoke 四轮全过（skill 发现/插件注入回文/两审派发/PWNED.txt 行为级不存在）+ spec v3.12 §7.1.1 裁决「tier 与 smoke 门槛两轴独立」消除一级/推迟矛盾；registry verified 降为诚实口径；完整写章 smoke 与全部宿主同口径统一推迟 beta）
- 红利：OpenCode subagent frontmatter 支持 `permission: { edit: deny }`，可把两审「只读 ReviewInput」从提示词约束升级为宿主权限硬约束，与 v7「AI 不信任工程」哲学最合拍。
- 工作量参照 codex adapter：registry 条目 + host-shells 渲染（agents markdown，frontmatter 加 mode/permission）+ installer 加插件文件写入路径（或 AGENTS.md 块兜底）+ `adapters/opencode/support.md`。

### P3 · 中危合批

- [ ] **F8：YAML 序列化器 key 零转义**。`storage/serializers/yaml-dialect.js:18-36`，value 侧转义完备但 key 原样输出；AI 可控 updates 键含 `\n`/`:` 可注入 front matter 结构。修法：key 白名单或同等引号转义。
- [ ] **F9：契约互斥锁无陈旧回收**。`staging/contract-invalidation.js:29-67`，进程被 kill 后锁文件永久残留堵住全部写路径，且报错不给锁位置/删除指引。修法：pid/startedAt 陈旧判定 + 指引文案。
- [ ] **F10：git index.lock 陈旧阈值仅 3 秒**。`state-machine/git-health.js:5`，杀软/索引器锁盘超 3 秒会被误删 → 双 git 进程并发写损坏窗口。修法：提到分钟级 + 进程存活判断。
- [ ] **F11：`books.jsonl` 读侧无形状校验**（用户复核调级为中危候选，待裁决）：`session/index.js` 逐行 JSON.parse 不校验 `目录` 字段，`runtime/locate.js:50` 直接消费 → 目录写坏后 `git clean -fd` / `reset --hard` / 递归 `fs.rm` 作用于工作目录外。复核意见：读侧复用 `persist-book` 同款校验。

### 设计取舍，暂不动

- **语义召回缺失**（v6 向量 RAG 被砍，现仅 sqlite 结构化查询 + grep 关键词）：设计取舍非缺陷，写满一卷后用真实痛点再决策。
- **通用知识库对作者只读**（v6 `/learn` 被砍，经验沉淀移开发期）：同上。
- **Dashboard 砍掉**：v7 用 `report-*` + `batch-status` 替代，保留观察。

### 结构债务（记录在案，随后续重构处理）

- `staging/index.js` 1513 行 God Module，与 finalize/prep/review 存在**目录级循环依赖**（靠文件级错开避免字面 ESM 环，无 lint 护栏，一次 import 合并即引爆）。
- `dto/` 名不副实（仅 1 文件，真正 DTO 组装散在 state-machine/prep/review）。
- `extractSection` 至少 5 份语义不一实现（违反项目自身「单源」纪律）；章尾截取两口径（UTF-16 码元 vs 码点，注释自称同口径，emoji 场景结果不同）。
- storage 端口「可用非必经」：写侧大量绕过适配器直接 fs 调用，长期双写漂移风险。

## Acceptance Criteria

- [ ] 本任务为备案任务：全部发现已记录、定级、附文件:行号与修法口径（本文件即交付物）。
- [ ] 实施启动前，按落地顺序将 P0（F1-F5）拆为首个优先执行的子任务/独立任务，其余随优先级推进。

## 落地顺序（已商定）

1. ✅ P0：F1-F4 校验 + 总闸（发版硬阻断；顺带 F5 统一章号/卷号校验）——子任务 `07-29-p0-path-traversal` 已归档（96773c0 + 397b133，CI 双平台绿；实施中追加发现：总闸对绝对路径平台相关漏判，已一并修复）
2. P1：F6 静默降级标记（真模型 50 章验证之前）——子任务 `07-29-p1-dto-degraded-flag`（planning，prd/design/implement 三件套齐，待 start）
3. P2：F7 OpenCode adapter——子任务 `07-29-p2-opencode-adapter`（planning，PRD 就绪；design 实施期以 plugin spike 补）
4. P3：F8-F10（+F11 待定级）中危合批 + F12 v7 路由 #135 同构核查——子任务 `07-29-p3-medium-batch`（planning，PRD-only 合批；**F11 定级待作者裁决**）；建议 npm 发版前完成

## Notes

- 与 07-23 已完成的全局评审整改不重叠：上轮收口口径/基线/重试策略，本批为新发现（路径穿越三处、OpenCode 适配、DTO 降级标记均为新项）。
- 评审综合评分备忘：架构 8/10、边界 7.5/10、代码质量 8/10、安全 5/10、人机交互 9/10、成熟度 4/10（alpha，真模型零验证）。
- 安全发现经过两轮独立核实（主会话逐行读源码 + 复核），S1/S2/S3 实锤；用户复核对 F11 定级存疑（建议升 P0 候选或保持中危，实施前裁决）。
