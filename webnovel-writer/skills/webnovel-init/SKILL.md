---
name: webnovel-init
description: 深度初始化网文项目。通过分阶段交互收集完整创作信息，生成可直接进入规划与写作的项目骨架与约束文件。
allowed-tools: Read Write Edit Grep Bash Agent AskUserQuestion WebSearch WebFetch
argument-hint: "[书名或灵感（可选）]"
---

# Project Initialization (Deep Mode)

## 目标

- 结构化交互收集足够信息，避免"先生成再返工"。
- 产出可落地骨架：`.webnovel/state.json`、`设定集/*`、`大纲/总纲.md`、`.webnovel/idea_bank.json`、`.story-system/MASTER_SETTING.json`。
- 保证后续 `/webnovel-plan` 与 `/webnovel-write` 可直接运行。

## 执行原则

1. 先收集，再生成；未过充分性闸门，不执行 `webnovel.py init`。
2. 分波次提问，每轮只问"当前缺失且会阻塞下一步"的信息；用户已明确的不重复问，冲突让用户裁决。
3. 参考书拆解只返回结构化结果；用户确认前不得写入 `idea_bank.json`、`.story-system`、`设定集`、`大纲`、`正文`、`.webnovel/state.json` 或任何 canon/read model 文件。

## 引用加载策略

路径说明：`references/` 指 `skills/webnovel-init/references/`；`../../references/` 指共享 references。详细采集字段见 `references/init-collection-schema.md`（按需区段读，逐项收集，必填项以「充分性闸门」为准）。

| Step | Trigger | Reference |
|------|---------|-----------|
| Step 1 | always | `references/system-data-flow.md`、`references/genre-tropes.md` |
| 题材/卖点采集 | always | `../../references/genre-profiles.md`（只读当前 genre 段） |
| 角色卡顿 | 人物扁平 | `references/worldbuilding/character-design.md` |
| 世界观/力量 | 按需 | `references/worldbuilding/faction-systems.md`、`references/worldbuilding/power-systems.md`、`references/worldbuilding/world-rules.md`、`references/worldbuilding/setting-consistency.md` |
| 创意约束 | Step 6 | `references/creativity/creativity-constraints.md`（区段：采集读 `## 一、创意包 Schema (Idea Package)`、`## 六、硬约束驱动创意 (Hard Constraints)`、`## 八、评分系统 (Scoring System)`，评分展示读 `### 8.1 五维评分`）、`references/creativity/selling-points.md`（区段：`## 9. 核心卖点定位模板` 骨架，按需补 `### 1.3 核心卖点黄金公式`、`## 7. 实战检查清单`）；复合题材读 `creative-combination.md`；卡顿读 `inspiration-collection.md`；题材命中读 `anti-trope-*.md` |
| 命名 | 开始命名 | `python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill init --table 命名规则 --query "{命名对象} {题材}" --genre {题材}` |

按需读取上述长细则（创意约束、反套路库、世界观设计指南、卖点模板），不内联其条目。

## 工具策略

- `Read/Grep`：读项目上下文与参考文件。
- `Bash`：执行 `webnovel.py init`、文件存在性检查、最小验证。
- `Agent`：拆分并行子任务；Step 1.5 用户选择参考书拆解作灵感来源时调用 `webnovel-writer:deconstruction-agent`。
- `AskUserQuestion`：关键分歧裁决、候选选择、最终确认。
- `WebSearch`/`WebFetch`：仅在用户要求市场趋势/平台风向、创意约束需时间敏感依据、或题材信息明显不确定时使用，先 search 后 fetch 核验。

## 交互流程（Deep）

### Step 1：预检与上下文加载

环境设置（bash 命令执行前）：
```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

if [ -z "${CLAUDE_PLUGIN_ROOT}" ] || [ ! -d "${CLAUDE_PLUGIN_ROOT}/scripts" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${CLAUDE_PLUGIN_ROOT}/scripts" >&2
  exit 1
fi
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
```

必须做：
- 确认当前目录可写；确认入口脚本 `${SCRIPTS_DIR}/webnovel.py` 存在（仅支持插件目录）。
- 初始化前不要用 `where` 把 `WORKSPACE_ROOT` 解析成书项目根；新项目尚不存在时 `where` 可能命中旧指针或旧项目。
- 只打印工作区与脚本目录，确认生成目标将在工作区下的书名安全化子目录中。
- 加载最小参考：`references/system-data-flow.md`、`references/genre-tropes.md`；`templates/genres/` 仅在选定题材后按需读取。

输出：进入 Deep 采集前的"已知信息清单"和"待收集清单"。

### Step 1.5：灵感来源询问（可选）

进入故事核采集前，必须先用 `AskUserQuestion` 或直接提问确认用户是否提供灵感来源。不要默认拆书，也不要把参考作品当作必填项。

建议询问：

```text
你这本书的灵感来源想从哪里开始？可以直接说原创想法，也可以提供参考作品做拆书提炼。若要拆书，请给参考书名+平台，并尽量提供章节摘录或文本路径；没有参考也可以直接跳过。
```

可接受来源：原创想法、参考作品拆书（书名/平台/章节摘录/文本路径）、市场趋势、题材模板/反套路库/已有脑洞片段。

当用户选择参考作品拆书且提供文本路径或章节摘录时，必须使用 `Agent` 工具调用 `webnovel-writer:deconstruction-agent`，不得由 init 主流程口头替代拆解结果。

```text
Use the Agent tool to run `webnovel-writer:deconstruction-agent`.

Prompt: reference_title={reference_title}; reference_source={reference_source}; reference_text_path={reference_text_path}; reference_text_excerpt={reference_text_excerpt}; analysis_mode={quick|deep|auto}; init_goal={当前初始化故事方向或空}; target_genre={题材或空}。只返回 init_reference_research JSON 对象，不写任何文件，不创建目录，不写 .story-system、.webnovel、设定集、大纲、正文、idea_bank.json、state.json 或任何 canon/read model 文件。
```

处理规则：
- 只有书名/平台、无文本或摘录时，先问能否提供摘录/路径；不能提供则把参考书仅作"方向线索"，不得编造其黄金三章、角色、设定或剧情事实。
- 接收返回的 `init_reference_research` JSON 后，只使用 `reader_promise`、`opening_hook_patterns`、`cool_point_loops`、`protagonist_patterns`、`antagonist_pressure_patterns`、`pacing_notes`、`borrowable_structures`、`differentiation_requirements`、`init_candidates`、`quality`。
- 先检查 `quality`：`quality.passed=false`、`confidence < 0.85` 或 `warnings` 非空时，不得把候选折叠进创意约束包，只能把风险和需补充材料展示给用户确认。
- `do_not_copy` 和 `canon_contamination_warnings` 必须进入已知信息清单，作为后续创意生成红线。
- Step 2-6 只能使用用户确认过、并已变形为本书差异化表达的模式；禁止把参考书角色、设定、组织、地点、金手指、剧情事实原样写入生成项目文件。

### Step 2：故事核与商业定位

必收：书名、题材（支持 A+B 复合）、目标规模（总字数或总章数）、一句话故事、核心冲突、目标读者/平台。

canonical 题材集合（写入 `project_info.genre`）：都市、玄幻、仙侠、奇幻、科幻、历史、悬疑、游戏、古言、现言、幻言、年代、种田、快穿、衍生。

可自由输入细分 preset / 套路 / 形式，初始化脚本会映射到 canonical 并按 taxonomy 加载模板（示例：修仙、系统流、规则怪谈、宫斗宅斗、电竞、末世）。优先让用户自由描述再二次结构化确认；卡住时给 2-4 个候选方向。

### Step 3：角色骨架与关系冲突

必收：主角姓名、主角欲望、主角缺陷（会害他付代价）、主角结构（单/多主角）、感情线配置（无/单女主/多女主）、反派分层（小/中/大）与镜像对抗一句话。可选：主角原型标签、多主角分工。

### Step 4：金手指与兑现机制

必收：金手指类型（可为"无金手指"）、名称/系统名（无则留空）、风格、可见度、不可逆代价（必须有代价或明确"无+理由"）、成长节奏。
条件必收：系统流给系统性格+升级节奏；重生给重生时间点+记忆完整度；传承/器灵给辅助边界+出手限制。

### Step 5：世界观与力量规则

必收：世界规模（单城/多域/大陆/多界）、力量体系类型、势力格局、社会阶层与资源分配。
题材相关：货币体系与兑换规则、宗门/组织层级、境界链与小境界。

### Step 6：创意约束包（差异化核心）

流程：
1. 汇总 Step 1.5 已确认的灵感来源：原创想法、参考拆书结果、市场趋势、题材模板或反套路库。
2. 基于题材映射加载反套路库（最多 2 个主相关库）。
3. 生成 2-3 套创意包，每套含：一句话卖点、反套路规则 1 条、硬约束 2-3 条、主角缺陷驱动一句话、反派镜像一句话、开篇钩子。
4. 三问筛选：为什么这题材必须这么写？换常规主角会不会塌？卖点能否一句话讲清且不撞模板？
5. 展示五维评分（详见 `references/creativity/creativity-constraints.md` 的 `8.1 五维评分`）辅助决策。
6. 用户选择最终方案，或拒绝并给出原因。

备注：
- 若用户要求"贴近当下市场"，可触发外部检索并标注时间戳。
- 若使用了参考拆解，展示候选时必须标明参考来源、转换方式、不可复制项和差异化要求；用户未明确确认前，不写入 `idea_bank.json` 或任何生成项目文件。

### Step 7：一致性复述与最终确认

必须输出"初始化摘要草案"并让用户确认：故事核（题材/一句话故事/核心冲突）、主角核（欲望/缺陷）、金手指核（能力与代价）、世界核（规模/力量/势力）、创意约束核（反套路+硬约束）。

确认规则：用户未明确确认，不执行生成；用户仅改局部，回到对应 Step 最小重采集。

## 充分性闸门（必须通过）

未满足以下条件前，禁止执行 `webnovel.py init`：

1. 书名、题材（可复合）已确定。
2. 目标规模可计算（字数或章数至少一个）。
3. 主角姓名 + 欲望 + 缺陷完整。
4. 世界规模 + 力量体系类型完整。
5. 金手指类型已确定（允许"无金手指"）。
6. 创意约束已确定：反套路规则 1 条 + 硬约束至少 2 条，或用户明确拒绝并记录原因。

## 项目目录安全规则（必须）

- `project_root` 必须由书名安全化生成：`PROJECT_ROOT="${WORKSPACE_ROOT}/${PROJECT_SLUG}"`；安全化结果为空或以 `.` 开头时自动前缀 `proj-`。
- 禁止在插件目录（`${CLAUDE_PLUGIN_ROOT}`）下生成项目文件；禁止直接把 `WORKSPACE_ROOT` 当作 `PROJECT_ROOT`，除非用户明确指定当前目录就是书项目根。
- 初始化前必须展示并确认 `WORKSPACE_ROOT`、`PROJECT_SLUG`、`PROJECT_ROOT`。

```bash
PROJECT_SLUG="$(python -X utf8 -c "import re,sys; title=sys.argv[1].strip(); slug=re.sub(r'[\\\\/:*?\"<>|]+','',title); slug=re.sub(r'\\s+','-',slug).strip('-'); print(('proj-' + slug) if (not slug or slug.startswith('.')) else slug)" "{title}")"
PROJECT_ROOT="${WORKSPACE_ROOT}/${PROJECT_SLUG}"
echo "WORKSPACE_ROOT=${WORKSPACE_ROOT}"
echo "PROJECT_SLUG=${PROJECT_SLUG}"
echo "PROJECT_ROOT=${PROJECT_ROOT}"
```

## 执行生成

### 1) 运行初始化脚本

参数全部来自上面的采集对象（书名/题材/主角/金手指/世界观/反派/创意约束等），逐字段映射为 `webnovel.py init` 的 `--*` 选项；完整字段清单见 `references/init-collection-schema.md`，可用 `python "${SCRIPTS_DIR}/webnovel.py" init --help` 核对选项名。

```bash
python "${SCRIPTS_DIR}/webnovel.py" init \
  "${PROJECT_ROOT}" "{title}" "{genre}" \
  --protagonist-name "{protagonist_name}" \
  --target-words {target_words} --target-chapters {target_chapters} \
  --protagonist-desire "{protagonist_desire}" --protagonist-flaw "{protagonist_flaw}" \
  --golden-finger-type "{gf_type}" --gf-irreversible-cost "{gf_irreversible_cost}" \
  --world-scale "{world_scale}" --power-system-type "{power_system_type}" \
  --core-selling-points "{core_points}"
  # 其余字段（结构/感情线/反派/势力/货币/境界/原型/读者/平台等）按采集对象继续追加对应 --* 选项
```

### 2) 写入 `idea_bank.json`

写入 `.webnovel/idea_bank.json`，内容必须与最终选定方案一致：

```json
{
  "selected_idea": {"title": "", "one_liner": "", "anti_trope": "", "hard_constraints": []},
  "constraints_inherited": {"anti_trope": "", "hard_constraints": [], "protagonist_flaw": "", "antagonist_mirror": "", "opening_hook": ""}
}
```

### 3) Patch 总纲

`大纲/总纲.md` 必须补齐：故事一句话、核心主线/暗线、创意约束（反套路、硬约束、主角缺陷、反派镜像）、反派分层、关键爽点里程碑（2-3 条）。

### 4) 生成写前合同树（Story System 初始化）

init 完成后立即生成 MASTER_SETTING，让后续 plan 有调性/禁忌参照。此处不传 `--chapter`（只生成 `MASTER_SETTING.json` 和 `anti_patterns.json`），也不传 `--emit-runtime-contracts`（还没有卷/章级数据）；plan 拆到具体章节时再生成 volume/chapter/review 合同。

```bash
GENRE="$(python -X utf8 -c "import json,os; root=os.environ['PROJECT_ROOT']; s=json.load(open(root + '/.webnovel/state.json',encoding='utf-8')); pi=s.get('project_info',{}); print(pi.get('genre') or s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  story-system "${GENRE}" --genre "${GENRE}" --persist --format json
```

## 验证与交付

```bash
test -f "${PROJECT_ROOT}/.webnovel/state.json"
find "${PROJECT_ROOT}/设定集" -maxdepth 1 -type f -name "*.md"
test -f "${PROJECT_ROOT}/大纲/总纲.md"
test -f "${PROJECT_ROOT}/.webnovel/idea_bank.json"
test -f "${PROJECT_ROOT}/.story-system/MASTER_SETTING.json"
test "$(basename "${PROJECT_ROOT}")" = "${PROJECT_SLUG}"
```

成功标准：
- `state.json` 存在且 title/genre/target_words/target_chapters 不为空。
- 设定集核心文件存在：`世界观.md`、`力量体系.md`、`主角卡.md`；单主角不生成 `主角组.md`，`heroine_config=无女主` 不生成 `女主卡.md`。
- 默认不生成 `金手指设计.md`、`复合题材-融合逻辑.md`、`爽点规划.md` 或空目录；这些以主角卡、世界观、卷纲为事实源。
- `总纲.md` 已填核心主线与约束字段；`idea_bank.json` 已写入且与最终选定方案一致。
- `.story-system/MASTER_SETTING.json` 存在且 `route.primary_genre` 非空。

## 失败处理（最小回滚）

触发：关键文件缺失；总纲关键字段缺失；约束启用但 `idea_bank.json` 缺失或不一致。

恢复：只补缺失字段，不全量重问；只重跑最小步骤（文件缺失→重跑 `webnovel.py init`；总纲缺字段→只 patch 总纲；idea_bank 不一致→只重写该文件）；重新验证，全部通过后结束。

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
- 项目目录、`.webnovel/state.json`、`.webnovel/idea_bank.json`。
- `设定集/世界观.md`、`设定集/力量体系.md`、`设定集/主角卡.md`、`设定集/反派设计.md`。
- `大纲/总纲.md`、`.story-system/MASTER_SETTING.json`。
- 是否使用参考作品拆解；用户确认前未写入 canon 的情况。
- 缺失信息是否影响后续 `/webnovel-plan`。

异常分类：
- 已自动处理：脚本补齐目录、重跑最小初始化步骤、重新生成缺失的非内容文件等。
- 建议确认：参考拆解质量略低、候选创意需用户再看一眼。
- 必须处理：核心设定未确认、项目目录不安全、关键文件仍缺失。

下一步建议必须使用任务化语言 + 可复制命令，例如：

```text
- 接下来可以规划第一卷：
  /webnovel-plan 1
```

不写 token 统计；如需排查故障，只给日志路径或建议运行 `/webnovel-doctor`。
