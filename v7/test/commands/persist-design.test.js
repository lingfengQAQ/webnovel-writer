import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as persistDesign } from '../../src/commands/persist-design.js'
import { run as readDesign } from '../../src/commands/read-design.js'
import { makeGitBook } from '../state-machine/_helper.js'
import { designFixture } from '../knowledge/_design-fixture.js'

async function writePayload(root, data) {
  const file = path.join(root, '工作区', '设计.json')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data), 'utf8')
  return file
}

test('persist-design：创建、改名和放弃计划对象分别入档，read-design 可按 ID 精读', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n',
  })
  try {
    let file = await writePayload(root, {
      作者已确认: true,
      对象: [{ 分类: '人物', 内容: designFixture() }],
    })
    const created = await persistDesign([], { file }, ctx)
    assert.equal(created.ok, true, created.error)
    await fs.access(path.join(root, '大纲', '创作设计', '人物', 'CHAR-001-林晚.md'))

    const read = await readDesign(['CHAR-001'], {}, ctx)
    assert.equal(read.ok, true, read.error)
    const dto = JSON.parse(read.output)
    assert.equal(dto.正名, '林晚')
    assert.match(dto.本书设计, /外怯内韧/)
    assert.equal(dto.计划路径, '大纲/创作设计/人物/CHAR-001-林晚.md')

    file = await writePayload(root, {
      作者已确认: true,
      对象: [{
        分类: '人物',
        内容: designFixture({ canonical: '林晚舟', alias: '晚晚' }),
      }],
    })
    const renamed = await persistDesign([], { file }, ctx)
    assert.equal(renamed.ok, true, renamed.error)
    await fs.access(path.join(root, '大纲', '创作设计', '人物', 'CHAR-001-林晚舟.md'))
    await assert.rejects(() => fs.access(path.join(root, '大纲', '创作设计', '人物', 'CHAR-001-林晚.md')))

    file = await writePayload(root, { 作者已确认: true, 放弃: ['CHAR-001'] })
    const abandoned = await persistDesign([], { file }, ctx)
    assert.equal(abandoned.ok, true, abandoned.error)
    await assert.rejects(() => fs.access(path.join(root, '大纲', '创作设计', '人物', 'CHAR-001-林晚舟.md')))
    assert.match((await git(['log', '-1', '--format=%s'])).stdout, /^fix\(设计\): 放弃 CHAR-001/)
  } finally {
    await cleanup()
  }
})

test('persist-design：与定稿名册重名时零写入', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n',
    '定稿/设定/名册.md': '| 正名 | 别名 | 类型 | 首现章 |\n|---|---|---|---|\n| 林晚 | 晚晚 | 角色 | 1 |\n',
  })
  try {
    const file = await writePayload(root, {
      作者已确认: true,
      对象: [{ 分类: '人物', 内容: designFixture() }],
    })
    const result = await persistDesign([], { file }, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /林晚|晚晚/)
    await assert.rejects(() => fs.access(path.join(root, '大纲', '创作设计', '人物')))
  } finally {
    await cleanup()
  }
})
