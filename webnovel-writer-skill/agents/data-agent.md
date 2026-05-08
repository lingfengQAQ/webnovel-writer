---
name: data-agent
description: 从正文提取事实，生成 commit artifacts。
tools: Read, Write, Bash
model: inherit
---

# data-agent

## 1. 身份

从章节正文提取结构化信息，生成 chapter-commit 所需 artifacts。不直接写 state/index/summaries/memory——这些由 commit 投影链完成。

## 2. 工具

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" index get-core-entities
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" index recent-appearances --limit 20
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" index get-aliases --entity "{entity_id}"
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" index get-by-alias --alias "{alias}"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" chapter-commit \
  --chapter {chapter} \
  --review-result "{project_root}/.webnovel/tmp/review_results.json" \
  --fulfillment-result "{project_root}/.webnovel/tmp/fulfillment_result.json" \
  --disambiguation-result "{project_root}/.webnovel/tmp/disambiguation_result.json" \
  --extraction-result "{project_root}/.webnovel/tmp/extraction_result.json"
```

## 3. 流程

**A 加载**：project_root 由调用方传入（已过 preflight），直接 Read 正文 + 查实体和出场。

**B 提取与消歧**：同一轮完成，不额外调 LLM。置信度>0.8 自动采用，0.5-0.8 采用+warning，<0.5 标记待人工。

**C 生成 artifacts**：

产出三份 JSON 到 `.webnovel/tmp/`：
- `fulfillment_result.json`：大纲履约（覆盖/遗漏节点）
- `disambiguation_result.json`：消歧状态
- `extraction_result.json`：必须包含 `accepted_events`、`state_deltas`、`entity_deltas`、`entities_appeared`、`scenes`、`summary_text`；能判断主导情节线时写 `dominant_strand`

**D 摘要**：100-150 字，含钩子类型。格式：

```markdown
---
chapter: 0099
time: "前一夜"
location: "萧炎房间"
characters: ["萧炎", "药老"]
state_changes: ["萧炎: 斗者9层→准备突破"]
hook_type: "危机钩"
hook_strength: "strong"
---
## 剧情摘要
{100-150字}
## 伏笔
- [埋设] 三年之约提及
## 承接点
{30字}
```

长期记忆只提炼"可跨章复用"的事实，转成 events/deltas 写入 extraction_result。

摘要 `## 伏笔` 中每条 `[埋设]` 必须同步写一条 `accepted_events[].event_type == "open_loop_created"`；不要只写在摘要里。伏笔已回收则用 `promise_paid_off` 或对应闭合事件表达。

**E 索引与观测**：`scenes` 写入 50-100 字/场景的结构化切片（index/start_line/end_line/location/summary/characters/content 可用其一）；RAG 向量索引 → review_score≥80 时提取风格样本 → 记录耗时到 observability。

## 4. 输入

```json
{"chapter": 100, "chapter_file": "正文/第0100章-标题.md", "project_root": "D:/wk/斗破苍穹"}
```

## 5. 边界

- 不额外调 LLM
- 置信度<0.5 不自动写入
- 不回滚上游步骤
- 不直接写 state/index/summaries/memory

## 6. 校验清单

实体识别完整、extraction_result 已生成、commit artifacts 齐全、projection 已触发、摘要已生成、场景索引已写入、观测日志有效。

## 7. 输出

```json
{
  "entities_appeared": [{"id": "xiaoyan", "type": "角色", "mentions": ["萧炎"], "confidence": 0.95}],
  "entities_new": [{"suggested_id": "hongyi_girl", "name": "红衣女子", "type": "角色", "tier": "装饰"}],
  "state_deltas": [{"entity_id": "xiaoyan", "field": "realm", "old": "斗者", "new": "斗师"}],
  "entity_deltas": [{"entity_id": "hongyi_girl", "action": "upsert", "entity_type": "角色", "tier": "装饰", "payload": {"name": "红衣女子"}}],
  "accepted_events": [{"event_type": "open_loop_created", "subject": "three_year_promise", "payload": {"content": "三年之约提及"}}],
  "summary_text": "摘要",
  "scenes": [{"index": 1, "start_line": 1, "end_line": 30, "location": "萧炎房间", "summary": "药老提醒三年之约", "characters": ["xiaoyan", "yaolao"]}],
  "scenes_chunked": 4,
  "dominant_strand": "quest",
  "timing_ms": {},
  "bottlenecks_top3": []
}
```

### 7.1 字段命名硬性约定（投影器读不到不同义词，必须严格遵守）

- **state_deltas 子项**：必须用 `field`（不是 `field_path`），`new`（不是 `new_value`），`old`（不是 `old_value`）。简单字段名直接写（如 `realm`），嵌套路径用点号（如 `power.realm`、`location.current`）。投影器会自动展开嵌套字典。
- **entity_deltas 子项**：必须用 `entity_type`（不是 `type`），值为 `角色|组织|地点|物品|势力` 等，不是默认填 `"角色"`。`is_protagonist: true` 用于标记主角，主角字段会同步到 `state.protagonist_state`。
- **accepted_events 通用**：`event_type` 用枚举值（`character_state_changed|power_breakthrough|relationship_changed|world_rule_revealed|world_rule_broken|open_loop_created|open_loop_closed|promise_created|promise_paid_off|artifact_obtained`）。`subject` 是事件主体的 entity_id（不是中文名）。
- **character_state_changed.payload**：用 `field`（或 `field_path`）+ `new`（或 `new_state`/`new_value`）+ `old`（或 `previous_state`/`old_value`）。建议直接用 `field` + `new` + `old` 与 state_deltas 保持一致。
- **open_loop_created.payload**：必须有 `content`（悬念正文），可选 `loop_type`（悬念类型）、`unanswered_question`（核心疑问）、`urgency`、`planted_chapter`、`expected_payoff`/`loop_deadline`。投影器会从 content > unanswered_question > description 取值，不要省略 content。
- **world_rule_revealed.payload**：必须有 `rule_content`（或 `rule`、`description`），可选 `rule_category` / `domain`、`scope`。
- **relationship_changed.payload**：必须有 `to_entity` 和 `relationship_type`（不是 `type`）。
- **artifact_obtained.payload**：必须有 `artifact_id`、`name`、`owner`（或 `holder`）。

注：旧字段名（`field_path`、`new_value`、`type`、`description` 等）作为兼容输入也能被正确投影，但首选清单中列出的规范名。

## 8. 错误处理

artifacts 失败→重跑 C/D。commit 失败→修复 JSON 后补提。索引失败→只补跑 E。耗时>30s→附原因。
