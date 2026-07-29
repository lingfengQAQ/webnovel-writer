# v7 多维度评审全文与核实记录（2026-07-29）

> 本文档是 `prd.md` 的证据附件：保存 kimi（OpenCode 宿主）评审的完整原文要点、claude 侧的独立核实过程与证据链、以及评审期间的修正与裁决。PRD 管「修什么、什么顺序」，本文管「为什么可信、依据在哪」。

## 1. 评审背景与口径

- 评审对象：v7 分支 `v7/` 目录（Node.js ESM 全量重写，`7.0.0-alpha`）。
- 评审者：kimi（OpenCode 宿主，含子代理逐行复核）；核实者：claude（本仓库，独立抽查源码）。
- 规模口径（kimi 实测）：133 源文件 / 113 测试文件 / 629 用例 / 53 CLI 命令 / 287 条知识引用 / 运行时依赖仅 js-yaml。
- 与 07-23 那轮 kimi 全局评审**不重叠**：上轮整改收口的是口径/基线/重试策略（已归档），本轮的 P0 路径穿越为新发现。

## 2. 评审评分总览（kimi 原文）

| 维度 | 评分 | 一句话 |
|---|---|---|
| 架构设计 | 8/10 | 信任分层清晰（脚本零 AI / 审稿令牌 / 复算校验 / 原子提交），但 staging God Module + 目录级循环依赖 |
| 边界 | 7.5/10 | 命令契约同构、schema 单源做得好；ctx 空值语义不一、静默降级面广 |
| 代码质量 | 8/10 | 错误范式统一、零 TODO、测试镜像 src + 故障注入；extractSection 多份实现违反自家单源纪律 |
| 安全 | 5/10 | 三处高危路径穿越；威胁模型自相矛盾（factPath 有白名单，相邻三字段裸奔） |
| 人机交互 | 9/10 | 单动词状态机、重试预算额度化、中文人话工程、断点续跑——最出色维度 |
| 成熟度 | 4/10 | 4 宿主真模型 smoke 全部 deferred-beta；dist 被 gitignore 依赖手跑 build；lockfile 钉腾讯镜像 |

核心哲学（评审认可为方向正确）：**能数的交脚本，要判断的交两审，事实只经定稿流程入 git。**

## 3. 高危发现的独立核实（claude，逐行抽查）

### F1 `secretWrites[].id` 路径穿越 —— 实锤

`v7/src/storage/adapters/SecretWriter.js` `write(id, frontMatter, content)`：

```js
const dir = path.join(this.repoPath, '定稿', '设定', '信息差')
await fs.mkdir(dir, { recursive: true })
const filePath = path.join(dir, `${id}.md`)
await fs.writeFile(filePath, ...)
```

对 `id` 零校验；`id="../../x"` 逃出书仓，`mkdir recursive` 递归建目录。调用链 `finalize/index.js:237-241` 把 payload 的 `secretWrites` 原样传入。

### F2 `timelineRows[].volumeNum` 同类穿越 —— 实锤

`v7/src/storage/adapters/TimelineWriter.js:27`：

```js
const filePath = path.join(dir, `第${String(volumeNum).padStart(2, '0')}卷.md`)
```

`padStart` 不过滤任何字符，`"../../x"` 原样进路径。调用链 `finalize/index.js:229-234`。

### F3 `books.jsonl` 读侧无形状校验 —— 实锤（PRD 列为 F11，调级中危候选）

`v7/src/session/index.js` 逐行 `JSON.parse(t)` 直接 push，不校验 `目录` 字段形状；`runtime/locate.js` 消费该字段定位工作目录，下游含 `git clean -fd` / `reset --hard` / 递归 `fs.rm`。

### 最关键的对照证据：防线代码已存在，只是没接上

同一条 finalize 链上，`factChanges.factPath` 走了严格校验：

- `knowledge/fact-changes.js:241-246` `isFactPath`：要求 `定稿/设定/` 前缀 + `.md` 结尾；
- `knowledge/design.js:228-233` `normalizePosixRelative`：显式拒绝 `\`、绝对路径、`../` 与 `/../`。

结论：**不是威胁模型缺失，是三个相邻字段漏接现成防线**。修法因此收敛为「源头复用 `normalizePosixRelative` + `writeAtomicBatch` 总闸边界兜底」两层（详见 PRD F1-F4）。

### 结构性论断抽查

- `staging/index.js` 实测 **1513 行**（kimi 报 1423，量级一致，方向成立）。
- `extractSection` 出现在 10 个文件（cache/rebuilder、commands/read-*、knowledge、migrate/transform、prep、review、storage/adapters/OutlineReader、ThreadLedgerReader）；「至少 5 份语义不一实现」方向属实，未逐份比对语义差异。
- `adapters/registry.json` 确认无 opencode 条目（仅 claude-code / codex / gemini-cli / cursor / `_default`）。

## 4. 评审期间的修正记录

### OpenCode 适配：从「能力硬伤」修正为「适配清单遗漏」

kimi 初评称 OpenCode 只能落 `_default`（tier 3，两审降级为同上下文自审）；经其自行复核修正——OpenCode 具备 tier-1 全部能力：

| tier-1 要求 | OpenCode | 证据 |
|---|---|---|
| SKILL.md 单入口 | ✅ | `.opencode/skills/<name>/SKILL.md` 目录约定 |
| 两审独立 subagent | ✅ | `.opencode/agents/*.md` + `mode: subagent`，各自新鲜上下文 |
| 会话启动注入 | ✅（机制不同） | `.opencode/plugins/` `chat.message` hook（本仓库 Trellis 即活证据） |
| 检测命令 | ✅ | `opencode` 在 PATH（1.18.4） |

额外红利：OpenCode subagent frontmatter 支持 `permission: { edit: deny }`，可把两审「只读 ReviewInput」从提示词约束升级为**宿主权限硬约束**——与 v7 信任分层哲学最合拍的宿主。工作量参照 codex adapter，不碰核心 src（PRD F7）。

## 5. claude 侧补充意见（已并入 PRD 口径）

1. **P0 应插队到全部 beta 余项之前**：beta 余项（真写 50 章、v6 迁移、M5 手测、npm 发版）中，npm 发版是 P0 的硬 deadline——发版即把写洞交付给外部用户。
2. **F6 静默降级被初评低估**：与「真模型零验证」叠加时，真写 50 章若吃到缺料 DTO，验证结论本身失真且无人察觉。故提为 P1、排在真模型验证之前；协作系统里「我不知道」必须能和「没有」区分。
3. **语义召回缺失 / 知识库只读 / Dashboard 砍除**属设计取舍非缺陷：v7 有意的减法（DTO 零 token、`report-*` 替代），写满一卷用真实痛点再决策，不预支复杂度。
4. P2 协同哲学类意见（对谈成果无沉淀通道、batch-status 偏账面、结构债务反噬补丁）记录在案，不进本轮修编。

## 6. 与其他事项的关联

- issue #134（语义省略/翻译腔治理）已单独决策：v6 不改、纳入 v7，见记忆 `issue-134-deferred-to-v7`；其中「编辑审加语言机制 category」与本评审的两审机制强相关，实施时注意同一文件（`v7/roles/编辑审.md`）不要两头改。
- issue #135 / PR #136（explicit_genre_fallback）修复只落在 master 线；**v7 路由（`路由.csv` + knowledge-pack）是否存在同构问题仍是待核查项**，建议随 P0 子任务一并列入检查单。

## 7. 落地顺序（与 PRD 一致）

1. P0：F1-F4 路径校验 + 总闸（发版硬阻断；顺带 F5 章号/卷号统一校验）
2. P1：F6 DTO 降级显式标记（真模型验证前置）
3. P2：F7 OpenCode adapter
4. P3：F8-F11 中危合批
5. 结构债务（staging 拆分、extractSection 收单源、storage 端口必经化）随后续重构处理，不单独立项
