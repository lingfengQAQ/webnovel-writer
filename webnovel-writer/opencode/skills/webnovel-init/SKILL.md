---
name: webnovel-init
description: 深度初始化网文项目。通过分阶段交互收集完整创作信息，生成可直接进入规划与写作的项目骨架与约束文件。
tools: Read Write Edit Grep Bash Task AskUserQuestion WebSearch WebFetch
---

# Project Initialization (Deep Mode v2)

## 目标

- 通过结构化交互收集足够信息，避免“先生成再返工”。
- 产出可落地项目骨架：`.webnovel/state.json`、`设定集/*`、`大纲/总纲.md`、`.webnovel/idea_bank.json`。
- 保证后续 `/webnovel-plan` 与 `/webnovel-write` 可直接运行。

## 执行原则

1. 先收集，再生成；未过充分性闸门，不执行 `init_project.py`。
2. 分波次提问，每轮只问“当前缺失且会阻塞下一步”的信息。
3. 允许调用 `Read/Grep/Bash/Task/AskUserQuestion/WebSearch/WebFetch` 辅助收集。
4. 用户已明确的信息不重复问；冲突信息优先让用户裁决。
5. Deep 模式优先完整性，允许慢一点，但禁止漏关键字段。

## 引用加载等级（strict, lazy）

采用分级加载，避免一次性灌入全部资料：

- L0：未确认任务前，不预加载参考。
- L1：每个阶段仅加载该阶段“必读”文件。
- L2：仅在题材、金手指、创意约束触发条件满足时加载扩展参考。
- L3：市场趋势类、时效类资料仅在用户明确要求时加载。

路径约定：
- `references/...` 相对当前 skill 目录（`${OPENCODE_PLUGIN_ROOT}/skills/webnovel-init/references/...`）。
- `templates/...` 相对插件根目录（`${OPENCODE_PLUGIN_ROOT}/templates/...`）。

默认加载清单：
- L1（启动前）：`references/genre-tropes.md`
- L2（按需）：
  - 题材模板：`templates/genres/{genre}.md`
  - 金手指：`../../templates/golden-finger-templates.md`
  - 世界观：`references/worldbuilding/faction-systems.md`
  - 创意约束：按下方“逐文件引用清单”触发加载
- L3（显式请求）：
  - `references/creativity/market-trends-2026.md`

## References（逐文件引用清单）

### 根目录

- `references/genre-tropes.md`
  - 用途：Step 1 题材归一化、题材特征提示。
  - 触发：所有项目必读。
- `references/system-data-flow.md`
  - 用途：初始化产物与后续 `/plan`、`/write` 的数据流一致性检查。
  - 触发：Step 0 预检必读。

### worldbuilding

- `references/worldbuilding/character-design.md`
  - 用途：Step 2 角色维度补问（目标、缺陷、动机、反差）。
  - 触发：用户人物信息抽象或扁平时加载。
- `references/worldbuilding/faction-systems.md`
  - 用途：Step 4 势力格局与组织层级设计。
  - 触发：Step 4 默认加载。
- `references/worldbuilding/power-systems.md`
  - 用途：Step 4 力量体系类型与边界定义。
  - 触发：涉及修仙/玄幻/高武/异能时加载。
- `references/worldbuilding/setting-consistency.md`
  - 用途：Step 6 一致性复述前做设定冲突检查。
  - 触发：Step 6 默认加载。
- `references/worldbuilding/world-rules.md`
  - 用途：Step 4 世界规则与禁忌项收束。
  - 触发：Step 4 默认加载。

### creativity

- `references/creativity/creativity-constraints.md`
  - 用途：Step 5 创意约束包主 schema。
  - 触发：Step 5 必读。
- `references/creativity/category-constraint-packs.md`
  - 用途：Step 5 按平台/题材选择约束包模板。
  - 触发：Step 5 必读。
- `references/creativity/creative-combination.md`
  - 用途：复合题材（A+B）融合规则。
  - 触发：用户选择复合题材时加载。
- `references/creativity/inspiration-collection.md`
  - 用途：用户卡住时提供卖点/钩子候选。
  - 触发：Step 1 或 Step 5 卡顿时加载。
- `references/creativity/selling-points.md`
  - 用途：Step 5 卖点生成与筛选。
  - 触发：Step 5 必读。
- `references/creativity/market-positioning.md`
  - 用途：目标读者/平台定位与商业化语义统一。
  - 触发：Step 1 用户提及平台或商业目标时加载。
- `references/creativity/market-trends-2026.md`
  - 用途：时间敏感市场趋势参考。
  - 触发：仅用户明确要求“参考当下趋势”时加载。
- `references/creativity/anti-trope-xianxia.md`
  - 用途：反套路库（修仙/玄幻/高武/西幻）。
  - 触发：题材命中对应映射时加载。
- `references/creativity/anti-trope-urban.md`
  - 用途：反套路库（都市/历史）。
  - 触发：题材命中对应映射时加载。
- `references/creativity/anti-trope-game.md`
  - 用途：反套路库（游戏/科幻/末世）。
  - 触发：题材命中对应映射时加载。
- `references/creativity/anti-trope-rules-mystery.md`
  - 用途：反套路库（规则/悬疑/灵异/克苏鲁）。
  - 触发：题材命中对应映射时加载。

## 工具策略（按需）

- `Read/Grep`：读取项目上下文与参考文件（`README.md`、`CLAUDE.md`、`templates/genres/*`、`references/*`）。
- `Bash`：执行 `init_project.py`、文件存在性检查、最小验证命令。
- `Task`：拆分并行子任务（如题材映射、约束包候选生成、文件验证）。
- `AskUserQuestion`：用于关键分歧裁决、候选方案选择、最终确认。
- `WebSearch`：用于检索最新市场趋势、平台风向、题材数据（可带域名过滤）。
- `WebFetch`：用于抓取已确定来源页面内容并做事实核验。
- 外部检索触发条件：
  - 用户明确要求参考市场趋势或平台风向；
  - 创意约束需要“时间敏感依据”；
  - 对题材信息存在明显不确定。

## 交互流程（Deep）

### Step 0：预检与上下文加载

环境设置（bash 命令执行前）：
```bash
export WORKSPACE_ROOT="${OPENCODE_PROJECT_DIR:-$PWD}"

if [ -z "${OPENCODE_PLUGIN_ROOT}" ] || [ ! -d "${OPENCODE_PLUGIN_ROOT}/scripts" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${OPENCODE_PLUGIN_ROOT}/scripts" >&2
  exit 1
fi
export SCRIPTS_DIR="${OPENCODE_PLUGIN_ROOT}/scripts"
```

必须做：
- 确认当前目录可写。
- 解析脚本目录并确认入口存在（仅支持插件目录）：
  - 固定路径：`${OPENCODE_PLUGIN_ROOT}/scripts`
  - 入口脚本：`${SCRIPTS_DIR}/webnovel.py`
- 建议先打印解析结果，避免写到错误目录：
  - `python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where`
- 加载最小参考：
  - `references/system-data-flow.md`（用于校对 init 产物与 plan/write 输入链路）
  - `references/genre-tropes.md`
  - `templates/genres/`（仅在用户选定题材后按需读取）

输出：
- 进入 Deep 采集前的“已知信息清单”和“待收集清单”。

### Step 1：故事核与商业定位

收集项（必收）：
- 书名（可先给工作名）
- 题材（支持 A+B 复合题材）
- 目标规模（总字数或总章数）
- 一句话故事
- 核心冲突
- 目标读者/平台

题材集合（用于归一化与映射）：
- 玄幻修仙类：修仙 | 系统流 | 高武 | 西幻 | 无限流 | 末世 | 科幻
- 都市现代类：都市异能 | 都市日常 | 都市脑洞 | 现实题材 | 黑暗题材 | 电竞 | 直播文
- 言情类：古言 | 宫斗宅斗 | 青春甜宠 | 豪门总裁 | 职场婚恋 | 民国言情 | 幻想言情 | 现言脑洞 | 女频悬疑 | 狗血言情 | 替身文 | 多子多福 | 种田 | 年代
- 特殊题材：规则怪谈 | 悬疑脑洞 | 悬疑灵异 | 历史古代 | 历史脑洞 | 游戏体育 | 抗战谍战 | 知乎短篇 | 克苏鲁

交互方式：
- 优先让用户自由描述，再二次结构化确认。
- 若用户卡住，给 2-4 个候选方向供选。

### Step 2：角色骨架与关系冲突

收集项（必收）：
- 主角姓名
- 主角欲望（想要什么）
- 主角缺陷（会害他付代价的缺陷）
- 主角结构（单主角/多主角）
- 感情线配置（无/单女主/多女主）
- 反派分层（小/中/大）与镜像对抗一句话

收集项（可选）：
- 主角原型标签（成长型/复仇型/天才流等）
- 多主角分工

### Step 3：金手指与兑现机制

收集项（必收）：
- 金手指类型（可为“无金手指”）
- 名称/系统名（无则留空）
- 风格（硬核/诙谐/黑暗/克制等）
- 可见度（谁知道）
- 不可逆代价（必须有代价或明确“无+理由”）
- 成长节奏（慢热/中速/快节奏）

收集项（条件必收）：
- 若为系统流：系统性格、升级节奏
- 若为重生：重生时间点、记忆完整度
- 若为传承/器灵：辅助边界与出手限制

### Step 4：世界观与力量规则

收集项（必收）：
- 世界规模（单城/多域/大陆/多界）
- 力量体系类型
- 势力格局
- 社会阶层与资源分配

收集项（题材相关）：
- 货币体系与兑换规则
- 宗门/组织层级
- 境界链与小境界

### Step 5：创意约束包（差异化核心）

流程：
1. 基于题材映射加载反套路库（最多 2 个主相关库）。
2. 生成 2-3 套创意包，每套包含：
   - 一句话卖点
   - 反套路规则 1 条
   - 硬约束 2-3 条
   - 主角缺陷驱动一句话
   - 反派镜像一句话
   - 开篇钩子
3. 三问筛选：
   - 为什么这题材必须这么写？
   - 换成常规主角会不会塌？
   - 卖点能否一句话讲清且不撞模板？
4. 展示五维评分（详见 `references/creativity/creativity-constraints.md` 的 `8.1 五维评分`），辅助用户决策。
5. 用户选择最终方案，或拒绝并给出原因。

备注：
- 若用户要求“贴近当下市场”，可触发外部检索并标注时间戳。

### Step 6：一致性复述与最终确认

必须输出“初始化摘要草案”并让用户确认：
- 故事核（题材/一句话故事/核心冲突）
- 主角核（欲望/缺陷）
- 金手指核（能力与代价）
- 世界核（规模/力量/势力）
- 创意约束核（反套路 + 硬约束）

确认规则：
- 用户未明确确认，不执行生成。
- 若用户仅改局部，回到对应 Step 最小重采集。

## 内部数据模型（初始化收集对象）

```json
{
  "project": {
    "title": "",
    "genre": "",
    "target_words": 0,
    "target_chapters": 0,
    "one_liner": "",
    "core_conflict": "",
    "target_reader": "",
    "platform": ""
  },
  "protagonist": {
    "name": "",
    "desire": "",
    "flaw": "",
    "archetype": "",
    "structure": "单主角"
  },
  "relationship": {
    "heroine_config": "",
    "heroine_names": [],
    "heroine_role": "",
    "co_protagonists": [],
    "co_protagonist_roles": [],
    "antagonist_tiers": {},
    "antagonist_level": "",
    "antagonist_mirror": ""
  },
  "golden_finger": {
    "type": "",
    "name": "",
    "style": "",
    "visibility": "",
    "irreversible_cost": "",
    "growth_rhythm": ""
  },
  "world": {
    "scale": "",
    "factions": "",
    "power_system_type": "",
    "social_class": "",
    "resource_distribution": "",
    "currency_system": "",
    "currency_exchange": "",
    "sect_hierarchy": "",
    "cultivation_chain": "",
    "cultivation_subtiers": ""
  },
  "constraints": {
    "anti_trope": "",
    "hard_constraints": [],
    "core_selling_points": [],
    "opening_hook": ""
  }
}
```

## 充分性闸门（必须通过）

未满足以下条件前，禁止执行 `init_project.py`：

1. 书名、题材（可复合）已确定。
2. 目标规模可计算（字数或章数至少一个）。
3. 主角姓名 + 欲望 + 缺陷完整。
4. 世界规模 + 力量体系类型完整。
5. 金手指类型已确定（允许“无金手指”）。
6. 创意约束已确定：
   - 反套路规则 1 条
   - 硬约束至少 2 条
   - 或用户明确拒绝并记录原因。

## 项目目录安全规则（必须）

- `project_root` 必须由书名安全化生成（去非法字符，空格转 `-`）。
- 若安全化结果为空或以 `.` 开头，自动前缀 `proj-`。
- 禁止在插件目录下生成项目文件（`${OPENCODE_PLUGIN_ROOT}`）。

## 执行生成

### 1) 运行初始化脚本

```bash
python "${SCRIPTS_DIR}/webnovel.py" init \
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

### 2) 写入 `idea_bank.json`

写入 `.webnovel/idea_bank.json`：

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
    "antagonist_mirror": "",
    "opening_hook": ""
  }
}
```

### 3) Patch 总纲

必须补齐：
- 故事一句话
- 核心主线 / 核心暗线
- 创意约束（反套路、硬约束、主角缺陷、反派镜像）
- 反派分层
- 关键爽点里程碑（2-3 条）

## 验证与交付

执行检查：

```bash
test -f "{project_root}/.webnovel/state.json"
find "{project_root}/设定集" -maxdepth 1 -type f -name "*.md"
test -f "{project_root}/大纲/总纲.md"
test -f "{project_root}/.webnovel/idea_bank.json"
```

成功标准：
- `state.json` 存在且关键字段不为空（title/genre/target_words/target_chapters）。
- 设定集核心文件存在：`世界观.md`、`力量体系.md`、`主角卡.md`、`金手指设计.md`。
- `总纲.md` 已填核心主线与约束字段。
- `idea_bank.json` 已写入且与最终选定方案一致。

## 失败处理（最小回滚）

触发条件：
- 关键文件缺失；
- 总纲关键字段缺失；
- 约束启用但 `idea_bank.json` 缺失或内容不一致。

恢复流程：
1. 仅补缺失字段，不全量重问。
2. 仅重跑最小步骤：
   - 文件缺失 -> 重跑 `init_project.py`；
   - 总纲缺字段 -> 只 patch 总纲；
   - idea_bank 不一致 -> 只重写该文件。
3. 重新验证，全部通过后结束。
