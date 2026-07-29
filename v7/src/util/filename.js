// Windows 保留设备名（F-10）：基名（首个点之前）命中即整名非法，CON.md 也建不出来
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/** 文件名净化：Windows 非法字符 <>:"/\|?* 与控制字符替成 _（标题本体不改,只净化文件名）；
 * 保留设备名前置 _ 消歧。 */
export function sanitizeFileName(title) {
  const s = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  if (!s) return '未命名'
  return WINDOWS_RESERVED.test(s.split('.')[0]) ? `_${s}` : s
}

/** 文件名干校验（P0-F1/F3）：AI 可控 id 字段进文件路径前的白名单。
 * 判定基准=「净化后与原值相同」，与 sanitizeFileName 单源，不另建黑名单：
 * 含路径分隔符/非法字符/控制字符必被改写而拒绝；. 开头拒绝 ../隐藏文件；
 * 保留设备名会被前置 _ 消歧而拒绝。校验拒绝而非静默净化——id 是语义标识，
 * 改写会造成 id 与文件名漂移。 */
export function isSafeFileStem(value) {
  const s = String(value ?? '')
  return s !== '' && !s.startsWith('.') && s === sanitizeFileName(s)
}
