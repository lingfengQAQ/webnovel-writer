# Agent 中间层协议 (Agent Middleware Protocol)

## 概述

本协议定义了主Agent与子Agent之间的文件交换规范，实现上下文隔离。

## 中间文件命名规范

| 文件类型 | 命名格式 | 内容 |
|----------|----------|------|
| Context Agent 输出 | `ctx_ch{NNNN}.json` | 创作执行包摘要 |
| 审查器组1输出 | `rev1_ch{NNNN}.json` | 一致性+连贯性+OOC审查结果 |
| 审查器组2输出 | `rev2_ch{NNNN}.json` | 追读力+爽点+节奏审查结果 |
| Data Agent 输出 | `data_ch{NNNN}.json` | 状态更新确认 |

## 版本号规范

```json
{
  "version": "1.0",
  "chapter": 100,
  "timestamp": "2026-03-26T10:00:00Z",
  "checksum": "sha256:..."
}
```

## 写入协议

1. 写入前先写 `.tmp` 文件
2. 完成后 rename 到正式位置
3. 读取前检查 checksum

## 目录结构

```
.webnovel/tmp/agent_outputs/
├── ctx_ch0100.json       # Context Agent
├── rev1_ch0100.json      # 审查器组1
├── rev2_ch0100.json      # 审查器组2
├── data_ch0100.json      # Data Agent
└── .lock/                # 锁文件目录
```

## 上下文隔离原则

1. **主Agent最小化上下文** - 只保留当前章必需信息
2. **Agent间通过文件交换** - 不依赖内存传递
3. **分组并行审查** - 减少窗口数量，同时保持隔离
4. **结果摘要化** - 每个Agent只返回关键结论，不返回完整处理过程