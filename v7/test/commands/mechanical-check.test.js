import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { run } from '../../src/commands/mechanical-check.js'
import { RETRY_POLICY_PATH } from '../../src/retry-policy/index.js'
import { tempBookCtx } from './_helper.js'

test('mechanical-check 输出 pass/issues/candidates JSON', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const draft = `---
章号: 3
标题: 测
卷: 1
字数: 40
章定位: 推进
钩子: 危机钩-强
情绪定位: 铺垫
---
林晚立于殿前，握紧令牌，心中默念定要查明旧案，不负师门多年栽培。`
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '草稿-A.md'), draft, 'utf8')

    const r = await run(['3'], {}, ctx)
    assert.equal(r.ok, true)
    const out = JSON.parse(r.output)
    assert.equal(typeof out.pass, 'boolean')
    assert.ok(Array.isArray(out.issues))
    assert.ok(Array.isArray(out.candidates))
    assert.equal(out.used, 0)
    assert.equal(out.remaining, 2)
    assert.equal(out.blocked, false)
    assert.equal(out.executed, true)
    assert.equal(typeof out.action, 'string')
  } finally {
    await cleanup()
  }
})

test('mechanical-check 两个不同修订稿耗尽自动预算，第三个先拒绝，作者确认可继续且不重置', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  const draftPath = path.join(ctx.repoPath, '工作区', '草稿-A.md')
  try {
    const outputs = []
    for (const marker of ['初稿', '修订一', '修订二']) {
      await fs.writeFile(draftPath, failingDraft(marker), 'utf8')
      const result = await run(['3'], {}, ctx)
      assert.equal(result.ok, true, result.error)
      outputs.push(JSON.parse(result.output))
    }
    assert.deepEqual(outputs.map((out) => out.used), [0, 1, 2])
    assert.deepEqual(outputs.map((out) => out.remaining), [2, 1, 0])
    assert.equal(outputs[2].blocked, true)
    assert.equal(outputs[2].action, 'hand-off-to-author')

    const statePath = path.join(ctx.repoPath, RETRY_POLICY_PATH)
    const beforeBlocked = await fs.readFile(statePath, 'utf8')
    await fs.writeFile(draftPath, failingDraft('自动第三轮'), 'utf8')
    const blockedResult = await run(['3'], {}, ctx)
    assert.equal(blockedResult.ok, true, blockedResult.error)
    const blocked = JSON.parse(blockedResult.output)
    assert.equal(blocked.executed, false)
    assert.equal(blocked.used, 2)
    assert.equal(blocked.remaining, 0)
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.action, 'request-author-confirmation')
    assert.equal(await fs.readFile(statePath, 'utf8'), beforeBlocked, '拒绝前不执行也不改状态')

    const authorResult = await run(['3'], { 'author-confirmed': true }, ctx)
    assert.equal(authorResult.ok, true, authorResult.error)
    const author = JSON.parse(authorResult.output)
    assert.equal(author.executed, true)
    assert.equal(author.used, 2)
    assert.equal(author.remaining, 0)
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
    assert.deepEqual(
      state.chapters['3'].mechanical.attempts.map((item) => item.route),
      ['initial', 'automatic', 'automatic', 'author']
    )
  } finally {
    await cleanup()
  }
})

test('mechanical-check 同一草稿内容 hash 重检幂等，不重复扣自动轮次', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const draftPath = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    await fs.writeFile(draftPath, failingDraft('同稿'), 'utf8')
    const first = JSON.parse((await run(['3'], {}, ctx)).output)
    const second = JSON.parse((await run(['3'], {}, ctx)).output)
    assert.equal(first.used, 0)
    assert.equal(second.used, 0)
    const state = JSON.parse(
      await fs.readFile(path.join(ctx.repoPath, RETRY_POLICY_PATH), 'utf8')
    )
    assert.equal(state.chapters['3'].mechanical.attempts.length, 1)
  } finally {
    await cleanup()
  }
})

test('mechanical-check 只改 front matter 也是新草稿版本，消耗自动额度', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const draftPath = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    const body = '林晚同稿正文。'
    const withTitle = (title) => `---
章号: 3
标题: ${title}
卷: 1
字数: 4
章定位: 推进
钩子: 危机钩-强
情绪定位: 铺垫
---
${body}`
    await fs.writeFile(draftPath, withTitle('第一版'), 'utf8')
    const first = JSON.parse((await run(['3'], {}, ctx)).output)
    await fs.writeFile(draftPath, withTitle('第二版'), 'utf8')
    const second = JSON.parse((await run(['3'], {}, ctx)).output)
    assert.equal(first.used, 0, '初检免费')
    assert.equal(second.used, 1, '正文未变、只改 front matter 也必须扣一轮自动修复')
    const state = JSON.parse(
      await fs.readFile(path.join(ctx.repoPath, RETRY_POLICY_PATH), 'utf8')
    )
    assert.deepEqual(
      state.chapters['3'].mechanical.attempts.map((item) => item.route),
      ['initial', 'automatic']
    )
  } finally {
    await cleanup()
  }
})

test('mechanical-check 重试预算损坏 → fail closed', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '草稿-A.md'), failingDraft('损坏'), 'utf8')
    await fs.writeFile(path.join(ctx.repoPath, RETRY_POLICY_PATH), '{bad', 'utf8')
    const result = await run(['3'], {}, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /重试预算记录损坏.*停止自动流程/)
  } finally {
    await cleanup()
  }
})

test('mechanical-check 非数字章号 → ok=false', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await run(['abc'], {}, ctx)
    assert.equal(r.ok, false)
  } finally {
    await cleanup()
  }
})

function failingDraft(marker) {
  return `---
章号: 3
标题: ${marker}
卷: 1
字数: 4
章定位: 推进
钩子: 危机钩-强
情绪定位: 铺垫
---
林晚${marker}。`
}
