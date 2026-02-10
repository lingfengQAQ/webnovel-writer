---
name: webnovel-init
description: Initializes a new webnovel project in deep mode, collecting full story/world/character/constraint data and generating all pre-writing files. Use when starting a new novel or running /webnovel-init.
---

# Project Initialization (Deep only)

Goal: create a writing-ready project skeleton + creative constraints. No Quick/Standard mode.

## Workflow
1. Ask for deep setup info (story, character, world, golden finger, constraints).
2. Run init_project.py with full parameters.
3. Write idea_bank.json.
4. Patch 总纲.md with the collected core info.
5. Verify files.

## Reference Loading Levels (strict, lazy)

Apply progressive disclosure:
- L0: Load nothing extra until task type is confirmed.
- L1: Load only the minimum file needed for the current wave.
- L2: Load conditional files only when the user choice requires them.
- L3: Load optional/time-sensitive files only on explicit user request.

Do not recursively chase references inside a reference file unless blocked.

Path conventions:
- `references/...` → relative to this skill directory (i.e. `.claude/skills/webnovel-init/references/...`)
- `@templates/...` → relative to `.claude/templates/...` (project-level shared templates)

### L1 (minimum, wave-gated)
- Before Wave 1: `references/genre-tropes.md`

### L2 (conditional)
- After genre selection: `@templates/genres/{genre}.md` (only for selected genres in A+B)
- Before Wave 3 (golden finger): `@templates/golden-finger-templates.md`
- Before Wave 4 (world): `references/worldbuilding/faction-systems.md`
- Before Wave 4 (constraints):
  - `references/creativity/creativity-constraints.md`
  - `references/creativity/anti-trope-xianxia.md` (修仙/玄幻/高武/西幻)
  - `references/creativity/anti-trope-rules-mystery.md` (规则/悬疑/灵异)

### L3 (optional, explicit only)
- `references/creativity/market-trends-2026.md`
- If used, explicitly mark it as time-sensitive and verify freshness before relying on it.

## Questioning style
- Ask in 3–4 conversational waves; avoid rigid templates.
- Ask only missing info; confirm before generation.
- Offer options only when the user is stuck.

### Suggested grouping (flexible)
**Wave 1**: 书名 + 题材 + 目标规模 + 一句话故事
**Wave 2**: 主角（姓名/欲望/缺陷/结构） + 感情线 + 反派分层
**Wave 3**: 金手指（类型/名称/风格/可见度/代价） + 条件追问
**Wave 4**: 世界观（规模/力量/势力/阶层/境界） + 创意约束确认

Adjust order based on user's initial input. If user provides detailed info upfront, skip to missing items.

## Required data (collect and map)
Order is flexible; group by theme.

### A) Project scale & premise
- 书名
- 题材（支持 A+B）
  - 玄幻修仙类: 修仙 | 系统流 | 高武 | 西幻 | 无限流 | 末世 | 科幻
  - 都市现代类: 都市异能 | 都市日常 | 都市脑洞 | 现实题材 | 黑暗题材 | 电竞 | 直播文
  - 言情类: 古言 | 宫斗宅斗 | 青春甜宠 | 豪门总裁 | 职场婚恋 | 民国言情 | 幻想言情 | 现言脑洞 | 女频悬疑 | 狗血言情 | 替身文 | 多子多福 | 种田 | 年代
  - 特殊题材: 规则怪谈 | 悬疑脑洞 | 悬疑灵异 | 历史古代 | 历史脑洞 | 游戏体育 | 抗战谍战 | 知乎短篇 | 克苏鲁
- 目标规模：总字数或总章数（若只给总字数，默认按每章 3500 估算并告知）
- 一句话故事 + 核心冲突 + 主线目标
- 目标读者/平台（可一句话描述）

### B) 主角与阵营
- 主角姓名、人设类型、核心欲望、关键缺陷
- 主角结构（单/多主角）+ 多主角姓名与定位
- 感情线：无/单女主/多女主；女主姓名与定位
- 反派分层（小/中/大）+ 反派镜像一句话 + 反派等级（若有）

### C) 金手指
- 类型、名称/系统名、风格
  - 常见类型: 系统面板 | 重生记忆 | 老爷爷/传承 | 血脉觉醒 | 异能觉醒 | 随身空间 | 无金手指
- 读者可见度、不可逆代价、成长节奏
- 条件追问（根据类型）：
  - 系统面板 → 系统性格、系统命名、升级节奏
  - 重生记忆 → 重生时间点、记忆完整度、先知程度
  - 老爷爷/传承 → 器灵性格、器灵实力、辅助方式
  - 随身空间 → 空间大小、特殊功能、升级方式
  - 血脉觉醒 → 血脉来源、觉醒条件、能力限制
  - 异能觉醒 → 异能来源、异能上限、是否可进化
  - 无金手指 → 主角天赋、特殊机遇、成长路线

### D) 世界观与力量
- 世界规模、势力格局、力量体系类型
- 社会阶层、资源分配
- 货币体系 + 兑换规则
- 宗门/组织层级
- 境界链 + 小境界划分（如适用）

### E) 创意约束
**Generation flow**:
1. Load anti-trope library based on genre (xianxia or rules-mystery)
2. Generate 2-3 creative packages, each containing:
   - 书名变体（可选）
   - 一句话卖点
   - 反套路规则（从库中选 1 条）
   - 主角缺陷（驱动故事）
   - 反派镜像设计（一句话）
   - 开篇钩子
   - 硬约束 2–3 条
3. Apply 三问筛选:
   - Q1: 这题材为什么"只能这样写"？
   - Q2: 这主角如果换成常规人设会崩吗？
   - Q3: 这个卖点一句话能讲清、且不撞常见套路吗？
4. Score each package (满分 50):
   - 新颖度 25% | 市场性 20% | 可写性 20% | 爽点密度 20% | 长线潜力 15%
5. Present packages to user for selection

**Collected data**:
- 反套路规则（从对应库选 1 条）
- 硬约束 2–3 条
- 主角缺陷如何驱动故事（一句话）
- 反派镜像如何体现（一句话）
- 开篇钩子 + 核心卖点 1–3 条

## Generate project

### Sufficiency check (must pass before running init)
Hard requirement: do not run init_project.py until all items below are known or explicitly deferred by the user.
- 书名、题材（含复合题材）
- 目标规模（总字数或总章数）
- 主角姓名 + 欲望 + 缺陷
- 世界规模 + 力量体系类型
- 金手指类型（可为“无金手指”）
- 反套路规则 + 硬约束（若用户拒绝创意约束，必须明确记录）

If any is missing, stop and ask only for the missing items.

### Project directory
- project_root = 书名安全化（去非法字符，空格转 `-`；为空或以 `.` 开头则前缀 `proj-`）
- 禁止在 `.claude/` 下生成

### Run init script
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/init_project.py" \
  "{project_root}" \
  "{title}" \
  "{genre}" \
  --protagonist-name "{protagonist_name}" \
  --target-words {target_words} \
  --target-chapters {target_chapters} \
  --golden-finger-name "{gf_name}" \
  --golden-finger-type "{gf_type}" \
  --golden-finger-style "{gf_style}" \
  --core-selling-points "{core_points}" \
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
  --gf-visibility "{gf_visibility}" \
  --gf-irreversible-cost "{gf_irreversible_cost}" \
  --currency-system "{currency_system}" \
  --currency-exchange "{currency_exchange}" \
  --sect-hierarchy "{sect_hierarchy}" \
  --cultivation-chain "{cultivation_chain}" \
  --cultivation-subtiers "{cultivation_subtiers}" \
  --protagonist-desire "{protagonist_desire}" \
  --protagonist-flaw "{protagonist_flaw}" \
  --protagonist-archetype "{protagonist_archetype}" \
  --antagonist-level "{antagonist_level}" \
  --target-reader "{target_reader}" \
  --platform "{platform}"
```

### Write idea_bank.json
Create `.webnovel/idea_bank.json` with the selected idea and inherited constraints.

```json
{
  "selected_idea": {
    "title": "",
    "one_liner": "",
    "anti_trope": "",
    "hard_constraints": []
  },
  "constraints_inherited": {
    "anti_trope": "",
    "hard_constraints": [],
    "protagonist_flaw": "",
    "antagonist_mirror": ""
  }
}
```

### Patch 总纲.md
After init, fill these fields in `大纲/总纲.md` using collected info:
- 故事一句话 / 核心主线 / 核心暗线
- 创意约束（反套路规则 / 硬约束 / 主角缺陷 / 反派镜像）
- 反派分层概要
- 关键爽点里程碑（2–3 条）

### Verify
```bash
Get-Item "{project_root}/.webnovel/state.json"
Get-ChildItem "{project_root}/设定集" -Filter *.md
Get-Item "{project_root}/大纲/总纲.md"
```

### Final check
- `.webnovel/state.json` 存在且包含 title/genre/target_words/target_chapters
- `设定集/世界观.md`、`力量体系.md`、`主角卡.md`、`金手指设计.md` 已生成
- `大纲/总纲.md` 已填：一句话故事 / 核心主线 / 创意约束 / 反派分层
- `.webnovel/idea_bank.json` 已写入（有创意约束时）

### Hard fail conditions (must stop)
- 任一关键文件不存在（state.json / 总纲.md / 设定集主文件）
- 总纲关键字段为空（故事一句话 / 核心主线 / 创意约束 / 反派分层）
- idea_bank.json 需要但未生成（当创意约束被启用时）

### Rollback / recovery
If any hard fail triggers:
1. Stop and report missing items.
2. Ask only for missing info.
3. Re-run the minimal step needed:
   - Missing files → re-run init_project.py.
   - 总纲缺字段 → patch 总纲.md only.
   - idea_bank.json 缺失 → write it only.
4. Re-run Final check. Do not proceed to /webnovel-plan until passing.
