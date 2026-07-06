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

// R12 故障注入：atomic.js 与本测试共享 node:fs 的 promises 单例，patch 即生效。
test('writeAtomicBatch：写 tmp 就失败的文件，其原文绝不能被回滚删除（R12）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-atomic-'))
  const origWriteFile = fs.writeFile
  try {
    await origWriteFile.call(fs, path.join(root, 'a.txt'), 'oldA', 'utf8')
    await origWriteFile.call(fs, path.join(root, 'b.txt'), 'oldB', 'utf8')

    fs.writeFile = async (p, ...rest) => {
      if (String(p).includes('b.txt') && String(p).includes('.wnwtmp')) {
        const err = new Error('注入：EPERM 模拟（文件被占用/路径超长）')
        err.code = 'EPERM'
        throw err
      }
      return origWriteFile.call(fs, p, ...rest)
    }

    await assert.rejects(() =>
      writeAtomicBatch(root, [
        { path: 'a.txt', content: 'newA' },
        { path: 'b.txt', content: 'newB' },
      ])
    )

    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'oldA', 'A 应从备份恢复')
    assert.equal(await fs.readFile(path.join(root, 'b.txt'), 'utf8'), 'oldB', 'B 从未动过，原文必须还在')
  } finally {
    fs.writeFile = origWriteFile
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('writeAtomicBatch：备份 rename 失败的文件，其原文绝不能被回滚删除（R12）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-atomic-'))
  const origRename = fs.rename
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'oldA', 'utf8')
    await fs.writeFile(path.join(root, 'b.txt'), 'oldB', 'utf8')

    fs.rename = async (from, to, ...rest) => {
      if (String(from).endsWith('b.txt') && String(to).includes('.wnwbackup')) {
        const err = new Error('注入：EPERM 模拟（原文件被编辑器占用）')
        err.code = 'EPERM'
        throw err
      }
      return origRename.call(fs, from, to, ...rest)
    }

    await assert.rejects(() =>
      writeAtomicBatch(root, [
        { path: 'a.txt', content: 'newA' },
        { path: 'b.txt', content: 'newB' },
      ])
    )

    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'oldA', 'A 应从备份恢复')
    assert.equal(await fs.readFile(path.join(root, 'b.txt'), 'utf8'), 'oldB', 'B 原文必须还在')
    const leftovers = (await fs.readdir(root)).filter((f) => f.includes('.wnwtmp') || f.includes('.wnwbackup'))
    assert.deepEqual(leftovers, [], '不应残留 tmp/backup 文件')
  } finally {
    fs.rename = origRename
    await fs.rm(root, { recursive: true, force: true })
  }
})
