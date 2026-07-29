import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { SecretWriter } from '../../../src/storage/adapters/SecretWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

test('SecretWriter.write 写信息差（防呆 front matter + 内容）', async () => {
  const root = await makeRepo()
  try {
    const w = new SecretWriter(root)
    const fm = { 强度: '高', 知情人: ['林晚'], 读者已知: false, 登记章: 152, 关键词: ['血书'] }
    const r = await w.write('信息差-021-血书真相', fm, '## 内容\n血书写着真凶名讳。')
    assert.equal(r.ok, true)
    const content = await read(root, '定稿/设定/信息差/信息差-021-血书真相.md')
    assert.match(content, /读者已知: false/)
    assert.match(content, /关键词:\n {2}- 血书/)
    assert.match(content, /## 内容/)
    assert.match(content, /血书写着真凶名讳/)
  } finally {
    await cleanup(root)
  }
})

// P0-F1：id 是 AI 可控字段，写入器必须自卫——非法 id 拒绝且零建目录。
test('SecretWriter.write 拒绝路径穿越 id 且零建目录', async () => {
  const root = await makeRepo({})
  try {
    const w = new SecretWriter(root)
    for (const bad of ['../../x', '..', 'a/b', 'a\\b', 'C:\\x', '']) {
      const r = await w.write(bad, { 强度: '高' }, 'x')
      assert.equal(r.ok, false, bad)
      assert.match(r.error, /信息差/)
    }
    await assert.rejects(() =>
      fs.access(path.join(root, '定稿')), '非法 id 不得创建 定稿/ 目录'
    )
  } finally {
    await cleanup(root)
  }
})
