# M1 格式层核心库 + 派生缓存

## Goal

实现 v7 的格式层基础设施，使系统能够可靠地读写 story repo 源文件，并通过缓存支撑精准读取。交付四层能力（依赖链）：① 容错读写库 → ② Storage Adapter 小端口 → ③ `.cache/index.db` 五表+重建器 → ④ 41 精准读取接口 CLI。出口：删光 `.cache` 全量重建测试绿 + 精准读取 41 接口逐条测试绿。

## Background

**上游就绪**：
- spec 0.8：格式法律文本（§1 不变量、§2-6 文件格式、§11 缓存）
- O4 缓存设计（2026-06-26 定稿）：五表 DDL、41 接口清单、优先级分层
- 实施计划 §1.5：架构原则（拆小端口、AI 不碰文件、状态机不判业务）
- 后端规范基线 1.1：零依赖、node:sqlite、容错读取、防呆方言、永不带栈崩
- M0 骨架：`v7/src/storage/index.js`、`v7/src/cache/index.js` 占位已存在

**范围决策**（2026-06-27）：
- 本任务一次交付全 41 个精准读取接口（分 P0/P1/P2 三层实现、每层一 commit 检查点）
- 不拆父子任务（四块是依赖链不是独立交付物，拆了反而增加跨任务状态管理成本）

## Requirements

### R1 容错读写库（格式解析与序列化）

**R1.1 Front matter 读写**
- 解析章节文件的 YAML front matter（`---` 包裹），提取结构化字段
- 解析三类条目文件（伏笔/悬念/感情线）的 front matter + Markdown 正文分区（描述/收尾计划/履历）
- 解析角色卡、信息差、世界观、名册文件
- **容错**：遇到未知字段必须保留原样（不变量 9）；YAML 解析失败返回错误对象（不崩溃）

**R1.2 平铺 YAML 与 book.yaml**
- 读取 `book.yaml` 的平铺字段（spec §3）
- 写出时强制防呆方言（spec §2.3、数据规范 §4）：
  - 一律平铺（禁止嵌套映射）
  - 列表块格式（`- 项`，禁 `[a,b]`）
  - 危险值加引号（数字串、含冒号/`true`/`null` 等易误判的字符串）
  - 两空格缩进、UTF-8 无 BOM

**R1.3 时间线 Markdown 表格**
- 解析 `定稿/设定/时间线/第NN卷.md` 的 Markdown 表（`| 章 | 书内时间 | 一句话事件 | 在场 |`）
- 提取行到结构化数组

**R1.4 名册解析**
- 解析 `定稿/设定/名册.md` 表（`| 正名 | 别名 | 类型 | 首现章 |`）
- 建立别名→正名映射

### R2 Storage Adapter 小端口（架构原则 §1.5）

**禁止上帝对象**：不做 20 方法的 `StoryRepo` 大类，拆成职责最小的独立端口：

- `ChapterReader`：读章节 front matter、正文、指定范围
- `ChapterWriter`：写新章到定稿（M2 调用，本任务只定接口）
- `ThreadLedgerReader`：读三类条目（伏笔/悬念/感情线）基本信息、履历、收尾计划
- `ThreadLedgerWriter`：更新条目状态、追加履历（M2 调用，本任务只定接口）
- `EntityReader`：读角色卡、解析别名、列出实体
- `TimelineReader`：读指定卷时间线、按在场过滤
- `SecretReader`：读信息差基本信息、内容
- `OutlineReader`：读总纲/卷纲指定小节
- `BookConfigReader`：读 `book.yaml`

每个端口只暴露 2-5 个方法，调用方按需依赖（权限最小化）。

### R3 `.cache/index.db` 五表与重建器

**R3.1 五表 DDL**（O4 §1，表名英文、内容中文）
- `chapters`：章 front matter 展开（章号/标题/卷/视角/章定位/钩子/情绪定位/字数/file_path）
- `threads`：三类条目统一存放（id/type/short_title/strength/status/opened_chapter/planned_end/last_advanced_chapter/file_path）
- `secrets`：信息差（id/short_title/known_to JSON/reader_knows/registered_chapter/keywords JSON/file_path）
- `entities`：名册（id 即正名/type/status/location/realm/possessions JSON/last_changed_chapter/file_path）
- `entity_aliases`：别名表（alias PK/entity_id FK）
- `fingerprints`：文体指纹（chapter_range_start+end 复合 PK/is_baseline/常用特征列/fingerprint_data JSON）

索引：按 O4 §1 各表建必要索引（volume_num、type、status、reader_knows、is_baseline 等）

**R3.2 重建器**（node:sqlite，O4 §4）
- 输入：只读 `定稿/`、`大纲/`、`文风/`（不读工作区）、`book.yaml`
- 输出：全量重建五表（DELETE 旧数据 → 扫描源文件 → INSERT）
- 校验：
  - 履历证据章节文件存在性（spec 0.8 A3 决策）
  - 别名唯一性（同一别名不能指向多个实体）
- 触发：`.cache/index.db` 不存在或损坏时
- **不做**：语义验证（履历真假、泄密真假）→ 两审负责

**R3.3 派生值策略**（O4 §0 原则 5）
- **不物化**：悬了太久章数（`当前最大章号 − last_advanced_chapter`）、信息差蓄积章数、是否超期 → 查询时算
- **不存**：随当前章号漂移的任何值
- 理由：避免每章定稿刷新全表，避免失同步

### R4 精准读取接口 CLI（41 个，O4 §2）

**命令式 API**：每个接口是一个明确的脚本命令，可在 CLI 调用、AI 友好、默认精准、统一 JSON/文本输出。

**P0（8 个，写章流程依赖）**：
- 时间线：读当前卷+上一卷
- 条目：读条目基本信息、读条目履历
- 正文：读近 N 章结尾、读章摘要
- 设定：读角色卡 front matter、解析别名
- 报表：悬了太久清单

**P1（7 个，机检与全书近况）**：
- 正文：读章节 front matter、按章定位筛选
- 信息差：列出未揭晓信息差
- 全文检索：关键词全文检索
- 报表：全书统计摘要、连续弱钩计数

**P2（26 个，AI 角色与自动模式优化）**：
- 条目：读条目收尾计划、读条目描述、列出某类型条目、按强度筛选
- 大纲：读总纲指定小节、读总纲结局段、读卷纲全文、读卷纲指定小节、列出所有卷纲
- 正文：读章节正文、读章节结尾 N 字、读章节开头 N 字、读章节范围摘要
- 时间线：读当前卷、读指定卷、按在场角色筛选
- 设定：读角色卡完整、读角色卡指定小节、列出所有角色、读世界观指定小节
- 信息差：读信息差内容
- 全文检索：正则表达式检索
- 报表：信息差蓄积报表、文体漂移报告、条目活跃率报表

完整清单见 O4 §2.2-2.9 各表（本 PRD 不重复列全部参数）。

## Constraints

### 技术约束（后端规范 + spec 不变量）

**C1 零第三方依赖**（质量规范 §1.1）
- 缓存用 `node:sqlite`（内置）
- 测试用 `node:test` + `node:assert`（内置）
- **唯一例外**：YAML 解析用 `js-yaml`（MIT、当前 5.2.0、YAML 规范复杂不适合手写）；序列化手写（简单、可控）
  - 实测传递依赖：js-yaml 带一个 `argparse`（同 nodeca 维护、MIT、供其 CLI 用）。即直接依赖仅 js-yaml，依赖树共 2 个小包——"零依赖"指零臃肿依赖树，此处符合其精神

**C2 容错与防呆**（不变量 1/9，数据规范 §4）
- 任何源文件解析失败不得崩溃，返回错误对象
- 未知字段保留原样写回
- 系统写出的 YAML 强制防呆方言（平铺/块列表/危险值引号）

**C3 编码与平台**（质量规范 §3）
- 所有文件 IO 显式 UTF-8 无 BOM
- Windows 中文路径必须正确处理（CI 验收项）
- 文件排序靠零填充数字前缀（`0152-`、`伏笔-031`），不依赖中文字典序

**C4 职责分界**（质量规范 §2.1）
- 本任务只做脚本能做的：文件 IO、格式解析、SQL 查询、字符串拼接
- 不做语义判断（履历真假、泄密真假）→ 两审负责
- 禁止用正则凑语义判断

**C5 错误处理**（错误规范 §1）
- 永不带堆栈崩溃
- 面向作者的错误全中文、说清发生了什么/影响/该怎么办

## Acceptance Criteria

### 核心验收（CI 强制）

**AC1 删光 `.cache` 全量重建**（不变量 2）
- [ ] `.cache/index.db` 不存在时，首次查询触发全量重建
- [ ] 重建后五表填充完整，所有查询正确返回
- [ ] 删除 `.cache/` 后再次查询，行为不变（可重建）
- [ ] CI 测试：删缓存→重建→验证查询结果与预期一致

**AC2 41 精准读取接口逐条测试**
- [ ] 每个接口有至少一个测试用例（喂真实 fixture 或 mock 数据，断言输出格式与内容）
- [ ] P0 接口测试覆盖典型输入与边界（空结果、不存在的 ID、范围越界）
- [ ] P1/P2 接口至少有正常路径测试

**AC2 权威 41 接口清单**（对齐 O4 §2.2-2.9，命令层测试逐条核对此表）：

| # | 分类 | 接口 | 命令 |
|---|------|------|------|
| 1 | 条目 | 读条目基本信息 | `read-thread <id> --fields=基本信息` |
| 2 | 条目 | 读条目履历 | `read-thread <id> --履历` |
| 3 | 条目 | 读条目收尾计划 | `read-thread <id> --收尾计划` |
| 4 | 条目 | 读条目描述 | `read-thread <id> --描述` |
| 5 | 条目 | 列出悬了太久 | `list-threads --悬了太久` |
| 6 | 条目 | 列出某类型 | `list-threads --type=<t> [--status=<s>]` |
| 7 | 条目 | 按强度筛选 | `list-threads --strength=高` |
| 8 | 大纲 | 读总纲指定小节 | `read-outline --总纲 --section=<标题>` |
| 9 | 大纲 | 读总纲结局段 | `read-outline --总纲 --结局` |
| 10 | 大纲 | 读卷纲全文 | `read-outline --卷=<N>` |
| 11 | 大纲 | 读卷纲指定小节 | `read-outline --卷=<N> --section=<标题>` |
| 12 | 大纲 | 列出所有卷纲 | `list-volumes` |
| 13 | 正文 | 读章节 front matter | `read-chapter <num> --front-matter` |
| 14 | 正文 | 读章节正文 | `read-chapter <num>` |
| 15 | 正文 | 读章节结尾 N 字 | `read-chapter <num> --tail=<N>` |
| 16 | 正文 | 读章节开头 N 字 | `read-chapter <num> --head=<N>` |
| 17 | 正文 | 读章摘要 | `read-chapter <num> --摘要` |
| 18 | 正文 | 读章节范围摘要 | `read-chapters --range=<a>-<b> --摘要` |
| 19 | 正文 | 读近 N 章结尾 | `read-chapters --recent=<N> --tail=<M>` |
| 20 | 正文 | 按章定位筛选 | `list-chapters --章定位=推进 [--卷=<N>]` |
| 21 | 时间线 | 读当前卷 | `read-timeline --current-volume` |
| 22 | 时间线 | 读当前卷+上一卷 | `read-timeline --current-and-prev` |
| 23 | 时间线 | 读指定卷 | `read-timeline --卷=<N>` |
| 24 | 时间线 | 按在场筛选 | `read-timeline --在场=<角色名>` |
| 25 | 设定 | 读角色卡 front matter | `read-character <name> --front-matter` |
| 26 | 设定 | 读角色卡完整 | `read-character <name>` |
| 27 | 设定 | 读角色卡指定小节 | `read-character <name> --section=<标题>` |
| 28 | 设定 | 解析别名 | `resolve-alias <别名>` |
| 29 | 设定 | 列出所有角色 | `list-characters [--status=<s>]` |
| 30 | 设定 | 读世界观指定小节 | `read-worldview --section=<标题>` |
| 31 | 信息差 | 读信息差基本信息 | `read-secret <id> --基本信息` |
| 32 | 信息差 | 读信息差内容 | `read-secret <id> --内容` |
| 33 | 信息差 | 列出未揭晓 | `list-secrets --reader-knows=false` |
| 34 | 检索 | 关键词全文检索 | `grep-story <关键词>` |
| 35 | 检索 | 正则检索 | `grep-story --regex=<pattern>` |
| 36 | 报表 | 悬了太久清单 | `report-overdue-threads` |
| 37 | 报表 | 信息差蓄积 | `report-secret-accumulation` |
| 38 | 报表 | 文体漂移（M1 边界：读表对比基线，不做特征提取） | `report-style-drift` |
| 39 | 报表 | 条目活跃率 | `report-thread-activity --卷=<N>` |
| 40 | 报表 | 连续弱钩计数 | `report-weak-hook-streak` |
| 41 | 报表 | 全书统计摘要 | `report-book-stats` |

合计 7+5+8+4+6+3+2+6 = **41**，分布于 21 个命令文件（多接口共享文件，靠 `--选项` 分流）。

**AC3 容错读取**（不变量 9）
- [ ] front matter 含未知字段时，解析不崩溃，字段保留
- [ ] 写回时未知字段原样出现在输出 YAML 中
- [ ] 测试：构造含 `自定义字段: 值` 的章节文件，读→改标题→写，自定义字段不丢失

**AC4 防呆写出**（数据规范 §4）
- [ ] 写出的 front matter 一律平铺（无嵌套映射）
- [ ] 列表一律块格式（每行 `- 项`）
- [ ] 危险值加引号（`"123"` 不误判数字、`"true"` 不误判布尔）
- [ ] 测试：写含列表/数字串/含冒号字符串的 YAML，手工验证输出格式

**AC5 Windows 中文路径全链路**（质量规范 §3.2）
- [ ] CI Windows job 包含中文目录名与文件名的 fixture
- [ ] 读写、重建、查询全流程在中文路径下通过

### 接口行为验收（抽查典型）

**AC6 章节读取**
- [ ] `read-chapter <num> --front-matter`：返回 JSON 含章号/标题/卷/视角等字段
- [ ] `read-chapter <num> --tail=500`：返回正文末尾 500 字（不含 front matter）
- [ ] 不存在的章号返回明确错误（不崩溃）

**AC7 条目读取**
- [ ] `read-thread <id> --fields=基本信息`：返回强度/状态/开启章/预计收尾
- [ ] `read-thread <id> --履历`：返回履历列表（按章号排序）
- [ ] `list-threads --悬了太久`：计算 `当前最大章号 − last_advanced_chapter`，返回超过阈值的条目（阈值从 `book.yaml` 读取）

**AC8 别名解析**
- [ ] `resolve-alias <别名>`：返回正名
- [ ] 未登记别名返回"未找到"（不崩溃）
- [ ] 同一别名指向多个正名时，重建器报错（别名唯一性校验）

**AC9 报表生成**
- [ ] `report-overdue-threads`：按类型分组返回悬了太久的条目清单
- [ ] `report-book-stats`：返回总章数/总字数/条目数/角色数
- [ ] `report-weak-hook-streak`：返回末尾连续弱钩章数

**AC10 重建器校验**
- [ ] 履历引用不存在的章节文件时，重建器记录警告（不阻断重建，但输出可见）
- [ ] 别名冲突时，重建器报错并拒绝重建

### 架构验收

**AC11 小端口分离**（架构原则 §1.5）
- [ ] `storage/` 导出至少 8 个独立 reader 端口（ChapterReader / ThreadLedgerReader / EntityReader / TimelineReader / SecretReader / OutlineReader / BookConfigReader + 未来 Writer 占位）
- [ ] 每个端口方法数 ≤ 5
- [ ] 测试中可单独 import 某一端口，不依赖其他端口实例化

**AC12 测试镜像 src**
- [ ] `v7/test/storage/` 与 `v7/src/storage/` 镜像
- [ ] `v7/test/cache/` 与 `v7/src/cache/` 镜像
- [ ] 测试文件命名 `*.test.js`

## Out of Scope

- ❌ Writer 端口的真实实现（M2 定稿流程调用，本任务只定接口占位）
- ❌ 增量更新缓存（定稿时只写变化行）→ M2 优化
- ❌ 文体指纹特征提取算法（`fingerprints` 表建好但留空，特征提取随 M3+ 体检/卷复盘补）；`report-style-drift` 接口存在、能读表并对比基线，但 M1 不实现特征提取函数
- ❌ 向量库与语义检索（可选插件，7.x）
- ❌ CLI 子命令注册机制优化（当前动态 import 按命令名加载，M3+ 可做统一注册表）

## Open Questions

无阻断问题。以下为实施细节，进入 design 阶段决策：

- YAML 库选型：`js-yaml`（零依赖、MIT）vs 手写轻量解析器？
- 测试 fixture 布局：`v7/test/fixtures/` 放示例书仓库？
- CLI 命令 41 个如何组织：全扁平 `bin/commands/*.js` 还是按类型分组子目录？
- 文体指纹 `fingerprints` 表在 M1 只建表结构 + 占位查询接口，特征提取函数留桩——这个边界在 design 明确

## Notes

- 本任务是 M2-M6 的地基：M2 写章流程脚本依赖 P0 接口、M3 状态机依赖全书近况、M4 AI 角色依赖完整读取面
- 四块交付物是依赖链（容错读写库 → 小端口 → 五表+重建 → 41 接口），不拆父子任务
- 实施分四阶段（每阶段一 commit）：① 容错读写库 → ② Storage Adapter 端口 → ③ 五表+重建器 → ④ 41 接口分层（P0→P1→P2，每层 sub-commit）
- 后端规范 + spec 0.8 + O4 是法律文本，本 PRD 与之冲突时以它们为准
