# 技术设计：DTO 静默降级显式标记（F6）

## 1. 核心机制：降级事件收集器（ctx 随行，不改函数签名链）

约 21 处降级点分散在 adapters/prep/review，逐层改返回值签名会把 `{ok, data, error}` 契约搅乱。改为**事件收集**：

```js
// src/util/degradation.js（新增，单源）
export function createDegradationCollector() {
  const events = []
  return {
    report(site, reason) { events.push({ site, reason: String(reason).slice(0, 200) }) },
    drain() { return events.splice(0) },
    get size() { return events.length },
  }
}
```

- 收集器挂 `ctx.degradation`（ctx 已贯穿命令→组装→adapter 全链，零签名改动）。
- adapter 在**有损降级**点调 `ctx.degradation?.report('ChapterReader.read', err.message)`——可选链保证无收集器时零影响（测试/旧调用点不炸）。
- DTO 组装收口处（备料 `prep/index.js`、两审 `review/index.js` assembleReviewInput、状态机 `state-machine/dto.js`）`drain()` 非空才写 `degraded` 字段。

## 2. 三分类落点（S0 清单决定，先验假设）

| 分类 | 处理 | 例 |
|---|---|---|
| 有损降级（读失败→空/残缺继续） | `report()` → DTO `degraded` | 缓存坏且文件读也失败仍返回空列表 |
| 良性降级（缓存坏→文件读成功） | 不进 DTO；`report` 到诊断通道（工作区/.救援/ 或忽略，S0 裁决） | ChapterReader 缓存 miss 转文件 |
| 合理吞错（语义「没有」） | 不动 | readdir ENOENT=首个条目 |

判定原则：**看降级后数据是否与真源等价**。等价=良性；不等价（缺料）=有损。

## 3. DTO 字段契约

```json
"degraded": [{ "site": "ChapterReader.read", "reason": "SQLITE_CORRUPT: ..." }]
```

- 无事件不出现该键（旧断言零改动）；出现即非空数组。
- `persist.js` 侧：序 0-6 各 DTO 的「期望产物」说明同步补 degraded 语义（R4 对称结构公约，spec 0.14 决策 34 同款纪律）。
- reason 截断 200 字符——DTO 是给 AI 的材料不是日志。

## 4. SKILL/角色任务书消费约定（一句话，最小侵入）

- SKILL 写章流程备料步骤 + 两审任务书各加一句：材料含 `degraded` 时先向作者呈报缺料位置与原因，作者确认后才继续。
- 改 SKILL 必须重渲染四宿主壳（drift check 硬门）。

## 5. 测试形状

- 单测：collector 纯函数；adapter 注入坏 cache（DI 现成故障注入模式）断言 report 语义。
- 集成：备料/审稿输入两条链的故障注入端到端（AC 场景）；无故障链路断言键不存在。

## 6. 回滚

事件收集是旁路：删 collector 挂载 + drain 写入两点即回原状；不动存储格式。
