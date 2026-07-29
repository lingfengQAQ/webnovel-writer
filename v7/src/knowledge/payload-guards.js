import { isSafeFileStem } from '../util/filename.js'
import { parsePositiveInt } from '../util/positive-int.js'

/**
 * finalize payload 路径类字段校验（P0-F1/F2）。
 * AI 可控字段进入文件路径前的源头防线：secretWrites[].id 必须是安全文件名干，
 * timelineRows[].volumeNum 必须是正整数。
 * 与 fact-changes.js 同哲学——纯校验同时供 finalize 与 staging 两链路使用
 * （R6 两链路 import 同一函数），避免校验口径漂移。
 * 校验失败人话报错并带索引定位（secretWrites[i].id），AI 可改 payload 重试。
 *
 * @param {object} payload 定稿包
 * @returns {{ok: boolean, error: string}}
 */
export function validateFinalizePayloadPaths(payload) {
  const errors = []
  const secretWrites = payload?.secretWrites
  if (secretWrites !== undefined && !Array.isArray(secretWrites)) {
    errors.push('secretWrites 必须是数组')
  } else if (Array.isArray(secretWrites)) {
    for (let i = 0; i < secretWrites.length; i++) {
      const id = secretWrites[i]?.id
      if (!isSafeFileStem(id)) {
        errors.push(`secretWrites[${i}].id 信息差编号「${String(id ?? '（空）')}」含非法字符，不能用作文件名`)
      }
    }
  }
  const timelineRows = payload?.timelineRows
  if (timelineRows !== undefined && !Array.isArray(timelineRows)) {
    errors.push('timelineRows 必须是数组')
  } else if (Array.isArray(timelineRows)) {
    for (let i = 0; i < timelineRows.length; i++) {
      const volumeNum = timelineRows[i]?.volumeNum
      const parsed = parsePositiveInt(volumeNum)
      if (parsed === null) {
        errors.push(`timelineRows[${i}].volumeNum 时间线卷号必须是正整数，收到「${String(volumeNum ?? '（空）')}」`)
      }
    }
  }
  return { ok: errors.length === 0, error: errors.join('；') }
}
