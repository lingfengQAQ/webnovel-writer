import { test } from 'node:test'
import assert from 'node:assert/strict'
import { determineNextState } from '../../src/state-machine/index.js'

test('空工作目录（repoPath=null）→ 序1 建书引导,不碰 git/缓存', async () => {
  const r = await determineNextState({ repoPath: null, cache: null, workdir: '/tmp/任意' })
  assert.equal(r.ok, true)
  assert.equal(r.序, 1)
  assert.equal(r.state, 'create-book')
  assert.equal(r.needsAI, true)
  assert.deepEqual(r.gitHealth, { fixed: [], guidance: [] })
  assert.deepEqual(r.dto.缺, ['book.yaml', '总纲'])
})
