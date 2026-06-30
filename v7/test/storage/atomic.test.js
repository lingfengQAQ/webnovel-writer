import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { writeAtomicBatch } from '../../src/storage/atomic.js'

test('writeAtomicBatch：后续文件失败时，已替换文件恢复原样', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-atomic-'))
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'old', 'utf8')
    await fs.mkdir(path.join(root, 'b.txt'))

    await assert.rejects(() =>
      writeAtomicBatch(root, [
        { path: 'a.txt', content: 'new' },
        { path: 'b.txt', content: 'bad' },
      ])
    )

    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'old')
    const bStat = await fs.stat(path.join(root, 'b.txt'))
    assert.equal(bStat.isDirectory(), true, '既有目录不应被批量写删除')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
