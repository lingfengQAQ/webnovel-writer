import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { run } from '../../src/commands/mechanical-check.js'
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
