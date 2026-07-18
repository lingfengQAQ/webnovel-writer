import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as persistContract } from '../../src/commands/persist-contract.js'
import { readBatch, 章状态 } from '../../src/staging/index.js'
import { makeGitBook, minimalWorkContract, chapter } from '../state-machine/_helper.js'

test('作者确认的契约更新独立提交，并使生效章后的未定稿工件失效', async () => {
  const oldContract = minimalWorkContract()
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '作品契约/作品契约.md': oldContract,
    '作品契约/知识选择记录.md': '# 知识选择记录\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    const stagedDir = path.join(root, '工作区', '待定稿', '0003-待改')
    await fs.mkdir(stagedDir, { recursive: true })
    await fs.writeFile(path.join(stagedDir, '草稿.md'), '暂存草稿。', 'utf8')
    await fs.writeFile(
      path.join(root, '工作区', '待定稿', '批次.json'),
      JSON.stringify({
        章列表: [{ 章号: 3, 标题: '待改', 状态: 章状态.待审收, 目录: '0003-待改' }],
      }),
      'utf8'
    )
    await fs.writeFile(path.join(root, '工作区', '草稿-A.md'), '当前草稿。', 'utf8')
    await fs.writeFile(path.join(root, '工作区', '本章写作材料.md'), '旧材料。', 'utf8')
    await fs.writeFile(path.join(root, '工作区', '审稿.md'), '旧审稿。', 'utf8')

    const payload = {
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 3 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      作者已确认: true,
    }
    const inputPath = path.join(root, '工作区', '契约修订.json')
    await fs.writeFile(inputPath, JSON.stringify(payload), 'utf8')

    const before = (await git(['rev-list', '--count', 'HEAD'])).stdout.trim()
    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, true, result.error)
    assert.match(result.output, /v2/)
    assert.match(result.output, /第 3 章起生效/)
    assert.match(await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'), /契约版本: 2/)
    assert.match(await fs.readFile(path.join(root, '作品契约', '知识选择记录.md'), 'utf8'), /契约版本 2/)
    const after = (await git(['rev-list', '--count', 'HEAD'])).stdout.trim()
    assert.equal(Number(after), Number(before) + 1)
    assert.match((await git(['log', '-1', '--format=%s'])).stdout, /^fix\(契约\): v2/)

    const batch = await readBatch(root)
    assert.equal(batch.章列表[0].状态, 章状态.契约变更)
    await fs.access(path.join(root, '工作区', '契约更新前-草稿-A.md'))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '本章写作材料.md')))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '审稿.md')))
    await fs.access(path.join(root, '工作区', '契约更新待重备料.md'))
  } finally {
    await cleanup()
  }
})

test('契约更新不会静默接受未确认、倒退版本或影响已定稿章', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
  })
  try {
    const inputPath = path.join(root, '工作区', '坏修订.json')
    await fs.mkdir(path.dirname(inputPath), { recursive: true })
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        作品契约: minimalWorkContract({ version: 1, effectiveChapter: 1 }),
        知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
        作者已确认: false,
      }),
      'utf8'
    )
    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /作者确认/)
    assert.match(result.error, /严格递增/)
    assert.match(result.error, /第 2 章/)
    assert.doesNotMatch(await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'), /契约版本: 2/)
  } finally {
    await cleanup()
  }
})
