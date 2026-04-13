# 项目结构与运维

## 目录层级

系统涉及 4 层目录，使用前需要了解它们的区别：

| 层级 | 说明 | 示例 |
|------|------|------|
| `WORKSPACE_ROOT` | Claude Code 工作区根目录 | `D:\wk\novels` |
| `.claude/` | 工作区级配置与项目指针 | `D:\wk\novels\.claude\` |
| `PROJECT_ROOT` | 某本书的项目根目录（由 `/webnovel-init` 创建） | `D:\wk\novels\凡人资本论` |
| `CLAUDE_PLUGIN_ROOT` | 插件缓存目录（不在项目内，由 Marketplace 安装管理） | 自动管理 |

### 工作区目录

```text
workspace-root/
├── .claude/
│   ├── .webnovel-current-project   # 指向当前书项目根
│   └── settings.json
├── 小说A/                          # PROJECT_ROOT
├── 小说B/
└── ...
```

一个工作区可以包含多本书，通过 `.webnovel-current-project` 指针切换当前操作的书。

### 书项目目录（PROJECT_ROOT）

```text
project-root/
├── .webnovel/            # 运行时数据
│   ├── state.json        # 项目状态
│   ├── index.db          # SQLite 索引（实体/关系/章节数据）
│   ├── vectors.db        # 向量索引
│   ├── summaries/        # 章节摘要
│   ├── backups/          # 自动备份
│   └── archive/          # 归档
├── .story-system/        # Story System 数据
│   ├── MASTER_SETTING.json
│   ├── chapters/
│   ├── volumes/
│   ├── reviews/
│   ├── commits/
│   └── events/
├── 正文/                  # 正文章节
├── 大纲/                  # 总纲与卷纲
├── 设定集/                # 世界观、角色、力量体系
└── 审查报告/              # 审查输出
```

### 插件目录

插件安装在 Claude 插件缓存目录，不在书项目内。运行时通过 `CLAUDE_PLUGIN_ROOT` 引用：

```text
${CLAUDE_PLUGIN_ROOT}/
├── skills/       # 7 个 Skill 命令定义
├── agents/       # 3 个 Agent 定义
├── scripts/      # Python 脚本与数据模块
├── references/   # 参考文档（题材画像、追读力分类法等）
├── templates/    # 初始化模板
├── genres/       # 精调题材配置
└── dashboard/    # 可视化面板前端
```

### 用户级全局映射

当工作区指针不可用时，系统会从用户级 registry 查找 workspace → project 映射：

```text
${CLAUDE_HOME:-~/.claude}/webnovel-writer/workspaces.json
```

## 常用运维命令

### 环境预检

```bash
python -X utf8 "${CLAUDE_PLUGIN_ROOT}/scripts/webnovel.py" --project-root "${WORKSPACE_ROOT}" preflight
```

检查项：插件脚本路径 / 项目根是否可解析 / Skill 目录是否存在。

### 索引重建

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index process-chapter --chapter 1
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index stats
```

### 健康报告

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" status -- --focus all
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" status -- --focus urgency
```

### 向量重建

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" rag index-chapter --chapter 1
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" rag stats
```

### 测试

```bash
pwsh "${CLAUDE_PLUGIN_ROOT}/scripts/run_tests.ps1" -Mode smoke
pwsh "${CLAUDE_PLUGIN_ROOT}/scripts/run_tests.ps1" -Mode full
```

## Story System 运维

### 健康检查

```bash
python -X utf8 "${CLAUDE_PLUGIN_ROOT}/scripts/webnovel.py" --project-root "${PROJECT_ROOT}" story-events --health
```

返回字段：`sqlite_rows` / `event_files` / `ok`

重点关注：

- `.story-system/events/` 是否可读
- `index.db` 中 `story_events` 表是否可查
- `override_contracts` 是否能统计 `amend_proposal`

### 备份

做 Story System 相关备份时，至少同时备份以下内容：

```text
.story-system/
.webnovel/index.db
```

如果要做章节级回溯，建议连同 `.webnovel/summaries/` 一起备份。
