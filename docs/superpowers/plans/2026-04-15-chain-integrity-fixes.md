# Init→Plan→Write 链路完整性修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 init→plan→write→plan→write 全链路中 7 个使用者视角的断裂问题，确保题材从 init 到裁决层的流通、story-system 在正确时机触发、plan 跨卷时能感知已写内容。

**Architecture:** 围绕"题材是 init 写入 state.json 的唯一真源"这个核心决策，从数据层（CSV 别名补齐）到流程层（SKILL.md 规范化）逐步修复。

**Tech Stack:** CSV (UTF-8 BOM), Python CLI, Markdown prompt files

**已确认决策：**
1. 题材在 init 阶段写入 state.json，后续所有环节从此读取，不再允许 free-text query 决定路由
2. CSV 检索结果是创作参考，大纲/章纲是最高权重（仅次于用户意见）
3. chapter_brief.json 只承载裁决/路由元数据，不伪装成章级内容合同
4. rejected chapter 不阻断下一章，交由用户决断
5. plan 写卷依据：大纲 + 用户意见 + 已有剧情状态 + CSV 检索

---

## Task 1: 裁决表补齐 init 题材别名

**问题：** init 支持的题材名（修仙、系统流、高武、西幻等）与裁决表的题材名（东方仙侠、西方奇幻等）不匹配，导致裁决层对部分题材不生效。

**Files:**
- Modify: `webnovel-writer/references/csv/裁决规则.csv`
- Modify: `webnovel-writer/references/csv/题材与调性推理.csv`

- [ ] **Step 1: 建立 init 题材 → 裁决题材的映射**

init SKILL.md 第 110-113 行列出的题材集合：

```
玄幻修仙类：修仙 | 系统流 | 高武 | 西幻 | 无限流 | 末世 | 科幻
都市现代类：都市异能 | 都市日常 | 都市脑洞 | 现实题材 | 黑暗题材 | 电竞 | 直播文
言情类：古言 | 宫斗宅斗 | 青春甜宠 | 豪门总裁 | ...
特殊题材：规则怪谈 | 悬疑脑洞 | 悬疑灵异 | 历史古代 | 历史脑洞 | ...
```

映射到现有 7 个裁决题材：

| init 题材名 | → 裁决题材 |
|------------|-----------|
| 修仙、仙侠 | 东方仙侠 |
| 西幻、西方奇幻 | 西方奇幻 |
| 末世、科幻 | 科幻末世 |
| 都市异能、都市脑洞、现实题材 | 都市日常 |
| 都市修真、现代修真 | 都市修真 |
| 高武、都市异能（高武向） | 都市高武 |
| 历史古代、历史脑洞 | 历史古代 |
| 系统流、无限流 | 东方仙侠（fallback，多为修仙变体） |

不在映射中的（言情类、规则怪谈、悬疑等）暂无裁决行，走空裁决 fallback。

- [ ] **Step 2: 在裁决规则.csv 的关键词列补齐别名**

每行的「关键词」列追加 init 题材名：

| 裁决题材 | 当前关键词 | 追加 |
|---------|-----------|------|
| 西方奇幻 | `西方奇幻\|奇幻` | `\|西幻` |
| 东方仙侠 | `东方仙侠\|仙侠` | `\|修仙\|系统流\|无限流` |
| 科幻末世 | `科幻末世\|末世\|科幻` | （已覆盖） |
| 都市日常 | `都市日常\|都市` | `\|都市脑洞\|现实题材\|黑暗题材` |
| 都市修真 | `都市修真\|修真\|现代修真` | （已覆盖） |
| 都市高武 | `都市高武\|高武\|都市异能` | （已覆盖） |
| 历史古代 | `历史古代\|历史\|古代` | `\|历史脑洞` |

编辑 CSV 文件，在对应行的「关键词」列追加。

- [ ] **Step 3: 同步更新路由表的别名覆盖**

路由表 `题材与调性推理.csv` 当前 8 行是流派（退婚流、规则怪谈等），不是题材大类。**不改现有行**。

但路由表目前缺少"东方仙侠""西方奇幻""科幻末世"等大类的路由行。当用户 genre 是"修仙"时，路由表的 `_route()` 可能匹配不上任何行（因为现有行都是具体流派）。

需要确认：路由表是否需要补"大类"行？检查 `_route()` 的 fallback 逻辑——如果匹配不上，用 `--genre` 参数做 `explicit_genre_fallback`，走默认推荐表。这个 fallback 够用。

结论：**路由表不改**。裁决表补别名即可。路由匹配不上时 fallback 到默认推荐表 + 裁决表仍能通过 `_load_reasoning(genre)` 匹配到。

- [ ] **Step 4: 运行测试确认**

```bash
cd "D:\wk\novel skill\webnovel-writer\webnovel-writer" && python -m pytest scripts/data_modules/tests/test_csv_config.py scripts/data_modules/tests/test_reasoning_engine.py -v --tb=short
```

- [ ] **Step 5: Commit**

```bash
cd "D:\wk\novel skill\webnovel-writer" && git add webnovel-writer/references/csv/裁决规则.csv && git commit -m "fix: expand reasoning table genre aliases to cover init genre names"
```

---

## Task 2: 规范 story-system 的 genre 输入为 state.json 唯一真源

**问题：** write SKILL.md 调 `story-system "{chapter_goal}"` 时 `{chapter_goal}` 来源不明，导致路由质量不可控。

**决策：** genre 从 state.json 读取，作为唯一真源。query 参数改为章纲目标（用于 CSV 检索），genre 参数固定从 state.json 取。

**Files:**
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md`
- Modify: `webnovel-writer/skills/webnovel-plan/SKILL.md`

- [ ] **Step 1: 修改 write SKILL.md 准备阶段的 story-system 调用**

当前（第 141-143 行）：
```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" \
  story-system "{chapter_goal}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

改为：
```bash
# 从 state.json 读取题材（唯一真源）
GENRE="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" state get-field --field project.genre)"

# 从章纲提取本章目标作为检索 query（若无章纲则用题材兜底）
CHAPTER_GOAL="{从章纲提取的本章目标，如'韩立进入坊市试探消息真伪'}"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" \
  story-system "${CHAPTER_GOAL}" --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

在这段命令前加说明：
```markdown
**genre 参数规范**：
- `--genre` 必须从 `state.json` 的 `project.genre` 读取，不得手动填写
- 第一个位置参数（query）填本章章纲的"目标"字段内容，用于 CSV 知识检索
- 若章纲无明确目标，fallback 到 `"{题材} 第{chapter_num}章"`
```

- [ ] **Step 2: 修改 plan SKILL.md 的 story-system 调用**

当前（第 59-61 行）：
```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" \
  story-system "{chapter_goal}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

同样改为带 `--genre` 的规范形式。

- [ ] **Step 3: 确认 `state get-field` CLI 命令存在**

```bash
grep -n "get-field" webnovel-writer/scripts/data_modules/webnovel.py
```

如果不存在，需要补一个简单的 state 子命令来读取任意 JSON path。或者用 jq/python 一行脚本替代：

```bash
GENRE="$(python -X utf8 -c "import json; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json')); print(s.get('project',{}).get('genre',''))")"
```

- [ ] **Step 4: Commit**

```bash
git add webnovel-writer/skills/webnovel-write/SKILL.md webnovel-writer/skills/webnovel-plan/SKILL.md
git commit -m "fix: standardize story-system genre input from state.json as sole source"
```

---

## Task 3: init 完成后触发 story-system 生成 MASTER_SETTING

**问题：** init 完成后 `.story-system/` 目录不存在，plan 的卷级规划阶段缺少调性/禁忌参照。

**Files:**
- Modify: `webnovel-writer/skills/webnovel-init/SKILL.md`

- [ ] **Step 1: 在 init SKILL.md 的"执行生成"段落末尾追加 story-system 触发**

在"3) Patch 总纲"之后、"验证与交付"之前，新增：

```markdown
### 4) 生成写前合同树（Story System 初始化）

init 完成后，立即生成 MASTER_SETTING，让后续 plan 有调性/禁忌参照：

```bash
GENRE="$(python -X utf8 -c "import json; s=json.load(open('{project_root}/.webnovel/state.json')); print(s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" \
  story-system "${GENRE}" --genre "${GENRE}" --persist --format json
```

说明：
- 此时不传 `--chapter`，只生成 `MASTER_SETTING.json` 和 `anti_patterns.json`
- 不传 `--emit-runtime-contracts`（还没有卷/章级数据）
- plan 阶段拆到具体章节时再生成 volume/chapter/review 合同
```

- [ ] **Step 2: 更新 init 的验证与交付段落**

在验证检查中新增：
```bash
test -f "{project_root}/.story-system/MASTER_SETTING.json"
```

在成功标准中新增：
- `.story-system/MASTER_SETTING.json` 存在且 `route.primary_genre` 非空

- [ ] **Step 3: Commit**

```bash
git add webnovel-writer/skills/webnovel-init/SKILL.md
git commit -m "feat: init triggers story-system to generate MASTER_SETTING after project creation"
```

---

## Task 4: 明确 chapter_brief 只承载裁决元数据

**问题：** `chapter_brief.json` 的 `chapter_focus` 是从 CSV 检索结果凑的，跟实际章纲无关，误导 context-agent。

**决策：** chapter_brief 只承载裁决/路由元数据。章纲是最高权重（仅次于用户意见），由 context-agent 直接读取。

**Files:**
- Modify: `webnovel-writer/agents/context-agent.md`
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md`

- [ ] **Step 1: 在 context-agent.md 的"Story System 主链"段落明确权重**

在写前真源列表后新增权重说明：

```markdown
**数据权重（高→低）**：
1. 用户明确要求
2. 大纲/章纲原文（`大纲/第X卷-详细大纲.md` 中的本章内容）
3. Story Contracts 中的 `MASTER_SETTING`（题材、调性、核心禁忌）
4. `chapter_{NNN}.json` 的 `reasoning` 字段（裁决层的风格/节奏/毒点建议）
5. accepted `CHAPTER_COMMIT`（写后事实）
6. CSV 检索结果（创作参考，不覆盖大纲）

`chapter_{NNN}.json` 的 `chapter_focus` 字段仅为 CSV 检索派生的参考，不代表本章实际目标。本章目标以章纲原文为准。
```

- [ ] **Step 2: 在 write SKILL.md 的"合同树必备文件"段落补充说明**

在第 146-148 行的合同树说明后加：

```markdown
**注意**：`.story-system/chapters/chapter_{NNN}.json` 的 `chapter_focus` 是 CSV 检索派生的参考建议，不是本章的实际目标。本章目标以 `大纲/第X卷-详细大纲.md` 中的章纲原文为最高权重。`chapter_{NNN}.json` 的核心价值是 `reasoning` 字段中的裁决元数据（风格优先级、节奏策略、反模式）。
```

- [ ] **Step 3: Commit**

```bash
git add webnovel-writer/agents/context-agent.md webnovel-writer/skills/webnovel-write/SKILL.md
git commit -m "docs: clarify chapter_brief carries reasoning metadata, outline is authority"
```

---

## Task 5: plan 跨卷时读取已写内容

**问题：** plan 第2卷时不读 commit 历史、summaries、实体状态，导致章纲可能与已写内容矛盾。

**决策：** plan 步骤 1 加载大纲 + 用户意见 + 已有剧情状态 + CSV 检索。

**Files:**
- Modify: `webnovel-writer/skills/webnovel-plan/SKILL.md`

- [ ] **Step 1: 扩展 plan Step 1 的数据加载**

当前 Step 1（第 97-113 行）只读 state.json 和总纲。改为：

```markdown
### Step 1：加载项目数据并确认前置条件

**必须加载**：

```bash
# 项目状态与题材
cat "$PROJECT_ROOT/.webnovel/state.json"

# 总纲（全局蓝图）
cat "$PROJECT_ROOT/大纲/总纲.md"
```

**已有卷的剧情状态**（跨卷规划时必须加载）：

若已有已完成卷（`.webnovel/summaries/` 下有文件），加载以下数据感知已写内容：

```bash
# 最近 5 章摘要（了解剧情走向）
for ch in $(seq $((START_CH - 5)) $((START_CH - 1))); do
  cat "$PROJECT_ROOT/.webnovel/summaries/ch$(printf '%04d' $ch).md" 2>/dev/null
done

# 核心角色当前状态（知道主角走到哪了）
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  knowledge query-entity-state --entity "{protagonist_id}" --at-chapter {上一卷最后章}

# 核心关系当前状态
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  knowledge query-relationships --entity "{protagonist_id}" --at-chapter {上一卷最后章}

# 活跃伏笔（跨卷未回收的伏笔）
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  memory-contract get-open-loops
```

**CSV 创作参考**（卷级规划时按需检索）：

```bash
# 本卷题材相关的节奏和桥段参考
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 爽点与节奏 --query "{卷级核心冲突}" --genre "${GENRE}"
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill plan --table 桥段套路 --query "{卷级核心冲突}" --genre "${GENRE}"
```
```

按需读取（保持不变）：
- `设定集/世界观.md`
- `设定集/力量体系.md`
- `设定集/主角卡.md`
- `设定集/反派设计.md`
- `.webnovel/idea_bank.json`

- [ ] **Step 2: 在 plan Step 6（卷纲骨架）加入已写状态参照**

在 Step 6 的"卷纲必须明确"列表后新增：

```markdown
跨卷一致性检查：
- 上一卷未回收的伏笔必须出现在新卷的伏笔规划中（继续推进或标记回收）
- 角色关系变化必须延续（不能当上一卷没发生过）
- 主角能力/境界必须承接（不能回退也不能跳级，除非有剧情解释）
```

- [ ] **Step 3: Commit**

```bash
git add webnovel-writer/skills/webnovel-plan/SKILL.md
git commit -m "feat: plan reads write history for cross-volume awareness"
```

---

## Task 6: 运行测试 + 最终验证

**Files:** (read-only verification)

- [ ] **Step 1: 运行全量 prompt integrity 测试**

```bash
cd "D:\wk\novel skill\webnovel-writer\webnovel-writer" && python -m pytest scripts/data_modules/tests/test_prompt_integrity.py -v --tb=short
```

- [ ] **Step 2: 运行 CSV 配置对齐测试**

```bash
cd "D:\wk\novel skill\webnovel-writer\webnovel-writer" && python -m pytest scripts/data_modules/tests/test_csv_config.py -v --tb=short
```

- [ ] **Step 3: 验证裁决表别名覆盖**

```bash
python3 -c "
import csv
from pathlib import Path
path = Path('webnovel-writer/references/csv/裁决规则.csv')
with open(path, 'r', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        genre = row['题材']
        keywords = row['关键词']
        print(f'{genre}: {keywords}')
"
```

确认"修仙""西幻""系统流""都市脑洞""历史脑洞"等 init 题材名都出现在对应行的关键词中。

- [ ] **Step 4: 手动走一遍 init→write 关键路径**

模拟检查：
1. init 设 genre="修仙" → state.json.project.genre="修仙"
2. init 触发 story-system "修仙" --genre "修仙" → MASTER_SETTING.json 生成
3. write 读 state.json 的 genre → 传 --genre "修仙" 给 story-system
4. story-system `_route()` 匹配"修仙" → 路由表 fallback（无精确匹配，但有 explicit_genre_fallback）
5. story-system `_load_reasoning("修仙")` → 裁决表匹配到"东方仙侠"行（通过别名"修仙"）
6. 裁决层生效 → chapter_brief.reasoning 有值

确认这条路径不断裂。

- [ ] **Step 5: Commit final**

```bash
git add -A && git commit -m "chore: final verification for chain integrity fixes"
```
