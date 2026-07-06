/**
 * 实体类型值归一单源（R5/G-2/G-3）：名册「类型」列是作者域（写中文），
 * 缓存 entities.type 是机器域（存英文 machine 值）——本函数是唯一的翻译点。
 * 英文旧值恒等收纳（存量书无损）；未知值原样保留（不猜）。
 */
const TYPE_MAP = new Map([
  ['角色', 'character'],
  ['地点', 'location'],
  ['组织', 'organization'],
  ['势力', 'organization'],
  ['物品', 'item'],
  ['character', 'character'],
  ['location', 'location'],
  ['organization', 'organization'],
  ['item', 'item'],
])

/**
 * @param {string|undefined} raw 名册「类型」单元格原文
 * @returns {string} 机器域类型值；空值默认 character
 */
export function normalizeEntityType(raw) {
  const v = String(raw ?? '').trim()
  if (!v) return 'character'
  return TYPE_MAP.get(v) || v
}
