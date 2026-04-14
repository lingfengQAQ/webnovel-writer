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
