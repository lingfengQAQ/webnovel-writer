import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sha256 } from '../util/hash.js'
import { isDesignPath, normalizePosixRelative } from './design.js'

export const FACT_DECISIONS = Object.freeze(['无冲突', '作者已裁决', '冲突', '歧义'])

export async function validateFactChanges(
  repoPath,
  value,
  { factOverlay = new Map(), removedPlans = new Set() } = {}
) {
  if (value == null) return { ok: true, errors: [], changes: [] }
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['factChanges 必须是数组'], changes: [] }
  }

  const errors = []
  const changes = []
  const planPaths = new Set()
  const factPaths = new Set()
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    const where = `factChanges[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${where} 必须是对象`)
      continue
    }
    const planPath = String(item.planPath || '').trim()
    const factPath = String(item.factPath || '').trim()
    const content = typeof item.content === 'string' ? item.content : ''
    const decision = String(item.decision || '').trim()
    const resolution = typeof item.resolution === 'string' ? item.resolution.trim() : ''
    const expectedHash = normalizeExpectedHash(item.expectedHash)

    if (!isDesignPath(planPath)) errors.push(`${where}.planPath 不是大纲/创作设计下的直接 Markdown 文件`)
    if (!isFactPath(factPath)) errors.push(`${where}.factPath 必须位于定稿/设定/ 下且以 .md 结尾`)
    if (!content.trim()) errors.push(`${where}.content 必须是非空的完整事实 Markdown`)
    if (!FACT_DECISIONS.includes(decision)) errors.push(`${where}.decision 只能是${FACT_DECISIONS.join('、')}`)
    if (decision === '冲突' || decision === '歧义') {
      errors.push(`${where} 仍是「${decision}」，须由作者裁决后才能定稿`)
    }
    if (decision === '作者已裁决' && !resolution) {
      errors.push(`${where}.resolution 在作者已裁决时必填`)
    }
    if (typeof item.removePlan !== 'boolean') {
      errors.push(`${where}.removePlan 必须明确为 true 或 false`)
    }
    if (item.expectedHash != null && !expectedHash) {
      errors.push(`${where}.expectedHash 必须是 sha256:<64位十六进制> 或 64 位十六进制`)
    }
    if (planPaths.has(planPath)) errors.push(`${where}.planPath 与本批次前项重复`)
    if (factPaths.has(factPath)) errors.push(`${where}.factPath 与本批次前项重复`)
    planPaths.add(planPath)
    factPaths.add(factPath)

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
      ...(resolution ? { resolution } : {}),
      removePlan: item.removePlan === true,
    })
  }
  return { ok: errors.length === 0, errors, changes }
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
