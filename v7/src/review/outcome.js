import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  CONTRACT_ISSUE_FIELD,
  contractIssuesFromReviewIssues,
  encodeContractIssue,
} from '../knowledge/contract-issues.js'

const OUTCOME_PATH = path.join('工作区', '评审报告', '审稿结果.json')

export function reviewOutcomeFile(merged) {
  return {
    path: OUTCOME_PATH,
    content: JSON.stringify(
      {
        章号: merged.章号,
        issues: merged.issues,
        issues_count: merged.issues_count,
        blocking_count: merged.blocking_count,
        has_blocking: merged.has_blocking,
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

  const blockers = outcome.issues.filter(isBlockingIssue)
  if (blockers.length) {
    const details = blockers.map((issue) => singleLine(issue.description)).filter(Boolean).join('；')
    return {
      ok: false,
      error: `第 ${chapterNum} 章还有 ${blockers.length} 个阻断问题，不能暂存或定稿${details ? `：${details}` : '。'}`,
    }
  }

  const records = contractIssuesFromReviewIssues(outcome.issues)
  const frontMatter = { ...(payload.frontMatter || {}) }
  if (records.length) {
    frontMatter[CONTRACT_ISSUE_FIELD] = records.map(encodeContractIssue).filter(Boolean)
  } else {
    delete frontMatter[CONTRACT_ISSUE_FIELD]
  }
  return { ok: true, payload: { ...payload, frontMatter }, records, error: '' }
}

function isBlockingIssue(issue) {
  if (issue?.category === 'unregistered_thread') return false
  return issue?.severity === 'critical' || issue?.blocking === true
}

function singleLine(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}
