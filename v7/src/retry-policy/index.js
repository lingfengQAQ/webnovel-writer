import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Persistent retry accounting is deliberately a small, deterministic machine
 * record.  The forward-slash path is part of the product contract even on
 * Windows; node's fs/path APIs accept it unchanged.
 */
export const RETRY_POLICY_PATH = '工作区/重试预算.json'
export const RETRY_POLICY_SCHEMA_VERSION = 1
export const MAX_MECHANICAL_AUTO_REPAIRS = 2
export const MAX_AUTOMATIC_REVIEW_ATTEMPTS = 2

const HASH_RE = /^sha256:[0-9a-f]{64}$/
const REVIEW_MODES = new Set(['pending', 'complete', 'degraded'])
const MECHANICAL_ROUTES = new Set(['initial', 'automatic', 'author'])
const REVIEW_ROUTES = new Set(['automatic', 'author'])
const MECHANICAL_RESULTS = new Set(['pass', 'fail'])
const REVIEW_STATUSES = new Set(['issued', 'saved'])

/** Return a fresh, valid empty state. */
export function emptyRetryPolicy() {
  return { schemaVersion: RETRY_POLICY_SCHEMA_VERSION, chapters: {} }
}

/**
 * Read and strictly validate the retry record.  A missing record is the valid
 * empty state; every other read/parse/schema failure is fail-closed.
 */
export async function readRetryPolicy(repoPath) {
  let raw
  try {
    raw = await fs.readFile(path.join(repoPath, RETRY_POLICY_PATH), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: true, state: emptyRetryPolicy(), exists: false, error: '' }
    }
    return { ok: false, state: null, exists: true, error: `重试预算记录无法读取：${err.message}` }
  }

  let value
  try {
    value = JSON.parse(raw)
  } catch (err) {
    return { ok: false, state: null, exists: true, error: `重试预算记录损坏，已停止自动流程：${err.message}` }
  }
  const checked = validateRetryPolicy(value)
  if (!checked.ok) {
    return { ok: false, state: null, exists: true, error: `重试预算记录损坏，已停止自动流程：${checked.error}` }
  }
  return { ok: true, state: checked.state, exists: true, error: '' }
}

/**
 * Build the only supported on-disk representation.  This function never
 * includes timestamps, process ids, or derived counters.
 */
export function retryPolicyFile(state) {
  const checked = validateRetryPolicy(state)
  if (!checked.ok) throw new Error(`重试预算记录内容不完整，拒绝写入：${checked.error}`)
  return {
    path: RETRY_POLICY_PATH,
    content: JSON.stringify(checked.state, null, 2),
  }
}

/**
 * Hash of the whole draft file (front matter included, line endings
 * normalized).  Front-matter-only fixes are still repairs, so they must
 * produce a new hash and consume budget; body-only hashing would allow
 * unlimited free rechecks on front-matter issues.
 */
export function retryDraftHash(content) {
  const normalized = String(content || '').replace(/\r\n?/g, '\n').trim()
  return 'sha256:' + createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/** Validate and return a canonical copy of the state. */
export function validateRetryPolicy(value) {
  if (!isPlainObject(value)) return { ok: false, state: null, error: '顶层必须是对象' }
  if (exactKeys(value, ['schemaVersion', 'chapters']) === false) {
    return { ok: false, state: null, error: '顶层字段必须且只能是 schemaVersion、chapters' }
  }
  if (value.schemaVersion !== RETRY_POLICY_SCHEMA_VERSION) {
    return { ok: false, state: null, error: `schemaVersion 必须是 ${RETRY_POLICY_SCHEMA_VERSION}` }
  }
  if (!isPlainObject(value.chapters)) return { ok: false, state: null, error: 'chapters 必须是对象' }

  const chapterNumbers = Object.keys(value.chapters)
  const canonicalChapters = {}
  for (const key of chapterNumbers.sort(compareChapterKeys)) {
    if (!isCanonicalChapterKey(key)) {
      return { ok: false, state: null, error: `章号键无效：${key}` }
    }
    const chapter = value.chapters[key]
    const validChapter = validateChapterRecord(chapter, key)
    if (!validChapter.ok) return validChapter
    canonicalChapters[key] = validChapter.chapter
  }
  return {
    ok: true,
    state: { schemaVersion: RETRY_POLICY_SCHEMA_VERSION, chapters: canonicalChapters },
    error: '',
  }
}

/**
 * Pure mechanical preflight.  No state is written here, so a checker error
 * cannot consume a repair round.  The caller records the result only after
 * the checker completes successfully.
 */
export function reserveMechanicalAttempt(state, { chapterNum, draftHash, authorConfirmed = false } = {}) {
  const base = validateRetryPolicy(state)
  if (!base.ok) return { ok: false, state: null, error: base.error }
  if (!validChapterNum(chapterNum)) return { ok: false, state: null, error: '章号必须是正整数' }
  if (!HASH_RE.test(draftHash || '')) return { ok: false, state: null, error: '草稿哈希无效' }

  const chapter = getChapter(base.state, chapterNum)
  const attempts = chapter.mechanical.attempts
  const existing = attempts.find((item) => item.draftHash === draftHash)
  const used = countAutomaticMechanical(attempts)
  const remaining = MAX_MECHANICAL_AUTO_REPAIRS - used

  if (existing) {
    return {
      ok: true,
      allowed: true,
      idempotent: true,
      route: existing.route,
      state: base.state,
      budget: mechanicalBudget(attempts),
      action: 'repeat-same-draft',
      error: '',
    }
  }

  if (!attempts.length) {
    return {
      ok: true,
      allowed: true,
      idempotent: false,
      route: 'initial',
      state: base.state,
      budget: { used, remaining, blocked: false },
      action: 'run-initial-check',
      error: '',
    }
  }

  // An author-confirmed path is explicit and never replenishes automatic
  // budget.  It is checked before the automatic limit so it remains usable
  // after the automatic path is exhausted.
  if (authorConfirmed === true) {
    return {
      ok: true,
      allowed: true,
      idempotent: false,
      route: 'author',
      state: base.state,
      budget: { used, remaining, blocked: false },
      action: 'run-author-confirmed-check',
      error: '',
    }
  }

  const latest = attempts.at(-1)
  if (latest?.result !== 'fail') {
    return {
      ok: true,
      allowed: false,
      idempotent: false,
      route: null,
      state: base.state,
      budget: { used, remaining, blocked: true },
      action: 'request-author-confirmation',
      error: '本章已有通过机检的草稿；新的不同草稿须由作者明确确认后再检。',
    }
  }
  if (used >= MAX_MECHANICAL_AUTO_REPAIRS) {
    return {
      ok: true,
      allowed: false,
      idempotent: false,
      route: null,
      state: base.state,
      budget: { used, remaining: 0, blocked: true },
      action: 'request-author-confirmation',
      error: '本章机检自动修复次数已用完，请作者确认后继续。',
    }
  }
  return {
    ok: true,
    allowed: true,
    idempotent: false,
    route: 'automatic',
    state: base.state,
    budget: { used, remaining, blocked: false },
    action: 'run-automatic-repair-check',
    error: '',
  }
}

/** Record a completed mechanical check in memory; caller writes atomically. */
export function recordMechanicalAttempt(
  state,
  { chapterNum, draftHash, pass, route = 'automatic' } = {}
) {
  const base = validateRetryPolicy(state)
  if (!base.ok) return { ok: false, state: null, changed: false, error: base.error }
  if (!validChapterNum(chapterNum)) return { ok: false, state: null, changed: false, error: '章号必须是正整数' }
  if (!HASH_RE.test(draftHash || '')) return { ok: false, state: null, changed: false, error: '草稿哈希无效' }
  if (!MECHANICAL_ROUTES.has(route)) return { ok: false, state: null, changed: false, error: '机检路径无效' }
  if (typeof pass !== 'boolean') return { ok: false, state: null, changed: false, error: '机检结果无效' }

  const next = cloneState(base.state)
  const chapter = getChapter(next, chapterNum)
  const attempts = chapter.mechanical.attempts
  const existing = attempts.find((item) => item.draftHash === draftHash)
  if (existing) {
    // Same hash is idempotent.  Keep the original route and only update the
    // observed result, avoiding a second budget charge.
    if (existing.result === (pass ? 'pass' : 'fail')) {
      return { ok: true, state: next, changed: false, attempt: existing, error: '' }
    }
    existing.result = pass ? 'pass' : 'fail'
    return { ok: true, state: next, changed: true, attempt: existing, error: '' }
  }
  if (route === 'initial' && attempts.length) {
    return { ok: false, state: null, changed: false, error: '机检初次记录已存在' }
  }
  if (route === 'automatic' && countAutomaticMechanical(attempts) >= MAX_MECHANICAL_AUTO_REPAIRS) {
    return { ok: false, state: null, changed: false, error: '机检自动修复次数已用完' }
  }
  const attempt = { draftHash, route, result: pass ? 'pass' : 'fail' }
  attempts.push(attempt)
  return { ok: true, state: next, changed: true, attempt, error: '' }
}

/**
 * Reserve one two-review round without taking a lock or writing.  This is the
 * integration API for review-input/runReviews callers that already hold the
 * shared work-state lock.
 */
export async function reserveReviewAttempt(
  repoPath,
  { chapterNum, reviewInputToken, mode = 'pending', authorApproved = false } = {}
) {
  const loaded = await readRetryPolicy(repoPath)
  if (!loaded.ok) return { ok: false, state: null, file: null, changed: false, error: loaded.error }
  const result = reserveReviewAttemptInState(loaded.state, {
    chapterNum,
    reviewInputToken,
    mode,
    authorApproved,
  })
  if (!result.ok) return { ...result, file: null, changed: false }
  return {
    ...result,
    file: result.changed ? retryPolicyFile(result.state) : null,
    exists: loaded.exists,
  }
}

/** Pure counterpart useful when the caller has already loaded the state. */
export function reserveReviewAttemptInState(
  state,
  { chapterNum, reviewInputToken, mode = 'pending', authorApproved = false } = {}
) {
  const base = validateRetryPolicy(state)
  if (!base.ok) return { ok: false, state: null, file: null, changed: false, error: base.error }
  if (!validChapterNum(chapterNum)) return { ok: false, state: null, file: null, changed: false, error: '章号必须是正整数' }
  if (!HASH_RE.test(reviewInputToken || '')) {
    return { ok: false, state: null, file: null, changed: false, error: '审稿输入令牌无效' }
  }
  if (!REVIEW_MODES.has(mode)) return { ok: false, state: null, file: null, changed: false, error: '审稿模式无效' }

  const chapter = getChapter(base.state, chapterNum)
  const attempts = chapter.review.attempts
  const existing = attempts.at(-1)
  const used = countAutomaticReviews(attempts)
  const remaining = MAX_AUTOMATIC_REVIEW_ATTEMPTS - used
  // Only re-fetching the currently issued round is idempotent.  Once that
  // round is saved, issuing even the same deterministic token is a real
  // re-review and consumes another round.
  if (existing?.reviewInputToken === reviewInputToken && existing.status === 'issued') {
    if (existing.mode !== 'pending' && mode !== 'pending' && existing.mode !== mode) {
      return {
        ok: false,
        state: null,
        file: null,
        changed: false,
        error: '同一审稿输入令牌不能切换审稿模式',
      }
    }
    if (existing.mode === 'pending' && mode !== 'pending') {
      const next = cloneState(base.state)
      const attempt = getChapter(next, chapterNum).review.attempts.at(-1)
      attempt.mode = mode
      return {
        ok: true,
        allowed: true,
        idempotent: true,
        state: next,
        changed: true,
        attempt,
        used,
        remaining,
        blocked: false,
        action: 'repeat-same-review-input',
        error: '',
      }
    }
    return {
      ok: true,
      allowed: true,
      idempotent: true,
      state: base.state,
      changed: false,
      attempt: existing,
      used,
      remaining,
      blocked: false,
      action: 'repeat-same-review-input',
      error: '',
    }
  }

  if (!authorApproved && used >= MAX_AUTOMATIC_REVIEW_ATTEMPTS) {
    return {
      ok: false,
      allowed: false,
      idempotent: false,
      state: base.state,
      changed: false,
      attempt: null,
      used,
      remaining: 0,
      blocked: true,
      action: 'request-author-confirmation',
      error: '本章两审自动轮次已用完，请作者明确批准后再重审。',
    }
  }

  const route = authorApproved ? 'author' : 'automatic'
  const next = cloneState(base.state)
  const nextAttempts = getChapter(next, chapterNum).review.attempts
  const attempt = { reviewInputToken, mode, route, status: 'issued' }
  nextAttempts.push(attempt)
  const nextUsed = used + (route === 'automatic' ? 1 : 0)
  return {
    ok: true,
    allowed: true,
    idempotent: false,
    state: next,
    changed: true,
    attempt,
    used: nextUsed,
    remaining: MAX_AUTOMATIC_REVIEW_ATTEMPTS - nextUsed,
    blocked: false,
    action: route === 'author' ? 'reserve-author-approved-review' : 'reserve-automatic-review',
    error: '',
  }
}

/** Mark a previously reserved review token as saved; no lock or write. */
export async function markReviewAttemptSaved(
  repoPath,
  { chapterNum, reviewInputToken, mode = 'pending' } = {}
) {
  const loaded = await readRetryPolicy(repoPath)
  if (!loaded.ok) return { ok: false, state: null, file: null, changed: false, error: loaded.error }
  const result = markReviewAttemptSavedInState(loaded.state, { chapterNum, reviewInputToken, mode })
  if (!result.ok) return { ...result, file: null, changed: false }
  return { ...result, file: result.changed ? retryPolicyFile(result.state) : null, exists: loaded.exists }
}

export function markReviewAttemptSavedInState(
  state,
  { chapterNum, reviewInputToken, mode = 'pending' } = {}
) {
  const base = validateRetryPolicy(state)
  if (!base.ok) return { ok: false, state: null, file: null, changed: false, error: base.error }
  if (!validChapterNum(chapterNum)) return { ok: false, state: null, file: null, changed: false, error: '章号必须是正整数' }
  if (!HASH_RE.test(reviewInputToken || '')) {
    return { ok: false, state: null, file: null, changed: false, error: '审稿输入令牌无效' }
  }
  if (!REVIEW_MODES.has(mode)) {
    return { ok: false, state: null, file: null, changed: false, error: '审稿模式无效' }
  }
  const existing = getChapter(base.state, chapterNum).review.attempts.at(-1)
  if (!existing || existing.reviewInputToken !== reviewInputToken) {
    // `missing` lets callers separate "record absent" (save proceeds with a
    // warning; budget was already reset by whatever removed the record) from
    // corruption, which stays fail-closed.
    return { ok: false, missing: true, state: null, file: null, changed: false, error: '未找到对应的审稿轮次，拒绝补记' }
  }
  if (existing.status === 'saved') {
    return { ok: true, state: base.state, changed: false, attempt: existing, error: '' }
  }
  if (existing.mode === 'pending' && mode === 'pending') {
    return { ok: false, state: null, file: null, changed: false, error: '保存审稿轮次时必须补全 complete 或 degraded 模式' }
  }
  if (existing.mode !== 'pending' && mode !== 'pending' && existing.mode !== mode) {
    return { ok: false, state: null, file: null, changed: false, error: '保存的审稿模式与发行轮次不一致' }
  }
  const next = cloneState(base.state)
  const attempt = getChapter(next, chapterNum).review.attempts.at(-1)
  if (attempt.mode === 'pending') attempt.mode = mode
  attempt.status = 'saved'
  return { ok: true, state: next, changed: true, attempt, error: '' }
}

/** Return a file plan that removes retry records for the given chapters. */
export async function clearRetryPolicyChapters(repoPath, chapterNumbers) {
  const loaded = await readRetryPolicy(repoPath)
  if (!loaded.ok) return { ok: false, state: null, file: null, changed: false, error: loaded.error }
  const result = clearRetryPolicyChaptersInState(loaded.state, chapterNumbers)
  if (!result.ok) return { ...result, file: null }
  return { ...result, file: result.changed ? retryPolicyFile(result.state) : null, exists: loaded.exists }
}

export function clearRetryPolicyChaptersInState(state, chapterNumbers) {
  const base = validateRetryPolicy(state)
  if (!base.ok) return { ok: false, state: null, file: null, changed: false, error: base.error }
  if (!Array.isArray(chapterNumbers)) {
    return { ok: false, state: null, file: null, changed: false, error: '待清理章号必须是数组' }
  }
  const numbers = [...new Set(chapterNumbers)]
  if (numbers.some((n) => !validChapterNum(n))) {
    return { ok: false, state: null, file: null, changed: false, error: '待清理章号必须是正整数' }
  }
  const next = cloneState(base.state)
  let changed = false
  for (const chapterNum of numbers) {
    const key = String(chapterNum)
    if (Object.prototype.hasOwnProperty.call(next.chapters, key)) {
      delete next.chapters[key]
      changed = true
    }
  }
  return { ok: true, state: next, changed, error: '' }
}

/** Compute the public mechanical budget fields for a chapter's current state. */
export function mechanicalBudgetForChapter(state, chapterNum) {
  const checked = validateRetryPolicy(state)
  if (!checked.ok || !validChapterNum(chapterNum)) return null
  const attempts = getChapter(checked.state, chapterNum).mechanical.attempts
  return mechanicalBudget(attempts)
}

function mechanicalBudget(attempts) {
  const used = countAutomaticMechanical(attempts)
  const latest = attempts.at(-1)
  return {
    used,
    remaining: MAX_MECHANICAL_AUTO_REPAIRS - used,
    blocked: latest?.result === 'fail' && used >= MAX_MECHANICAL_AUTO_REPAIRS,
  }
}

function validateChapterRecord(value, key) {
  if (!isPlainObject(value) || exactKeys(value, ['mechanical', 'review']) === false) {
    return { ok: false, state: null, error: `第 ${key} 章记录字段不完整` }
  }
  const mechanical = validateMechanicalRecord(value.mechanical, key)
  if (!mechanical.ok) return mechanical
  const review = validateReviewRecord(value.review, key)
  if (!review.ok) return review
  return {
    ok: true,
    chapter: { mechanical: mechanical.record, review: review.record },
    error: '',
  }
}

function validateMechanicalRecord(value, key) {
  if (!isPlainObject(value) || exactKeys(value, ['attempts']) === false || !Array.isArray(value.attempts)) {
    return { ok: false, state: null, error: `第 ${key} 章机检记录无效` }
  }
  const attempts = []
  const hashes = new Set()
  let initialCount = 0
  let automaticCount = 0
  for (const item of value.attempts) {
    if (!isPlainObject(item) || exactKeys(item, ['draftHash', 'route', 'result']) === false) {
      return { ok: false, state: null, error: `第 ${key} 章机检尝试字段无效` }
    }
    if (!HASH_RE.test(item.draftHash || '') || !MECHANICAL_ROUTES.has(item.route) || !MECHANICAL_RESULTS.has(item.result)) {
      return { ok: false, state: null, error: `第 ${key} 章机检尝试值无效` }
    }
    if (hashes.has(item.draftHash)) return { ok: false, state: null, error: `第 ${key} 章机检哈希重复` }
    hashes.add(item.draftHash)
    if (item.route === 'initial') initialCount++
    if (item.route === 'automatic') automaticCount++
    attempts.push({ draftHash: item.draftHash, route: item.route, result: item.result })
  }
  if (initialCount > 1) return { ok: false, state: null, error: `第 ${key} 章机检初次记录重复` }
  if (automaticCount > MAX_MECHANICAL_AUTO_REPAIRS) {
    return { ok: false, state: null, error: `第 ${key} 章机检自动修复次数超限` }
  }
  if (attempts.length && attempts[0].route !== 'initial') {
    return { ok: false, state: null, error: `第 ${key} 章机检缺少初次记录` }
  }
  return { ok: true, record: { attempts }, error: '' }
}

function validateReviewRecord(value, key) {
  if (!isPlainObject(value) || exactKeys(value, ['attempts']) === false || !Array.isArray(value.attempts)) {
    return { ok: false, state: null, error: `第 ${key} 章两审记录无效` }
  }
  const attempts = []
  let automaticCount = 0
  for (const item of value.attempts) {
    if (!isPlainObject(item) || exactKeys(item, ['reviewInputToken', 'mode', 'route', 'status']) === false) {
      return { ok: false, state: null, error: `第 ${key} 章两审尝试字段无效` }
    }
    if (!HASH_RE.test(item.reviewInputToken || '') || !REVIEW_MODES.has(item.mode) || !REVIEW_ROUTES.has(item.route) || !REVIEW_STATUSES.has(item.status)) {
      return { ok: false, state: null, error: `第 ${key} 章两审尝试值无效` }
    }
    if (item.route === 'automatic') automaticCount++
    attempts.push({
      reviewInputToken: item.reviewInputToken,
      mode: item.mode,
      route: item.route,
      status: item.status,
    })
  }
  if (automaticCount > MAX_AUTOMATIC_REVIEW_ATTEMPTS) {
    return { ok: false, state: null, error: `第 ${key} 章两审自动轮次超限` }
  }
  return { ok: true, record: { attempts }, error: '' }
}

function getChapter(state, chapterNum) {
  const key = String(chapterNum)
  if (!state.chapters[key]) {
    state.chapters[key] = { mechanical: { attempts: [] }, review: { attempts: [] } }
  }
  return state.chapters[key]
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state))
}

function countAutomaticMechanical(attempts) {
  return attempts.reduce((count, item) => count + (item.route === 'automatic' ? 1 : 0), 0)
}

function countAutomaticReviews(attempts) {
  return attempts.reduce((count, item) => count + (item.route === 'automatic' ? 1 : 0), 0)
}

function validChapterNum(value) {
  return Number.isInteger(value) && value > 0
}

function isCanonicalChapterKey(key) {
  return /^\d+$/.test(key) && Number(key) > 0 && String(Number(key)) === key
}

function compareChapterKeys(left, right) {
  return Number(left) - Number(right)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

export { HASH_RE }
