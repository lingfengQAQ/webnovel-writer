/**
 * 将 JS 对象序列化为符合防呆方言的 YAML 字符串。
 * 规则：
 * 1. 一律平铺（检测嵌套抛错）
 * 2. 数组输出块格式（\n- item）
 * 3. 危险值加引号（数字串/true/false/null/含冒号）
 * 4. 两空格缩进
 * @param {object} data - JS 对象（必须平铺）
 * @returns {string} YAML 字符串
 */
export function serializeYAML(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('serializeYAML 只接受非空对象（不能是数组或 null）')
  }

  const lines = []

  for (const [key, value] of Object.entries(data)) {
    // 检测嵌套映射（违反防呆方言）
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      throw new Error(`防呆方言禁止嵌套映射：字段「${key}」的值是对象。所有字段必须平铺到顶层。`)
    }

    // 数组：块格式（一行一条）
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) {
        const serializedItem = serializeValue(item)
        lines.push(`  - ${serializedItem}`)
      }
      continue
    }

    // 标量：加引号判断
    const serializedValue = serializeValue(value)
    lines.push(`${key}: ${serializedValue}`)
  }

  return lines.join('\n')
}

/**
 * 序列化单个值（判断是否需要引号）。
 * @param {any} value
 * @returns {string}
 */
function serializeValue(value) {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  if (typeof value !== 'string') {
    throw new Error(`不支持的值类型：${typeof value}`)
  }

  // 字符串：判断是否需要引号
  if (needsQuoting(value)) {
    // 简单引号转义（双引号内的双引号转义为 \"）
    const escaped = value.replace(/"/g, '\\"')
    return `"${escaped}"`
  }

  return value
}

/**
 * 判断字符串是否需要引号（防止被 YAML 误判类型）。
 * @param {string} value
 * @returns {boolean}
 */
function needsQuoting(value) {
  // 纯数字字符串：123 → "123"
  if (/^\d+$/.test(value)) {
    return true
  }

  // 浮点数：1.23 → "1.23"
  if (/^\d+\.\d+$/.test(value)) {
    return true
  }

  // 布尔字面值：true/false/True/False/TRUE/FALSE → "true"
  if (/^(true|false|True|False|TRUE|FALSE)$/i.test(value)) {
    return true
  }

  // null 字面值：null/Null/NULL → "null"
  if (/^(null|Null|NULL)$/i.test(value)) {
    return true
  }

  // 含冒号（YAML 键值分隔符）：A:B → "A:B"
  if (value.includes(':')) {
    return true
  }

  // 以 # 开头（注释）：#comment → "#comment"
  if (value.startsWith('#')) {
    return true
  }

  // 以 - 开头（列表项）：-item → "-item"
  if (value.startsWith('-')) {
    return true
  }

  // 包含换行符
  if (value.includes('\n')) {
    return true
  }

  return false
}
