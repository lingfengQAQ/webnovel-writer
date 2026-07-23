import { test } from 'node:test'
import assert from 'node:assert/strict'
import { determineNextState } from '../../src/state-machine/index.js'
import { buildDto } from '../../src/state-machine/dto.js'
import { makeGitBook, chapter } from './_helper.js'
import { encodeContractIssue } from '../../src/knowledge/contract-issues.js'
import { serializeFrontMatter } from '../../src/storage/serializers/front-matter.js'

test('序6 起草细纲：dto 含全书近况 + nextChapter，needsAI=true', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n体检周期: 50\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-起.md': chapter(1),
  })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 6)
    assert.equal(r.needsAI, true)
    assert.equal(r.dto.nextChapter, 2)
    assert.match(r.dto.全书近况, /第\s*1\s*卷/)
    assert.ok(r.dto.期望产物.includes('细纲'))
  } finally {
    await cleanup()
  }
})

test('序1 建书引导：dto.缺 含 book.yaml，needsAI=true', async () => {
  const { ctx, cleanup } = await makeGitBook({ '大纲/占位.md': 'x' })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 1)
    assert.equal(r.needsAI, true)
    assert.ok(r.dto.缺.includes('book.yaml'))
  } finally {
    await cleanup()
  }
})

test('序0 修复确认：dto.failures 指向坏文件', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': '书名: 测\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-起.md': chapter(1),
    '定稿/正文/0002-坏.md': '---\n章号: 2\n标题: [未闭合\n---\nx',
  })
  try {
    const r = await determineNextState(ctx)
    assert.equal(r.序, 0)
    assert.ok(r.dto.failures.length >= 1)
    assert.ok(r.dto.failures.some((f) => f.file.includes('0002')))
  } finally {
    await cleanup()
  }
})

test('buildDto 默认分支：非 AI 态返回最简 dto', async () => {
  const dto = await buildDto({}, 2, { state: 'relink-manual-edits' })
  assert.equal(dto.state, 'relink-manual-edits')
})

test('契约重复问题在细纲停顿点呈报，卷末固定汇总；无问题不制造修改', async () => {
  const encoded = encodeContractIssue({
    条款: '核心读者承诺',
    严重度: 'medium',
    问题: '成长承诺没有推进',
  })
  const chapterWithIssue = (num) =>
    serializeFrontMatter(
      {
        章号: num,
        标题: `第${num}章`,
        卷: 1,
        字数: 100,
        章定位: '推进',
        钩子: '危机钩-强',
        情绪定位: '铺垫',
        契约问题: [encoded],
      },
      '正文。'
    )
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-一.md': chapterWithIssue(1),
    '定稿/正文/0002-二.md': chapterWithIssue(2),
  })
  try {
    const outline = await buildDto(ctx, 6, { nextChapter: 3 })
    assert.equal(outline.作品契约复盘提示[0].条款, '核心读者承诺')
    assert.deepEqual(outline.作品契约复盘提示[0].连续章, [1, 2])

    const volume = await buildDto(ctx, 4, { 卷: 1 })
    assert.equal(volume.作品契约复盘[0].次数, 2)
    assert.deepEqual(volume.作品契约复盘[0].章, [1, 2])
    assert.match(volume.作品契约, /## 差异化点/)
    assert.match(volume.作品契约, /契约版本: 1/)
    assert.match(volume.期望产物, /作者确认.*证据.*影响范围.*persist-contract/)
  } finally {
    await cleanup()
  }
})

test('序4 DTO 与序6共用契约读取闸门：缺失或损坏均返回阻断且不携伪造契约', async () => {
  const missingBook = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n',
    '大纲/总纲.md': '# 总纲',
    '定稿/正文/0001-收卷.md': chapter(1),
  }, { includeContract: false })
  try {
    const missing = await buildDto(missingBook.ctx, 4, { 卷: 1 })
    assert.match(missing.阻断原因, /卷复盘停止.*作品契约.*不存在/)
    assert.match(missing.期望产物, /不得进行卷复盘或修订契约/)
    assert.equal(missing.作品契约, undefined)
  } finally {
    await missingBook.cleanup()
  }

  const damagedBook = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n',
    '大纲/总纲.md': '# 总纲',
    '作品契约/作品契约.md': '---\n类型: 玄幻\n---\n坏契约',
    '定稿/正文/0001-收卷.md': chapter(1),
  })
  try {
    const damaged = await buildDto(damagedBook.ctx, 4, { 卷: 1 })
    assert.match(damaged.阻断原因, /卷复盘停止.*作品契约结构不完整/)
    assert.equal(damaged.作品契约, undefined)
  } finally {
    await damagedBook.cleanup()
  }
})
