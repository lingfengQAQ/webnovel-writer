---
name: blocking-override-guidelines
purpose: review Step 6 blocking issue 用户裁决参考
---

# Blocking Override Guidelines

> 主服务 skill: `webnovel-review` Step 6
> 次服务 skill: `webnovel-write` Step 3（blocking 循环时参考）
> 内容层级: 提醒层 / 缺陷补偿层 / 知识补充层

---

## 提醒层

- 只有用户明确承担风险时才允许 override blocking issue
- override 不等于"问题不存在"，而是"用户决定接受后果"
- override 后仍应在审查报告中保留原始 issue 记录

## 缺陷补偿层

以下情况**禁止建议 override**：

- issue 涉及**设定冲突**（角色能力、世界规则、势力关系与设定集矛盾）
- issue 涉及**时间线冲突**（事件顺序、时间跨度与已有章节矛盾）
- issue 涉及**事实错误**（角色死亡后复活、已销毁道具再次出现等）
- issue 涉及**连续性断裂**（上章结尾与本章开头无法衔接）

以下情况**可以考虑 override**（但仍需用户确认）：

- issue 是**节奏偏差**（本章偏慢/偏快，但不影响剧情正确性）
- issue 是**风格建议**（对话过于书面化、描写密度偏高等）
- issue 是**结构化节点未完全覆盖**（可选节点未落地，但必须节点已覆盖）

## 知识补充层

### 可 override 的典型场景

1. **过渡章节奏偏慢**：reviewer 报告 pacing_score 低，但本章是故意铺垫，用户确认后 override
2. **对话风格偏书面**：reviewer 标记 ai_flavor，但角色设定就是学者/官员，书面语合理
3. **可选节点未覆盖**：CPN 中某个可选推进节点在正文中隐含但未显式展开

### 不可 override 的典型场景

1. **角色能力超出当前境界**：主角使用了尚未觉醒的能力
2. **地点穿越**：上章在 A 城，本章无交代突然在 B 城
3. **已死角色复活**：被明确写死的角色在后续章节中出现
