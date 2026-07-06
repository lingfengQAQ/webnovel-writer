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
    return `"${escapeDoubleQuoted(value)}"`
  }

  return value
}

/**
 * 双引号标量的完整转义：反斜杠必须最先转，随后引号与控制字符——
 * 漏任何一类都会让写出的 front matter 自己读不回（R8）。
 */
function escapeDoubleQuoted(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // 其余 C0 控制字符转 \xXX，防不可见字符炸解析
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/**
 * 判断字符串是否需要引号（防止被 YAML 误判类型）。
 * @param {string} value
 * @returns {boolean}
 */
function needsQuoting(value) {
  // 空串裸写会变 null；前后空格裸写会被裁
  if (value === '' || value !== value.trim()) {
    return true
  }

  // 数字形态全家：整数/浮点/带符号/科学计数（1e3、+5、-2.5E-3）
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    return true
  }

  // 进制前缀数字：0x1F / 0o17 / 0b101
  if (/^0[xX][0-9a-fA-F]+$/.test(value) || /^0[oO][0-7]+$/.test(value) || /^0[bB][01]+$/.test(value)) {
    return true
  }

  // 特殊浮点字面值：.inf / .nan（含符号与大小写变体）
  if (/^[+-]?\.(inf|Inf|INF)$/.test(value) || /^\.(nan|NaN|NAN)$/.test(value)) {
    return true
  }

  // 布尔字面值：true/false/True/False/TRUE/FALSE → "true"
  if (/^(true|false|True|False|TRUE|FALSE)$/i.test(value)) {
    return true
  }

  // null 字面值：null/Null/NULL/~ → "null"
  if (/^(null|Null|NULL|~)$/.test(value)) {
    return true
  }

  // 含冒号（YAML 键值分隔符）：A:B → "A:B"
  if (value.includes(':')) {
    return true
  }

  // 空格+井号 = 行内注释起点，后半截会被当注释吞掉
  if (value.includes(' #')) {
    return true
  }

  // 起首 YAML 指示符/引号/别名锚点等：[ ] { } * & ! | > @ % ` " ' , 以及 # 与 ? 后随空白
  if (/^[[\]{}*&!|>@%`"',#]/.test(value) || /^\?(\s|$)/.test(value)) {
    return true
  }

  // 以 - 开头（列表项）：-item → "-item"
  if (value.startsWith('-')) {
    return true
  }

  // 包含换行/制表等控制字符
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(value)) {
    return true
  }

  return false
}
