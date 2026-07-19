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
  if (r.副题材命中.length) {
    lines.push(
      '## 题材融合协议检查',
      '',
      '- 共同核心冲突：主题材与副题材围绕同一个长期问题持续施压。',
      '- 主题材承诺与主线因果：主题材决定核心读者承诺及主线为何向前。',
      '- 副题材介入条件与独立贡献：写明何时介入，以及移除后会失去什么因果。',
      '- 规则兼容或隔离：冲突规则必须解释统一、优先级或隔离边界。',
      '- 主副线职责：说明各自推动的对象，避免两套故事轮流出现。',
      '- 冲突解决方式：规则或承诺冲突时，写明本书采用的取舍。',
      '- 主要失焦风险：列出最可能让主题材失焦或让副题材只剩标签的失败方式。',
      '',
      '标签出现次数不能证明融合成立；同一组题材可以形成不同融合协议。',
      ''
    )
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
