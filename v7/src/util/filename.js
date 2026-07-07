// Windows 保留设备名（F-10）：基名（首个点之前）命中即整名非法，CON.md 也建不出来
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/** 文件名净化：Windows 非法字符 <>:"/\|?* 与控制字符替成 _（标题本体不改,只净化文件名）；
 * 保留设备名前置 _ 消歧。 */
export function sanitizeFileName(title) {
  const s = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  if (!s) return '未命名'
  return WINDOWS_RESERVED.test(s.split('.')[0]) ? `_${s}` : s
}
