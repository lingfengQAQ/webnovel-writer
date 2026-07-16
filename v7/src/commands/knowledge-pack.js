import { resolveBookTags } from '../knowledge/index.js'

/**
 * knowledge-pack --类型=<题材> [--流派=a,b]：建书蒸馏材料包（spec §6.3）。
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

  const r = await resolveBookTags(ctx.packageRoot, { 类型, 流派 })
  const lines = ['# 建书蒸馏材料包', '']

  if (r.题材命中) {
    lines.push(`归一结果：类型=${r.题材命中.名称}${r.流派命中.length ? `；流派=${r.流派命中.map((t) => t.名称).join('、')}` : ''}`)
  }
  if (r.未命中.length) {
    lines.push(`知识库未命中：${r.未命中.join('、')}——这部分蒸馏走对谈共创，契约 front matter 的 来源 写「对谈共创」。`)
  }
  lines.push('')

  const entries = [r.题材命中, ...r.流派命中].filter(Boolean)
  let hasContent = false
  for (const e of entries) {
    if (!e.content) {
      lines.push(`## ${e.名称}`, '', '（条目待补——按对谈共创处理）', '')
      continue
    }
    hasContent = true
    lines.push(`<!-- 来源：${e.条目} -->`, e.content.trim(), '')
  }
  if (!hasContent && !r.未命中.length) {
    lines.push('（知识库无可用条目，蒸馏全程对谈共创）')
  }
  lines.push(
    '---',
    '蒸馏方法：逐节对撞——「库怎么说 → 作者怎么定」，作者的取舍（含不按常规）即蒸馏结果。',
    '产出 文风/题材流派指导.md（放进 persist-book JSON 的「题材流派指导」字段），固定结构：',
    'front matter：题材 / 流派（块列表）/ 恩怨清算（有仇必报|宿命必偿|恩怨分明|以直报怨|留有余地，按题材默认与作者对谈定档）/ 来源（块列表：条目路径或「对谈共创」）',
    '恩怨清算五档语义（从狠到缓）：有仇必报=结仇必清算、代价足额落地；宿命必偿=清算可迟到不缺席、因果闭环由叙事兜底兑现；恩怨分明=有恩报恩有仇报仇、等价对付不扩大化；以直报怨=以公正回应仇怨、威胁未除不滥慈悲、除害不虐杀；留有余地=结算保留回旋空间、允许有代价的宽宥。',
    '正文四节：## 骨架约定 / ## 差异化点（必填≥3条）/ ## 本书专属毒点 / ## 节奏参数（含恩怨清算档位的本书化表述——只约束主角行动线与恩怨结算，不约束配角人设）'
  )
  return { ok: true, output: lines.join('\n') }
}
