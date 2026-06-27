import * as yaml from 'js-yaml'

/**
 * 安全解析 YAML 字符串（容错，不抛异常）。
 * @param {string} yamlString - YAML 字符串
 * @param {object} options - 选项（preserveUnknown 默认 true）
 * @returns {{ok: boolean, data: object|null, error: string, raw: string}}
 */
export function parseYAML(yamlString, options = {}) {
  const preserveUnknown = options.preserveUnknown !== false

  if (typeof yamlString !== 'string') {
    return {
      ok: false,
      data: null,
      error: 'YAML 内容必须是字符串',
      raw: '',
    }
  }

  // 空字符串视为空对象（合法）
  if (yamlString.trim() === '') {
    return {
      ok: true,
      data: {},
      error: '',
      raw: yamlString,
    }
  }

  try {
    const data = yaml.load(yamlString, { schema: yaml.DEFAULT_SCHEMA })

    // js-yaml.load 可能返回 null（空文档）、非对象类型
    if (data === null || data === undefined) {
      return {
        ok: true,
        data: {},
        error: '',
        raw: yamlString,
      }
    }

    if (typeof data !== 'object' || Array.isArray(data)) {
      return {
        ok: false,
        data: null,
        error: 'YAML 根节点必须是对象（不能是数组或标量）',
        raw: yamlString,
      }
    }

    return {
      ok: true,
      data: data,
      error: '',
      raw: yamlString,
    }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err.message || 'YAML 解析失败',
      raw: yamlString,
    }
  }
}
