/**
 * 审稿单 schema 与阻断规则（多智能体 spec v3.4 §5.4 / story-repo-spec §8 第6步）。
 * 两审 category 分域;阻断规则:critical→强制 blocking;unregistered_thread(D3)→强制非阻断。
 * 报告级计数(issues_count/blocking_count/has_blocking)由校验器复算覆盖,不信 AI 自报。
 */
export const FACT_CATEGORIES = [
  'setting', 'timeline', 'continuity', 'character', 'logic',
  'requirement', 'leak', 'evidence', 'unregistered_thread',
]
export const EDIT_CATEGORIES = ['structure', 'pacing', 'commercial', 'motivation']
export const SEVERITIES = ['critical', 'high', 'medium', 'low']

/** 审稿单 JSON 形态范例（单源:生成器注入角色任务书,角色与校验器不双表） */
export const SCHEMA_EXAMPLE = {
  chapter: 100,
  issues: [
    {
      severity: 'critical',
      category: 'setting',
      location: '第3段',
      description: '问题描述',
      evidence: '草稿引用 vs 输入数据',
      fix_hint: '修复方向',
      blocking: true,
    },
  ],
  issues_count: 1,
  blocking_count: 1,
  has_blocking: true,
  summary: 'N个问题：X个阻断，Y个高优',
}

const REQUIRED_FIELDS = ['location', 'description', 'evidence', 'fix_hint']

/**
 * @param {object} report AI 出的审稿单 {chapter, issues:[...]}
 * @param {{reviewType: 'factCheck'|'editorial'}} opts
 * @returns {{ok: boolean, report: object|null, errors: string[]}}
 */
export function validateReviewReport(report, { reviewType } = {}) {
  const errors = []
  const allowed =
    reviewType === 'factCheck' ? FACT_CATEGORIES : reviewType === 'editorial' ? EDIT_CATEGORIES : null
  if (!allowed) errors.push(`未知审查类型：${reviewType}`)

  if (!report || !Array.isArray(report.issues)) {
    return { ok: false, report: null, errors: [...errors, 'report.issues 缺失或非数组'] }
  }

  const normalized = report.issues.map((issue, i) => {
    const where = `issues[${i}]`
    if (!SEVERITIES.includes(issue.severity)) errors.push(`${where} severity 非法：${issue.severity}`)
    if (allowed && !allowed.includes(issue.category)) {
      errors.push(`${where} category「${issue.category}」越界（${reviewType}）`)
    }
    for (const f of REQUIRED_FIELDS) {
      if (issue[f] == null || issue[f] === '') errors.push(`${where} 缺字段 ${f}`)
    }
    // 阻断规则
    let blocking = !!issue.blocking
    if (issue.severity === 'critical') blocking = true
    if (issue.category === 'unregistered_thread') blocking = false
    return { ...issue, blocking }
  })

  const blocking_count = normalized.filter((x) => x.blocking).length
  const out = {
    ...report,
    issues: normalized,
    issues_count: normalized.length,
    blocking_count,
    has_blocking: blocking_count > 0,
  }
  return { ok: errors.length === 0, report: out, errors }
}
