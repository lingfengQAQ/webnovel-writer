# M1-M4 全量 Review 报告（2026-06-27）

> 用户要求:M4 完成后对 M1-M4 通审,重点「不把 v6 问题带入 v7」。
> 方法:全树 grep（v6 遗毒/契约违规/空壳）+ 高风险枢纽精读（编排/数据完整性/git安全/缓存/启发式）+ 全量 246 测试 + CI 双平台。范围 73 源文件 / 4848 行。

## 结论速览

**代码健康、v6 清洁、架构自洽、246 绿。** 一个结构性缺口（写章后半段无 CLI 缝）与真模型 smoke 一同被推迟,应显式跟踪。

## 一、v6 清洁度（用户头号关切）—— PASS

- `src/`+`bin/`+`skills/`+`roles/`+`adapters/`+`templates/`:grep `state.json|webnovel.py|python|设定集|dashboard|doctor|棘轮|story-system` **零命中**。
- `references/` 迁移树（42 文件）:`migration.test` 逐文件 grep 门禁零 v6 遗毒;题材**单一真源**（genre-index.csv，无 markdown 双表）;37 模板创意约束/Pack 段全剥（残留 0）;CSV 删 适用技能/推荐检索表 列;系统流.md 的 `/webnovel-write` 已改。
- 两审角色是**重构非拷贝**:v6 reviewer.md 直调 `python webnovel.py`+读文件 → v7 roles 只吃 ReviewInput DTO，零脚本/路径。

## 二、架构自洽（实施计划 §1.5）—— SOUND

- AI 只吃 DTO:CharacterContext/ReviewInput 测试断言零路径泄漏;两审用 DI 注入把 AI 隔在确定性层外。
- 状态机只路由:determineNextState 序0-6 命中即停,不判业务、不调 AI（AI 态返回 needsAI+DTO）。
- 命令契约:`src/` 零 `console.log`/`process.exit`（bin 唯一副作用点）。无 M1 式空壳谎报。
- 小端口 + schema 单源:category/severity/范例由 schema.js 单源注入角色，角色与校验器不双表。

## 三、数据完整性 —— SOUND

- 定稿原子（finalizeChapter）:写工作树→故障点→add→commit→**最后**清工作区;catch 回滚用 `restore --staged --worktree` + `clean`，仅 定稿/大纲、不碰工作区。断电注入测试覆盖。
- git 隐身（checkGitHealth）:激进自动修 + 改 git 前先备份（stash/备份 ref/归档不删），作者永不见英文报错。
- 缓存重建（不变量2）:DELETE 五表→扫描→INSERT;scanCharacters upsert（M1 修复在）、别名唯一性、履历章存在性校验。
- 序0 修复落盘安全网:只写失败清单内文件 + 修复内容须能解析。

## 四、发现

### F1（中·结构性）写章后半段缺宿主可调 CLI 缝 —— 与 smoke 一同推迟
有 CLI:prepare-chapter / mechanical-check / next / impact / goto-chapter。
**无 CLI（仅测试调用）**:`runReviews`（两审）、`finalizeChapter`（定稿）、`persist*`（AI 态落盘）。
宿主只能跑 `webnovel-writer <命令>`,故目前可驱动 备料→机检,但**两审→定稿 + AI 态落盘需先补 CLI 缝**才能端到端。这正是被推迟的真模型 smoke 要驱动的部分——**与 smoke 同步推迟**,非缺陷,但须显式跟踪（本条即跟踪）。
- 建议:wiring 时设计 `review-input/review-submit`、`finalize`、`persist-*` 命令（复杂 payload 走 `--product=<json路径>`）。与 smoke/M5 host 接线一并做。

### F2（低·权衡）陈旧锁阈值 3s
`git-health` 删 `.git/index.lock` 阈值 3000ms 偏激进。单会话串行模型下 check 时锁必为崩溃残留,3s 反而利于崩溃恢复 UX;并发风险≈0。判定:**可接受**,保留。

### F3（信息）诚实占位
`ChapterWriter.updateFrontMatter()`（throw 暂未实现）、`installer/index.js`（M5 占位）均**无人依赖**（grep 确认零调用/零 import）,非 M1 式谎报,留作未来。

## 五、测试

246 绿、CI 双平台（run 28292073367，drift+validator 含 Windows）。skipped 0 / todo 0。

## 推荐下一步

1. （可选）补写章后半段 CLI 缝（F1）——使两审/定稿/落盘宿主可驱动,为真模型 smoke 铺路。
2. 否则进 M5 安装器（npx init/update + books.jsonl 写侧 + SessionStart hook 接线 + F1 的 CLI 缝一并做）。
