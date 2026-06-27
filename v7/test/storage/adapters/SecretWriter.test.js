import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SecretWriter } from '../../../src/storage/adapters/SecretWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

test('SecretWriter.write 写信息差（防呆 front matter + 内容）', async () => {
  const root = await makeRepo()
  try {
    const w = new SecretWriter(root)
    const fm = { 强度: '高', 谁知道: ['林晚'], 读者知道: false, 登记章: 152, 关键词: ['血书'] }
    const r = await w.write('信息差-021-血书真相', fm, '## 内容\n血书写着真凶名讳。')
    assert.equal(r.ok, true)
    const content = await read(root, '定稿/设定/信息差/信息差-021-血书真相.md')
    assert.match(content, /读者知道: false/)
    assert.match(content, /关键词:\n {2}- 血书/)
    assert.match(content, /## 内容/)
    assert.match(content, /血书写着真凶名讳/)
  } finally {
    await cleanup(root)
  }
})
