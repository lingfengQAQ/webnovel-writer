# 题材配置档案 (Genre Profiles) v5.4

> **定位**：本文档定义各题材的追读力配置参数，供 Step 1.5 / Context Agent / Checkers 读取。
>
> **原则**：配置用于"调整权重和建议"，不做硬性裁决。
>
> **v5.4**：版本号对齐，内容沿用 v5.3。

---

## 一、Profile 字段说明

### 1.1 核心字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 题材唯一标识（英文小写） |
| `name` | string | 题材中文名 |
| `description` | string | 一句话描述核心卖点 |
| `tags` | string[] | 可叠加的题材标签（预留多标签扩展） |

### 1.2 钩子配置 (hook_config)

| 字段 | 类型 | 说明 |
|------|------|------|
| `preferred_types` | string[] | 偏好钩子类型（按优先级排序） |
| `strength_baseline` | string | 默认钩子强度：strong/medium/weak |
| `chapter_end_required` | boolean | 章末是否必须有钩子 |
| `transition_allowance` | number | 过渡章豁免上限（连续多少章可降级） |

### 1.3 爽点配置 (coolpoint_config)

| 字段 | 类型 | 说明 |
|------|------|------|
| `preferred_patterns` | string[] | 偏好爽点模式（按优先级排序） |
| `density_per_chapter` | string | 每章爽点密度：high(2+)/medium(1)/low(0-1) |
| `combo_interval` | number | combo爽点间隔（每N章至少1个） |
| `milestone_interval` | number | 阶段性胜利间隔（每N章至少1个） |

### 1.4 微兑现配置 (micropayoff_config)

| 字段 | 类型 | 说明 |
|------|------|------|
| `preferred_types` | string[] | 偏好微兑现类型 |
| `min_per_chapter` | number | 每章最少微兑现数量 |
| `transition_min` | number | 过渡章最少微兑现数量 |

### 1.5 节奏红线 (pacing_config)

| 字段 | 类型 | 说明 |
|------|------|------|
| `stagnation_threshold` | number | 节奏停滞阈值（连续N章无推进=HARD-003） |
| `strand_quest_max` | number | Quest主线最大连续章数 |
| `strand_fire_gap_max` | number | Fire感情线最大断档章数 |
| `transition_max_consecutive` | number | 过渡章最大连续数 |

### 1.6 约束豁免 (override_config)

| 字段 | 类型 | 说明 |
|------|------|------|
| `allowed_rationale_types` | string[] | 允许的Override理由类型 |
| `debt_multiplier` | number | 债务倍率（>1表示该题材更严格） |
| `payback_window_default` | number | 默认偿还窗口（章数） |

---

## 二、内置题材 Profiles

### 2.1 爽文/系统流 (shuangwen)

```yaml
id: shuangwen
name: 爽文/系统流
description: 金手指开挂，快节奏升级，打脸装逼一条龙
tags: [shuangwen]

hook_config:
  preferred_types: [渴望钩, 危机钩, 情绪钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [装逼打脸, 扮猪吃虎, 越级反杀, 迪化误解]
  density_per_chapter: high
  combo_interval: 5
  milestone_interval: 10

micropayoff_config:
  preferred_types: [能力兑现, 资源兑现, 认可兑现]
  min_per_chapter: 2
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 5
  strand_fire_gap_max: 15
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, ARC_TIMING]
  debt_multiplier: 1.0
  payback_window_default: 3
```

**题材特点**：
- 追求高密度爽点，读者期待快节奏
- 章末必须有明确期待（要突破了/要打脸了/要发财了）
- 过渡章容忍度低，最多连续2章

---

### 2.2 修仙/玄幻 (xianxia)

```yaml
id: xianxia
name: 修仙/玄幻
description: 逆天改命，残酷法则，机缘与争斗并存
tags: [xianxia]

hook_config:
  preferred_types: [危机钩, 渴望钩, 选择钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 3

coolpoint_config:
  preferred_patterns: [越级反杀, 扮猪吃虎, 身份掉马, 反派翻车]
  density_per_chapter: medium
  combo_interval: 8
  milestone_interval: 15

micropayoff_config:
  preferred_types: [能力兑现, 资源兑现, 信息兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 4
  strand_quest_max: 6
  strand_fire_gap_max: 12
  transition_max_consecutive: 3

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, WORLD_RULE_CONSTRAINT, ARC_TIMING]
  debt_multiplier: 0.9
  payback_window_default: 5
```

**题材特点**：
- 需要世界观构建，允许更多铺垫章
- 境界突破是核心期待
- 设定约束可作为合理Override理由

---

### 2.3 言情/甜宠 (romance)

```yaml
id: romance
name: 言情/甜宠
description: 情感互动，关系推进，心动与虐心交织
tags: [romance]

hook_config:
  preferred_types: [情绪钩, 渴望钩, 选择钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [甜蜜超预期, 身份掉马, 迪化误解]
  density_per_chapter: medium
  combo_interval: 6
  milestone_interval: 12

micropayoff_config:
  preferred_types: [关系兑现, 情绪兑现, 认可兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 4
  strand_quest_max: 4
  strand_fire_gap_max: 5
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, CHARACTER_CREDIBILITY, ARC_TIMING]
  debt_multiplier: 1.0
  payback_window_default: 4
```

**题材特点**：
- 感情线是绝对核心，断档容忍度极低
- 情绪钩是王牌（心疼/心动/吃醋）
- 关系进展是最重要的微兑现

---

### 2.4 悬疑/推理 (mystery)

```yaml
id: mystery
name: 悬疑/推理
description: 谜题驱动，逻辑推演，真相一步步揭示
tags: [mystery]

hook_config:
  preferred_types: [悬念钩, 危机钩, 选择钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [反派翻车, 身份掉马]
  density_per_chapter: low
  combo_interval: 10
  milestone_interval: 20

micropayoff_config:
  preferred_types: [信息兑现, 线索兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 8
  strand_fire_gap_max: 20
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [LOGIC_INTEGRITY, TRANSITIONAL_SETUP, ARC_TIMING]
  debt_multiplier: 0.8
  payback_window_default: 5
```

**题材特点**：
- 逻辑完整性优先于爽点密度
- 信息兑现是核心微兑现（每章需揭示新线索）
- LOGIC_INTEGRITY可作为降级钩子强度的合理理由

---

### 2.5 规则怪谈 (rules-mystery)

```yaml
id: rules-mystery
name: 规则怪谈
description: 诡异规则，生存推理，反杀怪谈
tags: [rules-mystery, horror]

hook_config:
  preferred_types: [危机钩, 悬念钩, 选择钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 1

coolpoint_config:
  preferred_patterns: [越级反杀, 反派翻车]
  density_per_chapter: medium
  combo_interval: 5
  milestone_interval: 8

micropayoff_config:
  preferred_types: [信息兑现, 线索兑现, 能力兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 2
  strand_quest_max: 4
  strand_fire_gap_max: 15
  transition_max_consecutive: 1

override_config:
  allowed_rationale_types: [LOGIC_INTEGRITY, WORLD_RULE_CONSTRAINT]
  debt_multiplier: 1.2
  payback_window_default: 2
```

**题材特点**：
- 紧张氛围要求高钩子强度
- 过渡章容忍度极低（1章）
- 规则约束是合理Override理由

---

### 2.6 都市异能 (urban-power)

```yaml
id: urban-power
name: 都市异能
description: 现代背景，隐藏超能，低调装逼
tags: [urban, power]

hook_config:
  preferred_types: [危机钩, 渴望钩, 情绪钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [扮猪吃虎, 装逼打脸, 身份掉马, 迪化误解]
  density_per_chapter: high
  combo_interval: 5
  milestone_interval: 10

micropayoff_config:
  preferred_types: [认可兑现, 能力兑现, 关系兑现]
  min_per_chapter: 2
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 5
  strand_fire_gap_max: 10
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, ARC_TIMING]
  debt_multiplier: 1.0
  payback_window_default: 3
```

**题材特点**：
- 装逼打脸系列是核心爽点
- 现代背景要求身份隐藏→掉马的节奏控制
- 社会地位变化是重要微兑现

---

### 2.7 知乎短篇 (zhihu-short)

```yaml
id: zhihu-short
name: 知乎短篇
description: 短平快，强反转，情绪冲击
tags: [short, zhihu]

hook_config:
  preferred_types: [情绪钩, 悬念钩, 选择钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 0

coolpoint_config:
  preferred_patterns: [反派翻车, 身份掉马, 甜蜜超预期]
  density_per_chapter: high
  combo_interval: 2
  milestone_interval: 3

micropayoff_config:
  preferred_types: [情绪兑现, 信息兑现, 关系兑现]
  min_per_chapter: 2
  transition_min: 2

pacing_config:
  stagnation_threshold: 1
  strand_quest_max: 2
  strand_fire_gap_max: 3
  transition_max_consecutive: 0

override_config:
  allowed_rationale_types: []
  debt_multiplier: 2.0
  payback_window_default: 1
```

**题材特点**：
- 不允许过渡章（每章必须有收获）
- 极高钩子强度要求
- 债务倍率最高（短篇不允许欠债）

---

### 2.8 替身文/虐文 (substitute)

```yaml
id: substitute
name: 替身文/虐文
description: 情感纠葛，误解与反转，追妻火葬场
tags: [substitute, angst]

hook_config:
  preferred_types: [情绪钩, 选择钩, 悬念钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [身份掉马, 反派翻车, 甜蜜超预期]
  density_per_chapter: medium
  combo_interval: 5
  milestone_interval: 10

micropayoff_config:
  preferred_types: [情绪兑现, 关系兑现, 认可兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 3
  strand_fire_gap_max: 4
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [CHARACTER_CREDIBILITY, ARC_TIMING, TRANSITIONAL_SETUP]
  debt_multiplier: 1.0
  payback_window_default: 4
```

**题材特点**：
- 情绪钩是绝对核心（虐心→心疼→期待）
- 身份掉马是王牌爽点
- 感情线断档容忍度极低

---

## 三、Profile 加载机制

### 3.1 加载时机

1. **Step 1.5**：根据 `state.json → project.genre` 加载对应profile
2. **Context Agent**：将profile相关字段注入创作任务书
3. **Checkers**：根据profile调整检测阈值和建议权重

### 3.2 多标签支持（预留）

当前为单标签模式。未来支持多标签时：
- 使用 `tags` 字段叠加
- 冲突字段取更严格的值
- 例：`[romance, mystery]` → 感情线断档取 min(5, 20) = 5

### 3.3 自定义Profile

用户可在 `state.json` 中覆盖默认值：

```json
{
  "project": {
    "genre": "xianxia",
    "genre_overrides": {
      "pacing_config": {
        "stagnation_threshold": 5
      }
    }
  }
}
```

---

## 四、与 Taxonomy 的关系

| Taxonomy 定义 | Profile 配置 |
|--------------|-------------|
| 钩子类型清单 | 哪些类型偏好 |
| 爽点模式清单 | 哪些模式偏好 |
| 微兑现类型清单 | 哪些类型偏好 |
| Hard/Soft 标准 | 阈值调整 |
| Override 理由类型 | 哪些理由允许 |

---

## 五、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v5.4 | 2026-02-03 | 版本号对齐，内容不变 |
| v5.3 | 2026-02-01 | 初版，包含8个内置题材profile |
