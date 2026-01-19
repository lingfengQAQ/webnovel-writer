---
name: webnovel-init
description: Initializes webnovel projects with settings, outline framework, and state.json. Supports quick/standard/deep modes. Activates when user wants to start a new novel or /webnovel-init.
allowed-tools: Bash Write Read Edit AskUserQuestion Task
---

# Project Initialization Skill

## Workflow Checklist

Copy and track progress:

```
项目初始化进度：
- [ ] Step 1: 加载题材套路 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/genre-tropes.md")
- [ ] Step 2: 加载数据规范 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/system-data-flow.md")
- [ ] Step 3: 确认上下文充足
- [ ] Step 4: 检查现有项目
- [ ] Step 5: 收集基本信息 (AskUserQuestion)
- [ ] Step 5.5: 加载题材模板 (根据用户选择)
- [ ] Step 6: 金手指设计 (Standard+)
- [ ] Step 7: 创意深挖 (Deep模式)
- [ ] Step 8: 生成项目文件
- [ ] Step 9: 验证并报告
```

---

## Step 1: 加载题材套路（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/genre-tropes.md"
```

## Step 2: 加载数据规范

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/system-data-flow.md"
```

## Step 3: 确认上下文充足

**检查清单**：
- [ ] 题材套路和金手指类型已了解
- [ ] state.json 结构已理解
- [ ] 项目目录结构已明确
- [ ] 题材模板将在 Step 5.5 加载

**如有缺失 → 返回对应 Step**

## Step 4: 检查现有项目

```bash
ls .webnovel/state.json 2>/dev/null && echo "项目已存在"
```

如存在，询问用户：保留/备份/覆盖

## 初始化模式

| 模式 | 时长 | 内容 |
|------|------|------|
| ⚡ Quick | 5分钟 | 基本信息 |
| 📝 Standard | 15-20分钟 | +金手指+核心卖点 |
| 🎯 Deep | 30-45分钟 | +创意评估+市场定位+角色深度 |

## Step 5: 收集基本信息

**使用 AskUserQuestion 收集**：
- 题材类型（修仙/系统流/都市异能/狗血言情）
- 小说标题
- 主角姓名
- 目标字数

**参考 genre-tropes.md** 建议合适的金手指类型。

## Step 5.5: 加载题材模板（必须执行）

**用户选择题材后，必须加载对应模板**：

| 题材 | 执行命令 |
|------|---------|
| 修仙 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/修仙.md"` |
| 系统流 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/系统流.md"` |
| 都市异能 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/都市异能.md"` |
| 狗血言情 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/狗血言情.md"` |
| 知乎短篇 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/知乎短篇.md"` |
| 古言 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/古言.md"` |
| 现实题材 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/现实题材.md"` |
| 规则怪谈 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/规则怪谈.md"` |
| 替身文 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/替身文.md"` |
| 多子多福 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/多子多福.md"` |
| 黑暗题材 | `cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/黑暗题材.md"` |

**金手指设计参考**（Standard+ 模式必须加载）：
```bash
cat "${CLAUDE_PLUGIN_ROOT}/templates/golden-finger-templates.md"
```

## Step 6: 金手指设计（Standard + Deep）

**加载核心设计参考**：
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/selling-points.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/worldbuilding/character-design.md"
```

**使用 AskUserQuestion 收集**：
- 金手指类型（系统面板/签到/鉴定/吞噬）
- 系统名称/代号
- 代价/限制（反套路）
- 系统性格
- 成长曲线
- 核心卖点（1-3个）

## Step 7: 创意深挖（Deep 模式）

如为 Deep 模式，额外加载：
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/inspiration-collection.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/worldbuilding/power-systems.md"
```

收集：
- 灵感五维评估
- 创意 A+B+C 组合
- 市场定位
- 主角深度设计（欲望/缺陷/原型）
- 反派设计（C/B/A/S 级）

## Step 8: 生成项目文件

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/init_project.py" \
  "./webnovel-project" \
  "{title}" \
  "{genre}" \
  --protagonist-name "{name}" \
  --target-words {count} \
  --golden-finger-name "{gf_name}" \
  --golden-finger-type "{gf_type}" \
  --core-selling-points "{points}"
```

**生成文件**：
- `.webnovel/state.json` - 运行时状态
- `设定集/世界观.md` - 世界设定
- `设定集/力量体系.md` - 力量体系
- `设定集/主角卡.md` - 主角卡
- `设定集/金手指设计.md` - 金手指设计
- `大纲/总纲.md` - 总纲

## Step 9: 验证并报告

```bash
ls -la .webnovel/state.json
ls -la 设定集/*.md
git init && git add . && git commit -m "初始化网文项目：{title}"
```

**输出三大定律提醒**：
1. **大纲即法律**: 遵循大纲，不擅自发挥
2. **设定即物理**: 遵守设定，不自相矛盾
3. **发明需识别**: 新实体由 Data Agent 自动提取
