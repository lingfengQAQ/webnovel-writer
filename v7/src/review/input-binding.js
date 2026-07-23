import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ContractReader } from '../storage/adapters/ContractReader.js'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'

export const REVIEW_INPUT_PATH = path.join('工作区', '审稿输入.json')
export const REVIEW_INPUT_TOKEN_FIELD = '审稿输入令牌'

const TOKEN_RE = /^sha256:[0-9a-f]{64}$/

export function reviewInputToken(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('审稿输入必须是对象')
  }
  const payload = {}
  for (const key of Object.keys(input)) {
    if (key !== REVIEW_INPUT_TOKEN_FIELD) payload[key] = input[key]
  }
  const canonical = JSON.stringify(sortJsonValue(payload))
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export function bindReviewInput(input) {
  const bound = { ...input }
  bound[REVIEW_INPUT_TOKEN_FIELD] = reviewInputToken(bound)
  return bound
}

export function reviewInputFile(input) {
  return {
    path: REVIEW_INPUT_PATH,
    content: JSON.stringify(input, null, 2),
  }
}

export function validateReviewInputToken(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, token: '', error: '审稿输入必须是对象' }
  }
  if (!Number.isInteger(input.章号) || input.章号 < 1) {
    return { ok: false, token: '', error: '审稿输入章号无效' }
  }
  if (!Number.isInteger(input.作品契约版本) || input.作品契约版本 < 1) {
    return { ok: false, token: '', error: '审稿输入缺少有效的作品契约版本' }
  }
  const token = input[REVIEW_INPUT_TOKEN_FIELD]
  if (!TOKEN_RE.test(token || '')) {
    return { ok: false, token: '', error: '审稿输入令牌格式不正确' }
  }
  let expected
  try {
    expected = reviewInputToken(input)
  } catch (err) {
    return { ok: false, token: '', error: `审稿输入无法计算令牌：${err.message}` }
  }
  if (token !== expected) {
    return { ok: false, token, error: '审稿输入内容已变化，令牌不再匹配' }
  }
  return { ok: true, token, error: '' }
}

export async function readCurrentReviewInput(
  repoPath,
  { chapterNum, draft, expectedToken = null, contract = null } = {}
) {
  let input
  try {
    input = JSON.parse(
      await fs.readFile(path.join(repoPath, REVIEW_INPUT_PATH), 'utf8')
    )
  } catch (err) {
    return {
      ok: false,
      input: null,
      token: '',
      error: `缺少或无法读取当前审稿输入：${err.message}`,
    }
  }

  const validated = validateReviewInputToken(input)
  if (!validated.ok) return { ...validated, input: null }
  if (expectedToken !== null && expectedToken !== validated.token) {
    return { ok: false, input: null, token: validated.token, error: '回传的审稿输入令牌与当前输入不一致' }
  }
  if (Number.isInteger(chapterNum) && input.章号 !== chapterNum) {
    return { ok: false, input: null, token: validated.token, error: `当前审稿输入不属于第 ${chapterNum} 章` }
  }
  if (draft !== undefined) {
    const draftBinding = validateReviewedDraft(input.草稿全文, draft)
    if (!draftBinding.ok) {
      return { ok: false, input: null, token: validated.token, error: draftBinding.error }
    }
  }

  const currentContract = contract || await new ContractReader(repoPath).readReviewSections()
  if (!currentContract.ok) {
    return { ok: false, input: null, token: validated.token, error: currentContract.error }
  }
  const currentVersion = currentContract.data?.frontMatter?.契约版本
  if (
    input.作品契约版本 !== currentVersion ||
    input.作品契约 !== currentContract.content
  ) {
    return { ok: false, input: null, token: validated.token, error: '当前审稿输入使用的作品契约已变化' }
  }
  return { ok: true, input, token: validated.token, error: '' }
}

export function reviewedDraftHash(value) {
  let body
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    body = String(value.body || '')
  } else {
    const text = String(value || '')
    const parsed = parseFrontMatter(text)
    body = parsed.ok ? parsed.body : text
  }
  const normalized = body.replace(/\r\n?/g, '\n').trim()
  return 'sha256:' + createHash('sha256').update(normalized, 'utf8').digest('hex')
}

function validateReviewedDraft(reviewedText, currentDraft) {
  if (reviewedDraftHash(reviewedText) !== reviewedDraftHash(currentDraft)) {
    return { ok: false, error: '当前审稿输入与这份正文不一致' }
  }
  if (!currentDraft || typeof currentDraft !== 'object' || Array.isArray(currentDraft)) {
    return { ok: true, error: '' }
  }

  const parsed = parseFrontMatter(String(reviewedText || ''))
  if (!parsed.ok || !parsed.data || typeof parsed.data !== 'object') {
    return { ok: false, error: '被审草稿缺少可核对的章档案，请重新生成草稿并运行两审' }
  }
  const currentFrontMatter = currentDraft.frontMatter
  if (!currentFrontMatter || typeof currentFrontMatter !== 'object' || Array.isArray(currentFrontMatter)) {
    return { ok: false, error: '当前定稿包缺少可核对的章档案' }
  }
  if (canonicalJson(parsed.data) !== canonicalJson(currentFrontMatter)) {
    return { ok: false, error: '当前定稿包的章档案与被审草稿不一致' }
  }
  return { ok: true, error: '' }
}

function canonicalJson(value) {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value
  const sorted = {}
  for (const key of Object.keys(value).sort(codeUnitCompare)) {
    if (value[key] !== undefined) sorted[key] = sortJsonValue(value[key])
  }
  return sorted
}

function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
