---
name: webnovel-learn
description: 从当前会话提取成功模式并写入 project_memory.json
allowed-tools: Read Bash
---

# /webnovel-learn

## Project Root Guard（必须先确认）

- 必须在项目根目录执行（需存在 `.webnovel/state.json`）
- 使用统一入口解析项目根，避免写错目录：

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

## 目标
- 提取可复用的写作模式（钩子/节奏/对话/微兑现等）
- 追加到 `.webnovel/project_memory.json`

## 输入
```bash
/webnovel-learn "本章的危机钩设计很有效，悬念拉满"
```

## 输出
```json
{
  "status": "success",
  "learned": {
    "pattern_type": "hook",
    "description": "危机钩设计：悬念拉满",
    "source_chapter": 100,
    "learned_at": "2026-02-02T12:00:00Z"
  }
}
```

## 执行流程
1. 读取 `"$PROJECT_ROOT/.webnovel/state.json"`，获取当前章节号（progress.current_chapter）
2. 解析用户输入，归类 pattern_type（hook/pacing/dialogue/payoff/emotion/format/other）
3. 必须调用脚本写入，不得手写或拼接 JSON：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" project-memory add-pattern \
  --pattern-type "{pattern_type}" \
  --description "{用户输入或提炼后的完整描述}" \
  --category "{分类，可空}" \
  --importance "{high|medium|low}"
```

脚本会自动读取/初始化 `.webnovel/project_memory.json`，并用 JSON 序列化写回，自动转义英文双引号、换行等字符。

## 约束
- 不删除旧记录，仅追加
- 避免完全重复的 description（可去重）
- 禁止使用 `Write` 或手工编辑 `.webnovel/project_memory.json`

## 去重规则

- 追加前扫描已有 `patterns` 数组
- 若存在 `pattern_type` + `description` 完全相同的记录，跳过并告知用户
- 部分相似不去重，由用户判断

## 成功标准

- `project_memory.json` 存在且格式合法
- 新 pattern 已追加到 `patterns` 数组
- 输出包含 `status: success` 和完整 `learned` 对象

## 失败恢复

| 故障 | 恢复方式 |
|------|---------|
| `project_memory.json` 不存在 | 自动初始化 `{"patterns": []}` 后继续 |
| JSON 解析失败 | 不写入脏数据，告知用户文件损坏并建议手动修复 |
| `state.json` 缺失导致无法获取章节号 | 使用 `source_chapter: null`，不阻断 |
| 用户输入无法归类 | 使用 `pattern_type: "other"`，不阻断 |
