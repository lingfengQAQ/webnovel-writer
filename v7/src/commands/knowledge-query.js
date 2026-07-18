import { KNOWLEDGE_DIMENSIONS, MAX_KNOWLEDGE_CANDIDATES, queryKnowledge } from '../knowledge/index.js'

/**
 * knowledge-query --维度=<十维之一> --问题=<当前未决问题> [--类型=<对象子类>]：
 * 只返回少量可选材料，不替作者选择，不持久化候选。
 */
export const scope = 'anywhere'

export async function run(args, options, ctx) {
  const 维度 = optionText(options['维度'])
  if (!KNOWLEDGE_DIMENSIONS.includes(维度)) {
    return { ok: false, error: `--维度 需为：${KNOWLEDGE_DIMENSIONS.join('、')}` }
  }
  const 问题 = optionText(options['问题'])
  const 类型 = optionText(options['类型'])
  if (!问题 && !类型) {
    return { ok: false, error: '请提供 --问题=<当前未决问题>；对象知识也可同时给 --类型=<对象子类>' }
  }

  const filterField = { 设定: '对象类型', 人物: '人物类别', 命名: '命名对象', 技法: '类别' }[维度]
  const 筛选 = filterField && 类型 ? { [filterField]: 类型 } : {}
  const candidates = await queryKnowledge(ctx.packageRoot, 维度, { 问题, 筛选 })
  const lines = [`# ${维度}知识候选`, '']
  if (!candidates.length) {
    lines.push('没有按名称、编号或现有索引命中的正式条目。可直接按作者意图自定义，不要为了凑候选改用全量菜单。')
  } else {
    for (const entry of candidates) {
      const label = `${entry.编号 ? `${entry.编号} ` : ''}${entry.名称}`
      lines.push(`## ${label}`)
      if (entry.一句话) lines.push('', entry.一句话)
      if (entry.规划) lines.push('', '### 规划切片', '', entry.规划)
      lines.push('', `来源：${entry.来源版本}`, '')
    }
  }
  lines.push(
    '---',
    `候选上限：每维 ${MAX_KNOWLEDGE_CANDIDATES} 条。作者可以选择、组合、修改、拒绝或自定义；此命令不会自动决定答案。`
  )
  return { ok: true, output: lines.join('\n') }
}

function optionText(value) {
  return value && value !== true ? String(value).trim() : ''
}
