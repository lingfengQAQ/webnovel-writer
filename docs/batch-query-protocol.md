# 批量查询协议

## 接口

```bash
python webnovel.py --project-root {path} batch-query --queries '[
    {"type": "get-recent-reading-power", "limit": 5},
    {"type": "get-core-entities"},
    {"type": "recent-appearances", "limit": 20}
]'
```

## 返回格式

```json
{
  "get-recent-reading-power": [...],
  "get-core-entities": [...],
  "recent-appearances": [...]
}
```

## 支持的查询类型

| type | 说明 | 参数 |
|------|------|------|
| get-recent-reading-power | 获取最近章节追读力元数据 | limit: int (默认5) |
| get-pattern-usage-stats | 获取爽点模式使用统计 | last_n: int (默认20) |
| get-hook-type-stats | 获取钩子类型使用统计 | last_n: int (默认20) |
| get-debt-summary | 获取追读力债务汇总 | 无 |
| get-core-entities | 获取核心实体列表 | 无 |
| recent-appearances | 获取最近出场记录 | limit: int (默认20) |
