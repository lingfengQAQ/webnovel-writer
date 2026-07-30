/**
 * 降级事件收集器（P1-F6）：ctx 随行的旁路通道。
 * 有损降级（读失败→空/残缺数据继续组装 DTO）在各降级点 report，DTO 组装收口处 drain，
 * 非空才写 `degraded` 字段——AI 据此区分「没有数据」与「读取失败后的残缺数据」。
 * 良性降级（缓存坏→文件读成功，数据与真源等价）不进此通道，避免狼来了。
 *
 * 用法：ctx.degradation?.report(site, reason)——可选链保证无收集器时零影响
 * （测试/旧调用点的 ctx 没有 degradation 键，天然兼容）。
 */
export function createDegradationCollector() {
  const events = []
  return {
    /**
     * @param {string} site 发生位置（如 'SecretReader.listUnrevealed'）
     * @param {*} reason 原因摘要（归一为字符串，截断 200——DTO 是给 AI 的材料不是日志）
     */
    report(site, reason) {
      events.push({ site: String(site), reason: String(reason ?? '').slice(0, 200) })
    },
    /** 取走全部事件并清空（DT0 组装收口处调用一次）。 */
    drain() {
      return events.splice(0)
    },
    get size() {
      return events.length
    },
  }
}
