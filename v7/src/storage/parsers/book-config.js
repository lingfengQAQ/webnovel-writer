import { parseYAML } from './yaml-safe.js'

/**
 * 解析 book.yaml 配置文件（平铺字段）。
 * @param {string} yamlString - book.yaml 文件内容
 * @returns {{ok: boolean, data: object|null, error: string}}
 */
export function parseBookConfig(yamlString) {
  const result = parseYAML(yamlString)

  if (!result.ok) {
    return {
      ok: false,
      data: null,
      error: `book.yaml 解析失败：${result.error}`,
    }
  }

  // 验证必需字段（spec §3）
  const requiredFields = ['spec_version', '书名', '类型', '每章目标字数', '卷规模']
  const missingFields = requiredFields.filter((field) => !(field in result.data))

  // 默认值（无论是否缺少必需字段，都合并可选字段的默认值）
  const defaults = {
    spec_version: '7.0',
    书名: '未命名',
    类型: '玄幻',
    每章目标字数: 3000,
    卷规模: 40,
    文体基线起: 1,
    文体基线止: 30,
    伏笔悬了太久章数: 10,
    悬念悬了太久章数: 10,
    感情线悬了太久章数: 30,
    连续弱钩上限: 3,
    关键章稿数: 3,
    自动确认细纲: false,
    连写批次大小: 8,
  }

  // 合并默认值（只覆盖 undefined 的字段）
  const mergedData = { ...defaults, ...result.data }

  return {
    ok: true,
    data: mergedData,
    error: '',
  }
}
