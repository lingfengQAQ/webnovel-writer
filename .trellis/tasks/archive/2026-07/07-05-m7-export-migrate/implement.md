# M7 实施清单

执行方式：inline（M1-M6 先例），三期每期一 commit，期末验证绿才进下期。上下文顺序：prd → design → research/v6-data-inventory.md → 本清单；Phase 2 起步走 trellis-before-dev。

## P1 干净导出

- [x] P1.1 `v7/src/export/index.js`：exportChapters(ctx, {mode, chapterNum?, range?}) 纯函数层（design §2：单章无标题行、合并文件「第N章 标题」分隔、边界人话报错）
- [x] P1.2 `v7/src/commands/export.js` 薄壳（scope: book）+ bin --help 补行
- [x] P1.3 测试 `v7/test/export/index.test.js` + `v7/test/commands/export.test.js`：
  - 单章：去 front matter 逐字节断言、文件名 `第NNNN章-标题.txt`、正文体无标题行
  - 范围/全书：标题行与章间距格式、书名文件名、覆盖旧导出
  - 边界：缺章列清单报错、a>b 报错、空定稿区人话
  - 落点 `工作区/导出/`（gitignore 生效 = git status 干净断言）

验证：`node --test v7/test/export/ v7/test/commands/export.test.js`（列文件跑）
提交：`feat(v7): M7 P1——干净导出（单章/范围/全书）`

## P2 migrate 读取与映射（纯函数面，零落盘）

- [x] P2.1 `v7/src/migrate/read-v6.js`：双形态探测 + state.json 键名/别名归一（Q13-3/4/5/6）+ index.db 只读容错读（逐表 try，Q13-10）+ 正文三命名归一（Q13-1）+ summaries/大纲/设定集/两记忆文件读取；空损坏 state.json 降级（Q13-9）
- [x] P2.2 `v7/src/migrate/transform.js`：design §3.2 映射表逐行实现（front matter 组装用防呆序列化器；伏笔状态/强度映射；名册/时间线表生成；待校对三文件；genre 小码表）+ 报告数据结构
- [x] P2.3 fixture：`v7/test/fixtures/v6-inline/`（全量内联形态：三种正文命名混用、chapter_meta 双键格式、伏笔别名 status、project 键名）+ `v7/test/fixtures/v6-sqlite/`（精简 state + 测试内现场建 index.db，DDL 摘 research Q3：entities/aliases/state_changes/relationships/chapter_reading_power）——坑：根 .gitignore `.webnovel/` 会吞 fixture，已加否定规则（目录先重包含）
- [x] P2.4 测试 `v7/test/migrate/read-v6.test.js` + `transform.test.js`：两形态读出的 V6Facts 等价；映射表每行至少一断言（AC2/AC3 的纯函数半）；缺表/缺文件/损坏 state 容错各一例

验证：`node --test v7/test/migrate/`（列文件）
提交：`feat(v7): M7 P2——v6 双形态归一读取与映射纯函数`

## P3 migrate 物化 + 命令 + 指引收口

- [x] P3.1 `v7/src/migrate/index.js`：临时目录物化 → git init + 初始 commit → 缓存重建 → 同盘 rename → books.jsonl 登记 → 迁移报告落工作区（design §3.3/§3.4）；启动清扫 `.migrate-tmp-` 残留
- [x] P3.2 `v7/src/commands/migrate.js`（scope: workdir，`--dir` 可选）+ bin --help；SKILL.md 例外流程加 export/migrate 两行 + 壳重渲染 + drift 绿
- [x] P3.3 `v7/docs/migration-guide.md` 迁移指引（卸载市场版 → npx init → migrate → 校对清单；命令名/参数与实现一致，AC7）
- [x] P3.4 测试 `v7/test/migrate/e2e.test.js`：
  - AC2 端到端两形态：migrate → 仓库结构合规 → `next` 判定进正常流程 → 删缓存重建一致
  - AC3 不丢字：fixture 每段 v6 文本在 v7 产物/待校对区 grep 到（逐映射行抽样）
  - AC4 回退：注入落盘中途失败 → 工作目录零残留 + 源 v6 目录 mtime/内容未动
  - AC5 报告三节断言；目标目录已存在拒绝；books.jsonl 登记断言
- [x] P3.5 全量 `node --test`（Windows 本机）429 绿 + AC1-AC7 复核、prd.md 打勾（AC6 CI 部分待 push）
- [x] P3.6 spec 回填（Phase 3.3）：story-repo-spec 0.13（§4.7 导出实现口径；§12 迁移实现注记——双形态/待校对前缀/整体回退/如实丢弃；决策 38）；实施计划 §M7 出口达成标注（代码面达成即进入 beta）；backend error-handling §3.6 目录级原子边界
- [x] P3.7 commit + push（5ba85a5/8615d91/e14545a/557bd42），CI 双平台绿（run 28736268905 六 job）；prd.md AC6 已回填 run 号

提交：`feat(v7): M7 P3——migrate 物化/命令/指引` + `docs(v7): M7 spec 回填`

## 风险与回滚点

- migrate 是新增独立模块，不碰主循环热路径；export 只读定稿——两者对既有 407 测试零影响（回归面=全量绿）
- Windows 中文路径 + v6 fixture 文件名（第NNNN章-标题.md）在 CI windows job 全覆盖；fixture 内建 db 避免二进制入库
- 临时目录若因进程中断遗留：目录名带 `.migrate-tmp-` 前缀，migrate 启动时清扫同前缀残留（幂等）
- 每期独立 commit 可 revert；migrate 失败路径不触碰既有书目录与 books.jsonl
