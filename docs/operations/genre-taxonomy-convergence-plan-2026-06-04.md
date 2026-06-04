# Genre Taxonomy Convergence Plan

日期：2026-06-04
状态：修订版

## 目标

把题材体系收敛到 CSV 已采用的 15 个 `canonical_genre`，同时保留 37 个中文题材模板作为初始化阶段的可叠加 preset。

一句话原则：

> CSV canonical 是主干；taxonomy index 是用户输入层真源；模板是 preset；平台细分、套路、形式全部标签化。

## 已核实事实

- `webnovel-writer/templates/genres/*.md` 当前实际数量是 37 个。
- `templates/genres/*.md` 只在初始化链路中直接读取：
  - `skills/webnovel-init/SKILL.md` 提示按用户题材读取模板。
  - `scripts/init_project.py` 通过 `templates/genres/{key}.md` 拼入 `设定集/世界观.md`。
- 当前至少有三处题材输入归一逻辑，目标不同，已经形成漂移风险：
  - `scripts/init_project.py::_normalize_genre_key()`：用户输入 -> 模板文件名。
  - `scripts/reference_search.py::resolve_genre()`：用户输入/平台标签/legacy -> 15 canonical。
  - `scripts/data_modules/genre_aliases.py`：用户输入 -> profile key/legacy profile section。
- `scripts/reference_search.py` 里 `PLATFORM_TO_CANONICAL` 和 `_LEGACY_GENRE_MAP` 已经覆盖约 40 个输入标签，和计划中的 index 高度重叠，不能继续作为第二真源。
- `state.json` 当前 schema 是 `project_info.genre`，不是顶层 `project.genre`。
- 仍有 legacy 消费者读取 `project.genre`，包括 `skills/webnovel-plan/SKILL.md`、`skills/webnovel-write/SKILL.md`、`memory_contract_adapter.py` 和部分 context/profile 兼容路径。
- `story_system_engine.py::_route()` 不只是调用 `resolve_genre()`，还包含 route table 关键字/别名匹配、explicit genre fallback、inferred genre fallback。
- `references/csv/题材与调性推理.csv` 当前实际 route rows 是 26 条；验证应覆盖真实 CSV 全量 rows，不写死 26 或 27。
- `references/genre-profiles.md` 已定位为 fallback，高频题材主链已迁入 Story Contracts。

## 目标模型

### 1. 硬题材枚举

唯一硬枚举继续使用 15 个 canonical：

```text
都市 玄幻 仙侠 奇幻 科幻
历史 悬疑 游戏 古言 现言
幻言 年代 种田 快穿 衍生
```

这些值用于：

- CSV `适用题材`
- `裁决规则.csv` 的 `题材`
- Story System 的 `canonical_genre`
- `reference_search.py --genre`
- 新项目 `state.json.project_info.genre`

### 2. Taxonomy Index

新增 `webnovel-writer/templates/genres/index.csv`，但它不是单纯模板清单，而是题材输入层的唯一数据真源。

建议字段：

```csv
label,canonical_genre,label_type,template_file,template_type,route_tags,trope_tags,format_tags,aliases,notes
都市,都市,canonical,,canonical,,,,,
都市脑洞,都市,platform,都市脑洞.md,route,都市脑洞,,,都市奇闻,
规则怪谈,悬疑,route,规则怪谈.md,route,规则怪谈,,,规则动物园|规则类,
系统流,玄幻,trope,系统流.md,trope,,系统流,,系统|系统文,
知乎短篇,现言,format,知乎短篇.md,format,,,知乎短篇,知乎体|盐选|小程序短篇,
网游,游戏,legacy,,,,,,,
```

规则：

- 每个 `templates/genres/*.md` 必须在 index 中有且只有一行 `template_file` 指向它。
- 不带模板文件的 platform/legacy alias 也必须进入 index，不能留在 Python 硬编码字典里。
- `label` 与 `aliases` 都必须解析到同一 `canonical_genre`。
- `canonical_genre` 必须属于 15 canonical 或 `全部`。
- `template_type` 只描述模板用途，不参与硬枚举。

### 3. 单一 Resolver Contract

新增一个共享 loader/resolver，例如 `scripts/genre_taxonomy.py`：

```python
GenreResolution(
    raw_label="知乎短篇风的规则怪谈",
    canonical_genre="悬疑",
    matched_labels=["规则怪谈", "知乎短篇"],
    template_files=["规则怪谈.md", "知乎短篇.md"],
    route_tags=["规则怪谈"],
    trope_tags=[],
    format_tags=["知乎短篇"],
    unresolved=[]
)
```

兼容原则：

- `reference_search.resolve_genre()` 保留为 wrapper，只返回 canonical 或原值，用于现有调用点。
- `_normalize_genre_key()` 不再拥有 alias 字典；如果暂时保留，只能委托 taxonomy resolver 返回 `template_file`。
- `data_modules/genre_aliases.py` 不再维护输入 alias；只保留 profile key 映射，或委托 taxonomy 后再转 profile key。
- Story System 不改变 route 语义，只把输入 canonical 化能力接到同一 resolver。

### 4. State Schema

新 init 项目写入：

```json
{
  "project_info": {
    "genre": "悬疑",
    "genre_label": "知乎短篇风的规则怪谈",
    "genre_tags": {
      "route": ["规则怪谈"],
      "trope": [],
      "format": ["知乎短篇"],
      "templates": ["规则怪谈", "知乎短篇"]
    }
  }
}
```

兼容读取顺序：

1. `project_info.genre`
2. `project_info.genre_label`
3. legacy `project.genre`

写入新项目时不再新增顶层 `project.genre`。

## 改动范围

### 必改

- `templates/genres/*.md`
  - H1 标题中文化。
  - 不移动文件。
- `templates/genres/index.csv`
  - 覆盖 37 个模板。
  - 覆盖 `PLATFORM_TO_CANONICAL` 和 `_LEGACY_GENRE_MAP` 的现有输入。
- `scripts/genre_taxonomy.py`
  - 新增共享 CSV loader/resolver。
- `scripts/reference_search.py`
  - 删除硬编码 `PLATFORM_TO_CANONICAL` 与 `_LEGACY_GENRE_MAP`。
  - `resolve_genre()` 改为调用 taxonomy wrapper。
- `scripts/init_project.py`
  - init 时用 taxonomy 解析用户原始题材。
  - `project_info.genre` 写 canonical。
  - 读取模板时按 `template_file` 加载 preset，不再按原始输入精确拼路径。
- `scripts/data_modules/genre_aliases.py`
  - 移除重复输入 alias，改为委托 taxonomy 或仅保留 profile key 映射。
- `scripts/data_modules/memory_contract_adapter.py`
  - fallback 从 `project_info.genre`/`genre_label` 读取，legacy `project.genre` 只兜底。
- `scripts/data_modules/context_manager.py`
  - legacy profile fallback 与 taxonomy resolver 对齐。
- `skills/webnovel-init/SKILL.md`
  - 主体题材只展示 15 canonical。
  - 说明可输入 preset/套路/形式，但运行时会映射到 canonical。
- `skills/webnovel-plan/SKILL.md`、`skills/webnovel-write/SKILL.md`
  - 读取 genre 的 shell snippet 改为 `project_info.genre` 优先，legacy `project.genre` 兜底。
- `scripts/validate_csv.py`
  - 增加 taxonomy index 双向校验。
- 相关测试
  - `reference_search` resolver 兼容测试。
  - `init_project` state/schema/template 加载测试。
  - Story System 真实 CSV route 端到端测试。

### 应改

- `references/csv/genre-canonical.md`
  - 明确 `题材与调性推理.csv` 的 `题材/流派` 是 route tag，不是 canonical enum。
- `references/csv/README.md`
  - 补充 taxonomy index、template preset、canonical 的关系。
- `references/index/reference-loading-map.md`
  - 更新 init 阶段题材模板加载规则。
- `references/genre-profiles.md`
  - 把 `project.genre` 文档表述修正为 `project_info.genre`，并标注 fallback 定位。
- `templates/output/state-schema.md`
  - 加入 `project_info.genre_label` 与 `project_info.genre_tags` 示例。

### 暂不改

- 不大规模重写 9 张核心 CSV 内容。
- 不删除 37 个模板。
- 不把 `templates/genres/` 立即拆成 `canonical/` 和 `presets/` 子目录。
- 不批量迁移用户已有项目的 `state.json`，只提供兼容读取。
- 不把 `genre-profiles.md` 重新升级为主真源。

## 分阶段计划

### Phase 1: Taxonomy Index 与模板校验

范围：

- 新增 `templates/genres/index.csv`。
- 覆盖现有 37 个模板。
- 把 `PLATFORM_TO_CANONICAL` 和 `_LEGACY_GENRE_MAP` 的所有 key/value 迁入 index。
- 所有模板 H1 中文化，去掉英文括号。
- 新增校验：
  - 实际 `templates/genres/*.md` 数量与 index `template_file` 双向一致。
  - 每个 `template_file` 存在且唯一。
  - 每个 `canonical_genre` 属于 15 canonical。
  - 每个 `label`/`alias` 唯一，不能映射到多个 canonical。

不改运行逻辑。

验证：

```powershell
(Get-ChildItem -Path webnovel-writer\templates\genres -Filter *.md | Measure-Object).Count
python -X utf8 webnovel-writer\scripts\validate_csv.py
```

### Phase 1.5: Resolver Contract 先落地

范围：

- 新增共享 taxonomy loader/resolver。
- 定义结构化 `GenreResolution`。
- 给 `reference_search.resolve_genre()`、`init_project` 模板解析、`genre_aliases` profile alias 写清楚委托关系。
- 在测试中先证明旧行为不丢：
  - `PLATFORM_TO_CANONICAL` 原有用例全部通过 index resolver。
  - `_LEGACY_GENRE_MAP` 原有用例全部通过 index resolver。
  - `_normalize_genre_key()` 原 alias 用例全部能解析到相同模板文件。

这一阶段的目标是拆掉“多真源”的设计风险，再进入调用点迁移。

### Phase 2: 迁移运行时调用点

范围：

- `reference_search.py` 删除硬编码映射，改用 taxonomy。
- `init_project.py` 删除本地 alias 字典，按 `GenreResolution.template_files` 加载模板。
- `story_system_engine.py` 保持 `_route()` 的 keyword/alias/fallback 顺序，内部 canonical resolve 改用同一 wrapper。
- `genre_aliases.py` 输入 alias 迁移到 taxonomy，profile key 只处理 profile section/key 兼容。

验证：

- `都市日常 -> 都市`
- `宫斗宅斗 -> 古言`
- `玄幻言情 -> 幻言`
- `规则怪谈 -> 悬疑`
- `网游 -> 游戏`
- `玄幻 -> canonical 玄幻，同时 init 模板可选中修仙.md`
- `克系 -> canonical 悬疑或按 index 配置，同时 init 模板选中克苏鲁.md`

### Phase 3: Init 写入与 schema 消费者修正

范围：

- `init_project.py` 写入 `project_info.genre`、`project_info.genre_label`、`project_info.genre_tags`。
- `skills/webnovel-plan/SKILL.md` 与 `skills/webnovel-write/SKILL.md` 的 genre 读取改为：
  - `project_info.genre` 优先。
  - legacy `project.genre` 兜底。
- `memory_contract_adapter.py` 与 `context_manager.py` 的 fallback 读取同样改为 `project_info` 优先。
- 更新 `templates/output/state-schema.md`。

兼容策略：

- 老项目只含 `project.genre` 时继续可读。
- 新项目不再写 `project.genre`。
- 非 canonical 老值通过 taxonomy resolver 兼容，不直接崩溃。

验证：

- init 新项目 state schema 测试。
- `webnovel-plan` / `webnovel-write` 中 shell snippet 的读取逻辑测试或文档 grep 校验。
- memory/context fallback 测试。

### Phase 4: Story System 真实 CSV 端到端验证

范围：

- 增加真实 CSV route 覆盖测试，使用 `webnovel-writer/references/csv/题材与调性推理.csv`。
- 对每个 route row 取第一个可用的 `关键词` / `意图与同义词` / `题材别名` / `题材/流派` 作为 query，调用 `StorySystemEngine(...).build(...)`。
- 断言：
  - 不抛 routing error。
  - `route.canonical_genre` 属于 15 canonical。
  - `route.genre_filter == route.canonical_genre`，除非 canonical 是空或 `全部`。
  - `route_source` 是预期集合之一：`keyword_or_alias_match`、`explicit_genre_fallback`、`inferred_genre_fallback`。
- 当前真实 CSV 是 26 rows，但测试应按实际行数动态覆盖，不写死 26 或 27。

验证：

```powershell
$env:PYTHONUTF8='1'; python -m pytest webnovel-writer\scripts\data_modules\tests\test_story_system_engine.py -q --no-cov
$env:PYTHONUTF8='1'; python -m pytest webnovel-writer\scripts\data_modules\tests\test_story_system_cli.py -q --no-cov
```

### Phase 5: Skill 与文档收口

范围：

- `webnovel-init/SKILL.md`
  - 主体题材展示 15 canonical。
  - preset/套路/形式用示例说明，不混入硬枚举。
- `references/csv/genre-canonical.md`
  - 明确 canonical、route tag、trope tag、format tag 的边界。
- `references/csv/README.md`
  - 写明 CSV 只接受 canonical，taxonomy index 负责用户输入层。
- `references/index/reference-loading-map.md`
  - 更新模板加载规则。
- `references/genre-profiles.md`
  - 明确 fallback 触发条件。

### Phase 6: 可选目录重构

只有前五阶段稳定后再做。

目标结构：

```text
templates/genres/
  index.csv
  canonical/
    都市.md
    玄幻.md
  presets/
    都市异能.md
    规则怪谈.md
    知乎短篇.md
```

这一步路径影响大，必须单独提交。

## genre-profiles.md Fallback 规则

`genre-profiles.md` 只在以下场景使用：

1. 老项目没有 Story Contracts，无法从 `.story-system` 取得 route/profile。
2. `story_contracts.master.route.primary_genre` 为空，且 protagonist/state fallback 有 genre。
3. 用户显式启用了 legacy profile fallback。

优先级：

1. Story Contracts 的 route/profile。
2. `project_info.genre_label` 或 `project_info.genre` 经 taxonomy resolve 后的结果。
3. legacy `project.genre`。
4. 配置项 fallback genre。

`genre_profile_excerpt` 只能作为补充 context，不能覆盖 Story System contract 的 route 决策。

## 建议提交拆分

1. `docs(genres): refine taxonomy convergence plan`
2. `chore(genres): add taxonomy index and normalize headings`
3. `feat(genres): add taxonomy resolver`
4. `refactor(genres): migrate genre resolution call sites`
5. `feat(init): persist canonical genre and genre tags`
6. `docs(genres): update skill and csv taxonomy guidance`
7. 可选：`refactor(genres): split canonical and preset templates`

## 风险与控制

- 风险：CSV index 变成又一份真源。
  控制：Phase 2 必须删除 Python 硬编码映射，所有 resolver 委托同一 loader。

- 风险：`玄幻 -> 修仙.md` 这类“canonical 与模板 preset 不同名”的历史行为丢失。
  控制：在 index 中显式建模为 `canonical_genre=玄幻`、`template_file=修仙.md`，并加回归测试。

- 风险：`系统流`、`知乎短篇` 等默认 canonical 有争议。
  控制：index 中标注 `label_type/template_type`，init 可在交互层展示 canonical 推断结果。

- 风险：Story System route 被 resolver 行为变化破坏。
  控制：Phase 4 使用真实 `题材与调性推理.csv` 全量 route rows 做端到端测试。

- 风险：schema 读取点漏改，继续读 `project.genre`。
  控制：Phase 3 增加 grep 校验和兼容读取测试，`project_info` 优先，legacy `project` 只兜底。

## 完成标准

- 37 个模板全部有 index 映射，且 index 与实际文件双向一致。
- 所有模板标题纯中文。
- `PLATFORM_TO_CANONICAL` 与 `_LEGACY_GENRE_MAP` 不再以硬编码 dict 存在。
- `_normalize_genre_key()` 不再维护本地 alias。
- `reference_search.py`、`init_project.py`、`genre_aliases.py` 使用同一 taxonomy resolver。
- 新 init 项目写入 canonical `project_info.genre`，并保存 `genre_label` 与 `genre_tags`。
- 老项目 `project.genre` 仍可兼容读取，但不是新写入 schema。
- 真实 Story System route CSV 全量端到端测试通过。
- `validate_csv.py`、prompt integrity 与全量 pytest 通过。
