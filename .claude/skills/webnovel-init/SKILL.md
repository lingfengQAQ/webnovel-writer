---
name: webnovel-init
description: Initializes webnovel projects with settings, outline framework, and state.json. Supports quick/standard/deep modes. Activates when user wants to start a new novel or /webnovel-init.
allowed-tools: Bash Write Read Edit AskUserQuestion Task
---

# Project Initialization Skill

## Workflow Checklist

```
项目初始化进度：
- [ ] Phase 1: 模式确定 + 基础资料加载
- [ ] Phase 2: 题材选择（两轮）
- [ ] Phase 3: 基本信息收集
- [ ] Phase 4: 金手指设计 (Standard+)
- [ ] Phase 5: 世界构建 (Standard+)
- [ ] Phase 6: 创意深挖 (Deep)
- [ ] Phase 6.5: 创意约束生成 (Standard+) ← 新增
- [ ] Phase 7: 生成项目文件
- [ ] Phase 8: 验证并报告
```

---

## Phase 1: 模式确定 + 基础资料

### 1.1 加载基础资料（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/genre-tropes.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/system-data-flow.md"
```

### 1.2 确定初始化模式

**[AskUserQuestion Round 1]**

| 问题 | 选项 |
|------|------|
| 初始化模式 | ⚡ Quick (5分钟，基本信息) / 📝 Standard (15-20分钟，+金手指设计) / 🎯 Deep (30-45分钟，+创意评估+市场定位) |

---

## Phase 2: 题材选择

### 2.1 选择题材大类

**[AskUserQuestion Round 2]**

| 问题 | 选项 |
|------|------|
| 题材大类 | 玄幻修仙类 / 都市现代类 / 言情类 / 特殊题材 |

### 2.2 选择具体题材 + 目标字数

**[AskUserQuestion Round 3]** 根据大类显示：

| 大类 | 具体题材选项 |
|------|-------------|
| 玄幻修仙类 | 修仙 / 系统流 / 高武 / 西幻 / 无限流 / 末世 / 科幻 |
| 都市现代类 | 都市日常 / 都市异能 / 都市脑洞 / 现实题材 |
| 言情类 | 古言 / 宫斗宅斗 / 青春甜宠 / 豪门总裁 / 职场婚恋 / 民国言情 / 幻想言情 / 现言脑洞 / 女频悬疑 / 狗血言情 / 替身文 / 多子多福 / 种田 / 年代 |
| 特殊题材 | 规则怪谈 / 悬疑脑洞 / 悬疑灵异 / 历史古代 / 历史脑洞 / 游戏体育 / 抗战谍战 / 知乎短篇 |

**支持复合题材**：可输入“题材A+题材B”（最多 2 个），例如：`都市脑洞+规则怪谈`。  
**复合规则**：1 主 1 辅（约 7:3），主线保持主题材逻辑，副题材只提供规则/钩子/爽点。

同时询问：

| 问题 | 选项 |
|------|------|
| 目标字数 | 30万字 / 50万字 / 100万字 / 200万字+ |

### 2.3 加载题材模板（必须执行）

根据选择的题材执行（复合题材需分别加载）：

```bash
# 主题材
cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/{题材A}.md"
# 副题材（可选）
cat "${CLAUDE_PLUGIN_ROOT}/templates/genres/{题材B}.md"
```

---

## Phase 3: 基本信息收集

### 3.1 小说标题

**[AskUserQuestion Round 4-Q1]**

| 问题 | 选项 |
|------|------|
| 标题风格 | 《XXX系统》金手指型 / 《我在XXX当XXX》身份型 / 《从XXX开始》开局型 / 《XXX：XXX》副标题型 |

> AskUserQuestion 自动提供 Other 选项，用户可直接输入完整标题；若选择风格模板，Claude 根据风格生成具体建议。

### 3.2 主角姓名

**[AskUserQuestion Round 4-Q2]**

| 问题 | 选项 |
|------|------|
| 姓名风格 | 古风名（林天/萧炎/叶凡/陈平安） / 现代名（李明/张伟/王强） / 特殊名（需自定义） |

> 选择风格后，Claude 可生成具体姓名建议供用户确认。

### 3.3 主角结构与女主配置

**[AskUserQuestion Round 4-Q3]**

| 问题 | 选项 |
|------|------|
| 主角结构 | 单主角 / 多主角（2-5人） |
| 女主配置 | 无女主 / 重要女主（1人） / 多女主（2-3人） |

> 若选“多主角”，追问主角姓名与各自定位（主线/副线/反差角色）。
> 若选“有女主”，追问女主姓名与定位（事业线/情感线/对抗线）。
> 若选“多女主”，追问 2-3 位女主姓名与定位。

---

## Phase 4: 金手指设计 (Standard + Deep)

**跳过条件**: Quick 模式跳过此阶段

### 4.1 加载设计资料

```bash
cat "${CLAUDE_PLUGIN_ROOT}/templates/golden-finger-templates.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/selling-points.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/worldbuilding/character-design.md"
```

### 4.2 按题材动态显示金手指选项

**题材-金手指匹配表**:

| 题材 | 推荐金手指 |
|------|-----------|
| 玄幻修仙 | 系统面板、签到打卡、老爷爷/传承、血脉觉醒 |
| 都市异能 | 系统面板、重生记忆、异能觉醒、随身空间 |
| 言情 | 重生记忆、随身空间、无金手指 |
| 知乎短篇 | 单一特殊能力、无金手指 |
| 规则怪谈 | 系统提示、规则解读能力 |

**[AskUserQuestion Round 5]**

| 问题 | 选项 |
|------|------|
| 金手指类型 | 根据题材动态显示 + “无金手指” |
| 成长曲线 | 前期爆发型 / 稳步提升型 / 厚积薄发型 |
| 读者可见度 | 明牌 / 半明牌 / 暗牌 |
| 不可逆代价 | 寿命 / 记忆 / 关系 / 资源 / 无 |

### 4.3 根据金手指类型动态调整问题

**系统面板型**
- 系统性格 / 系统命名 / 代价或限制 / 升级节奏

**重生/穿越型**
- 重生时间点 / 记忆完整度 / 先知程度 / 蝴蝶效应

**老爷爷/器灵型**
- 器灵性格 / 器灵实力 / 辅助方式 / 恢复条件

**随身空间型**
- 空间大小 / 特殊功能 / 升级方式

**血脉/天赋型**
- 血脉来源 / 觉醒条件 / 能力限制

**异能觉醒型**（都市异能专用）
- 异能来源 / 异能上限 / 代价或副作用 / 是否可进化

**无金手指**
- 主角天赋 / 特殊机遇 / 成长路线

---

## Phase 5: 世界构建 (Standard + Deep)

**跳过条件**: Quick 模式跳过此阶段

### 5.1 按需加载世界构建资料

```bash
# 势力体系设计（推荐加载）
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/worldbuilding/faction-systems.md"
# 设定一致性指南
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/worldbuilding/setting-consistency.md"
# 世界规则设计
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/worldbuilding/world-rules.md"
```

### 5.2 世界观框架

**[AskUserQuestion Round 6]** (可选)

| 问题 | 选项 |
|------|------|
| 世界规模 | 单一大陆 / 多大陆 / 多位面/多世界 / 星际宇宙 |
| 势力格局 | 门派/宗门 / 家族/世家 / 国家/帝国 / 组织/联盟 |
| 力量体系 | 境界修炼型 / 等级数值型 / 血脉觉醒型 / 职业技能型 |
| 社会阶层 | 阶级森严 / 相对平等 / 高流动性 |
| 资源分配 | 资源稀缺 / 资源中等 / 资源充足 |
| 货币体系 | 银两/铜钱 / 灵石/灵晶 / 贡献点/功勋点 / 信用点/配给券 / 双币制 / 自定义 |
| 兑换规则 | 可选：填写主要面值或兑换比率（可空） |
| 宗门/组织层级 | 宗主-长老-核心-内门-外门 / 家族(嫡系-旁系) / 官僚(军衔) / 无宗门 |

### 5.2.1 境界链模板（仅境界修炼型）

**[AskUserQuestion Round 6-Q1]**

| 问题 | 选项 |
|------|------|
| 典型境界链 | 练气-筑基-金丹-元婴-化神 / 三阶九段 / 自定义 |
| 小境界划分 | 初/中/后/巅 / 初/中/后/圆满 / 无 |

### 5.3 反派分层（可选）

**[AskUserQuestion Round 6-Q2]**

| 问题 | 选项 |
|------|------|
| 反派分层 | 暂不设定 / 提供小反派 / 提供小+中反派 / 提供小+中+大反派 |

> 若选择提供，收集名称与定位（示例：小反派:张三;中反派:李四;大反派:王五）。

---

## Phase 6: 创意深挖 (Deep)

**跳过条件**: Quick/Standard 模式跳过此阶段

### 6.1 加载创意资料

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/inspiration-collection.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/worldbuilding/power-systems.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/creative-combination.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/market-positioning.md"
```

### 6.2 市场定位与主角设计

**[AskUserQuestion Round 7]**

| 问题 | 选项 |
|------|------|
| 市场定位 | 大众爽文 / 小众精品 / 中间路线 |
| 主角原型 | 废材逆袭 / 天才崛起 / 重生复仇 / 穿越者 |
| 主角性格 | 隐忍腹黑 / 热血冲动 / 冷静理智 / 外冷内热 |

### 6.3 反派与感情线设计

**[AskUserQuestion Round 8]**

| 问题 | 选项 |
|------|------|
| 反派类型 | 嚣张跋扈型 / 阴险狡诈型 / 悲情反派 / 理念冲突型 |
| 感情线设计 | 后宫多女 / 单一真爱 / 无感情线 / 暧昧不明确 |
| 主角缺陷 | 性格缺陷 / 能力限制 / 心理阴影 / 无明显缺陷 |

### 6.4 创意组合评估

根据以上选择，使用 **创意 A+B+C 组合法** 评估：
- A = 题材基础
- B = 金手指特色
- C = 差异化卖点

输出灵感五维评估：新颖度/市场性/可写性/爽点密度/长线潜力

---

## Phase 6.5: 创意约束生成 (Standard + Deep)

**跳过条件**: Quick 模式跳过此阶段

> **核心理念**: 约束不是限制，而是创意的催化剂；用结构化约束迫使非套路选择。

### 6.5.1 加载创意约束资料

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/creativity-constraints.md"
```

**可选：按平台分类生成创意包**

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/category-constraint-packs.md"
```

根据题材**只加载一个**反套路库：

```bash
# 修仙/玄幻
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/anti-trope-xianxia.md"
```

或

```bash
# 规则怪谈
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/anti-trope-rules-mystery.md"
```

**可选：市场扫描（仅在用户明确要求时）**

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-init/references/creativity/market-trends-2026.md"
```

### 6.5.2 生成创意包（3-5个）

基于前面收集的信息，生成 3-5 个创意包，每个包含：

若 Phase 6 未执行，先补问 1-2 个关键问题（保持简短）：
- 规则限制偏好（从创意约束库中选 1-2 条）
- 角色矛盾类型（主角“想要什么”与“怕失去什么”）

| 字段 | 说明 |
|------|------|
| 书名 | 吸引眼球的标题 |
| 一句话卖点 | 10秒电梯演讲 |
| 三轴混搭 | 题材基础 + 规则限制 + 角色矛盾（至少2/3非默认） |
| 反套路规则 | 从反套路库选择至少1条 |
| 主角缺陷 | 必填，驱动成长 |
| 反派镜像 | 与主角共享欲望/缺陷，采取相反道路 |
| 开篇钩子 | 一句钩子 + 开场场景 + 第一章末悬念 |
| 硬约束 | 2-3条世界观/能力/行为约束 |

### 6.5.3 三问筛选

对每个创意包进行三问筛选：

| # | 问题 | 通过标准 |
|---|------|---------|
| Q1 | 这题材为什么"只能这样写"？ | 能说出至少1个独特理由 |
| Q2 | 这主角如果换成常规人设会崩吗？ | 是（主角与故事深度绑定） |
| Q3 | 这个卖点一句话能讲清、且不撞常见套路吗？ | 是（卖点清晰且有差异化） |

**筛选结果**:
- 通过 3/3 → 进入评分
- 通过 2/3 → 修改后重新筛选
- 通过 1/3 或 0/3 → 淘汰

### 6.5.4 五维评分

| 维度 | 权重 | 1分 | 3分 | 5分 |
|------|------|-----|-----|-----|
| 新颖度 | 25% | 烂大街 | 微创新 | 开创新品类 |
| 市场性 | 20% | 小众冷门 | 中等受众 | 大众热门 |
| 可写性 | 20% | 极难驾驭 | 中等难度 | 易于实现 |
| 爽点密度 | 20% | 爽点稀疏 | 中等密度 | 高密度 |
| 长线潜力 | 15% | 难以续写 | 可续写 | 无限扩展 |

**计算**: 总分 = 新颖度×2.5 + 市场性×2 + 可写性×2 + 爽点密度×2 + 长线潜力×1.5（满分50）

### 6.5.5 选择最佳创意

**[AskUserQuestion Round 9]**

展示评分后的创意包，让用户选择：

| 问题 | 选项 |
|------|------|
| 选择哪个创意？ | 创意1: {title} ({score}分) / 创意2: {title} ({score}分) / ... / 重新生成 |

### 6.5.6 记录创意（延后保存）

先在输出中**明确标注**最终选中的创意包与继承约束；实际写入磁盘放到 Phase 7（确保已进入项目目录）。

---

## Phase 7: 生成项目文件

### 7.0 项目目录规则（必须执行）

- 项目目录名 = 书名安全化（去除非法字符 `<>:"/\\|?*`，空格转 `-`，首尾去除 `-`）
- 若结果为空或以 `.` 开头，前缀 `proj-`
- **禁止**将项目目录放在 `.claude/` 下

最终得到：
- `project_root = "./{safe_title}"`

### 7.1 执行初始化脚本

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/init_project.py" \
  "{project_root}" \
  "{title}" \
  "{genre}" \
  --protagonist-name "{name}" \
  --target-words {count} \
  --golden-finger-name "{gf_name}" \
  --golden-finger-type "{gf_type}" \
  --protagonist-structure "{protagonist_structure}" \
  --heroine-config "{heroine_config}" \
  --heroine-names "{heroine_names}" \
  --heroine-role "{heroine_role}" \
  --co-protagonists "{co_protagonists}" \
  --co-protagonist-roles "{co_protagonist_roles}" \
  --antagonist-tiers "{antagonist_tiers}" \
  --world-scale "{world_scale}" \
  --factions "{factions}" \
  --power-system-type "{power_system_type}" \
  --social-class "{social_class}" \
  --resource-distribution "{resource_distribution}" \
  --currency-system "{currency_system}" \
  --currency-exchange "{currency_exchange}" \
  --sect-hierarchy "{sect_hierarchy}" \
  --cultivation-chain "{cultivation_chain}" \
  --cultivation-subtiers "{cultivation_subtiers}" \
  --gf-visibility "{gf_visibility}" \
  --gf-irreversible-cost "{gf_irreversible_cost}" \
  --core-selling-points "{points}"
```

### 7.2 进入项目目录（必须执行）

```bash
cd "{project_root}"
```

### 7.2.1 保存创意到 idea_bank（如有）

> 前提：已 `cd` 到项目目录，且 `.webnovel/` 已由 init 脚本创建。

```bash
@'
{
  "selected_idea": {
    "title": "示例标题",
    "one_liner": "示例一句话卖点",
    "anti_trope": "选中的反套路规则",
    "hard_constraints": ["硬约束1", "硬约束2"]
  },
  "rejected_ideas": [],
  "constraints_inherited": {
    "anti_trope": "选中的反套路规则",
    "hard_constraints": ["硬约束1", "硬约束2"],
    "protagonist_flaw": "主角缺陷",
    "antagonist_mirror": "反派镜像设计"
  }
}
'@ | Set-Content -Encoding UTF8 ".webnovel/idea_bank.json"
```

### 7.2.2 保存市场扫描结果（如有）

> 仅在用户明确要求“市场扫描/热门趋势”时执行。

```bash
@'
# Market Notes ({YYYY-MM-DD})

来源：
- {来源1}
- {来源2}

要点：
- {标签/方向}
- {标签/方向}
'@ | Set-Content -Encoding UTF8 ".webnovel/market_notes-{YYYYMMDD}.md"
```

### 7.3 生成文件清单（含模板写入）

| 文件 | 说明 | 生成时机 | 写入路径 |
|------|------|---------|---------|
| `.webnovel/state.json` | 运行时状态 | init Phase 7 | `.webnovel/state.json` |
| `.webnovel/index.db` | 实体索引数据库 | init Phase 7 + 索引初始化 | `.webnovel/index.db` |
| `设定集/世界观.md` | 世界观设定模板 | init Phase 7 | `设定集/世界观.md` |
| `设定集/力量体系.md` | 力量体系模板 | init Phase 7 | `设定集/力量体系.md` |
| `设定集/主角卡.md` | 主角卡模板 | init Phase 7 | `设定集/主角卡.md` |
| `设定集/女主卡.md` | 女主卡模板 | init Phase 7 | `设定集/女主卡.md` |
| `设定集/主角组.md` | 多主角协作模板 | init Phase 7 | `设定集/主角组.md` |
| `设定集/金手指设计.md` | 金手指设计模板 | init Phase 7 | `设定集/金手指设计.md` |
| `设定集/复合题材-融合逻辑.md` | 复合题材融合模板 | init Phase 7 | `设定集/复合题材-融合逻辑.md` |
| `设定集/反派设计.md` | 反派模板 | init Phase 7 | `设定集/反派设计.md` |
| `大纲/总纲.md` | 总纲模板 | init Phase 7 | `大纲/总纲.md` |
| `大纲/爽点规划.md` | 爽点规划模板 | init Phase 7 | `大纲/爽点规划.md` |

**模板引用方式**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/templates/output/设定集-世界观.md" | 填充变量 > 设定集/世界观.md
```

### 7.4 初始化索引数据库（推荐）

```bash
python -m data_modules.index_manager stats --project-root "{project_root}"
```

---

## Phase 8: 验证并报告

### 8.1 验证文件

```bash
Get-Item "{project_root}/.webnovel/state.json"
Get-ChildItem "{project_root}/设定集" -Filter *.md
```

### 8.2 初始化 Git（可选）

```bash
git -C "{project_root}" init && git -C "{project_root}" add . && git -C "{project_root}" commit -m "初始化网文项目：{title}"
```

### 8.3 输出三大定律提醒

1. **大纲即法律**: 遵循大纲，不擅自发挥
2. **设定即物理**: 遵守设定，不自相矛盾（查询 index.db 确认）
3. **发明需识别**: 新实体由 Data Agent 自动提取

---

## AskUserQuestion 轮次汇总

| 轮次 | 阶段 | 问题数 | 适用模式 |
|------|------|--------|----------|
| Round 1 | Phase 1 | 1 | All |
| Round 2 | Phase 2 | 1 | All |
| Round 3 | Phase 2 | 2 | All |
| Round 4 | Phase 3 | 3 | All |
| Round 5 | Phase 4 | 4 | Standard/Deep |
| Round 6 | Phase 5 | 8 | Standard/Deep |
| Round 7 | Phase 6 | 3 | Deep |
| Round 8 | Phase 6 | 3 | Deep |
| Round 9 | Phase 6.5 | 1 | Standard/Deep |

**Quick 模式**: Round 1-4
**Standard 模式**: Round 1-6, 9
**Deep 模式**: Round 1-9

---

## 变量映射（用于 init_project.py）

> 统一变量名，直接拼接到 Phase 7 的命令参数。

| 来源问题 | 变量名 | 格式示例 |
|---------|--------|----------|
| 主角结构 | `protagonist_structure` | 单主角 / 多主角 |
| 女主配置 | `heroine_config` | 无女主 / 单女主 / 多女主 |
| 女主姓名 | `heroine_names` | 叶清 / 叶清,苏晚 |
| 女主定位 | `heroine_role` | 事业线 / 情感线 / 对抗线 |
| 多主角姓名 | `co_protagonists` | 林天,顾言 |
| 多主角定位 | `co_protagonist_roles` | 主线,副线 |
| 反派分层 | `antagonist_tiers` | 小反派:张三;中反派:李四;大反派:王五 |
| 世界规模 | `world_scale` | 多大陆 |
| 势力格局 | `factions` | 门派/宗门 |
| 力量体系 | `power_system_type` | 境界修炼型 |
| 社会阶层 | `social_class` | 阶级森严 |
| 资源分配 | `resource_distribution` | 资源稀缺 |
| 货币体系 | `currency_system` | 灵石/灵晶 |
| 货币兑换 | `currency_exchange` | 1灵晶=100灵石 |
| 宗门层级 | `sect_hierarchy` | 宗主-长老-核心-内门-外门 |
| 典型境界链 | `cultivation_chain` | 练气-筑基-金丹-元婴 |
| 小境界划分 | `cultivation_subtiers` | 初/中/后/巅 |
| 金手指可见度 | `gf_visibility` | 明牌 |
| 金手指不可逆代价 | `gf_irreversible_cost` | 寿命 / 记忆 |

**复合题材**：`genre = 题材A+题材B`（最多 2 个），其余变量不变。
