# Research: S0 降级点普查（DTO 静默降级显式标记 F6）

- **Query**: 对 v7 喂 AI 的 DTO 组装链上全部 catch 站点做三分类（有损/良性/合理吞错）普查 + 两个设计验证问题
- **Scope**: internal（v7/src/storage/adapters 全部 Reader、prep/、review/、state-machine/{dto,detectors,flows/*}.js、knowledge/）
- **Date**: 2026-07-30

判定原则（design.md §2）：**降级后数据与真源等价=良性；不等价（缺料）却继续组装=有损；ENOENT=语义「没有」或显式注释既定设计=合理吞错**。
另设第四标注「透传」：`{ok:false,error}` 显式返回 / fail-closed / 失败转可见记录（errors/warnings/failures 数组）——不产生降级，S2 不应接入，仅入表备查。

总量：**85 个 catch 站点**（83 个在六大范围内 + 2 个 state-machine/index.js 路由入口附带核实）。
**有损 10**（另有 2 个非 catch 的静默锚点附记）、**良性 3**、**合理吞错 44**、**透传 28**。

不存在 `SummaryReader`（卷摘要只有 `detectors.js:216` fs.access 存在性探测，无 Reader 实现）——任务书中「SummaryReader 等」为虚指。

---

## §1 三分类汇总表

### 1.1 storage/adapters Readers（32 站）

| 站点 | 读取目标 | 失败路径 | 流入 DTO | 分类 | 理由 |
|---|---|---|---|---|---|
| `ChapterReader.js:53-55` | 缓存 chapters 表 FM | 转文件读 | 经 readFrontMatter→commands read-chapter(s)，不直达 DTO | 良性 | 文件是真源；A6 注释承诺缓存/文件输出同形状 |
| `ChapterReader.js:79-85` | 章节文件读 | 向上抛 | — | 透传 | `{ok:false,error:读取失败原因}` 显式返回 |
| `ChapterReader.js:106-108` | readBody 章节文件 | 向上抛 | 经 readTail 被 prep/dto 静默消费（见 §2-7） | 透传 | 自身不吞；消费侧静默是有损锚点 |
| `ChapterReader.js:155-157` | readdir 定稿/正文 | 跳过 | 返回 null→「章节不存在」 | 合理吞错 | 目录缺失=新书无章=语义「没有」；非 ENOENT 错误同样被并入「不存在」（边缘） |
| `EntityReader.js:33-35` | 角色卡 front matter | 向上抛 | assembleCharacterContext→review:145 静默 continue（见 §2-3） | 透传 | 读失败与「不存在」合并为同一错误消息（边缘） |
| `EntityReader.js:53-55` | 角色卡全文 | 向上抛 | commands，不直达 DTO | 透传 | 同上 |
| `EntityReader.js:74-76` | 缓存 entity_aliases | 转文件读 | resolve-alias 命令，不直达 DTO | 良性 | 名册.md 是真源 |
| `EntityReader.js:97-99` | 名册.md | 向上抛 | — | 透传 | — |
| `EntityReader.js:120-122` | 缓存 entities 列表 | **返回空**（不转文件） | commands list-characters，不直达 DTO | **有损** | 缓存坏→`[]` 与真源（角色目录）不等价；文件降级分支只在 cache=null 时可达 |
| `EntityReader.js:143-145` | readdir 角色目录（无缓存降级分支） | 返回空 | 同上 | 合理吞错 | 目录缺失=无角色；非 ENOENT 也吞（边缘） |
| `ContractReader.js:32-33` | 作品契约.md | 向上抛 | prep:42/review:74/dto.js:79,103 全部 fail-closed | 透传 | 所有消费点「停止+显式错误」；读失败消息抹平为「不存在」（边缘但不改流程） |
| `DesignReader.js:27-30` | readdir 计划对象目录 | 跳过（ENOENT）/错误可见（非 ENOENT→errors.push） | list→prep:136/review:103 备料停止 | 合理吞错 | 计划对象目录可选；真错误浮现 errors→上层 fail-closed（范本式处理） |
| `DesignReader.js:41-43` | 计划对象文件 | 错误可见 | 同上 | 透传 | errors.push→list().ok=false→上层停止 |
| `DesignReader.js:90-92` | readPath 文件 | 向上抛 | commands，不直达 DTO | 透传 | — |
| `OutlineReader.js:25-27` | 总纲.md | 向上抛 | commands，不直达 DTO | 透传 | 错误形状显式 |
| `OutlineReader.js:42-44` | 卷纲文件 | 向上抛 | dto.js:168-173 外层 catch（§1.4） | 透传 | 消费侧已有既定设计注释 |
| `OutlineReader.js:66-68` | readdir 卷纲目录 | 返回空 | commands，不直达 DTO | 合理吞错 | 目录缺失=无卷纲 |
| `SecretReader.js:9-11`（parseJSONArray） | 缓存 JSON 列 | 返回空 | 包装 listUnrevealed 行的知情人/关键词 | 合理吞错 | `text\|\|'[]'` 设计默认 + prep/review 侧「未登记」占位可见；列真损坏时静默（边缘） |
| `SecretReader.js:36-38` | 信息差文件 | 向上抛 | commands | 透传 | — |
| `SecretReader.js:71-73` | 信息差文件内容 | 向上抛 | readContentFirstLine→prep:83「（未读到）」占位可见 | 透传 | prep 侧占位显式告诉 AI 未读到 |
| `SecretReader.js:94-96` | 缓存 secrets 表（listUnrevealed） | **返回空**（不转文件） | prep 信息差边界「（无）」/ review 信息差候选 `[]` | **有损** | 真源=定稿/设定/信息差/*.md；缓存坏→空数组且无文件 fallback，DTO 照常组装并宣称「（无）」 |
| `SecretReader.js:118-120` | readdir 信息差目录 | 跳过 | 返回 null→「不存在」透传 | 合理吞错 | 目录缺失=无信息差；非 ENOENT 同吞（边缘） |
| `ThreadLedgerReader.js:48-50` | 缓存 threads 表 | 转文件读 | readBasicInfo→commands/其他 | 良性 | 文件真源，A6 同形状承诺 |
| `ThreadLedgerReader.js:66-68` | 条目文件 | 向上抛 | — | 透传 | — |
| `ThreadLedgerReader.js:98-100` | 履历文件 | 向上抛 | review:219-220 `if (h.ok…)` 静默不加履历尾部 | 透传 | 消费侧静默（精度尾部缺失，低危，记此） |
| `ThreadLedgerReader.js:123-125` | 收尾计划文件 | 向上抛 | commands | 透传 | — |
| `ThreadLedgerReader.js:148-150` | 描述文件 | 向上抛 | commands | 透传 | — |
| `ThreadLedgerReader.js:187-189` | 缓存 threads（listOverdue） | **返回空**（不转文件） | assembleBookStatus→全书近况「悬了太久：无」→备料/审稿/序4/序6 DTO | **有损** | 缓存坏→`[]`，markdown 向 AI 宣称「无」；低置信（与 cache 全挂场景重叠，外层 book-status 通常先挂） |
| `ThreadLedgerReader.js:214-216` | 缓存 threads（listByType） | **返回空**（不转文件） | commands list-threads，不直达 DTO | **有损** | 同 §2-8 模式 |
| `ThreadLedgerReader.js:234-236` | readdir 条目目录 | 跳过 | 返回 null→「不存在」透传 | 合理吞错 | 目录缺失=无该类条目 |
| `TimelineReader.js:48-50` | 每卷时间线文件 | **跳过**（注释：文件不存在，跳过） | prep 时间线 md「（无）」、review 时间线片段、commands | 合理吞错 | 显式注释既定设计；非 ENOENT 读失败同样静默跳过（边缘——读失败的卷整卷消失，与真源不等价但未标 ENOENT） |
| `BookConfigReader.js:24-26` | book.yaml | 向上抛 | 消费侧静默默认化（见 §2 附记 A2） | 透传 | 自身不吞 |

### 1.2 prep/（5 站 + 1 锚点）

| 站点 | 读取目标 | 失败路径 | 流入 DTO | 分类 | 理由 |
|---|---|---|---|---|---|
| `prep/book-status.js:54-56` | assembleBookStatus 全部 5 条 cache.query + listOverdue | 向上抛（ok:false） | 见下——三个消费侧静默点 | **有损** | 全书近况组装失败被消费侧转空串/空数组继续，见 §2-5 |
| `prep/index.js:56-58` | 工作区/细纲.md | 返回默认 | 备料「本章要写到的事」=「（无细纲）」 | 合理吞错 | 显式注释「无细纲」+占位文本可见 |
| `prep/index.js:124-126` | 文风/文风铁律.md | 返回默认 | 备料「文风锚点」=「（无文风铁律）」 | 合理吞错 | 同上 |
| `prep/index.js:159-161` | 缓存 meta imagery_top | 返回默认 | 备料「反复读清单」占位 | 合理吞错 | 显式注释「按未体检处理」；已体检时占位措辞失真（边缘） |
| `prep/index.js:194-196` | 备料整体 | 向上抛 | — | 透传 | fail-closed |
| `prep/index.js:103-111`（锚点，非 catch） | 近章结尾 readTail | 返回空串拼接 | 备料「近章结尾」该章内容为空串 | **有损** | recent 来自缓存查询即章存在；readTail 失败无任何痕迹（`t.ok ? t.text : ''`），底层 catch=ChapterReader:106/155 |

### 1.3 review/（9 站）

| 站点 | 读取目标 | 失败路径 | 流入 DTO | 分类 | 理由 |
|---|---|---|---|---|---|
| `review/index.js:57-59` | resolveChapterDeclarations | 跳过 | ReviewInput.知识审查（空数组） | 合理吞错 | 显式注释「知识库不可用则略」；包内知识库真坏时审查切片丢失（边缘） |
| `review/index.js:92-94` | 工作区/细纲.md | 返回默认 | ReviewInput.本章要写到的事=「（无细纲）」 | 合理吞错 | 显式注释+占位可见 |
| `review/index.js:122-124` | 缓存 entities+aliases join | **返回空**（不转文件） | ReviewInput.名册=`[]` | **有损** | 真源=缓存表/角色卡/名册.md；缓存坏→空名册继续组装，AI 判新专名失真 |
| `review/index.js:139-160`（含 :145 `if (!cc.ok) continue`） | 角色目录扫描+逐卡读 | 返回空 / 单卡跳过 | ReviewInput.相关角色 | **有损** | 目录读失败→`[]`；单卡读失败→静默跳员（:145 无注释），AI 看不到在场角色——判新专名/状态失真；「无角色目录」注释只覆盖目录缺失语义 |
| `review/index.js:191-193` | 缓存 threads | **返回空**（不转文件） | ReviewInput.相关条目=`[]` | **有损** | 真源=threads 表/大纲条目；缓存坏→空清单继续组装；批内 overlay 只能补批内章 |
| `review/index.js:266-268` | 组装整体 | 向上抛 | — | 透传 | fail-closed |
| `review/input-binding.js:54-56` | 令牌计算 | 向上抛 | save-review 校验链 | 透传 | — |
| `review/input-binding.js:72-79` | 审稿输入.json | 向上抛 | save-review 校验链 | 透传 | 错误消息明确 |
| `review/outcome.js:43-48` | 审稿结果.json | 向上抛 | 定稿校验链 | 透传 | — |

### 1.4 state-machine（dto 5 + detectors 12 + flows 5 + index 2 附带）

| 站点 | 读取目标 | 失败路径 | 流入 DTO | 分类 | 理由 |
|---|---|---|---|---|---|
| `dto.js:151-153` | stagedFacts（批次） | 跳过 | 序6「章级知识候选」近期历史 | 合理吞错 | 显式注释「批次不可读按定稿历史继续，候选不阻断创作」既定设计；批内章历史真丢时降权信号失真（边缘） |
| `dto.js:173-175` | 卷纲（OutlineReader 外层保护） | 跳过 | 序6 语料 corpus | 合理吞错 | 显式注释「无卷纲」；reader 内部已透传，此 catch 实际兜底多余 |
| `dto.js:181-186` | 上一章结尾 readTail | 跳过 | 序6 语料 corpus | 合理吞错 | 显式注释「无上一章」（第 1 章语义）；读失败同样静默不入 corpus（边缘） |
| `dto.js:336-338` | stagedDraftPath fs.stat 草稿.md | 跳过 | 序3 DTO 批次章条目少了「草稿路径」键 | 合理吞错 | 草稿缺失=无指路；stat 真失败同吞（低危边缘） |
| `dto.js:351-353` | whatsMissing fs.access×3 | 记录 missing | 序1 DTO「缺」 | 合理吞错 | 存在性探测本身即目的，语义正确 |
| `detectors.js:45-47` | readdir 六源目录 | 跳过 | 序0 failures 清单 | 合理吞错 | 目录缺失=新书无条目=没有可报失败 |
| `detectors.js:62-64` | readdir 计划对象目录 | 跳过 | 同上 | 合理吞错 | 目录可选 |
| `detectors.js:82-84` | book.yaml access | 跳过 | 序1 判定 | 合理吞错 | 存在性探测 |
| `detectors.js:91-93` | 文风铁律读 | 跳过 | 序0 failures | 合理吞错 | 注释「文件可选，缺失跳过」 |
| `detectors.js:104-106` | 作品契约读 | **错误可见** | 序0 failures.push「作品契约文件不存在」 | 合理吞错 | 失败转为显式 failure 记录，不静默 |
| `detectors.js:107-109` | book.yaml access 外层 | 跳过 | — | 合理吞错 | 注释「建书态不要求契约先存在」 |
| `detectors.js:116-118` | 名册.md | 跳过 | 序0 failures | 合理吞错 | 注释「无名册」（可选） |
| `detectors.js:128-130` | 时间线目录 | 跳过 | 序0 failures | 合理吞错 | 注释「无时间线目录」 |
| `detectors.js:140-142` | bookMissing access | 语义返回 | 序1 路由 | 合理吞错 | 存在性探测 |
| `detectors.js:158-160` | git status（listManualEdits） | **返回空** | 序2 判定+序2 DTO「变更文件」 | **有损** | git 不可用→手改清单空→序2 整条跳过，未登记手改静默漏检（不等价）；缓释：checkGitHealth 的 guidance 会在同一路由结果报 git 损坏 → 低置信 |
| `detectors.js:177-179` | readdir 工作区 | 返回空 | 序3 现存/从哪继续 | 合理吞错 | 工作区缺失=无断点 |
| `detectors.js:218-220` | 卷摘要 access | 语义返回 | 序4 触发判定 | 合理吞错 | 存在性探测 |
| `flows/goto-chapter.js:82-84` | reset 失败 | 向上抛 | 不直达 DTO | 透传 | — |
| `flows/impact.js:49-51` | listMd readdir | 返回空 | analyzeImpact 输出（命令，非 DTO） | 合理吞错 | 目录缺=无命中 |
| `flows/impact.js:59-61` | walkMd readdir | 返回空 | 同上 | 合理吞错 | 同上 |
| `flows/retcon.js:47-59` | retcon 主流程 | 向上抛 | 不直达 DTO | 透传 | 外层 |
| `flows/retcon.js:56-58` | 回滚 restore | 跳过 | — | 合理吞错 | 内层「回滚尽力而为」，外层已上报失败 |
| `index.js:53-68`（附带） | 最新章 cache.query | **向上抛**（fail-closed） | cache-error 结果，无 DTO | 透传 | D7 决策：不裸抛也不降级成「第 1 章」——fail-closed 范本 |
| `index.js:124-126`（附带） | meta last_health_check | 返回默认 0 | 序5 触发判定 | 合理吞错 | :92 注释「记录存缓存 meta，丢失重测无害」既定设计 |

### 1.5 knowledge/（15 站）

| 站点 | 读取目标 | 失败路径 | 流入 DTO | 分类 | 理由 |
|---|---|---|---|---|---|
| `index.js:97-99` | 路由.csv | 返回空 | 序1 DTO 知识路由 | 合理吞错 | docstring「文件缺失返回空表」既定设计；包内文件损坏时无候选（边缘） |
| `index.js:204-206` | 路由条目文件 | 跳过 | 序1 建书知识材料 content:'' | 合理吞错 | 显式注释「路由可先于条目存在…内容按空降级」；AI 收到空内容知识条目（边缘） |
| `index.js:218-220` | 单条知识 readEntry | 返回空 | 序6 近期历史（叙事功能/实现方式=''） | 合理吞错 | docstring「失败返回 null」既定设计；消费侧静默空字符串（边缘） |
| `index.js:246-248` | readdir 维度目录 | 返回空 | 序6 章级知识候选该维度消失 | 合理吞错 | 目录缺=无该维度条目 |
| `chapter.js:161-163` | 快照 JSON.parse | 向上抛 | 归档校验 | 透传 | — |
| `chapter.js:248-250` | readdir 定稿/正文 | 跳过 | 序6 近期知识历史 | 合理吞错 | 显式注释「新书尚无定稿目录」 |
| `chapter.js:263-265` | 单章文件读/解析 | **跳过**（无注释） | 序6 近期知识历史静默少章 | **有损** | 章文件存在但读失败→该章知识历史消失→候选降权信号失真（低置信） |
| `chapter.js:330-332` | 归档 frontMatter 构造 | 向上抛 | 写侧 | 透传 | — |
| `chapter.js:341-343` | 清理 rm | **错误可见**（warnings.push） | 不直达 DTO | 透传 | 警告通道可见 |
| `chapter.js:356-358` | readOptionalWorkspaceFile | ENOENT→exists:false；非 ENOENT→ok:false | 归档校验 | 合理吞错 | err.code 显式区分——范本 |
| `chapter.js:368-370` | readdir 维度目录 | 返回空 | prep/序6 声明命中 | 合理吞错 | spec §7「查不到表注入声明文本本身」既定设计 |
| `contract-issues.js:60-62` | readdir 定稿/正文 | 返回空 | 序4 契约复盘「本卷没有实际记录…」/序6 复盘提示 | 合理吞错 | 目录缺=无历史；读失败时宣称「没有问题记录」（边缘） |
| `contract-issues.js:79-81` | 单章读 | 跳过 | 同上 | 合理吞错 | 显式注释「源文件格式错误由启动检测统一阻断」+序0 fail-closed 把关 |
| `fact-changes.js:146-148` | 既有事实读 | ENOENT→新建语义；非 ENOENT→errors.push 可见 | 写侧校验 | 合理吞错 | err.code 显式区分——范本 |
| `fact-changes.js:165-167` | planPath access | 语义返回 | 写侧校验 error 可见 | 合理吞错 | 失败转为显式 errors |

---

## §2 有损降级点全名单（S2 接入候选）

| # | 站点 | 失败路径 | 流入 DTO | 置信 |
|---|---|---|---|---|
| 1 | `v7/src/storage/adapters/SecretReader.js:94-96` | 缓存坏→return []（无文件 fallback） | 备料材料「信息差边界」、审稿输入「信息差候选」 | 高 |
| 2 | `v7/src/review/index.js:122-124` | 缓存坏→名册=[] | 审稿输入「名册」 | 高 |
| 3 | `v7/src/review/index.js:139-160`（含 :145 单卡 continue） | 目录失败→相关角色=[]；单卡失败→静默跳员 | 审稿输入「相关角色」 | 高 |
| 4 | `v7/src/review/index.js:191-193` | 缓存坏→相关条目=[] | 审稿输入「相关条目」 | 高 |
| 5 | `v7/src/prep/book-status.js:54-56` | 全书近况整体 ok:false，被静默消费于：`review/index.js:233`（`''`）、`review/index.js:107-108`（当前卷默认 1→时间线卷范围错）、`state-machine/dto.js:93-94`（序4 `''`/[]）、`dto.js:115/121/126`（序6 当前卷默认 1 + `''`） | 审稿输入「全书近况/时间线片段」、序4/序6 DTO | 高 |
| 6 | `v7/src/storage/adapters/ThreadLedgerReader.js:187-189` | 缓存坏→listOverdue=[]→markdown「悬了太久：无」 | 全书近况 markdown（备料/审稿/序4/序6） | 低（与 #5 场景重叠） |
| 7 | `v7/src/prep/index.js:103-111`（锚点；底层 catch `ChapterReader.js:106`/`:155`） | readTail 失败→`t.ok ? t.text : ''` 拼空串 | 备料材料「近章结尾」 | 高 |
| 8 | `v7/src/storage/adapters/EntityReader.js:120-122` | 缓存坏→listCharacters=[]（文件降级分支只在 cache=null 时可达） | 不直达 DTO（commands 层） | 中 |
| 9 | `v7/src/storage/adapters/ThreadLedgerReader.js:214-216` | 缓存坏→listByType=[] | 不直达 DTO（commands 层） | 中 |
| 10 | `v7/src/knowledge/chapter.js:263-265` | 单章读失败 continue（无注释） | 序6 DTO「近期知识历史」 | 低 |
| 11 | `v7/src/state-machine/detectors.js:158-160` | git 不可用→listManualEdits=[]→序2 静默放行 | 序2 DTO「变更文件」（漏检=序2 不触发） | 低 |

**附记（非 catch 站点，但同属静默缺料，S2 决策时一并过目）**：

- **A1**：`prep/book-status.js:13-14` `config.ok ? config.data : {}`——book.yaml 读失败→卷规模=40 等默认值进 全书近况 markdown 与 listOverdue 阈值（底层 catch=`BookConfigReader.js:24`；序0 对 book.yaml 解析失败已 fail-closed 前置，实际触发面窄）。
- **A2**：`dto.js:113` `!!(config.ok && config.data.自动确认细纲)`——config 读失败→序6 DTO「自动确认细纲」静默 =false。
- **A3**：`review/index.js:219-220` `if (h.ok && h.history.length)`——已声明条目履历读失败→静默不加「履历尾部」（底层透传=`ThreadLedgerReader.js:98`）。

## §3 良性降级点名单 + 处理建议

| # | 站点 | 机制 | 建议 |
|---|---|---|---|
| 1 | `ChapterReader.js:53-55` | 缓存 chapters 查询失败→读章节文件（A6 形状一致承诺） | 记诊断（不进 `degraded`，R5）；site 名建议 `ChapterReader.readFrontMatter cache→file` |
| 2 | `EntityReader.js:74-76` | 缓存 entity_aliases 失败→读名册.md | 记诊断；file fallback 也有失败路径（:97 透传），不直挂 DTO，低优先 |
| 3 | `ThreadLedgerReader.js:48-50` | 缓存 threads 失败→读条目文件（A6 同形状） | 记诊断 |

说明：TimelineReader 无缓存路径（文件即真源），不存在缓存→文件的良性形态；`:48` 已归合理吞错。

## §4 范围外 catch 统计（一行计数）

| 区域 | 站数 | 一句摘录 |
|---|---|---|
| staging/（index 33 + contract-invalidation 11） | 44 | 批次/锁内部读写；其 catch 多为 ok:false 透传或 warnings 可见，DTO 侧只经 stagedFacts 整体成败（prep/review 无 try 包裹=stagedFacts 抛则整体 fail-closed） |
| storage/adapters Writers（6 个 Writer） | 15 | 写侧错误透传+原子写回滚 |
| state-machine/persist.js | 10 | 落盘/写侧，全部 fail-closed 或回滚可见（R4 对称只涉及「期望产物」文案，不涉及其 catch） |
| state-machine/git-health.js | 6 | 全部转为中文 guidance/fixed 可见文案或注释兜底，结果随路由 DTO 同行 |
| finalize/（git.js 16 + index.js 7） | 23 | git 重试与定稿回滚 |
| cache/（index 10 + rebuilder 8） | 18 | 缓存内部重建逻辑 |
| migrate/ | 16 | v6 迁移 |
| commands/ | 12 | 命令层兜底 |
| installer/ | 10 | 安装器 |
| mechanical-check/ | 8 | 机检（不进 DTO） |
| health-check/ | 8 | 体检；结果不进 DTO 组装链（仅 meta 记录被 prep 反复读清单消费，已列入 §1.2） |
| host-shells/ | 5 | 宿主壳校验 |
| retry-policy/ | 2 | 自身 fail-closed |
| 其他（storage/atomic 4、session 7、storage/parsers/yaml-safe 1、util/json-input 2、export 1、runtime 1） | 16 | 原子写/会话/解析器/导出/定位 |
| **合计** | **193** | 均不在备料材料/审稿输入/序0-6 DTO 的组装链上 |

## §5 设计验证问题

### Q1：ctx 到 adapter 的可达性

**结论：design.md「ctx 已贯穿命令→组装→adapter 全链，零签名改动」的假设不成立。所有 Reader 收的是 `(repoPath, cache)` 解构件，没有任何 Reader 收完整 ctx**——`ctx.degradation` 挂上收集器后，Reader 实例没有自然路径拿到它。

实际构造函数签名：

- `ChapterReader` — `constructor(repoPath, cache = null)`（`storage/adapters/ChapterReader.js:32`）
- `SecretReader` — `constructor(repoPath, cache = null)`（`SecretReader.js:18`；EntityReader.js:12、ThreadLedgerReader.js:27、OutlineReader.js:8、TimelineReader.js:9 同款）
- `ContractReader` — `constructor(repoPath)`（`ContractReader.js:12`；DesignReader.js:12、BookConfigReader.js:9 只收 repoPath）

调用侧（手里都有 ctx，只是没传下去）：

- `prep/index.js:40-41`：`const { repoPath, cache } = ctx` → `new ContractReader(repoPath)`；:61 `new TimelineReader(repoPath, cache)`；:75 `new SecretReader(repoPath, cache)`；:107 `new ChapterReader(repoPath, cache)`；:214 `new DesignReader(repoPath)`
- `review/index.js:72-73`：同款解构 → `new ContractReader(repoPath)`；:99 `new DesignReader(repoPath)`；:162 `new TimelineReader(repoPath, cache)`；:168 `new SecretReader(repoPath, cache)`；:216 `new ThreadLedgerReader(repoPath, cache)`
- `prep/book-status.js:12-13,39`：`new BookConfigReader(repoPath)`、`new ThreadLedgerReader(repoPath, cache)`
- `dto/character-context.js:11`：`new EntityReader(ctx.repoPath, ctx.cache)`（此函数收完整 ctx）
- `state-machine/dto.js:79/103`：`new ContractReader(ctx.repoPath)`；:182 `new ChapterReader(ctx.repoPath, ctx.cache)`

含义：S2 想接 §2 的有损点（尤其 4 个 Reader 内站点 `SecretReader.js:94`、`ThreadLedgerReader.js:187/214`、`EntityReader.js:120`），**必须让 adapter 获得收集器**——改构造函数（第三参）或构造后属性注入（`reader.degradation = ctx.degradation`）二选一；调用点改造成本都在组装层（prep/review/dto/book-status/character-context），ctx 在那些点都现成。纯组装层站点（review:122/158/191、book-status:54、prep 锚点）不依赖此问题，可直接 `ctx.degradation?.report(...)`。

### Q2：DTO 组装收口函数与 drain 位置

| 链路 | 收口函数 | 位置 | drain 落点 |
|---|---|---|---|
| 备料（本章写作材料.md） | `prepareChapterMaterialsLocked`（内部；导出入口 `prepareChapterMaterials` 只是契约锁包装） | `v7/src/prep/index.js:38`（入口 :28） | `:193` `return { ok: true, filePath, content, error: '' }` 之前（content 在 :186 成型、:191 落盘；degraded 若要进材料文本须在 :186 前注入 parts，若只做返回值字段则在 :193 的返回对象上） |
| 审稿输入（审稿输入.json） | `assembleReviewInput` | `v7/src/review/index.js:70` | **必须在 `:228` `bindReviewInput({...})` 之前**把 `degraded` 塞进输入对象——bindReviewInput 对除令牌外全字段算 sha256（`input-binding.js:12-22`），drain 若放 bind 后，令牌不覆盖 degraded 且 sidecar 重算校验（`input-binding.js:81-108`）会与已发输入不一致 |
| 序 0-6 DTO | `buildDto` | `v7/src/state-machine/dto.js:35` | 各 case return 的 DTO 对象（序4 `:90`、序6 `:123`、序3 `:71-77` 等）——case 内 drain + 统一在出口 `mk(...)` 处补一次兜底 |

对称侧注意（R4）：写作材料/审稿输入的「期望产物」说明在 `dto.js` 各 case 的 `期望产物` 字段（序4 :99、序6 :131-136），persist.js 本身无期望产物文案、其 catch 全 fail-closed（§4），R4 同步点是 dto.js 文案而非 persist.js 代码。

## Caveats / Not Found

- **无 SummaryReader**：`storage/adapters/` 只有 SummaryWriter；卷摘要读取仅 `detectors.js:216` fs.access。任务书「SummaryReader 等」按虚指处理。
- **stagedFacts  caveat**：prep:46/review:77 调用 `stagedFacts` 无 try 包裹——stagedFacts 抛异常会由外层 catch 兜成整体 fail-closed，非静默；dto.js:151 处有意吞（既定设计注释）。staging 内部 44 个 catch 未逐处展开（不属六大范围，但其经由 facts 影响 DTO 内容，S2 若发现批内数据缺料应回溯此处）。
- **多处「合理吞错」站点不区分 err.code**：TimelineReader:48、ChapterReader:155、SecretReader:118、ThreadLedgerReader:234、detectors 各 readdir 等把 EACCES/EMFILE 等真错误一并按「没有」处理；按三分类口径归「合理吞错」（缺失语义为主），但它们在真错误下会产出与真源不等价的结果，表中已用「（边缘）」逐处标注——S2 若要给合理吞错点加 err.code 过滤，此名单可直接复用。
- **review/index.js:145 的 `if (!cc.ok) continue`** 是无注释静默丢弃角色卡读取失败——本次普查中唯一「目录内文件确定存在、读失败仍静默」且无既定设计注释的组装层站点，归入有损 #3。
