import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as finalizeCmd } from '../../src/commands/finalize.js'
import { tempBookCtx } from './_helper.js'

// R2：批次进行中的手动 finalize 必须被拒——放行会让 overlay 双计总章数，
// 且 finalize-batch 再转正同章时撞「条目已存在」整批卡死。守卫在读 payload 之前，
// 故测试无需构造定稿包。
async function injectBatch(root, nums) {
  const rows = []
  for (const n of nums) {
    const dirName = `${String(n).padStart(4, '0')}-批内章`
    await fs.mkdir(path.join(root, '工作区', '待定稿', dirName), { recursive: true })
    rows.push({ 章号: n, 标题: '批内章', 状态: '待审收', 目录: dirName })
  }
  await fs.writeFile(
    path.join(root, '工作区', '待定稿', '批次.json'),
    JSON.stringify({ 章列表: rows }),
    'utf8'
  )
}

test('R2：目标章在批内 → 手动 finalize 被拒，指向 finalize-batch', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    await injectBatch(ctx.repoPath, [3, 4])
    const r = await finalizeCmd(['3'], {}, ctx)
    assert.equal(r.ok, false)
    assert.match(r.error, /已在待定稿批次/)
    assert.match(r.error, /finalize-batch/)
  } finally {
    await cleanup()
  }
})

test('R2：批次在场但目标章不在批内 → 同样被拒（防章号错位）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    await injectBatch(ctx.repoPath, [3, 4])
    const r = await finalizeCmd(['9'], {}, ctx)
    assert.equal(r.ok, false)
    assert.match(r.error, /待定稿批次/)
    assert.match(r.error, /batch-discard/)
  } finally {
    await cleanup()
  }
})

test('无批次时 finalize 不受守卫影响（走正常校验路径）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await finalizeCmd(['3'], {}, ctx)
    // 没给 payload：应报缺 payload 而不是批次守卫错
    assert.equal(r.ok, false)
    assert.doesNotMatch(r.error, /批次/)
  } finally {
    await cleanup()
  }
})
