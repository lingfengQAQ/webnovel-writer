# M1-M7 全量 review 汇总报告（第三轮通审）

- 日期：2026-07-05；方式：7 只读子代理分区精读（报告见 research/review-{A..G}.md）→ 主会话真实路径探针裁决（probe-m1-m7.mjs / probe-followup.mjs，全走 persistCreateBook 真建书，不用测试脚手架）
- 候选总量 ~60；**探针裁决 CONFIRMED P1 × 11、PLAUSIBLE P1 × 1、P2 × 18、S × 10、REFUTED × 4**
- 一句话结论：**主循环与 M6/M7 主路径是通的（前两轮的病没复发），但三类结构性缺口成立——防呆序列化器不防、批次与手动流程互不知情、迁移书的实体在缓存里隐身**。修复面收敛在 6 个文件左右。

## 定性（对照前两轮）

- M1-M4 轮病根「测试脚手架掩盖主循环」、M1-M5 轮病根「流程间接力没人测」——本轮复查：**历轮修复全部在位**（见 §历轮在位）。
- 本轮新病根：**互斥不变量只写在 spec 没写进代码**（goto/手动 finalize 对批次零感知）；**"防呆"序列化器有系统性漏网**（写出的 front matter 自己读不回）；**fixture 恰好用了英文类型值，掩盖迁移链路的中英文断裂**（G-1/G-2，又一例脚手架掩盖）。

---

## P0（主循环断/丢数据，需立即修）

无。

## P1 CONFIRMED（探针复现，建议第一批修）

| # | 问题 | 位置 | 探针证据 | 源报告 |
|---|------|------|----------|--------|
| R1 | **goto 回退×进行中批次 → 孤儿批次 + 定稿章号静默断档**：定稿 1-3、stage 4、goto 2 后 finalizeBatch 照跑，定稿变 [1,2,4] 缺 3；条目履历跨缺口 | flows/goto-chapter.js（零批次感知）+ staging/index.js finalizeBatch（无连续性校验） | P-1：`定稿=[1,2,4]` | E1/D2 |
| R2 | **手动 finalize 已暂存章 → 叠加双计 + finalize-batch 卡死**：手动定稿 staged 章成功，overlay 总章数双计；finalizeBatch 撞 createThread「已存在」整批卡住 | commands/finalize.js（无批次守卫） | P-2：`finalizeBatch.ok=false 条目 伏笔-201 已存在` | E2 |
| R3 | **persistRepair 一刀切 front matter 校验 → book.yaml/名册/时间线坏了锁死在序 0**：合法修复内容被「缺少 front matter 分隔符」拒绝，工具内无法自愈 | state-machine/persist.js:123 | P-3：合法 book.yaml 修复被拒 | D1 |
| R4 | **finalize 清工作区遇目录 → 已 commit 却报失败**，文案谎称「已回滚、工作区原样保留」（commit 在 git log 里），且英文机器味泄漏；宿主重试会二次定稿 | finalize/index.js:142-144（fs.rm 无 recursive 无 try） | P-7b：`ok=false 但 ch(1) commit 在` | C1（探针后升 P1） |
| R5 | **迁移书角色全不可见**：migrate 名册写中文「角色」，全链按英文 `'character'` 过滤（list-characters/审稿名册/近况/report） | migrate/transform.js vs rebuilder/各查询 | P-5：`entities.type=[角色,地点]，list-characters 不含江遥` | G2 |
| R6 | **别名分隔三源分裂**：名册用全角逗号/顿号分隔的别名 resolveAlias 全 MISS（EntityReader/rebuilder 只切 ASCII `,`，staging 切 `[,，、]`） | EntityReader.js:87、rebuilder.js:262、staging/index.js:220 | P-6：三别名全 MISS | A5 |
| R7 | **防呆序列化器漏引**：空串→null、前后空格被裁、`0x1F/1e3/+5/~` 变数字/null；`[ * & " -空格` 起首值整份 front matter 解析炸 → 该章/卡静默不入缓存 | serializers/yaml-dialect.js:79-121 | A/F 双区独立复现（DRIFT/PARSEFAIL 表） | A1+F-2 |
| R8 | **双引号分支不转义反斜杠**：值含 `\`+触发引号（Windows 路径）→ 解析失败整文件读不回 | serializers/yaml-dialect.js:65-71 | A 区复现 PARSEFAIL | A2 |
| R9 | **book.yaml 手写拼接绕开序列化器**：书名 `[快穿]反派`/`*追读`/纯数字 → 解析失败/类型漂移 → 书内设置回落默认、books.jsonl 扫描重建时该书从书单消失 | migrate/transform.js:41-48 | F 区 A 组探针表 | F-1 |
| R10 | **v6 一对多别名 → 迁移整体硬回滚无绕过**：含歧义别名的合法 v6 项目迁不进来（名册重复别名 → rebuild 判冲突 → ROLLBACK → throw） | migrate/read-v6.js + transform.js | F 区 B 组探针 | F-3 |
| R11 | **表格序列化不转义 `\|`**：别名「刀疤\|老王」读回只剩「刀疤」，静默丢数据 | serializers/markdown-table.js:10 | A 区复现 | A4 |

## P1 PLAUSIBLE（逻辑确凿、需故障注入才能复现）

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| R12 | **atomic 出错回滚删掉未备份原文**：writeFile(tmp)/rename(full→backup) 先失败时 `existed=false`，restorePlan 误删从未动过的原文（Windows 长路径/文件占用触发） | storage/atomic.js:27-66 | 覆盖写场景（细纲/大纲）丢原文；建议修复时附故障注入回归测试 | A3 |

## P2（18 条，第二批修/顺手修）

- **Reader 键名冷热漂移**（A6，行为确凿）：ChapterReader/ThreadLedgerReader 命中缓存返英文列名、降级返中文键——read-chapter/read-thread 输出形状随缓存冷热变，机器味进作者域。
- **rebuild 静默无 warning**（B1 降级 + B-P2）：坏 front matter 章/条目从缓存消失零信号（探针证 warnings 恒空）。注：完整「重抄本章」链被序 0（坏 YAML）与序 2（重号手改）兜住——B1 主链 REFUTED。
- **名册缺「别名」列 → undefined.split 抛错 → 整次重建 ROLLBACK**（A13/A 接缝，违 §5.2 软失败）。
- **scanThreads 吞 UNIQUE + 卷复盘写条目绕过 createThread 重号校验**（B2）。
- **全角管道 `｜` 表格整表解析失败静默变空**（A7）；**GFM `\|` 不识别、多余列静默截断**（A8）；**upsert 整行替换丢作者额外列**（A11）。
- **_findThreadFile/SecretReader 无界前缀命中**（A9/C3）：查不存在的 `伏笔-1` 命中 `伏笔-10-*.md`。
- **角色卡文件名净化不同源**（A10/F-7）：migrate 净化、EntityWriter/Reader 不净化 → 找不到卡/实体分裂。
- **TimelineWriter.appendRow 不按章去重**（A12）：重定稿同章时间线叠行。
- **finalizeBatch 循环无 try-catch**（E3）：转正后 rm/meta 失败裸栈 + 批次.json 失步 → 重跑撞「已存在」。
- **stageChapter 覆盖重暂存清理失败报假失败**（E4）；**--until 后建议误导「继续写下一章」**（E5）；**批次.json 损坏重建把打回空目录变死「受影响」行**（E6）。
- **finalize 工作区清理不挡 `..`**（C2/G-4，与 stage-chapter 守卫不一致）。
- **迁移短题 slice(0,9) 截代理对**（F-4）；**sweepStaleTmp 误删并行 migrate 的 tmp**（F-5）；**openReadOnly 回退可写打开违反源只读**（F-6）；**err.message 英文泄漏作者面**（F-8/B 区 ensureReady）。
- **gitBookCtx 仓库形态失真**（G-1：无 .gitignore、工作区被跟踪——goto×批次类交叉在既有测试里无法如实验证）；**M6/M7 新命令零 bin spawn 覆盖**（G-6）。
- **陈旧 imagery_top 跨重建保留**（B）：改源刷缓存后到下次体检前，备料/机检吃旧高频意象（提醒性）。

## S（10 条，spec 漂移/卫生）

内层 catch 架空重建事务意图（B-S，结构性）；批次.json 持久形态与 §8.1 声明字段漂移（E7）；弱钩谓词四处双写（E8）；停止判据 front matter vs payload 可分叉（E9，契约提示）；extractUnknownFields 死代码（A14）；readRange 死代码+契约错位（A15）；book-config 死校验（A16）；appendUnderSection 子串匹配偏脆（A17）；migration-guide 不发布不 vendored 用户不可达（G-5）；--help「41 个」硬编码计数（G-8）；名册「类型」列取值无约定（G-3，R5 的规范面）。

## REFUTED（探针驳回，记录防复审）

1. B1 主链「静默截断→next 重抄本章」：坏 YAML 被序 0 拦、重号文件被序 2 手改检测拦（P-4/P-4b），只余「无 warning」卫生问题。
2. C1 初版路径（workspaceFiles 带「工作区/」前缀）：join 后指向不存在路径被 force 吞，无害——真实缺陷在正确路径的目录输入（已升 R4）。
3. export 2000 章内存、goto 后范围有洞、单章 double-sanitize（F 区核对，非问题）。
4. staged 并入机检 known 把提醒变阻断（C 区核对：反而抑制假阻断）。

## 历轮修复在位复查（AC4，全数通过）

- M1-M4 P0/P1：定稿后刷缓存（finalize:139）、重建单事务+别名冲突 ROLLBACK、临时库替换、回滚收窄到 written、schema 严格布尔/critical 阻断——在位 ✓
- M1-M5 三条 P1：卷复盘 `vol(NN)` commit（persist.js:104）、六处改源自刷缓存（finalize/goto/retcon/卷复盘/修复回写/relink，主会话独立 grep 与 D 区双验证）、relink 执行通道——在位 ✓（覆盖面缺口见 P2「文风/book.yaml 不在 relink 范围」→ 记 D 区候选 3）
- M5.5 确定性、M6 staged 不入缓存/指纹（AC7）、M6 before 防倒灌/容差同源/收卷接序 4——在位 ✓

## CLEAN 面（七区核销汇总）

薄壳契约全合规、bin cache.close 全分支、SQL 全参数化、六改源全刷缓存、体检只吃定稿、无批次零行为变化、finalize-batch 入口硬校验/升序原子/中途保留、export/migrate 接力面表头逐一对得上、drift 确定性、migration-guide 与实现一致。

## 修复 backlog 建议（供裁决，非本任务范围）

- **第一批（互斥守卫 + 序列化器，R1-R4/R7/R8/R12）**：goto/手动 finalize 加 active 批次拦截（人话指引先 finalize-batch 或 batch-discard）；persistRepair 按文件类型分派校验器（book.yaml→parseBookConfig、名册/时间线→parseMarkdownTable）；finalize 清理 `rm(recursive:true)` + 包 try 只记 warning（commit 后的清理失败不得改写 ok）；yaml-dialect needsQuoting 补指示符/空串/空格/数字变体 + 转义反斜杠；atomic existed 时序修正。
- **第二批（迁移链，R5/R6/R9/R10/R11）**：类型值统一（建议迁移写英文 machine 值或全链改中文——需定规范 G-3）；别名分隔抽单一 splitAliases；book.yaml 走 serializeYAML；一对多别名降级为「主实体保留+其余进待校对」；表格单元格转义。
- **第三批**：P2 清单按模块顺手修 + gitBookCtx 对齐真实建书 + 新命令补 bin spawn 用例。
- spec 侧：G-3 名册类型值约定、E7 批次.json 字段口径、B-S 事务边界条款化。
