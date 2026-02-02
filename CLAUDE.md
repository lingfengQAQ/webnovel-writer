# CLAUDE.md - Webnovel Writer 项目指南

> 本文档为 Claude Code 提供项目上下文，帮助 AI 理解项目结构和工作流程。

## 项目概述

**Webnovel Writer** 是基于 Claude Code 的长篇网文辅助创作系统（v5.3），解决 AI 写作中的"遗忘"和"幻觉"问题，支持 200 万字量级连载创作。

## 核心理念

### 防幻觉三定律
1. **大纲即法律** - 遵循大纲，不擅自发挥
2. **设定即物理** - 遵守设定，不自相矛盾
3. **发明需识别** - 新实体必须入库管理

### 追读力机制（v5.3 新增）
- **Hard Invariants** - 不可违反的硬约束（可读性/承诺/节奏/冲突）
- **Soft Guidance** - 可通过 Override Contract 违反的软建议
- **Chase Debt** - 追读力债务追踪与利息机制

## 关键目录

```
.claude/
├── agents/                 # 9 个专职 Agent
│   ├── context-agent.md    # 创作任务书生成器 (v5.3)
│   ├── data-agent.md       # 数据链工程师
│   ├── reader-pull-checker.md  # 追读力检查器 (v5.3)
│   ├── high-point-checker.md   # 爽点检查器 (v5.3)
│   └── ...
├── skills/                 # 6 个核心 Skill
│   ├── webnovel-init/
│   ├── webnovel-plan/
│   ├── webnovel-write/     # 主写作流程 (v5.3)
│   └── ...
├── scripts/                # Python 脚本
│   └── data_modules/
│       ├── index_manager.py  # SQLite 管理 (v5.3)
│       └── ...
├── references/             # 写作指南
│   ├── reading-power-taxonomy.md  # 追读力分类标准 (v5.3)
│   ├── genre-profiles.md          # 题材配置档案 (v5.3)
│   └── ...
└── templates/              # 题材模板
```

## 核心 Skill 命令

| 命令 | 说明 |
|------|------|
| `/webnovel-init` | 初始化项目 |
| `/webnovel-plan [卷号]` | 规划大纲 |
| `/webnovel-write [章号]` | 创作章节 |
| `/webnovel-review [范围]` | 质量审查 |
| `/webnovel-query [关键词]` | 信息查询 |
| `/webnovel-resume` | 恢复中断任务 |

## v5.3 新增功能

### 1. 追读力分类标准
- **钩子类型扩展**：危机钩/悬念钩/情绪钩/选择钩/渴望钩
- **爽点模式扩展**：8种模式（新增迪化误解/身份掉马）
- **微兑现体系**：7种类型（信息/关系/能力/资源/认可/情绪/线索）

### 2. 题材 Profile 配置
8种内置题材，每种包含：
- 偏好钩子类型
- 偏好爽点模式
- 微兑现要求
- 节奏红线阈值
- Override 允许规则

### 3. SQLite 新表
- `override_contracts` - Override Contract 记录
- `chase_debt` - 追读力债务
- `debt_events` - 债务事件日志
- `chapter_reading_power` - 章节追读力元数据

### 4. 约束分层机制
- **Hard Invariants** (HARD-001 ~ HARD-004) - 必须修复
- **Soft Guidance** - 可 Override，产生债务
- **Override Contract** - 记录违反理由和偿还计划
- **Chase Debt** - 债务追踪，含利息机制

## 写作工作流 (Step 1-6)

```
Step 1: Context Agent 搜集上下文
        ↓ (输出创作任务书，含追读力设计)
Step 1.5: 章节设计（开头/钩子/爽点/微兑现）
        ↓
Step 2A: 生成粗稿
Step 2B: 风格适配器
        ↓
Step 3: 6 Agent 并行审查（含 reader-pull-checker）
        ↓
Step 4: 网文化润色
        ↓
Step 5: Data Agent 处理数据链
        ↓
Step 6: Git 备份
```

## 常用 Python 命令

```bash
# 查询统计
python -m data_modules.index_manager stats --project-root "."

# 查询债务状态
python -m data_modules.index_manager get-debt-summary --project-root "."

# 查询追读力历史
python -m data_modules.index_manager get-recent-reading-power --limit 10 --project-root "."

# 查询模式使用统计
python -m data_modules.index_manager get-pattern-usage-stats --last-n 20 --project-root "."
```

## 关键文件说明

| 文件 | 说明 |
|------|------|
| `.webnovel/state.json` | 项目状态（精简版） |
| `.webnovel/index.db` | SQLite 索引数据库 |
| `.claude/references/reading-power-taxonomy.md` | 追读力分类标准 |
| `.claude/references/genre-profiles.md` | 题材配置档案 |

## 注意事项

1. **不要直接修改 state.json 中的大量数据** - 大数据存 SQLite
2. **Override Contract 需明确偿还计划** - 每个 Override 产生债务
3. **债务有利息** - 每章累积 10%，逾期会影响后续章节
4. **题材 Profile 可覆盖** - 在 state.json 中设置 genre_overrides
