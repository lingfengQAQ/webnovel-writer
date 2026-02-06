---
name: webnovel-query
description: Queries project settings for characters, powers, factions, items, and foreshadowing. Supports urgency analysis and golden finger status. Activates when user asks about story elements or /webnovel-query.
allowed-tools: Read Grep Bash AskUserQuestion
---

# Information Query Skill

## Project Root Guard（必须先确认）

- 必须在项目根目录执行（需存在 `.webnovel/state.json`）
- 若当前目录不存在该文件，先询问用户项目路径并 `cd` 进入
- 进入后设置变量：`$PROJECT_ROOT = (Resolve-Path ".").Path`
- **禁止**在 `.claude/` 下读取或写入项目文件

## Workflow Checklist

Copy and track progress:

```
信息查询进度：
- [ ] Step 1: 识别查询类型
- [ ] Step 2: 加载对应参考文件
- [ ] Step 3: 加载项目数据 (state.json)
- [ ] Step 4: 确认上下文充足
- [ ] Step 5: 执行查询
- [ ] Step 6: 格式化输出
```

---

## Reference Loading Levels (strict, lazy)

- L0: 先识别查询类型，不预加载全部参考。
- L1: 所有查询仅加载基础数据流规范。
- L2: 仅按查询类型加载对应专题参考。

### L1 (minimum)
- `references/system-data-flow.md`

### L2 (conditional by query type)
- 伏笔查询：`references/advanced/foreshadowing.md`
- 节奏查询：`../webnovel-plan/references/strand-weave-pattern.md`
- 标签格式查询：`references/tag-specification.md`

Do not load two or more L2 files unless the user request clearly spans multiple query types.

## Step 1: 识别查询类型

| 关键词 | 查询类型 | 需加载 |
|--------|---------|--------|
| 角色/主角/配角 | 标准查询 | system-data-flow.md |
| 境界/筑基/金丹 | 标准查询 | system-data-flow.md |
| 伏笔/紧急伏笔 | 伏笔分析 | foreshadowing.md |
| 金手指/系统 | 金手指状态 | system-data-flow.md |
| 节奏/Strand | 节奏分析 | strand-weave-pattern.md |
| 标签/实体格式 | 格式查询 | tag-specification.md |

## Step 2: 加载对应参考文件

**所有查询必须执行**：
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-query/references/system-data-flow.md"
```

**伏笔查询额外执行**：
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-query/references/advanced/foreshadowing.md"
```

**节奏查询额外执行**：
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan/references/strand-weave-pattern.md"
```

**标签格式查询额外执行**：
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-query/references/tag-specification.md"
```

## Step 3: 加载项目数据

```bash
cat "$PROJECT_ROOT/.webnovel/state.json"
```

## Step 4: 确认上下文充足

**检查清单**：
- [ ] 查询类型已识别
- [ ] 对应参考文件已加载
- [ ] state.json 已加载
- [ ] 知道在哪里搜索答案

**如有缺失 → 返回对应 Step**

## Step 5: 执行查询

### 标准查询

| 关键词 | 搜索目标 |
|--------|---------|
| 角色/主角/配角 | 主角卡.md, 角色库/ |
| 境界/实力 | 力量体系.md |
| 宗门/势力 | 世界观.md |
| 物品/宝物 | 物品库/ |
| 地点/秘境 | 世界观.md |

### 伏笔紧急度分析

**三层分类**（来自 foreshadowing.md）：
- **核心伏笔**: 主线剧情 - 权重 3.0x
- **支线伏笔**: 配角/支线 - 权重 2.0x
- **装饰伏笔**: 氛围/细节 - 权重 1.0x

**紧急度公式**：
```
紧急度 = (已过章节 / 目标章节) × 层级权重
```

**状态判定**：
- 🔴 Critical: 超过目标 OR 核心 >20 章
- 🟡 Warning: >80% 目标 OR 支线 >30 章
- 🟢 Normal: 计划范围内

**快速分析**：
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/status_reporter.py" --focus urgency --project-root "$PROJECT_ROOT"
```

### 金手指状态

输出包含：
- 基本信息（名称/类型/激活章节）
- 当前等级和进度
- 已解锁技能及冷却
- 待解锁技能预览
- 升级条件
- 发展建议

### Strand 节奏分析

**快速分析**：
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/status_reporter.py" --focus strand --project-root "$PROJECT_ROOT"
```

**检查警告**：
- Quest >5 连续章
- Fire >10 章未出现
- Constellation >15 章未出现

## Step 6: 格式化输出

```markdown
# 查询结果：{关键词}

## 📊 概要
- **匹配类型**: {type}
- **数据源**: state.json + 设定集 + 大纲
- **匹配数量**: X 条

## 🔍 详细信息

### 1. Runtime State (state.json)
{结构化数据}
**Source**: `.webnovel/state.json` (lines XX-XX)

### 2. 设定集匹配结果
{匹配内容，含文件路径和行号}

## ⚠️ 数据一致性检查
{state.json 与静态文件的差异}
```
