import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import {
  archiveChapterKnowledgeFromOutline,
  buildChapterKnowledgeArchive,
  CHAPTER_KNOWLEDGE_SNAPSHOT_PATH,
  flattenRecentChapterKnowledge,
  parseChapterDeclarations,
  parseChapterKnowledgeArchive,
  readRecentChapterKnowledge,
  resolveChapterDeclarations,
  validateChapterKnowledgeArchive,
} from '../../src/knowledge/chapter.js'
import { persistDraftOutline } from '../../src/state-machine/persist.js'
import { minimalWorkContract } from '../state-machine/_helper.js'

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
  assert.ok(archive.some((item) => /^节拍｜压抑蓄力爆发｜节拍\/.+@sha256:[0-9a-f]{64}$/.test(item)))
  assert.ok(archive.includes('场景｜自定义梦境回廊｜作者自定义'))
  assert.ok(archive.includes('技法｜限制视角误导｜作者自定义'))
  assert.ok(archive.includes('变体｜拍卖会只写会后余波，不写逐口竞价'))
  assert.ok(!archive.some((item) => item.includes('本章对象')))

  const history = parseChapterKnowledgeArchive(archive, { chapterNum: 12 })
  assert.equal(history.章号, 12)
  assert.ok(history.选择.some((item) => item.维度 === '追读' && item.名称 === '悬念钩'))
  assert.ok(history.选择.every((item) => !('变体' in item)))
  assert.deepEqual(history.本章整体变体, [
    '拍卖会只写会后余波，不写逐口竞价',
    '悬念钩用于递进既有玉佩谜题',
  ])

  const sourceLess = parseChapterKnowledgeArchive([
    '场景｜无来源旧值',
    '变体｜整体变体仍可单独读取',
  ], { chapterNum: 3 })
  assert.deepEqual(sourceLess, {
    章号: 3,
    选择: [],
    本章整体变体: ['整体变体仍可单独读取'],
  })
})

test('近期历史合并定稿章与批内前章，按章倒序且不读取额外反馈表', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-history-'))
  try {
    const dir = path.join(repoPath, '定稿', '正文')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, '0001-起步.md'),
      '---\n章号: 1\n标题: 起步\n知识选择:\n  - 场景｜拍卖会｜作者自定义\n---\n正文。',
      'utf8'
    )
    await fs.writeFile(
      path.join(dir, '0002-推进.md'),
      '---\n章号: 2\n标题: 推进\n知识选择:\n  - 追读｜悬念钩｜作者自定义\n  - 变体｜递进旧谜题\n---\n正文。',
      'utf8'
    )
    const history = await readRecentChapterKnowledge(repoPath, {
      before: 4,
      stagedChapters: [
        { 章号: 3, frontMatter: { 知识选择: ['节拍｜压抑蓄力爆发｜作者自定义'] } },
      ],
    })
    assert.deepEqual(history.map((item) => item.章号), [3, 2, 1])
    assert.deepEqual(history.find((item) => item.章号 === 2).本章整体变体, ['递进旧谜题'])
    assert.deepEqual(history.find((item) => item.章号 === 3).选择, [
      { 维度: '节拍', 名称: '压抑蓄力爆发', 来源: '作者自定义' },
    ])
    assert.deepEqual(flattenRecentChapterKnowledge(history), [
      { 章号: 3, 维度: '节拍', 名称: '压抑蓄力爆发', 来源: '作者自定义' },
      { 章号: 2, 维度: '追读', 名称: '悬念钩', 来源: '作者自定义' },
      { 章号: 1, 维度: '场景', 名称: '拍卖会', 来源: '作者自定义' },
    ])
  } finally {
    await fs.rm(repoPath, { recursive: true, force: true })
  }
})

async function fs_rm(p) {
  await fs.rm(p, { recursive: true, force: true })
}

// 端到端样例（目标 schema 夹具）：声明 → 命中 → 章档案 → 近期历史 → 软降权
test('细纲声明到近期软降权闭环：未选候选不持久化、自定义不阻断', async () => {
  const { queryKnowledge } = await import('../../src/knowledge/index.js')
  const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-e2e-pkg-'))
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-e2e-repo-'))
  try {
    const entry = (dir, file, fmLines) => fs.writeFile(
      path.join(pkg, 'references', dir, file),
      ['---', ...fmLines, '---', '## 规划时', '', '选用判据。', '', '## 落笔时', '', '落笔动作。', '', '## 审稿时', '', '核对判据。'].join('\n'),
      'utf8'
    )
    for (const dir of ['节拍', '场景', '技法', '追读']) {
      await fs.mkdir(path.join(pkg, 'references', dir), { recursive: true })
    }
    await entry('节拍', 'PA-901-蓄压释放.md', ['编号: PA-901', '名称: 蓄压释放', '一句话: 先蓄压后释放的章内曲线', '关键词:', '  - 蓄压', '  - 释放'])
    await entry('场景', '暗市交易.md', ['名称: 暗市交易', '一句话: 以非法交易为容器的多方博弈', '关键词:', '  - 暗市', '  - 交易'])
    await entry('场景', '未选容器.md', ['名称: 未选容器', '一句话: 本章未选择的候选场景', '关键词:', '  - 未选'])
    await entry('技法', '限制视角.md', ['名称: 限制视角', '类别: 视角', '作用层级: 场', '触发问题:', '  - 信息误导', '一句话: 只写视角人物能确认的信息'])
    await entry('追读', '悬念压钩.md', ['名称: 悬念压钩', '一句话: 章尾留未解悬念压力', '关键词:', '  - 悬念'])

    const e2eOutline = [
      '## 本章提案',
      '本章节拍：PA-901 蓄压释放',
      '本章场景：暗市交易',
      '本章技法：限制视角、自定义镜像独白',
      '本章追读：悬念压钩',
      '知识变体：暗市交易只写交易破裂后的追捕',
    ].join('\n')

    // 声明命中：正式条目精确命中，自定义原样保留且不阻断
    const resolved = await resolveChapterDeclarations(pkg, e2eOutline)
    assert.equal(resolved.selections.find((item) => item.声明.startsWith('PA-901')).条目.名称, '蓄压释放')
    assert.equal(resolved.selections.find((item) => item.声明 === '自定义镜像独白').条目, null)

    // 章档案平铺保存最终选择与真实变体；未选候选不持久化
    const archive = await buildChapterKnowledgeArchive(pkg, e2eOutline)
    assert.match(archive[0], /^节拍｜蓄压释放｜节拍\/PA-901-蓄压释放\.md@sha256:[0-9a-f]{64}$/)
    assert.match(archive[1], /^场景｜暗市交易｜场景\/暗市交易\.md@sha256:[0-9a-f]{64}$/)
    assert.match(archive[2], /^技法｜限制视角｜技法\/限制视角\.md@sha256:[0-9a-f]{64}$/)
    assert.equal(archive[3], '技法｜自定义镜像独白｜作者自定义')
    assert.match(archive[4], /^追读｜悬念压钩｜追读\/悬念压钩\.md@sha256:[0-9a-f]{64}$/)
    assert.equal(archive[5], '变体｜暗市交易只写交易破裂后的追捕')
    assert.ok(!archive.some((item) => item.includes('未选容器')))

    // 近期历史：批内前章视图 → queryKnowledge 软降权与重复提醒
    const history = await readRecentChapterKnowledge(repoPath, {
      before: 8,
      stagedChapters: [{ 章号: 7, frontMatter: { 知识选择: archive } }],
    })
    assert.ok(history[0].选择.some((item) => item.维度 === '场景' && item.名称 === '暗市交易'))
    assert.deepEqual(history[0].本章整体变体, ['暗市交易只写交易破裂后的追捕'])

    const hits = await queryKnowledge(pkg, '场景', {
      问题: '本章在暗市完成交易后被人追捕',
      近期: flattenRecentChapterKnowledge(history),
    })
    const used = hits.find((item) => item.名称 === '暗市交易')
    assert.ok(used, '近期用过的合适候选仍保留')
    assert.deepEqual(used.近期使用, [{ 章号: 7 }])
    assert.match(used.重复提醒, /软降权/)
    const unused = hits.find((item) => item.名称 === '未选容器')
    assert.ok(!unused || !unused.近期使用, '未选候选不产生使用记录')
  } finally {
    await fs_rm(pkg)
    await fs_rm(repoPath)
  }
})

test('归档以工作区确认细纲为准；细纲不存在时保留暂存 payload', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-archive-'))
  try {
    await fs.mkdir(path.join(repoPath, '作品契约'), { recursive: true })
    await fs.writeFile(
      path.join(repoPath, '作品契约', '作品契约.md'),
      minimalWorkContract(),
      'utf8'
    )
    const confirmed = await persistDraftOutline({ repoPath, packageRoot }, { 细纲: outline })
    assert.equal(confirmed.ok, true, confirmed.error)
    const payload = { frontMatter: { 标题: '测试', 知识选择: ['场景｜旧值'] }, body: '正文。' }
    const archived = await archiveChapterKnowledgeFromOutline({ repoPath, packageRoot }, payload)
    assert.equal(archived.ok, true)
    assert.equal(archived.found, true)
    assert.ok(archived.payload.frontMatter.知识选择.some((item) =>
      /^场景｜拍卖会｜场景\/.+@sha256:[0-9a-f]{64}$/.test(item)
    ))
    assert.ok(!archived.payload.frontMatter.知识选择.includes('场景｜旧值'))

    await fs.rm(path.join(repoPath, '工作区', '细纲.md'))
    await fs.rm(path.join(repoPath, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH))
    const preserved = await archiveChapterKnowledgeFromOutline({ repoPath, packageRoot }, archived.payload)
    assert.equal(preserved.found, false)
    assert.deepEqual(preserved.payload.frontMatter.知识选择, archived.payload.frontMatter.知识选择)
  } finally {
    await fs.rm(repoPath, { recursive: true, force: true })
  }
})

test('正式来源在细纲确认时冻结；引用后续修改或删除仍保留确认时 H1', async () => {
  const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-freeze-pkg-'))
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-freeze-repo-'))
  const entryPath = path.join(pkg, 'references', '场景', '临江夜市.md')
  const h1Content = [
    '---',
    '名称: 临江夜市',
    '一句话: 夜市中的追踪与交易',
    '关键词:',
    '  - 夜市',
    '---',
    '## 规划时',
    '让交易暴露追踪者。',
  ].join('\n')
  try {
    await fs.mkdir(path.dirname(entryPath), { recursive: true })
    await fs.writeFile(entryPath, h1Content, 'utf8')
    await fs.mkdir(path.join(repoPath, '作品契约'), { recursive: true })
    await fs.writeFile(
      path.join(repoPath, '作品契约', '作品契约.md'),
      minimalWorkContract(),
      'utf8'
    )
    const confirmed = await persistDraftOutline(
      { repoPath, packageRoot: pkg },
      { 细纲: '# 第 3 章细纲\n本章场景：临江夜市' }
    )
    assert.equal(confirmed.ok, true, confirmed.error)
    const snapshot = JSON.parse(await fs.readFile(
      path.join(repoPath, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH),
      'utf8'
    ))
    const frozen = snapshot.知识选择.find((item) => item.startsWith('场景｜临江夜市｜'))
    assert.match(frozen, /^场景｜临江夜市｜场景\/临江夜市\.md@sha256:[0-9a-f]{64}$/)

    await fs.writeFile(entryPath, h1Content + '\n引用内容已变更。\n', 'utf8')
    const afterMutation = await archiveChapterKnowledgeFromOutline(
      { repoPath, packageRoot: pkg },
      { frontMatter: { 标题: '测试' }, body: '正文。' }
    )
    assert.equal(afterMutation.ok, true, afterMutation.error)
    assert.ok(afterMutation.payload.frontMatter.知识选择.includes(frozen))

    await fs.rm(entryPath)
    const afterDeletion = await archiveChapterKnowledgeFromOutline(
      { repoPath, packageRoot: pkg },
      { frontMatter: { 标题: '测试' }, body: '正文。' }
    )
    assert.equal(afterDeletion.ok, true, afterDeletion.error)
    assert.ok(afterDeletion.payload.frontMatter.知识选择.includes(frozen))
    assert.ok(!afterDeletion.payload.frontMatter.知识选择.includes('场景｜临江夜市｜作者自定义'))
  } finally {
    await fs.rm(pkg, { recursive: true, force: true })
    await fs.rm(repoPath, { recursive: true, force: true })
  }
})

test('有细纲但快照缺失或 hash 不一致时严格失败，不从当前引用重建', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-snapshot-strict-'))
  const ctx = { repoPath, packageRoot }
  try {
    await fs.mkdir(path.join(repoPath, '作品契约'), { recursive: true })
    await fs.writeFile(
      path.join(repoPath, '作品契约', '作品契约.md'),
      minimalWorkContract(),
      'utf8'
    )
    const confirmed = await persistDraftOutline(ctx, { 细纲: '# 第 3 章细纲\n本章场景：拍卖会' })
    assert.equal(confirmed.ok, true, confirmed.error)
    await fs.writeFile(path.join(repoPath, '工作区', '细纲.md'), '# 第 3 章细纲\n本章场景：诡异日常', 'utf8')
    const mismatch = await archiveChapterKnowledgeFromOutline(
      ctx,
      { frontMatter: { 标题: '测试' }, body: '正文。' }
    )
    assert.equal(mismatch.ok, false)
    assert.match(mismatch.error, /与冻结快照不一致.*重新确认/)

    await fs.rm(path.join(repoPath, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH))
    const missing = await archiveChapterKnowledgeFromOutline(
      ctx,
      { frontMatter: { 标题: '测试' }, body: '正文。' }
    )
    assert.equal(missing.ok, false)
    assert.match(missing.error, /缺少知识冻结快照.*重新确认/)
  } finally {
    await fs.rm(repoPath, { recursive: true, force: true })
  }
})

test('无细纲保留分支只接受当前章档案格式，拒绝旧两段式和畸形来源', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-chapter-preserved-'))
  const hash = 'a'.repeat(64)
  const valid = [
    `场景｜拍卖会｜场景/拍卖会.md@sha256:${hash}`,
    '技法｜镜像独白｜作者自定义',
    '追读｜共同设计的钩子｜对谈共创',
    '变体｜本章只写拍卖结束后的追捕',
  ]
  try {
    assert.equal(validateChapterKnowledgeArchive(valid).ok, true)
    const preserved = await archiveChapterKnowledgeFromOutline(
      { repoPath, packageRoot },
      { frontMatter: { 标题: '测试', 知识选择: valid }, body: '正文。' }
    )
    assert.equal(preserved.ok, true, preserved.error)
    assert.equal(preserved.found, false)
    assert.deepEqual(preserved.payload.frontMatter.知识选择, valid)

    const invalidValues = [
      ['场景｜旧两段式'],
      ['变体｜'],
      [`场景｜拍卖会｜技法/限制视角.md@sha256:${hash}`],
      [`场景｜拍卖会｜场景/子目录/拍卖会.md@sha256:${hash}`],
      [`场景｜拍卖会｜场景/C:拍卖会.md@sha256:${hash}`],
      [`场景｜拍卖会｜场景/..拍卖会.md@sha256:${hash}`],
      [`场景｜拍卖会｜场景/拍卖会.md@sha256:${'A'.repeat(64)}`],
      ['未知维度｜名称｜作者自定义'],
      ['场景｜拍卖会｜作者自定义｜多余字段'],
    ]
    for (const 知识选择 of invalidValues) {
      const result = await archiveChapterKnowledgeFromOutline(
        { repoPath, packageRoot },
        { frontMatter: { 标题: '测试', 知识选择 }, body: '正文。' }
      )
      assert.equal(result.ok, false, 知识选择[0])
      assert.match(result.error, /章档案知识选择格式不正确/)
    }
  } finally {
    await fs.rm(repoPath, { recursive: true, force: true })
  }
})
