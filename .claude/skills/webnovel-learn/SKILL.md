---
name: webnovel-learn
description: 从当前会话提取成功模式并写入 project_memory.json
allowed-tools: Read Write Bash
---

# /webnovel-learn

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
1. 读取 `.webnovel/state.json`，获取当前章节号（progress.current_chapter）
2. 读取 `.webnovel/project_memory.json`，若不存在则初始化 `{"patterns": []}`
3. 解析用户输入，归类 pattern_type（hook/pacing/dialogue/payoff/emotion）
4. 追加记录并写回文件

## 约束
- 不删除旧记录，仅追加
- 避免完全重复的 description（可去重）
