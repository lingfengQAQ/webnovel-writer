import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import {
  archiveChapterKnowledgeFromOutline,
  buildChapterKnowledgeArchive,
  parseChapterDeclarations,
  parseChapterKnowledgeArchive,
  readRecentChapterKnowledge,
  resolveChapterDeclarations,
} from '../../src/knowledge/chapter.js'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

const outline = [
  '## 本章提案',
  '本章节拍：PA-001 压抑蓄力爆发、微反转补刀',
  '本章场景: 拍卖会、自定义梦境回廊',
  '本章技法：限制视角误导',
  '本章追读：悬念钩、选择钩',
  '知识变体：拍卖会只写会后余波，不写逐口竞价',
  '知识变体：悬念钩用于递进既有玉佩谜题',
  '本章对象：CHAR-001、物品-001',
  '章尾钩子：旧字段不得继续生效',
].join('\n')

test('章级声明一次性切换到四维、变体与对象，四维均可多选', () => {
  const declarations = parseChapterDeclarations(outline)
  assert.deepEqual(declarations.节拍, ['PA-001 压抑蓄力爆发', '微反转补刀'])
  assert.deepEqual(declarations.场景, ['拍卖会', '自定义梦境回廊'])
  assert.deepEqual(declarations.技法, ['限制视角误导'])
  assert.deepEqual(declarations.追读, ['悬念钩', '选择钩'])
  assert.deepEqual(declarations.变体, [
    '拍卖会只写会后余波，不写逐口竞价',
    '悬念钩用于递进既有玉佩谜题',
  ])
  assert.deepEqual(declarations.对象, ['CHAR-001', '物品-001'])
  assert.equal(declarations.追读.includes('旧字段不得继续生效'), false)
  assert.deepEqual(parseChapterDeclarations('## 本章提案'), {
    节拍: [], 场景: [], 技法: [], 追读: [], 变体: [], 对象: [],
  })
})

test('已选知识精确命中，未命中作为自定义原样归档；历史只解析最终选择与变体', async () => {
  const resolved = await resolveChapterDeclarations(packageRoot, outline)
  const pa1 = resolved.selections.find((item) => item.声明.startsWith('PA-001'))
  assert.equal(pa1.条目.名称, '压抑蓄力爆发')
  assert.ok(pa1.条目.落笔时.length > 0)
  assert.equal(resolved.selections.find((item) => item.声明 === '限制视角误导').条目, null)

  const archive = await buildChapterKnowledgeArchive(packageRoot, outline)
  assert.ok(archive.includes('节拍｜压抑蓄力爆发'))
  assert.ok(archive.includes('场景｜自定义梦境回廊'))
  assert.ok(archive.includes('技法｜限制视角误导'))
  assert.ok(archive.includes('变体｜拍卖会只写会后余波，不写逐口竞价'))
  assert.ok(!archive.some((item) => item.includes('本章对象')))

  const history = parseChapterKnowledgeArchive(archive, { chapterNum: 12 })
  assert.ok(history.every((item) => item.章号 === 12))
  assert.ok(history.every((item) => item.变体.includes('拍卖会只写会后余波')))
  assert.ok(history.some((item) => item.维度 === '追读' && item.名称 === '悬念钩'))
})

test('近期历史合并定稿章与批内前章，按章倒序且不读取额外反馈表', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-history-'))
  try {
    const dir = path.join(repoPath, '定稿', '正文')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, '0001-起步.md'),
      '---\n章号: 1\n标题: 起步\n知识选择:\n  - 场景｜拍卖会\n---\n正文。',
      'utf8'
    )
    await fs.writeFile(
      path.join(dir, '0002-推进.md'),
      '---\n章号: 2\n标题: 推进\n知识选择:\n  - 追读｜悬念钩\n  - 变体｜递进旧谜题\n---\n正文。',
      'utf8'
    )
    const history = await readRecentChapterKnowledge(repoPath, {
      before: 4,
      stagedChapters: [
        { 章号: 3, frontMatter: { 知识选择: ['节拍｜压抑蓄力爆发'] } },
      ],
    })
    assert.deepEqual(history.map((item) => item.章号), [3, 2, 1])
    assert.equal(history.find((item) => item.章号 === 2).变体, '递进旧谜题')
  } finally {
    await fs.rm(repoPath, { recursive: true, force: true })
  }
})

test('归档以工作区确认细纲为准；细纲不存在时保留暂存 payload', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-archive-'))
  try {
    await fs.mkdir(path.join(repoPath, '工作区'), { recursive: true })
    await fs.writeFile(path.join(repoPath, '工作区', '细纲.md'), outline, 'utf8')
    const payload = { frontMatter: { 标题: '测试', 知识选择: ['场景｜旧值'] }, body: '正文。' }
    const archived = await archiveChapterKnowledgeFromOutline({ repoPath, packageRoot }, payload)
    assert.equal(archived.ok, true)
    assert.equal(archived.found, true)
    assert.ok(archived.payload.frontMatter.知识选择.includes('场景｜拍卖会'))
    assert.ok(!archived.payload.frontMatter.知识选择.includes('场景｜旧值'))

    await fs.rm(path.join(repoPath, '工作区', '细纲.md'))
    const preserved = await archiveChapterKnowledgeFromOutline({ repoPath, packageRoot }, archived.payload)
    assert.equal(preserved.found, false)
    assert.deepEqual(preserved.payload.frontMatter.知识选择, archived.payload.frontMatter.知识选择)
  } finally {
    await fs.rm(repoPath, { recursive: true, force: true })
  }
})
