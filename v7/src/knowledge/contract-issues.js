import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'

export const CONTRACT_ISSUE_FIELD = '契约问题'

const DELIMITER = '｜'
const SEVERITY_LABELS = Object.freeze({
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
})
const SEVERITY_VALUES = new Map(
  Object.entries(SEVERITY_LABELS).map(([value, label]) => [label, value])
)

export function contractIssuesFromReviewIssues(issues) {
  const out = []
  const seen = new Set()
  for (const issue of Array.isArray(issues) ? issues : []) {
    const clause = singleLine(issue?.contract_clause)
    const severity = SEVERITY_LABELS[issue?.severity] ? issue.severity : ''
    const summary = singleLine(issue?.description)
    if (!clause || !severity || !summary) continue
    const key = clause + '\0' + severity + '\0' + summary
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ 条款: clause, 严重度: severity, 问题: summary })
  }
  return out
}

export function encodeContractIssue(issue) {
  const clause = safePart(issue?.条款)
  const severity = SEVERITY_LABELS[issue?.严重度] || ''
  const summary = safePart(issue?.问题)
  if (!clause || !severity || !summary) return ''
  return [clause, severity, summary].join(DELIMITER)
}

export function decodeContractIssue(value) {
  const parts = String(value || '').split(DELIMITER)
  if (parts.length !== 3) return null
  const clause = singleLine(parts[0])
  const severity = SEVERITY_VALUES.get(singleLine(parts[1])) || ''
  const summary = singleLine(parts[2])
  return clause && severity && summary
    ? { 条款: clause, 严重度: severity, 问题: summary }
    : null
}

export async function readContractIssueHistory(repoPath, { volume = null, throughChapter = null } = {}) {
  const dir = path.join(repoPath, '定稿', '正文')
  let files
  try {
    files = (await fs.readdir(dir))
      .filter((file) => /^\d{4}-.*\.md$/.test(file))
      .sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)))
  } catch {
    return []
  }

  const history = []
  for (const file of files) {
    try {
      const parsed = parseFrontMatter(await fs.readFile(path.join(dir, file), 'utf8'))
      if (!parsed.ok) continue
      const chapterNum = Number(parsed.data.章号)
      const volumeNum = Number(parsed.data.卷) || 1
      if (!Number.isInteger(chapterNum)) continue
      if (Number.isInteger(throughChapter) && chapterNum > throughChapter) continue
      if (Number.isInteger(volume) && volumeNum !== volume) continue
      const issues = (Array.isArray(parsed.data[CONTRACT_ISSUE_FIELD])
        ? parsed.data[CONTRACT_ISSUE_FIELD]
        : []
      ).map(decodeContractIssue).filter(Boolean)
      history.push({ 章号: chapterNum, 卷: volumeNum, 问题: issues })
    } catch {
      // 源文件格式错误由启动检测统一阻断；这里不制造第二套修复路径。
    }
  }
  return history
}

export function evaluateContractIssueSignals(history, { volume = null } = {}) {
  const rows = [...(Array.isArray(history) ? history : [])]
    .filter((row) => Number.isInteger(row?.章号))
    .sort((a, b) => a.章号 - b.章号)
  if (!rows.length) return []

  const currentVolume = Number.isInteger(volume) ? volume : rows.at(-1).卷
  const latestChapter = rows.at(-1).章号
  const byClause = new Map()
  for (const row of rows) {
    const seenInChapter = new Set()
    for (const issue of Array.isArray(row.问题) ? row.问题 : []) {
      if (!issue?.条款 || seenInChapter.has(issue.条款)) continue
      seenInChapter.add(issue.条款)
      const entries = byClause.get(issue.条款) || []
      entries.push({ 章号: row.章号, 卷: row.卷, 问题: issue.问题 })
      byClause.set(issue.条款, entries)
    }
  }

  const signals = []
  for (const [clause, entries] of byClause) {
    const latestTwo = entries.slice(-2)
    const consecutive =
      latestTwo.length === 2 &&
      latestTwo[1].章号 === latestChapter &&
      latestTwo[1].章号 === latestTwo[0].章号 + 1
    const volumeEntries = entries.filter((entry) => entry.卷 === currentVolume)
    if (!consecutive && volumeEntries.length < 3) continue
    signals.push({
      条款: clause,
      连续章: consecutive ? latestTwo.map((entry) => entry.章号) : [],
      卷内次数: volumeEntries.length,
      最近问题: entries.at(-1).问题,
    })
  }
  return signals.sort((a, b) => compareCodePoints(a.条款, b.条款))
}

export function summarizeContractIssues(history) {
  const byClause = new Map()
  for (const row of Array.isArray(history) ? history : []) {
    for (const issue of Array.isArray(row.问题) ? row.问题 : []) {
      const item = byClause.get(issue.条款) || { 条款: issue.条款, 次数: 0, 章: [], 最近问题: '' }
      item.次数++
      if (!item.章.includes(row.章号)) item.章.push(row.章号)
      item.最近问题 = issue.问题
      byClause.set(issue.条款, item)
    }
  }
  return [...byClause.values()].sort((a, b) => compareCodePoints(a.条款, b.条款))
}

function safePart(value) {
  return singleLine(value).replaceAll(DELIMITER, '／')
}

function singleLine(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function compareCodePoints(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}
