# design.md — v7 边界收口：格式对齐与状态机判定修复

> 依据：本任务 prd.md + spec 0.9（决策 27-32）。模块现状引用以 2026-07-02 代码为准（commit 6b312a4 起算，文档回填 871c448 不含代码）。

## 1. 改动总览（按层）

| 层 | 文件 | 改动 |
|---|---|---|
| storage/adapters | `OutlineReader.js` | 卷纲路径进 `卷纲/` 子目录（A1） |
| storage/adapters | `SummaryWriter.js` | 卷摘要写 `第NN卷.md`（A2，若卷摘要写出在 persist 则改 persist） |
| storage/adapters | `SecretWriter.js` / `SecretReader.js` | 字段名 `知情人`/`读者已知`；`listUnrevealed` 扩返回（A3/C2） |
| cache | `schema.js` | `chapters` 表加 `is_volume_end`；新增 `meta` 表（B1/B2）；schema 版本号 +1 触发自动重建 |
| cache | `rebuilder.js` | 字段名切换（A3）；`收卷` 填充 `is_volume_end`；`secrets.short_title` 从文件名短题解析（B1/C2） |
| state-machine | `index.js` | 序 4 改读收卷标记；序 5 改"距上次体检 ≥ 周期"；book.yaml 解析失败不再默认值兜底（B1/B2/B3） |
| state-machine | `detectors.js` | 序 0 补扫四类；序 3 计入 细纲/材料（B3/B4） |
| state-machine | `dto.js` | 序 6 期望产物文案补收卷提议提示（B1） |
| state-machine | `persist.js` | 卷纲路径（A1）、卷摘要文件名（A2） |
| mechanical-check | `index.js` | 新增条目变动形式检查（C1） |
| prep | `index.js` | 信息差边界注入 短题/知情人/关键词/内容首句（C2） |
| review | `index.js` | ReviewInput 增 拟条目变动 + 相关条目履历尾部（C3） |
| 新增 use case | `src/health-check/index.js` + `src/commands/health-check.js` | 最小体检：汇总既有报表 + 记录上次体检章号（B2） |
| roles | `事实审查.md` | 输入清单补"相关条目（含拟变动与近期履历）"（C3） |
| test | fixtures + 相关测试 | 路径/字段名同步；新判定正反用例 |

不动：`finalize/index.js`（收卷经 payload.frontMatter 透传，无需改）、`ChapterWriter`（未知字段原样写出已覆盖 `收卷`）、SKILL.md、host-shells 生成器。

## 2. 关键设计

### 2.1 收卷链路（B1）

- **数据流**：细纲提案（AI，含收卷提议）→ 作者确认 → 草稿/定稿包 front matter `收卷: 是` → `ChapterWriter` 原样写出 → 定稿后缓存重建 `is_volume_end=1` → 下次 `next` 序 4 命中。
- **解析宽容**：js-yaml 会把 `是` 解析为字符串 `"是"`；重建器接受 `收卷 === '是' || 收卷 === true`，其余值视为未收卷（不报错——非清单字段错误不属序 0）。
- **序 4 判定**：`SELECT chapter_num, volume_num, is_volume_end FROM chapters ORDER BY chapter_num DESC LIMIT 1`，`is_volume_end=1` 即卷复盘；DTO 的 `卷` 取该章 `volume_num`（替换原 `Math.floor(maxChapter/卷规模)`）。
- **卷规模退役**：状态机不再读 `卷规模`；它只由 `book-status`（全书近况"本卷 24/40 章（参考）"）与细纲提议消费——实现时核对 `book-status.js` 的 当前卷 计算改用 `MAX(volume_num)`，不得用章号除法。

### 2.2 体检记录与最小体检（B2）

- **`meta` 表**：`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`；键 `last_health_check_chapter`。派生物语义：删缓存后键消失 → 视为 0 → 到期即重测，无害。
- **序 5 判定**：`maxChapter - last_health_check >= 体检周期`（`体检周期` 来自 book.yaml，默认 50——字段已入 spec 0.9 §3）。
- **最小体检 use case**（`runHealthCheck`）：汇总既有查询（悬了太久清单、条目活跃率、连续弱钩计数）→ 写 `工作区/体检报告.md`（文体指纹/高频意象/句式小节输出"随 M5.5 落地"占位说明）→ `meta` 记录 `last_health_check_chapter = maxChapter`。零 token、needsAI=false，与序 5 的"脚本项"定位一致。CLI 动词 `health-check`（脚本命令不属 F1 的 AI 通道问题，与 prepare-chapter/mechanical-check 同类）。

### 2.3 序 0 扫描清单（B3）

`detectParseFailures` 在既有六目录 front matter 扫描外补四类（spec 0.9 §10 清单，实现不得自行增减）：

| 目标 | 判定 | 缺失时 |
|---|---|---|
| `book.yaml` | `BookConfigReader.read()` 不 ok → failure | 缺失不算失败（序 1 建书态负责） |
| `文风/文风铁律.md` | 有文件且 front matter 解析失败 → failure | 缺失跳过（文风可选） |
| `定稿/设定/名册.md` | `parseMarkdownTable` 不 ok → failure | 缺失跳过（名册非必需，与重建器口径一致） |
| `定稿/设定/时间线/*.md` | 逐文件 `parseMarkdownTable` 不 ok → failure | 目录缺失跳过 |

与重建器的分工：重建器对名册/时间线解析失败是**软跳过 + warning**（不阻断重建），序 0 是**作者面对的修复确认**——两者互补，口径不冲突。`index.js` 序 4-6 段的 `config.ok || 默认值` 兜底保留为纯防御（序 0 拦截后正常路径不会走到）。

### 2.4 条目变动形式检查（C1）

数据源：草稿 front matter 的 `伏笔/悬念/感情线` 块列表，行格式 `动词 ID`（spec 0.9 §4.1）。三条规则，全部查 `threads` 表、零语义：

1. **类型一致**：ID 前缀须与所在数组类型一致（`悬念` 数组里出现 `伏笔-031` → issue）。
2. **开启类动词**（埋下/设下/开启）：ID 不得已存在（撞已有 ID → issue；新 ID 合法——条目文件由定稿创建）。
3. **非开启动词**（推进/回收/揭晓/放弃/修成正果/无疾而终）：ID 必须存在且状态=进行（不存在 → 疑似 AI 编造；状态≠进行 → 推进已收尾条目）。

severity=high、blocking=true（确定性可数项，打回写稿不打扰作者——与禁词同级）。行格式不合 `动词 ID` 的行报 front matter 格式 issue（复用第 6 项检查的归属）。

### 2.5 信息差边界注入（C2）

- `rebuilder` 把 `secrets.short_title` 从文件名第三段起解析（`信息差-021-灭门真凶` → `灭门真凶`；无短题回落 id）。
- `SecretReader.listUnrevealed()` 返回 `{id, 短题, 知情人[], 关键词[]}`（缓存直出）；新增 `readContentFirstLine(id)`（精准片段：`## 内容` 首行）。
- 备料输出行模板：`- 信息差-021（灭门真凶）：知情人=大长老、神秘老者；关键词=大长老/灭门/血书；内容：灭门真凶是大长老。——读者未知，除知情人的对话与视角外不得出现`。

### 2.6 ReviewInput 补料（C3）

- `拟条目变动`：解析草稿 front matter 三数组 → `[{type, verb, id}]`（与 C1 同一解析函数，放 `util/`，机检与 review 共用、不双写）。
- `相关条目`：现有元数据基础上，对草稿声明涉及的条目附 `履历尾部`（`ThreadLedgerReader` 读 `## 履历` 末 3 行）；未被声明但 status=进行 的条目维持纯元数据（控制 token）。
- `roles/事实审查.md` 输入清单行改为：`章号、草稿全文、本章要写到的事、全书近况、相关角色（境界/状态/位置/持有）、相关条目（含拟变动与近期履历）、时间线片段、信息差候选。`（evidence 维度的核对对象在 M5 F1 接线后扩展为拟履历行——本任务不改 evidence 维度定义文字。）

## 3. 兼容与风险

| 风险 | 处置 |
|---|---|
| 缓存 schema 变更 | schema 版本号 +1，`ensureReady` 检测不匹配即全量重建（确认既有机制支持；不支持则加版本检查——实现第一步核实） |
| `收卷: 是` 被 YAML 解析为布尔的方言差 | 重建器同时接受 `'是'`/`true`；序列化侧防呆方言不输出裸 `是` 以外形态 |
| fixtures 路径变更牵连测试面 | 先改 fixtures + 全量跑测，用失败清单定位牵连点（测试是探针不是约束） |
| `book-status` 若按章号除法推当前卷 | 改用 `MAX(volume_num)`；有测试锁行为 |
| roles 变更影响壳生成 | 跑 `build-host-shells --check` 与 validator；dist 不提交 |

## 4. 回滚

四个主题 commit（见 implement.md），任一主题可独立 revert；缓存 schema 回滚 = revert 后删 `.cache` 重建，无持久迁移。
