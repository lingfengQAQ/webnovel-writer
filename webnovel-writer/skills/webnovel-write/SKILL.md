---
name: webnovel-write
description: 产出可发布章节，完整执行上下文→起草→审查→润色→提交→备份。
allowed-tools: Read Write Edit Grep Bash Agent AskUserQuestion
argument-hint: "[章号] [--fast|--minimal]"
---

# 写章流程

## 目标

产出可发布章节到 `正文/第{NNNN}章-{title}.md`。默认 2000-2500 字，用户/大纲另有要求时从之。

## 模式

| 模式 | 流程 |
|------|------|
| 默认 | Step 1→2→3→4→5→6 |
| `--fast` | Step 1→2→3(轻量)→4→5→6 |
| `--minimal` | Step 1→2→3(写 no-review artifact)→4(仅排版)→5→6 |

## 硬规则

- 禁止并步、跳步、伪造审查
- 必须使用 `Agent` 工具调用指定 subagent；不得用主流程口头代替 subagent 输出
- 审查只跑一轮；blocking issue 定点修复或经用户裁决后才进 Step 4/5
- 失败只补跑失败步骤，不回退
- 参考资料按步骤按需加载

## 优先级

用户要求 > 状态机硬门槛 > 项目约束（总纲/设定/记忆）> skill 流程 > reference 建议

## CSV 检索（Step 2 按需）

```bash
python -X utf8 "${SCRIPTS_DIR}/reference_search.py" --skill write --table {表名} --query "{关键词}" --genre {题材}
```

触发条件：新角色→命名规则，战斗→场景写法，多角色对话→写作技法，情感描写→写作技法，高频桥段→场景写法。

## 执行流程

### 准备：预检

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
export SKILL_ROOT="${CLAUDE_PLUGIN_ROOT:?}/skills/webnovel-write"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" preflight
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" placeholder-scan --format text
```

### 准备：刷新合同树

genre 从 `.webnovel/state.json` 的初始化配置快照读取，用于刷新合同树；写前主链真源仍是 `.story-system/` 合同。调用 story-system 前必须先从详细大纲解析真实本章目标，禁止传 `{章纲目标}`、`第N章章纲目标` 等占位 query。

```bash
GENRE="$(python -X utf8 -c "import json,sys; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); pi=s.get('project_info',{}); print(pi.get('genre') or s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  story-system "${CHAPTER_GOAL}" --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  write-gate --chapter {chapter_num} --stage prewrite --format json
```

必备文件：`MASTER_SETTING.json`（调性/禁忌）、`volume_{NNN}.json`（卷级节奏）、`chapter_{NNN}.review.json`（必须节点/禁区）。缺失则阻断。

`chapter_{NNN}.json` 必须优先检查顶层 `chapter_directive`。`chapter_focus` 只能来自 `chapter_directive.goal` 或真实 query，不得从 `dynamic_context` 的参考摘要继承。

写作任务书排序必须固定为：
1. 本章硬性约束：`chapter_directive.goal/time_anchor/chapter_span/countdown/chapter_end_open_question`
2. CBN/CPNs/CEN 与 `must_cover_nodes`
3. 本章禁区：`forbidden_zones`，违反即不通过
4. 风格指引：reasoning、主角卡 OOC 警戒、anti_patterns
5. 场景写法补充：`dynamic_context`，仅作风格参考，不能覆盖章纲约束

### Step 1：context-agent 生成写作任务书

必须使用 `Agent` 工具调用 `context-agent`，不得由主流程自行整理任务书。

Use the Agent tool to run `webnovel-writer:context-agent`.

Task:
- chapter={chapter_num}
- project_root=${PROJECT_ROOT}
- scripts_dir=${SCRIPTS_DIR}
- storage_path=${PROJECT_ROOT}/.webnovel
- state_file=${PROJECT_ROOT}/.webnovel/state.json（projection/read-model，仅兼容读取）
- 先 research，再按 本章硬性约束 → CBN/CPNs/CEN → 本章禁区 → 风格指引 → dynamic_context 补充参考 的顺序输出五段写作任务书。
- 上下文不足时返回 blocker。

产物：一份写作任务书，能独立支撑 Step 2 起草。

### Step 2：起草正文

只根据任务书起草。不加载 core-constraints/anti-ai-guide（已内化到任务书）。只输出纯正文，无占位符。有结构化节点时围绕 CBN→CPNs→CEN 展开。中文思维写作。

### Step 3：审查

必须使用 `Agent` 工具调用 `reviewer`，不得由主流程伪造审查 JSON。

Use the Agent tool to run `webnovel-writer:reviewer`.

Task:
- chapter={chapter_num}
- chapter_file=${CHAPTER_FILE}
- project_root=${PROJECT_ROOT}
- scripts_dir=${SCRIPTS_DIR}
- 只返回严格的 reviewer schema JSON，不写任何文件。
- 不评分、不口头总结。

reviewer 只返回 JSON；主流程负责用 `Write` 把返回的 JSON 写入 `${PROJECT_ROOT}/.webnovel/tmp/review_results.json`（reviewer 不持 Write，是这份 artifact 的非写入方）。随后必须运行 review-pipeline；review-pipeline 会把同一路径覆盖为标准 review_result artifact（含 `blocking_count`），供 precommit gate 与后续提交命令使用。

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" review-pipeline \
  --chapter {chapter_num} \
  --review-results "${PROJECT_ROOT}/.webnovel/tmp/review_results.json" \
  --metrics-out "${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json" \
  --report-file "审查报告/第{chapter_num}章审查报告.md" \
  --save-metrics
```

审查只跑一轮，reviewer 只调用一次。`blocking=true` 的问题在不改剧情、不破设定的前提下定点修复后直接进 Step 4，不重新调用 reviewer；确实无法修复的 blocking 问题用 `AskUserQuestion` 让用户裁决（接受当前版本 / 手动修复 / 放弃）。非 blocking issue 交给 Step 4 处理。`--fast` 只检查 setting/timeline/continuity。

`--minimal` 不调用 reviewer 与 `review-pipeline`，但必须**覆盖写入**本章新的 no-review `review_results.json`（禁止复用旧 artifact），使 Step 5 提交链有有效 `--review-result`（成功标准“审查已落库”对 `--minimal` 的豁免仍成立）：

```bash
python -X utf8 -c "import json,os; from pathlib import Path; root=Path(os.environ['PROJECT_ROOT']); ch=int('{chapter_num}'); p=root/'.webnovel'/'tmp'/'review_results.json'; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps({'chapter':ch,'issues':[],'issues_count':0,'blocking_count':0,'has_blocking':False,'summary':'minimal mode: reviewer skipped by user-selected --minimal flow','review_skipped':True,'review_mode':'minimal'},ensure_ascii=False,indent=2),encoding='utf-8')"
```

### Step 4：润色

`references/polish-guide.md` 区段读：先 `Grep` 匹配 `^#{1,3} ` 定位锚点行号，再 `Read` 的 offset/limit 取段——主路径取 `## 2. 执行顺序（必须按序）`；Anti-AI 终检单独区段取 `## 2A. Anti-AI 检测细则` 与 `## Phase 1 增补：Anti-AI 规范（7层，原版）`（词库段），不全文读。`references/writing/typesetting.md`、`references/style-adapter.md` 短文件，全文读。

顺序：修复非 blocking issue → 风格适配 → 排版 → Anti-AI 终检。

只改表达不改事实。`anti_ai_force_check=fail` 时不进 Step 5。`--minimal` 仅排版。

### Step 5：提交

#### 5.1 Data Agent 提取事实

必须使用 `Agent` 工具调用 `data-agent`，产出 fulfillment_result / disambiguation_result / extraction_result 三份 JSON，并复用 Step 3 的 review_results。

Use the Agent tool to run `webnovel-writer:data-agent`.

Task:
- chapter={chapter_num}
- chapter_file=${CHAPTER_FILE}
- project_root=${PROJECT_ROOT}
- scripts_dir=${SCRIPTS_DIR}
- output_dir=${PROJECT_ROOT}/.webnovel/tmp
- 按你自己的 schema（见 data-agent 输出格式段）生成 fulfillment_result.json、disambiguation_result.json、extraction_result.json 三份 artifact。
- 你是这三份 artifact 的唯一写入者；不直接写 state/index/summaries/memory/vectors/projection。

artifact 字段 schema 由 data-agent 自身定义、runtime validator 校验；主流程只检查文件存在与 schema，不重写、不补写、不口头替代。

#### 5.2 提交前校验与 CHAPTER_COMMIT

先跑 precommit gate：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  write-gate --chapter {chapter_num} --stage precommit --format json
```

precommit 通过后，运行提交前只读 `git diff` 变更面校验（写入所有权 sanity check，只读、不 stage、不提交）：

```bash
if git -C "${PROJECT_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "${PROJECT_ROOT}" diff --name-status -- .
  git -C "${PROJECT_ROOT}" diff --check -- .
fi
```

变更面不得出现插件目录、其他书项目、其他章节正文或不属于本章流程的手写状态文件；`git diff` 只覆盖 git 可见文件，SQLite / `.webnovel/` 内部语义由 5.3 postcommit 与 runtime 只读查询验证。若项目根不是 git worktree，记录“跳过 git diff 校验”，不得因此跳过 precommit gate。本步只读，禁止在此执行 `git add`/`git commit`。

校验通过后运行 chapter-commit：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" chapter-commit \
  --chapter {chapter_num} \
  --review-result "${PROJECT_ROOT}/.webnovel/tmp/review_results.json" \
  --fulfillment-result "${PROJECT_ROOT}/.webnovel/tmp/fulfillment_result.json" \
  --disambiguation-result "${PROJECT_ROOT}/.webnovel/tmp/disambiguation_result.json" \
  --extraction-result "${PROJECT_ROOT}/.webnovel/tmp/extraction_result.json"
```

自动判定：blocking_count>0 或 missed_nodes 非空 或 pending 非空 → rejected，否则 accepted。

#### 5.3 验证投影

projection_status 五项（state/index/summary/memory/vector）全部 done 或 skipped。

chapter_status 由 projection writer 自动推进：accepted→committed，rejected→rejected。

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  write-gate --chapter {chapter_num} --stage postcommit --format json
```

#### 5.4 失败隔离

commit 未生成→重跑 5.2。projection 失败→只补跑 projection，不回退 Step 1-4。

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  projections retry --chapter {chapter_num} --format json
```

### Step 6：Git 备份

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" backup \
  --chapter {chapter_num} \
  --chapter-title "{title}"
```

备份必须以解析后的 `PROJECT_ROOT` 为准，禁止从工作区父目录执行裸全量 Git add，避免把书项目仓库作为父仓库的嵌入仓库/submodule 加入。

## 充分性闸门

1. 正文文件存在且非空
2. 审查已落库（`--minimal` 除外）
3. blocking=true 必须在 Step 3 定点修复或经用户裁决
4. anti_ai_force_check=pass（`--minimal` 除外）
5. accepted CHAPTER_COMMIT，projection 五项 done/skipped
6. chapter_status=committed（projection 自动推进）
7. `write-gate` 的 prewrite / precommit / postcommit 均通过

## 失败恢复

审查缺失→重跑 Step 3。摘要/状态/记忆缺失→重跑 Step 5。润色失真→回 Step 4 修复后重跑 Step 5。

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
- 正文文件路径。
- 审查报告路径。
- `.webnovel/tmp/review_results.json`。
- `.webnovel/tmp/fulfillment_result.json`。
- `.webnovel/tmp/disambiguation_result.json`。
- `.webnovel/tmp/extraction_result.json`。
- `.story-system/commits/chapter_{NNN}.commit.json`。
- state / index / summary / memory / vector 更新状态。
- 备份状态。
- 是否可以继续写下一章。

状态规则：
- `chapter-commit rejected`、任一 `write-gate` failed、projection failed 时，最终状态不得写“已完成”。
- `--fast` 和 `--minimal` 的跳过项必须说明；`--minimal` 跳过审查时归入“已自动处理”或“建议确认”，不得假装已完成完整审查。
- projection retry 发生时必须说明已自动处理和最终结果。

异常分类：
- 已自动处理：projection retry 成功、RAG 临时降级但不影响结果、旧 no-review artifact 被本章新 artifact 覆盖。
- 建议确认：新增角色名 / 设定名、低置信歧义但不阻断、非阻断审查建议。
- 必须处理：blocking issue 未裁决、data artifacts 缺失或 schema 不完整、commit rejected、projection failed。

下一步建议必须使用任务化语言 + 可复制命令，例如：

```text
- 接下来可以写下一章：
  /webnovel-write {next_chapter}
```

不写 token 统计；如需排查故障，只给日志路径或建议运行 `/webnovel-doctor`。
