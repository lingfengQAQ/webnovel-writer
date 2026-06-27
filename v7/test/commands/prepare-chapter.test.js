import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { run } from '../../src/commands/prepare-chapter.js'
import { tempBookCtx } from './_helper.js'

test('prepare-chapter 写出本章写作材料', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await run(['3'], {}, ctx)
    assert.equal(r.ok, true)
    await fs.access(path.join(ctx.repoPath, '工作区', '本章写作材料.md'))
  } finally {
    await cleanup()
  }
})

test('prepare-chapter 非数字章号 → ok=false', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await run(['abc'], {}, ctx)
    assert.equal(r.ok, false)
  } finally {
    await cleanup()
  }
})
