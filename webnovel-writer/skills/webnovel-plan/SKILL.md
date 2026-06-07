---
name: webnovel-plan
description: 基于总纲生成卷纲、时间线和章纲，并把新增设定增量写回现有设定集。
allowed-tools: Read Write Edit Bash AskUserQuestion
argument-hint: "[卷号，如 1]"
---

# Outline Planning

主 agent 职责：基于总纲增量细化卷纲/时间线/章纲，把新增设定写回设定集，并刷新 Story System 写作合同。不重做全局故事，不重写整份总纲或设定集。

## 执行原则

1. 只做增量补齐，不重写整份总纲或设定集。
2. 先锁定卷级节奏，再批量拆章。
3. 时间线是硬约束，所有章纲必须带时间字段。
4. 若发现总纲与设定冲突，先阻断，再等用户裁决。
5. 优先级链：用户明确要求 > 总纲核心冲突与卷末高潮 > 时间线硬约束 > skill 默认流程 > reference 建议。

## 阻断条件

- 项目根不合法或总纲缺失。
- 总纲缺少卷名 / 章节范围 / 核心冲突 / 卷末高潮 → 阻断并请求用户补全。
- Step 2 / Step 8 发现设定冲突 → 标记 `BLOCKER`，等待用户裁决。
- 批量拆章时时间回跳且未标注闪回 → 阻断当前批次。
- Step 9 验证失败 → 只重做失败批次，不覆盖整卷。

## 环境准备

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SKILL_ROOT="${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" placeholder-scan --format text
```

规划开始 / 结束都运行 `placeholder-scan`；plan 阶段发现占位先警告并补齐相关文件，进入写章前不得保留当前章相关实体的 `[待...]` / `暂名` / `{占位}`。

## 读取策略（按阶段触发，不预读全部 reference）

每个 reference 只在对应 Step 触发时读取，且优先区段读：先用 `Grep` 匹配 `^#{2,4} ` 定位标题锚点行号，再用 `Read` 的 offset/limit 取目标段。

| 触发 | 读取方式 | 文件 |
|------|---------|------|
| Step 4 | 全文 | `${SKILL_ROOT}/../../templates/output/大纲-卷节拍表.md` |
| Step 5 | 全文 | `${SKILL_ROOT}/../../templates/output/大纲-卷时间线.md` |
| Step 6 always | 区段 | `${SKILL_ROOT}/../../references/genre-profiles.md`（仅当前 genre 的 `### 2.x` 段） |
| Step 6 always | 全文 | `${SKILL_ROOT}/../../references/shared/strand-weave-pattern.md` |
| 章纲拆分 always | 区段 | `${SKILL_ROOT}/../../references/outlining/plot-signal-vs-spoiler.md` |
| Step 6 需要爽点 | 区段 | `${SKILL_ROOT}/../../references/shared/cool-points-guide.md` |
| Step 6/7 需要冲突 | 区段 | `${SKILL_ROOT}/references/outlining/conflict-design.md` |
| Step 6/7 特定节奏 | 区段 | `${SKILL_ROOT}/references/outlining/genre-volume-pacing.md` |
| Step 7 追读力分析 | 区段 | `${SKILL_ROOT}/../../references/reading-power-taxonomy.md` |
| Step 7 章纲细化 + 节点规范 | 区段 | `${SKILL_ROOT}/references/outlining/chapter-planning.md` |

CSV 创作参考用检索读，不 `cat` 整表：

```bash
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 爽点与节奏 --query "{卷级核心冲突}" --genre "${GENRE}"
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 桥段套路 --query "{卷级核心冲突}" --genre "${GENRE}"
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 命名规则 --query "角色命名" --genre "${GENRE}"
```

## 执行流程

### Step 1：加载项目数据并确认前置条件

```bash
# 项目配置/投影状态（兼容读取，不作为写后事实真源）
cat "$PROJECT_ROOT/.webnovel/state.json"

# 总纲（全局蓝图）；确认卷名/章节范围/核心冲突/卷末高潮，不足则阻断
cat "$PROJECT_ROOT/大纲/总纲.md"

# 题材（来自 init 配置快照，后续 CSV 检索和裁决匹配依赖此值）；写后主链真源仍是 .story-system/
GENRE="$(python -X utf8 -c "import json; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); pi=s.get('project_info',{}); print(pi.get('genre') or s.get('project',{}).get('genre',''))")"
```

按需读取设定集：`设定集/世界观.md`、`设定集/力量体系.md`、`设定集/主角卡.md`、`设定集/反派设计.md`、`.webnovel/idea_bank.json`。

**跨卷状态读取**（已有已完成卷，即 `.webnovel/summaries/` 下有文件时必须执行）：

```bash
# 最近 5 章摘要
for ch in $(seq $((START_CH - 5)) $((START_CH - 1))); do
  cat "$PROJECT_ROOT/.webnovel/summaries/ch$(printf '%04d' $ch).md" 2>/dev/null
done

# 核心角色当前状态 / 核心关系当前状态 / 活跃伏笔（跨卷未回收）
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" knowledge query-entity-state --entity "{protagonist_id}" --at-chapter {上一卷最后章}
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" knowledge query-relationships --entity "{protagonist_id}" --at-chapter {上一卷最后章}
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" memory-contract get-open-loops
```

### Step 2：补齐设定基线

让设定集从骨架进入"可规划、可写作"。增量补齐，不清空、不重写整文件；发现冲突先列出并阻断。

- `设定集/世界观.md`：世界边界、社会结构、关键地点用途。
- `设定集/力量体系.md`：境界链、限制、代价与冷却。
- `设定集/主角卡.md`：欲望、缺陷、初始资源与限制。
- `设定集/反派设计.md`：小/中/大反派层级与镜像关系。

### Step 3：选择目标卷并确认范围

确认卷名、章节范围、核心冲突，以及是否有特殊要求（视角、情感线、题材偏移）。

### Step 4：生成卷节拍表

加载模板 `${SKILL_ROOT}/../../templates/output/大纲-卷节拍表.md`。

硬要求：必须填写中段反转，确无则写"无（理由：...）"；危机链至少 3 次递增；卷末新钩子必须能落到最后一章的章末未闭合问题。

输出文件：`大纲/第{volume_id}卷-节拍表.md`

### Step 5：生成卷时间线表

加载模板 `${SKILL_ROOT}/../../templates/output/大纲-卷时间线.md`。

硬要求：必须明确时间体系与本卷时间跨度；有倒计时事件时列出并标记 D-N。

输出文件：`大纲/第{volume_id}卷-时间线.md`

### Step 6：生成卷纲骨架

必读 `${SKILL_ROOT}/../../references/genre-profiles.md` 与 `${SKILL_ROOT}/../../references/shared/strand-weave-pattern.md`；按需读取爽点 / 冲突 / 节奏 reference（见读取策略表）。

卷纲必须明确：卷摘要、关键人物与反派层级、Strand 分布、爽点密度规划、伏笔规划、约束触发规划。

跨卷一致性检查（非首卷必须执行）：

- 上一卷未回收的伏笔必须出现在新卷伏笔规划中（继续推进或标记回收）。
- 角色关系变化必须延续，不能当上一卷没发生过。
- 主角能力 / 境界必须承接，不回退也不跳级（除非有剧情解释）。

### Step 7：批量生成章纲

批次规则：默认 `10章/批`；复杂题材或多线并进降到 `8章/批`；简单升级流放宽到 `12章/批`；不建议单批超过 `12章`。

按需读取 `${SKILL_ROOT}/../../references/reading-power-taxonomy.md` 与 `${SKILL_ROOT}/references/outlining/chapter-planning.md`。

每章必须包含：目标、阻力、代价、时间锚点、章内时间跨度、与上章时间差、倒计时状态、爽点、Strand、反派层级、视角/主角、关键实体、本章变化、章末未闭合问题、钩子，以及结构化节点 `CBN`、`CPNs`、`CEN`、`必须覆盖节点`、`本章禁区`。

#### 结构化节点

节点格式统一为 `主体 | 动作/变化 | 对象/结果`（写作执行骨架，不追求严格语法 SVO）。完整格式说明、字段细则与示例见 `${SKILL_ROOT}/references/outlining/chapter-planning.md` 的「结构化节点规范」，按需区段读，不在本文件内联。

核心约束：

- 每章固定 1 个 `CBN`、`2-4 个 CPN`、固定 1 个 `CEN`；`CPNs` 按时间顺序排列。
- 相邻章节 `CEN -> 下一章 CBN` 必须逻辑承接（首章和末章除外）。
- `必须覆盖节点`最多 4 个，建议 `CBN + CEN + 1~2 个核心 CPN`；可选节点只作建议，不作 fail 主依据。
- `本章禁区`不超过 5 条，只写本章绝对不能发生的硬禁区，不写风格类建议。
- 向后兼容：旧项目章纲缺失上述字段时，下游流程正常执行，仅跳过结构化检查。

输出文件：`大纲/第{volume_id}卷-详细大纲.md`

### Step 8：把新增设定写回现有设定集

输入：卷节拍表、卷时间线表、卷详细大纲、现有设定集文件。

写回规则：只增量补充相关段落；新角色写入角色卡或角色组；新势力 / 地点 / 规则写入世界观或力量体系；新反派层级写入反派设计。

硬规则：若发现与总纲或既有设定冲突，标记 `BLOCKER` 并停止后续更新。

### Step 9：验证、保存并更新状态

必须通过：节拍表 / 时间线表 / 详细大纲均存在且非空；每章时间字段齐全；时间线单调递增；倒计时推进正确；新设定已回写；`BLOCKER=0`；有节点时相邻章节 `CEN -> CBN` 无明显逻辑冲突且每章`必须覆盖节点`不超过 4 个。

验证全部通过后，生成显式结构化写回文件 `大纲/第{volume_id}卷-总纲写回.json`（只写规划中显式列出的伏笔 / 开放环，禁止从卷纲自由文本推断）：

```json
{
  "next_volume_anchor": {
    "volume": 2,
    "volume_name": "下一卷卷名",
    "core_conflict": "下一卷核心冲突",
    "volume_end_climax": "下一卷卷末高潮"
  },
  "foreshadow_writeback": [
    {"content": "本卷规划明确新增的伏笔", "buried_chapter": "第10章", "payoff_chapter": "", "level": "卷级"}
  ],
  "open_loop_writeback": [
    {"content": "本卷结束后仍持续开放的问题", "buried_chapter": "", "payoff_chapter": "", "level": "持续开放环"}
  ]
}
```

执行最小总纲写回（只更新 `大纲/总纲.md` 的 V+1 卷名 / 核心冲突 / 卷末高潮与伏笔表，不生成下一卷详细大纲 / 节拍表 / 时间线 / 章纲）：

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" master-outline-sync \
  --volume {volume_id} \
  --writeback-file "大纲/第{volume_id}卷-总纲写回.json" \
  --format text
```

更新状态：

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" update-state -- \
  --volume-planned {volume_id} \
  --chapters-range "{start}-{end}"
```

### Step 10：刷新 Story System 写作合同（本次规划已落到具体章节时必须执行）

genre 从 `state.json` 初始化配置快照读取；写前主链真源是 `.story-system/` 合同树。必须先从详细大纲解析真实 `CHAPTER_GOAL`，禁止传 `{章纲目标}` / `第N章章纲目标` 这类占位文本。

```bash
GENRE="$(python -X utf8 -c "import json; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); pi=s.get('project_info',{}); print(pi.get('genre') or s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" story-system "${CHAPTER_GOAL}" \
  --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

生成后必须把 `.story-system/MASTER_SETTING.json`、`.story-system/volumes/`、`.story-system/chapters/`、`.story-system/reviews/` 视为后续写作主链输入。进入写章前不得保留当前章相关实体的 `[待...]` / `暂名` / `{占位}`。

## 硬失败条件

- 节拍表 / 时间线表 / 详细大纲不存在或为空。
- 中段反转缺失且未给出理由。
- 任一章节缺少时间字段；时间回跳且未标注闪回；倒计时算术冲突。
- 与总纲核心冲突或卷末高潮明显冲突。
- 存在 `BLOCKER` 未裁决。

## 恢复规则

1. 只重做失败批次，不覆盖整卷文件。
2. 最后一个批次无效时，只删除并重写该批次。
3. 仅在全部验证通过后更新状态。

## 作者友好最终报告契约

最终回复必须面向作者，不输出原始 JSON、traceback 或长命令日志。使用固定三段式，并以一句总状态开头：

```text
总状态：已完成 / 部分完成 / 需要你处理 / 未完成。

一、产生的文件与完成情况
- ...

二、过程中遇到的问题与异常耗时
- 已自动处理：...
- 建议确认：...
- 必须处理：...

三、下一步建议
- ...
```

必须汇报：
- `大纲/第{volume_id}卷-节拍表.md`。
- `大纲/第{volume_id}卷-时间线.md`。
- `大纲/第{volume_id}卷-详细大纲.md`。
- 新增设定写回了哪些设定集文件。
- `大纲/第{volume_id}卷-总纲写回.json`。
- `master-outline-sync`、`update-state`、Story System 合同刷新是否完成。
- 占位符、时间线、节点承接是否通过。

异常分类：
- 已自动处理：只重做失败批次、补齐非阻断占位、重跑合同刷新。
- 建议确认：新增角色名、势力名、卷末钩子需要作者看一眼。
- 必须处理：总纲 / 设定冲突、时间线回跳、`BLOCKER` 未裁决、当前章相关占位残留。

下一步建议必须使用任务化语言 + 可复制命令，例如：

```text
- 接下来可以写第一章：
  /webnovel-write 1
```

不写 token 统计；如需排查故障，只给日志路径或建议运行 `/webnovel-doctor`。
