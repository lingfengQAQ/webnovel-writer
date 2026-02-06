# CLAUDE.md - Webnovel Writer 项目指南

> 本文档为 Claude Code 提供项目上下文，帮助 AI 理解项目结构和工作流程。

## 项目概述

**Webnovel Writer** 是基于 Claude Code 的长篇网文辅助创作系统（v5.4.2），解决 AI 写作中的"遗忘"和"幻觉"问题，支持 200 万字量级连载创作。

## 核心理念

### 防幻觉三定律
1. **大纲即法律** - 遵循大纲，不擅自发挥
2. **设定即物理** - 遵守设定，不自相矛盾
3. **发明需识别** - 新实体必须入库管理

### 创意约束系统（v5.4.2 新增）
- **三轴混搭** - 题材基础 + 规则限制 + 角色矛盾（至少2/3非默认）
- **反套路触发器** - 每项目必选至少1条反常规规则
- **镜像对抗** - 反派与主角共享欲望/缺陷，采取相反道路
- **约束继承** - 大纲规划时继承创意约束，每N章触发

### 追读力机制（v5.3 新增）
- **Hard Invariants** - 不可违反的硬约束（可读性/承诺/节奏/冲突）
- **Soft Guidance** - 可通过 Override Contract 违反的软建议
- **Chase Debt** - 追读力债务追踪（利息默认关闭）

## 关键目录

```
.claude/
├── agents/                 # 8 个专职 Agent
│   ├── context-agent.md    # 创作任务书生成器
│   ├── data-agent.md       # 数据链工程师
│   ├── reader-pull-checker.md  # 追读力检查器
│   └── ...
├── skills/                 # 7 个核心 Skill
│   ├── webnovel-init/      # 含创意约束生成 Phase
│   ├── webnovel-plan/      # 含约束继承检查
│   ├── webnovel-write/     # 主写作流程
│   └── ...
├── scripts/                # Python 脚本
│   └── data_modules/
│       ├── index_manager.py  # SQLite 管理
│       └── ...
├── references/             # 写作指南
│   ├── reading-power-taxonomy.md  # 追读力分类标准
│   ├── genre-profiles.md          # 题材配置档案
│   └── ...
└── templates/              # 题材模板
```

## 核心 Skill 命令

| 命令 | 说明 |
|------|------|
| `/webnovel-init` | 初始化项目（含创意约束生成） |
| `/webnovel-plan [卷号]` | 规划大纲（含约束继承检查） |
| `/webnovel-write [章号]` | 创作章节 |
| `/webnovel-review [范围]` | 质量审查 |
| `/webnovel-query [关键词]` | 信息查询 |
| `/webnovel-resume` | 恢复中断任务 |
| `/webnovel-learn [描述]` | 记忆写入 |

## Claude Code 调用矩阵

- 调用责任与触发时机统一见：`.claude/references/claude-code-call-matrix.md`
- 原则：脚本默认由 Skill/Agent 在流程节点触发；除非明确声明，不作为人工常规入口。

## v5.4.2 新增功能

### 1. 创意约束系统
- **creativity-constraints.md** - 创意包 Schema + 三轴混搭 + 三问筛选 + 五维评分
- **category-constraint-packs.md** - 按平台分类的约束包模板库
- **anti-trope-xianxia.md** - 修仙/玄幻反套路库（20条限制 + 15种非套路爽点）
- **anti-trope-rules-mystery.md** - 规则怪谈反套路库（20条限制 + 20种非套路爽点）
- **market-trends-2026.md** - 市场扫描模板（需联网更新，记录标签/方向）
- **复合题材** - 支持“题材A+题材B”组合加载模板（1主1辅）

### 2. 工作流更新
- **webnovel-init Phase 6.5** - 创意约束生成（Deep 模式）
- **webnovel-plan Phase 2.5** - 加载创意约束
- **webnovel-plan Phase 7** - 约束继承检查

### 3. 新增文件
- `.webnovel/idea_bank.json` - 创意银行（存储生成的创意包）

## 写作工作流 (Step 1-6)

```
Step 1: Context Agent 搜集上下文
        ↓ (输出创作任务书，含追读力策略)
Step 1.5: 章节设计（按需，开头/钩子/爽点/微兑现）
        ↓
Step 2A: 生成粗稿
Step 2B: 风格适配器
        ↓
Step 3: 默认 4 Agent 审查（关键章扩展到 6）
        ↓
Step 4: 网文化润色
        ↓
Step 5: Data Agent 处理数据链
        ↓
Step 6: Git 备份
```

## 常用 Python 命令

在项目根目录运行 `python -m data_modules.*` 前，请先确保模块路径可见：

```bash
# 方式1：先切到脚本目录
cd .claude/scripts

# 方式2：或在根目录设置 PYTHONPATH
# Windows PowerShell: $env:PYTHONPATH = ".claude/scripts"
# macOS/Linux: export PYTHONPATH=".claude/scripts"
```

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
| `.webnovel/idea_bank.json` | 创意银行（v5.4.2） |
| `设定集/复合题材-融合逻辑.md` | 复合题材融合逻辑模板 |
| `设定集/女主卡.md` | 女主卡模板 |
| `设定集/主角组.md` | 多主角设定模板 |
| `设定集/反派设计.md` | 反派设计模板 |
| `.claude/references/reading-power-taxonomy.md` | 追读力分类标准 |
| `.claude/references/genre-profiles.md` | 题材配置档案 |

## 注意事项

1. **不要直接修改 state.json 中的大量数据** - 大数据存 SQLite
2. **Override Contract 需明确偿还计划** - 每个 Override 产生债务
3. **债务利息默认关闭** - 仅在明确开启时计算
4. **题材 Profile 可覆盖** - 在 state.json 中设置 genre_overrides
5. **创意约束需继承** - 大纲规划时检查约束触发频率
6. **status_reporter 真实数据优先** - 伏笔/爽点分析优先读取 `state.json` 与 `index.db`，缺数据时标记“数据不足”，避免估算误导
