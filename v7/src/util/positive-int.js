/**
 * 章号/卷号统一解析口径（P0-F5）：只接受十进制正整数。
 * 替换各命令里「Number() + isNaN」的写法——isNaN 拦不住 "3.5" 截断歧义、
 * "1e3" 科学计数、"03" 前导零、负数与 0，这些都不合法。
 * @param {*} value 命令行参数或 payload 字段
 * @returns {number|null} 正整数，非法一律 null（调用方配人话报错）
 */
export function parsePositiveInt(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }
  const s = String(value ?? '').trim()
  return /^[1-9][0-9]*$/.test(s) ? Number(s) : null
}
