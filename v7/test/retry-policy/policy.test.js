import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  RETRY_POLICY_PATH,
  clearRetryPolicyChapters,
  emptyRetryPolicy,
  markReviewAttemptSaved,
  mechanicalBudgetForChapter,
  readRetryPolicy,
  recordMechanicalAttempt,
  reserveMechanicalAttempt,
  reserveReviewAttempt,
  retryDraftHash,
  retryPolicyFile,
  validateRetryPolicy,
} from '../../src/retry-policy/index.js'

const hash = (char) => `sha256:${char.repeat(64)}`

test('retry-policy：严格 schema + 确定性序列化，不写时间戳', () => {
  let state = emptyRetryPolicy()
  state = recordMechanicalAttempt(state, {
    chapterNum: 10,
    draftHash: hash('a'),
    pass: false,
    route: 'initial',
  }).state
  state = recordMechanicalAttempt(state, {
    chapterNum: 2,
    draftHash: hash('b'),
    pass: true,
    route: 'initial',
  }).state

  const file = retryPolicyFile(state)
  assert.equal(file.path, '工作区/重试预算.json')
  assert.ok(file.content.indexOf('"2"') < file.content.indexOf('"10"'), '章号按数值排序')
  assert.doesNotMatch(file.content, /time|date|started|updated/i)
  assert.deepEqual(JSON.parse(file.content), validateRetryPolicy(state).state)

  const extra = JSON.parse(file.content)
  extra.chapters['2'].mechanical.extra = true
  const invalid = validateRetryPolicy(extra)
  assert.equal(invalid.ok, false)
  assert.match(invalid.error, /机检记录无效/)
})

test('retry-policy：预算键哈希整份草稿，只改 front matter 也是新版本', () => {
  const body = '正文内容保持不变。'
  const a = retryDraftHash(`---\n章号: 3\n---\n\n${body}`)
  const b = retryDraftHash(`---\n章号: 3\n标题: 补上缺失字段\n---\n\n${body}`)
  const crlf = retryDraftHash(`---\r\n章号: 3\r\n---\r\n\r\n${body}`)
  assert.notEqual(a, b, '只改 front matter 的修复必须消耗新额度')
  assert.equal(a, crlf, '行尾差异不算新草稿版本')
  assert.match(a, /^sha256:[0-9a-f]{64}$/)
})

test('retry-policy：markSaved 轮次缺失带 missing 标志，区别于损坏 fail closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-retry-missing-'))
  try {
    const missing = await markReviewAttemptSaved(root, {
      chapterNum: 1,
      reviewInputToken: hash('f'),
      mode: 'complete',
    })
    assert.equal(missing.ok, false)
    assert.equal(missing.missing, true)
    assert.match(missing.error, /未找到对应的审稿轮次/)

    await fs.mkdir(path.join(root, '工作区'), { recursive: true })
    await fs.writeFile(path.join(root, RETRY_POLICY_PATH), '{"schemaVersion":1,', 'utf8')
    const corrupt = await markReviewAttemptSaved(root, {
      chapterNum: 1,
      reviewInputToken: hash('f'),
      mode: 'complete',
    })
    assert.equal(corrupt.ok, false)
    assert.notEqual(corrupt.missing, true, '损坏必须走 fail closed，不得当作缺失')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('retry-policy：损坏文件 fail closed，不静默恢复额度', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-retry-corrupt-'))
  try {
    await fs.mkdir(path.join(root, '工作区'), { recursive: true })
    await fs.writeFile(path.join(root, RETRY_POLICY_PATH), '{"schemaVersion":1,', 'utf8')
    const loaded = await readRetryPolicy(root)
    assert.equal(loaded.ok, false)
    assert.equal(loaded.state, null)
    assert.match(loaded.error, /损坏.*停止自动流程/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('retry-policy：机检初次免费、两个不同修订稿扣额度、同 hash 幂等、作者路径不重置', () => {
  let state = emptyRetryPolicy()

  const initial = reserveMechanicalAttempt(state, { chapterNum: 3, draftHash: hash('1') })
  assert.equal(initial.allowed, true)
  assert.equal(initial.route, 'initial')
  state = recordMechanicalAttempt(state, {
    chapterNum: 3,
    draftHash: hash('1'),
    pass: false,
    route: initial.route,
  }).state
  assert.deepEqual(mechanicalBudgetForChapter(state, 3), { used: 0, remaining: 2, blocked: false })

  const same = reserveMechanicalAttempt(state, { chapterNum: 3, draftHash: hash('1') })
  assert.equal(same.allowed, true)
  assert.equal(same.idempotent, true)
  const sameRecorded = recordMechanicalAttempt(state, {
    chapterNum: 3,
    draftHash: hash('1'),
    pass: false,
    route: same.route,
  })
  assert.equal(sameRecorded.changed, false)

  for (const char of ['2', '3']) {
    const reserved = reserveMechanicalAttempt(state, { chapterNum: 3, draftHash: hash(char) })
    assert.equal(reserved.allowed, true)
    assert.equal(reserved.route, 'automatic')
    state = recordMechanicalAttempt(state, {
      chapterNum: 3,
      draftHash: hash(char),
      pass: false,
      route: reserved.route,
    }).state
  }
  assert.deepEqual(mechanicalBudgetForChapter(state, 3), { used: 2, remaining: 0, blocked: true })

  const blocked = reserveMechanicalAttempt(state, { chapterNum: 3, draftHash: hash('4') })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.budget.blocked, true)
  assert.equal(blocked.action, 'request-author-confirmation')

  const repeatLast = reserveMechanicalAttempt(state, { chapterNum: 3, draftHash: hash('3') })
  assert.equal(repeatLast.allowed, true, '耗尽后同 hash 仍幂等可检')
  assert.equal(repeatLast.idempotent, true)

  const author = reserveMechanicalAttempt(state, {
    chapterNum: 3,
    draftHash: hash('4'),
    authorConfirmed: true,
  })
  assert.equal(author.allowed, true)
  assert.equal(author.route, 'author')
  state = recordMechanicalAttempt(state, {
    chapterNum: 3,
    draftHash: hash('4'),
    pass: false,
    route: author.route,
  }).state
  assert.deepEqual(mechanicalBudgetForChapter(state, 3), { used: 2, remaining: 0, blocked: true })
})

test('retry-policy：review API 无锁无落盘，issued 重取幂等，saved 后同 token 是新轮', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-retry-review-'))
  try {
    const first = await reserveReviewAttempt(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      authorApproved: false,
    })
    assert.equal(first.ok, true)
    assert.equal(first.changed, true)
    assert.equal(first.used, 1)
    assert.equal(first.remaining, 1)
    assert.equal(first.file.path, RETRY_POLICY_PATH)
    await assert.rejects(() => fs.access(path.join(root, RETRY_POLICY_PATH)), 'API 本身不得落盘')
    await writePlan(root, first.file)

    const duplicate = await reserveReviewAttempt(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
    })
    assert.equal(duplicate.ok, true)
    assert.equal(duplicate.idempotent, true)
    assert.equal(duplicate.changed, false)
    assert.equal(duplicate.file, null)
    assert.equal(duplicate.used, 1)

    const firstSaved = await markReviewAttemptSaved(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      mode: 'complete',
    })
    assert.equal(firstSaved.ok, true)
    assert.equal(firstSaved.attempt.status, 'saved')
    assert.equal(firstSaved.attempt.mode, 'complete')
    await writePlan(root, firstSaved.file)

    const second = await reserveReviewAttempt(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      mode: 'degraded',
    })
    assert.equal(second.ok, true)
    assert.equal(second.idempotent, false, 'saved 后同 token 是一次新重审')
    assert.equal(second.used, 2)
    assert.equal(second.remaining, 0)
    await writePlan(root, second.file)

    const secondSaved = await markReviewAttemptSaved(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      mode: 'degraded',
    })
    assert.equal(secondSaved.ok, true)
    await writePlan(root, secondSaved.file)

    const blocked = await reserveReviewAttempt(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      mode: 'complete',
    })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.action, 'request-author-confirmation')

    const author = await reserveReviewAttempt(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      mode: 'complete',
      authorApproved: true,
    })
    assert.equal(author.ok, true)
    assert.equal(author.attempt.route, 'author')
    assert.equal(author.used, 2)
    assert.equal(author.remaining, 0)
    await writePlan(root, author.file)

    const saved = await markReviewAttemptSaved(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      mode: 'complete',
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.changed, true)
    assert.equal(saved.attempt.status, 'saved')
    await writePlan(root, saved.file)

    const savedAgain = await markReviewAttemptSaved(root, {
      chapterNum: 7,
      reviewInputToken: hash('a'),
      mode: 'complete',
    })
    assert.equal(savedAgain.ok, true)
    assert.equal(savedAgain.changed, false)
    assert.equal(savedAgain.file, null)

    const cleared = await clearRetryPolicyChapters(root, [7, 7])
    assert.equal(cleared.ok, true)
    assert.equal(cleared.changed, true)
    assert.deepEqual(cleared.state.chapters, {})
    await writePlan(root, cleared.file)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, RETRY_POLICY_PATH), 'utf8')).chapters, {})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function writePlan(root, file) {
  await fs.mkdir(path.dirname(path.join(root, file.path)), { recursive: true })
  await fs.writeFile(path.join(root, file.path), file.content, 'utf8')
}
