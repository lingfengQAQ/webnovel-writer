import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  CONTRACT_ISSUE_FIELD,
  contractIssuesFromReviewIssues,
  encodeContractIssue,
} from '../knowledge/contract-issues.js'
import { validateFactChangeDecisionDetails } from '../knowledge/fact-changes.js'
import {
  readCurrentReviewInput,
  reviewedDraftHash,
} from './input-binding.js'

export { reviewedDraftHash } from './input-binding.js'

const OUTCOME_PATH = path.join('工作区', '评审报告', '审稿结果.json')

export function reviewOutcomeFile(merged, draft) {
  const factChanges = merged?.事实审查?.factChanges
  return {
    path: OUTCOME_PATH,
    content: JSON.stringify(
      {
        章号: merged.章号,
        issues: merged.issues,
        issues_count: merged.issues_count,
        blocking_count: merged.blocking_count,
        has_blocking: merged.has_blocking,
        审稿输入令牌: merged.审稿输入令牌,
        草稿哈希: reviewedDraftHash(draft),
        ...(factChanges !== undefined ? { factChanges } : {}),
      },
      null,
      2
    ),
  }
}

export async function applyReviewOutcome(repoPath, chapterNum, payload) {
  let outcome
  try {
    outcome = JSON.parse(await fs.readFile(path.join(repoPath, OUTCOME_PATH), 'utf8'))
  } catch (err) {
    return {
      ok: false,
      error: `缺少本章结构化审稿结果（工作区/评审报告/审稿结果.json）：${err.message}。请重新运行两审。`,
    }
  }
  if (outcome?.章号 !== chapterNum || !Array.isArray(outcome?.issues)) {
    return { ok: false, error: `结构化审稿结果与第 ${chapterNum} 章不对应，请重新运行两审。` }
  }
  if (payload?.frontMatter?.章号 !== chapterNum) {
    return { ok: false, error: `当前定稿包的章档案与第 ${chapterNum} 章不对应，请重新生成定稿包。` }
  }
  const binding = await readCurrentReviewInput(repoPath, {
    chapterNum,
    draft: payload,
    expectedToken: outcome.审稿输入令牌,
  })
  if (!binding.ok) {
    return {
      ok: false,
      error: `结构化审稿结果与当前审稿输入不一致：${binding.error}。请重新运行两审。`,
    }
  }
  if (
    !/^sha256:[0-9a-f]{64}$/.test(outcome.草稿哈希 || '') ||
    outcome.草稿哈希 !== reviewedDraftHash(payload)
  ) {
    return {
      ok: false,
      error: `结构化审稿结果与第 ${chapterNum} 章当前正文不对应，请对这份正文重新运行两审。`,
    }
  }

  const reviewedFacts = validateFactChangeDecisionDetails(outcome.factChanges)
  if (!reviewedFacts.ok) {
    return {
      ok: false,
      error: `结构化审稿结果的事实变化不合法：${reviewedFacts.errors.join('；')}。请重新运行两审。`,
    }
  }

  const blockers = outcome.issues.filter(isBlockingIssue)
  if (blockers.length) {
    const details = blockers.map((issue) => singleLine(issue.description)).filter(Boolean).join('；')
    return {
      ok: false,
      error: `第 ${chapterNum} 章还有 ${blockers.length} 个阻断问题，不能暂存或定稿${details ? `：${details}` : '。'}`,
    }
  }

  const boundFactChanges = bindReviewedFactChanges(outcome.factChanges, payload.factChanges)
  if (!boundFactChanges.ok) {
    return { ok: false, error: boundFactChanges.error }
  }

  const records = contractIssuesFromReviewIssues(outcome.issues)
  const frontMatter = { ...(payload.frontMatter || {}) }
  if (records.length) {
    frontMatter[CONTRACT_ISSUE_FIELD] = records.map(encodeContractIssue).filter(Boolean)
  } else {
    delete frontMatter[CONTRACT_ISSUE_FIELD]
  }
  const nextPayload = { ...payload, frontMatter }
  if (boundFactChanges.factChanges.length) {
    nextPayload.factChanges = boundFactChanges.factChanges
  } else {
    delete nextPayload.factChanges
  }
  return { ok: true, payload: nextPayload, records, error: '' }
}

function bindReviewedFactChanges(reviewedValue, submittedValue) {
  if (reviewedValue !== undefined && !Array.isArray(reviewedValue)) {
    return {
      ok: false,
      factChanges: [],
      error: '结构化审稿结果 factChanges 必须是数组，请重新运行两审。',
    }
  }
  const reviewed = reviewedValue || []
  if (submittedValue == null) {
    return { ok: true, factChanges: reviewed, error: '' }
  }
  if (!Array.isArray(submittedValue)) {
    return { ok: false, factChanges: [], error: '定稿包 factChanges 必须是数组，请重新生成定稿包。' }
  }
  if (submittedValue.length !== reviewed.length) {
    return {
      ok: false,
      factChanges: [],
      error: '定稿包的事实变化与本章事实审查结果数量不一致，不能省略或追加未经审查的事实变化。',
    }
  }

  for (let index = 0; index < reviewed.length; index++) {
    const saved = reviewed[index]
    const submitted = submittedValue[index]
    if (sameStructuredValue(saved, submitted)) continue
    if (isResolvedVersionOf(saved, submitted)) continue
    return {
      ok: false,
      factChanges: [],
      error: `定稿包 factChanges[${index}] 与本章事实审查结果不一致；只能原样保留，或把待裁决项补成「作者已裁决」。`,
    }
  }
  return { ok: true, factChanges: submittedValue, error: '' }
}

function isResolvedVersionOf(saved, submitted) {
  if (!saved || !submitted || typeof saved !== 'object' || typeof submitted !== 'object') {
    return false
  }
  if (!['冲突', '歧义'].includes(saved.decision) || submitted.decision !== '作者已裁决') {
    return false
  }
  const selectedOption = Array.isArray(saved.options)
    ? saved.options.find((option) => option?.optionId === submitted.optionId)
    : null
  if (!selectedOption || typeof selectedOption.applyChange !== 'boolean') return false
  const omitResolution = (value) => Object.fromEntries(
    Object.entries(value).filter(([key]) => !['decision', 'resolution', 'optionId'].includes(key))
  )
  return sameStructuredValue(omitResolution(saved), omitResolution(submitted)) &&
    typeof submitted.resolution === 'string' && submitted.resolution.trim().length > 0 &&
    typeof submitted.optionId === 'string' && submitted.optionId.trim().length > 0
}

function sameStructuredValue(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameStructuredValue(item, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && sameStructuredValue(left[key], right[key])
    )
}

function isBlockingIssue(issue) {
  if (issue?.category === 'unregistered_thread') return false
  return issue?.severity === 'critical' || issue?.blocking === true
}

function singleLine(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}
