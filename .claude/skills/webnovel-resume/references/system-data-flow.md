---
name: system-data-flow-redirect
purpose: 重定向到权威版本
---

<context>
此文件已迁移到统一位置，避免多版本不同步问题。
v5.4：版本号对齐，权威版本已更新。
</context>

<instructions>

## 权威版本位置

`skills/webnovel-query/references/system-data-flow.md` (v5.4)

## 加载方式

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-query/references/system-data-flow.md"
```

## 快速参考

### 目录结构
```
项目根目录/
├── 正文/           # 章节文件
├── 大纲/           # 卷纲/章纲
├── 设定集/         # 世界观/力量体系/角色卡
└── .webnovel/
    ├── state.json          # 权威状态
    ├── workflow_state.json # 工作流断点
    ├── index.db            # SQLite 索引
    └── archive/            # 归档数据
```

### v5.1 核心变化
- **双 Agent 架构**: Context Agent (读) + Data Agent (写)
- **无 XML 标签**: 纯正文写作，Data Agent AI 自动提取实体
- **SQLite 存储**: entities/aliases/state_changes 迁移到 index.db
- **state.json 精简**: 保持 < 5KB，仅存 protagonist_state 和 plot_threads

</instructions>
