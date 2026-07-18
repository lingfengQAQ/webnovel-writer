import { resolveBookKnowledge } from '../knowledge/index.js'

/**
 * knowledge-pack --类型=<题材> [--副题材=a,b] [--流派=a,b]：建书蒸馏材料包。
 * 按知识路由归一别名后输出命中条目全文；未命中如实列出（对谈共创降级，不报错）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'anywhere'

export async function run(args, options, ctx) {
  const 类型 = options['类型'] && options['类型'] !== true ? String(options['类型']) : ''
  if (!类型) return { ok: false, error: '请指定 --类型=<题材>（可运行 next --json 查看知识路由菜单）' }
  const 流派 =
    options['流派'] && options['流派'] !== true
      ? String(options['流派']).split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
      : []
  const 副题材 =
    options['副题材'] && options['副题材'] !== true
      ? String(options['副题材']).split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
      : []

  const r = await resolveBookKnowledge(ctx.packageRoot, { 类型, 副题材, 流派 })
  const lines = ['# 建书蒸馏材料包', '']

  if (r.题材命中) {
    lines.push(
      `归一结果：类型=${r.题材命中.名称}` +
        `${r.副题材命中.length ? `；副题材=${r.副题材命中.map((t) => t.名称).join('、')}` : ''}` +
        `${r.流派命中.length ? `；流派=${r.流派命中.map((t) => t.名称).join('、')}` : ''}`
    )
  }
  if (r.未命中.length) {
    lines.push(
      `知识库未命中：${r.未命中.map((item) => item.输入).join('、')}（${r.未命中.map((item) => `${item.维度}=${item.输入}`).join('、')}）——这部分走对谈共创，不伪装成知识库正式条目。`
    )
  }
  for (const warning of r.兼容提醒) lines.push(`兼容提醒：${warning}`)
  lines.push('')

  const entries = [r.题材命中, ...r.副题材命中, ...r.流派命中].filter(Boolean)
  let hasContent = false
  for (const e of entries) {
    if (!e.content) {
      lines.push(`## ${e.名称}`, '', '（条目待补——按对谈共创处理）', '')
      continue
    }
    hasContent = true
    lines.push(`<!-- 来源：${e.来源版本 || e.条目} -->`, e.content.trim(), '')
  }
  if (!hasContent && !r.未命中.length) {
    lines.push('（知识库无可用条目，蒸馏全程对谈共创）')
  }
  lines.push(
    '---',
    '蒸馏方法：逐节对撞——「库怎么说 → 作者怎么定」。路由只归一名称，不决定创意、人物、剧情或写法。',
    '创意约束尚未决定时，按真实未决问题运行 knowledge-query --维度=创意约束 --问题=<问题>，最多取 3 条；也可直接自定义。',
    '最终由作者确认作品契约；persist-book JSON 必须带 作者已确认:true、知识选择和完整作品契约。',
    '作品契约 front matter：类型 / 副题材 / 流派 / 创意约束 / 来源版本 / 契约版本:1 / 生效起章:1 / 更新原因 / 变更类型:建书。',
    '正文小节：核心读者承诺 / 骨架约定 / 题材融合协议 / 创意约束落地 / 差异化点（至少3条）/ 冲突与关系结算原则 / 本书专属毒点 / 节奏与兑现参数。'
  )
  return { ok: true, output: lines.join('\n') }
}
