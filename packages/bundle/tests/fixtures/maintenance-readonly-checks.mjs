import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

function snapshot(root) {
  const result = {}
  const visit = relative => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute)
    if (stat.isDirectory()) {
      result[relative + '/'] = 'directory'
      for (const name of fs.readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name)
    } else if (stat.isSymbolicLink()) result[relative] = `link:${fs.readlinkSync(absolute)}`
    else result[relative] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  }
  visit('')
  return result
}

/** A scripted native-tool trajectory, not a claim that a writing model follows the route. */
export async function checkMaintenanceReadonly({ workspace, main, child, ctx, execute, check, report }) {
  await check('只读开章与主动检查不增加状态调用或书仓写入', async () => {
    const bookName = '开章检查验收'
    const created = await execute(main, 'novel_create_book', { bookName, concept: { 状态: '已确认', 核心创意: '寻找故人', 题材与目标读者: '悬疑' } })
    assert.equal(created.value?.ok, true, JSON.stringify(created))
    const book = path.join(workspace, bookName), bookId = created.value.bookId
    const before = snapshot(book), calls = []
    const off = ctx.on('tools/result', (exec) => { if (exec.agent === main) calls.push({ name: exec.name, nested: exec.parent !== undefined }) })
    let questions = 0
    const offQuestions = ctx.on('user-questions/request', () => { questions++; throw new Error('Readonly inspection must not ask for author approval') })
    try {
      const begun = await execute(main, 'novel_begin_chapter', { bookId })
      assert.equal(begun.isError, false, JSON.stringify(begun))
      assert.equal(begun.value?.ok, true, JSON.stringify(begun))
      assert.equal(begun.value.开章核对.状态, '边界已核对')
      assert.equal(begun.value.书仓检查.结论, '未发现已知问题')
      assert.deepEqual(calls, [{ name: 'novel_begin_chapter', nested: false }])
      assert.deepEqual(snapshot(book), before)

      const queried = await execute(main, 'novel_get_story_status', { bookId })
      assert.equal(queried.value?.ok, true, JSON.stringify(queried))
      assert.equal(queried.value.书仓检查, undefined)
      assert.deepEqual(queried.value.chapters, begun.value.状态读取.chapters)
      assert.deepEqual(snapshot(book), before)

      const dir = path.join(book, '草稿区/草稿/卷01-未完')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, '稿1.起草中.txt'), '正在起草，尚未交付。')
      const pendingBefore = snapshot(book)
      const pending = await execute(main, 'novel_begin_chapter', { bookId })
      assert.equal(pending.value?.ok, true, JSON.stringify(pending))
      assert.equal(pending.value.开章核对.状态, '需恢复')
      assert.equal(pending.value.书仓检查.状态, '未检查')
      const manual = await execute(main, 'novel_check_book', { bookId })
      assert.equal(manual.value?.ok, true, JSON.stringify(manual))
      assert.equal(manual.value.书仓检查.规则版本, 1)
      assert.deepEqual(snapshot(book), pendingBefore)

      for (const name of ['novel_check_book', 'novel_begin_chapter']) {
        const denied = await execute(child, name, { bookId })
        assert.equal(denied.isError, true)
        assert.match(JSON.stringify(denied), /UNKNOWN_TOOL/)
      }
      assert.equal(questions, 0)
      assert.equal(calls.some(call => call.nested || ['write', 'edit', 'skill'].includes(call.name)), false)
      assert.equal(calls.filter(call => call.name === 'novel_get_story_status').length, 1)
      report.maintenanceReadonly = { scriptedTrajectory: calls.map(call => call.name), noNestedStateCall: true, fullBookBytesUnchanged: true, pendingDraftPreserved: true, authorQuestions: questions, delegatedToolsDenied: true }
    } finally { offQuestions(); off() }
  })
}
