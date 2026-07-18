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

  // 默认值（缺字段一律套默认——book.yaml 大部分字段可选，运行时永远给全量配置）
  const defaults = {
    spec_version: '7.0',
    书名: '未命名',
    类型: '玄幻',
    副题材: [],
    流派: [],
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
    连写无条目变动上限: 3,
  }

  // 合并默认值（只覆盖 undefined 的字段）
  const mergedData = { ...defaults, ...result.data }
  // 防呆方言中的空块列表会被 YAML 解析为 null；运行时统一给调用者数组。
  for (const field of ['副题材', '流派']) {
    if (mergedData[field] == null) mergedData[field] = []
  }

  return {
    ok: true,
    data: mergedData,
    error: '',
  }
}
