import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/export.js'
import { tempBookCtx } from './_helper.js'

test('export 命令：单章/范围/全书三形态与用法提示', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const single = await run(['1'], {}, ctx)
    assert.equal(single.ok, true, single.error)
    assert.match(single.output, /工作区\/导出\/第0001章-开局\.txt/)

    const range = await run([], { range: '1-2' }, ctx)
    assert.equal(range.ok, true, range.error)
    assert.match(range.output, /已导出 2 章/)

    const all = await run([], { all: true }, ctx)
    assert.equal(all.ok, true, all.error)
    assert.match(all.output, /全书-测试书\.txt/)

    const noArgs = await run([], {}, ctx)
    assert.equal(noArgs.ok, false)
    assert.match(noArgs.error, /用法/)

    const badRange = await run([], { range: 'a-b' }, ctx)
    assert.equal(badRange.ok, false)
    assert.match(badRange.error, /范围格式/)
  } finally {
    await cleanup()
  }
})
