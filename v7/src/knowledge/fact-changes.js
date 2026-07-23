import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sha256 } from '../util/hash.js'
import { isDesignPath, normalizePosixRelative } from './design.js'

export const FACT_DECISIONS = Object.freeze(['无冲突', '作者已裁决', '冲突', '歧义'])

/**
 * 事实审查可以先保存待作者裁决的冲突，但呈报内容必须完整。
 * 该纯校验同时供 review schema 与 finalize/staging 写盘闸门使用，避免两条链路漂移。
 */
export function validateFactChangeDecisionDetails(value) {
  if (value === undefined) return { ok: true, errors: [] }
  if (!Array.isArray(value)) return { ok: false, errors: ['factChanges 必须是数组'] }

  const errors = []
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    const where = `factChanges[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${where} 必须是对象`)
      continue
    }

    const decision = text(item.decision)
    if (!FACT_DECISIONS.includes(decision)) {
      errors.push(`${where}.decision 只能是${FACT_DECISIONS.join('、')}`)
      continue
    }
    const details = normalizeDecisionDetails(item)
    const needsDecision = decision === '冲突' || decision === '歧义'
    if (needsDecision && !details.difference) {
      errors.push(`${where}.difference 在「${decision}」时必填`)
    }
    if (needsDecision && !details.impact) {
      errors.push(`${where}.impact 在「${decision}」时必填`)
    }
    const hasOptions = item.options != null
    const requiresOptions = needsDecision || decision === '作者已裁决'
    if (requiresOptions && (!Array.isArray(item.options) || item.options.length < 2)) {
      errors.push(`${where}.options 在「${decision}」时必须提供至少两个处理选项`)
    } else if (hasOptions && !Array.isArray(item.options)) {
      errors.push(`${where}.options 如填写，必须是处理选项数组`)
    } else if (Array.isArray(item.options) && item.options.length > 0) {
      const ids = new Set()
      for (let optionIndex = 0; optionIndex < item.options.length; optionIndex++) {
        const option = item.options[optionIndex]
        const optionWhere = `${where}.options[${optionIndex}]`
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
          errors.push(`${optionWhere} 必须是对象`)
          continue
        }
        const id = text(option.optionId)
        if (!id) errors.push(`${optionWhere}.optionId 必填`)
        else if (ids.has(id)) errors.push(`${optionWhere}.optionId 与前项重复`)
        else ids.add(id)
        if (!text(option.label)) errors.push(`${optionWhere}.label 必填`)
        if (typeof option.applyChange !== 'boolean') {
          errors.push(`${optionWhere}.applyChange 必须明确为 true 或 false`)
        }
      }
    }

    if (decision === '作者已裁决') {
      if (!details.resolution) errors.push(`${where}.resolution 在作者已裁决时必填`)
      if (!details.optionId) {
        errors.push(`${where}.optionId 在作者已裁决时必填`)
      } else if (!details.options.some((option) => option.optionId === details.optionId)) {
        errors.push(`${where}.optionId 必须对应 options 中的一个处理选项`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

export async function validateFactChanges(
  repoPath,
  value,
  { factOverlay = new Map(), removedPlans = new Set() } = {}
) {
  if (value == null) return { ok: true, errors: [], changes: [] }
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['factChanges 必须是数组'], changes: [] }
  }

  const decisionValidation = validateFactChangeDecisionDetails(value)
  const errors = [...decisionValidation.errors]
  const changes = []
  const planPaths = new Set()
  const factPaths = new Set()
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    const where = `factChanges[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const planPath = String(item.planPath || '').trim()
    const factPath = String(item.factPath || '').trim()
    const content = typeof item.content === 'string' ? item.content : ''
    const decision = String(item.decision || '').trim()
    const decisionDetails = normalizeDecisionDetails(item)
    const keepsDecisionDetails = ['冲突', '歧义', '作者已裁决'].includes(decision)
    const selectedOption = decision === '作者已裁决'
      ? decisionDetails.options.find((option) => option.optionId === decisionDetails.optionId)
      : null
    const applyChange = decision === '无冲突'
      ? true
      : decision === '作者已裁决'
        ? selectedOption?.applyChange === true
        : false
    const expectedHash = normalizeExpectedHash(item.expectedHash)

    if (!isDesignPath(planPath)) errors.push(`${where}.planPath 不是大纲/创作设计下的直接 Markdown 文件`)
    if (!isFactPath(factPath)) errors.push(`${where}.factPath 必须位于定稿/设定/ 下且以 .md 结尾`)
    if (!content.trim()) errors.push(`${where}.content 必须是非空的完整事实 Markdown`)
    if (decision === '冲突' || decision === '歧义') {
      errors.push(`${where} 仍是「${decision}」，须由作者裁决后才能定稿`)
    }
    if (typeof item.removePlan !== 'boolean') {
      errors.push(`${where}.removePlan 必须明确为 true 或 false`)
    }
    if (item.expectedHash != null && !expectedHash) {
      errors.push(`${where}.expectedHash 必须是 sha256:<64位十六进制> 或 64 位十六进制`)
    }
    if (applyChange && planPaths.has(planPath)) errors.push(`${where}.planPath 与本批次前项重复`)
    if (applyChange && factPaths.has(factPath)) errors.push(`${where}.factPath 与本批次前项重复`)
    if (applyChange) {
      planPaths.add(planPath)
      factPaths.add(factPath)
    }

    if (item.applyChange != null && typeof item.applyChange !== 'boolean') {
      errors.push(`${where}.applyChange 必须由命中的审稿选项派生为布尔值`)
    } else if (item.applyChange != null && item.applyChange !== applyChange) {
      errors.push(`${where}.applyChange 与所选审稿选项的执行语义不一致`)
    }

    let existing = null
    if (isFactPath(factPath)) {
      if (factOverlay.has(factPath)) {
        const overlay = factOverlay.get(factPath)
        existing = typeof overlay === 'string' ? overlay : overlay?.content ?? null
      } else {
        try {
          existing = await fs.readFile(path.join(repoPath, ...factPath.split('/')), 'utf8')
        } catch (err) {
          if (err.code !== 'ENOENT') errors.push(`${where}.factPath 读取失败：${err.message}`)
        }
      }
      if (existing != null) {
        if (!expectedHash) errors.push(`${where}.expectedHash 在覆盖既有事实时必填`)
        else if (sha256(existing) !== expectedHash) {
          errors.push(`${where}.expectedHash 与当前事实内容不一致，审查后文件可能已变化`)
        }
      } else if (expectedHash) {
        errors.push(`${where}.expectedHash 只用于覆盖既有事实，新建事实不应填写`)
      }
    }

    if (isDesignPath(planPath)) {
      let planExists = !removedPlans.has(planPath)
      if (planExists) {
        try {
          await fs.access(path.join(repoPath, ...planPath.split('/')))
        } catch {
          planExists = false
        }
      }
      // 已有事实的后续更新可以追溯到已转正并删除的原计划；首次转正必须有计划文件。
      if (!planExists && (existing == null || item.removePlan === true)) {
        errors.push(`${where}.planPath 对应的计划对象不存在或已被移除`)
      }
    }

    changes.push({
      planPath,
      factPath,
      content,
      decision,
      ...(expectedHash ? { expectedHash } : {}),
      ...(keepsDecisionDetails && decisionDetails.difference
        ? { difference: decisionDetails.difference }
        : {}),
      ...(keepsDecisionDetails && decisionDetails.impact
        ? { impact: decisionDetails.impact }
        : {}),
      ...(keepsDecisionDetails && decisionDetails.options.length
        ? { options: decisionDetails.options }
        : {}),
      ...(keepsDecisionDetails && decisionDetails.resolution
        ? { resolution: decisionDetails.resolution }
        : {}),
      ...(keepsDecisionDetails && decisionDetails.optionId
        ? { optionId: decisionDetails.optionId }
        : {}),
      // false 选项只保留审稿绑定，归一化为真正的 no-op，防止误删计划。
      applyChange,
      removePlan: applyChange && item.removePlan === true,
    })
  }
  return { ok: errors.length === 0, errors, changes }
}

/** 待裁决内容的作者界面文本；review、手动 finalize 与自动暂存共用。 */
export function formatFactChangeDecisionRequests(value) {
  if (!Array.isArray(value)) return ''
  const pending = value
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.decision === '冲突' || item?.decision === '歧义')
  if (!pending.length) return ''

  const lines = ['以下事实变化需要作者裁决：']
  for (const { item, index } of pending) {
    const details = normalizeDecisionDetails(item)
    const target = text(item.factPath)
    lines.push('', `${index + 1}. ${item.decision}${target ? `（${target}）` : ''}`)
    lines.push(`   差异：${singleLine(details.difference) || '（事实审查未提供）'}`)
    lines.push(`   影响：${singleLine(details.impact) || '（事实审查未提供）'}`)
    lines.push('   处理选项：')
    if (details.options.length) {
      for (const option of details.options) {
        const suffix = option.description ? `；${singleLine(option.description)}` : ''
        lines.push(`   - ${option.optionId || '（缺少编号）'}：${singleLine(option.label) || '（缺少说明）'}${suffix}`)
      }
    } else {
      lines.push('   - （事实审查未提供）')
    }
  }
  lines.push('', '请作者选定处理方式并说明裁决；重新提交时将 decision 改为「作者已裁决」，填写 resolution 和所选 optionId。')
  return lines.join('\n')
}

export function formatFactChangeValidationError(validation) {
  const messages = []
  if (validation?.errors?.length) messages.push(validation.errors.join('；'))
  const decisionRequest = formatFactChangeDecisionRequests(validation?.changes)
  if (decisionRequest) messages.push(decisionRequest)
  return messages.join('\n')
}

export function isFactPath(value) {
  const rel = normalizePosixRelative(value)
  if (!rel || !rel.endsWith('.md')) return false
  const parts = rel.split('/')
  return parts.length >= 3 && parts[0] === '定稿' && parts[1] === '设定'
}

export function factContentHash(content) {
  return 'sha256:' + sha256(content)
}

function normalizeExpectedHash(value) {
  if (value == null || value === '') return ''
  const text = String(value).trim().toLowerCase().replace(/^sha256:/, '')
  return /^[0-9a-f]{64}$/.test(text) ? text : ''
}

function normalizeDecisionDetails(item) {
  const options = Array.isArray(item?.options)
    ? item.options
        .filter((option) => option && typeof option === 'object' && !Array.isArray(option))
        .map((option) => ({
          optionId: text(option.optionId),
          label: text(option.label),
          ...(text(option.description) ? { description: text(option.description) } : {}),
          ...(typeof option.applyChange === 'boolean'
            ? { applyChange: option.applyChange }
            : {}),
        }))
    : []
  return {
    difference: text(item?.difference),
    impact: text(item?.impact),
    options,
    resolution: text(item?.resolution),
    optionId: text(item?.optionId),
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function singleLine(value) {
  return text(value).replace(/\s+/g, ' ')
}
