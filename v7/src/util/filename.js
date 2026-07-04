/** 文件名净化：Windows 非法字符 <>:"/\|?* 与控制字符替成 _（标题本体不改,只净化文件名）。 */
export function sanitizeFileName(title) {
  const s = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return s || '未命名'
}
