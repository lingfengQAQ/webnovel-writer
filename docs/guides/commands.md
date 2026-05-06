# 命令详解

## Skill 命令（在 Claude Code 中使用）

### `/webnovel-init`

初始化小说项目，生成目录结构、设定模板和状态文件。

产出：

- `.webnovel/state.json`（运行时状态）
- `设定集/`（世界观、力量体系、主角卡、金手指设计、反派设计等）
- `大纲/总纲.md`、`大纲/爽点规划.md`
- `.env.example`（RAG 配置模板）

### `/webnovel-plan [卷号]`

生成卷级规划与章节大纲。

```bash
/webnovel-plan 1
/webnovel-plan 2-3
```

### `/webnovel-write [章号]`

执行完整章节创作流程（`context-agent` 先 research 并生成写作任务书 → 按任务书起草正文 → 审查 → 润色 → 数据落盘）。

```bash
/webnovel-write 1
/webnovel-write 45
```

### `/webnovel-review [范围]`

对已有章节做多维质量审查。

```bash
/webnovel-review 1-5
/webnovel-review 45
```

### `/webnovel-delete [范围]`

删除指定章节，并同步清理正文、commit、事件、摘要、索引、向量、长期记忆、角色图鉴和关系图谱等派生数据。

```bash
/webnovel-delete 3
/webnovel-delete 1,3,5-7
```

### `/webnovel-rewrite [范围]`

重写指定章节：先执行旧数据清理，再按 `/webnovel-write` 主链逐章重新创作。

```bash
/webnovel-rewrite 12
/webnovel-rewrite 12-15
```

### `/webnovel-query [关键词]`

查询角色、伏笔、节奏、状态等运行时信息。

```bash
/webnovel-query 萧炎
/webnovel-query 伏笔
```

### `/webnovel-learn [内容]`

从当前会话或用户输入中提取可复用写作模式，写入项目记忆。

```bash
/webnovel-learn "本章的危机钩设计很有效，悬念拉满"
```

产出：`.webnovel/project_memory.json`

### `/webnovel-dashboard`

启动只读可视化面板，查看项目状态、实体关系、章节与大纲内容。

```bash
/webnovel-dashboard
```

说明：

- 默认只读，不会修改项目文件
- 前端构建产物已随插件发布，无需本地 `npm build`

## 统一 CLI（命令行使用）

所有 CLI 命令的入口都是 `webnovel.py`，格式：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" <子命令> [参数]
```

## Story System 主链

推荐按以下顺序执行：

1. 生成合同

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" story-system "玄幻退婚流" --chapter 12 --persist --emit-runtime-contracts --format both
```

2. 提交章节

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" chapter-commit \
  --chapter 12 \
  --review-result ".webnovel/tmp/review_results.json" \
  --fulfillment-result ".webnovel/tmp/fulfillment_result.json" \
  --disambiguation-result ".webnovel/tmp/disambiguation_result.json" \
  --extraction-result ".webnovel/tmp/extraction_result.json"
```

3. 检查主链健康

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" preflight --format json
```

其中 `.story-system/` 是主链真源，`.webnovel/*` 是投影/read-model。

### 常用工具子命令

| 子命令 | 说明 |
|--------|------|
| `where` | 打印当前解析出的项目根目录 |
| `preflight` | 校验 CLI 环境、脚本路径和项目根是否可用 |
| `use <路径>` | 绑定当前工作区使用的书项目 |

### 数据模块子命令

| 子命令 | 说明 |
|--------|------|
| `index` | 索引管理（`process-chapter`、`stats` 等） |
| `state` | 状态管理 |
| `rag` | RAG 向量索引（`index-chapter`、`stats` 等） |
| `entity` | 实体链接 |
| `context` | 上下文管理 |
| `style` | 风格采样 |
| `migrate` | state.json → SQLite 迁移 |

### 运维子命令

| 子命令 | 说明 |
|--------|------|
| `status` | 健康报告（`--focus all` / `--focus urgency`） |
| `update-state` | 手动更新状态 |
| `backup` | 备份管理 |
| `archive` | 归档管理 |
| `extract-context` | 提取章节上下文（`--chapter N --format json`） |
| `delete-chapters` | 重写前清理旧章节并重建 read-model（`--chapters 1,3,5-7 --mode rewrite`） |
| `delete` | 精确删除章节及其相关数据（`1,3,5-7 --dry-run/--yes`） |
| `orchestrate` | 批量自动编排（`write/heal/nightly`），按章节范围自动执行检查与修复 |

`orchestrate` 示例：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate write --chapters 1-20 --auto-vector-heal
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate heal --chapters 1-200 --fail-fast
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate nightly --chapters 50-80 --json-report-out ".webnovel/reports/nightly.json"
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate autofix --bad-chapters 15,91,92,94 --auto-vector-heal --entity-clean --sync-outline-volumes 2,3 --json-report-out ".webnovel/reports/autofix.json"
```

### 100 章后偏纲的完整修复链（推荐顺序）

当你已经写到 100 章并发现“正文偏离大纲”，建议按下列顺序执行，保证大纲/向量/关系链/实体/事件都被重建与校验：

```bash
# 0) 环境与主链预检
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" preflight --format json

# 1) 批量修复链（审查 + commit + projection + 向量补偿）
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate heal --chapters 1-100 --auto-vector-heal --json-report-out ".webnovel/reports/heal-1-100.json"

# 2) 事件链健康（伏笔追踪/关系链基础）
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" story-events --health

# 3) 实体脏数据扫描并标记（拼音/英文 snake_case）
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" entity-clean --mark-invalid --format json --chapter 100

# 4) 关键观测（实体、关系、审查趋势）
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" index get-core-entities
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" index get-relationship-graph --format json
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" index get-review-trend-stats --last-n 20
```

说明：
- `orchestrate heal` 负责批量修复执行链。
- `story-events --health` 用于检查事件链断裂与健康状态。
- `entity-clean` 会抓出类似 `old_book_knock_mark` 这类脏实体并写入 `invalid_facts` 待处理。

### Claude Code 插件方式：检查与修复（无需手动找命令）

在 Claude Code 里建议按以下节奏执行：

```bash
/webnovel-review 1-100
```

先出总审查报告，定位偏纲、设定冲突、时间线冲突。

```bash
/webnovel-write 91
/webnovel-write 92
/webnovel-write 93
...
/webnovel-write 100
```

对问题章节逐章重跑完整链路（包含审查与提交流程），每批修复完成后再复查：

```bash
/webnovel-review 91-100
```

如需检查运行时数据一致性，再补一条：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate heal --chapters 91-100 --auto-vector-heal
```

### 自动修复建议（指定坏章，如 15/91/92/94）

你这个想法非常好，推荐用“**坏章列表自动修复 + 全书连贯复核 + 大纲反写**”三段式：

1) 先审查定位：

```bash
/webnovel-review 1-100
```

2) 在 Claude Code 中按坏章列表循环触发子 agent（示例）：

```bash
/webnovel-write 15
/webnovel-write 91
/webnovel-write 92
/webnovel-write 94
```

> `webnovel-write` 会自动调用 context/reviewer/data-agent 子链做修复与重提交。

3) 修完后做全书连贯复核（防止局部修复引发跨章断裂）：

```bash
/webnovel-review 1-100
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" story-events --health
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate heal --chapters 1-100 --auto-vector-heal --json-report-out ".webnovel/reports/continuity-1-100.json"
```

4) 最后做“大纲反写/校准”，保证后续生成不受旧偏差影响：

```bash
# 先确认受影响卷号，然后逐卷执行
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" master-outline-sync --volume 2 --format json
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" master-outline-sync --volume 3 --format json
```

### 长期记忆子命令

| 子命令 | 说明 |
|--------|------|
| `memory stats` | 查看总量、分类统计 |
| `memory query` | 按 category/subject/status 过滤查询 |
| `memory dump` | 导出完整 scratchpad 内容 |
| `memory conflicts` | 查看同主键 active 冲突项 |
| `memory bootstrap` | 从 index.db 与 summaries 回填初始长期记忆 |
| `memory update` | 对指定章节结果执行手动映射写入 |

示例：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" memory stats
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" memory query --category character_state --subject xiaoyan
```

### Story System 子命令

| 子命令 | 说明 |
|--------|------|
| `story-system "<题材>" --persist` | 写入合同种子（`MASTER_SETTING.json` 等） |
| `story-system "<题材>" --emit-runtime-contracts --chapter N` | 生成运行时合同 + 写前校验 |
| `chapter-commit --chapter N` | 提交章节 commit（可附带 review/fulfillment/disambiguation/extraction 结果） |
| `story-events --chapter N` | 查询指定章节事件 |
| `story-events --health` | 事件链健康检查 |
| `memory-contract` | 记忆合同管理 |
| `review-pipeline --chapter N --review-results <file>` | 审查流水线 |

示例：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" story-system "玄幻退婚流" --persist
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" chapter-commit --chapter 12 --review-result .webnovel/tmp/review.json
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" story-events --health
```

产物：

- `story-system --persist` → `.story-system/MASTER_SETTING.json`
- `--emit-runtime-contracts` → `volumes/*.json` 与 `reviews/*.review.json`
- `chapter-commit` → `commits/*.commit.json`
- `story-events` → 读取 `events/*.events.json` 或 `index.db.story_events`
