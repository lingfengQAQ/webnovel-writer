import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { readV6Project } from '../../src/migrate/read-v6.js'
import { tempV6, tempV6Sqlite, inlineFixture } from './_v6.js'

test('inline 形态：state 全量内联读取，键名/别名/三种正文命名全归一', async () => {
  const { v6Path, cleanup } = await tempV6(inlineFixture)
  try {
    const r = await readV6Project(v6Path)
    assert.equal(r.ok, true, r.error)
    const f = r.facts
    assert.equal(f.form, 'inline')
    assert.equal(f.project.title, '剑碎虚空') // project 键（非 project_info）
    assert.equal(f.project.genre, 'xianxia')

    // 三种正文命名归一：平坦带标题 / 遗留无标题 / 卷内 3 位
    assert.deepEqual(
      f.chapters.map((c) => [c.num, c.title, c.volumeHint]),
      [[1, '残剑出鞘', null], [2, null, null], [3, '剑灵初醒', 1]]
    )
    assert.match(f.chapters[0].body, /^晨雾未散/)

    // 实体 + alias_index 反查
    assert.equal(f.entities.length, 3)
    const luchen = f.entities.find((e) => e.id === 'luchen')
    assert.equal(luchen.name, '陆沉')
    assert.equal(luchen.isProtagonist, true)
    assert.ok(luchen.aliases.includes('小师弟'))

    // 伏笔规范化：status/tier 别名、planted 多键名
    assert.equal(f.foreshadowing.length, 2)
    assert.deepEqual(
      f.foreshadowing.map((x) => [x.status, x.tier, x.plantedChapter, x.resolvedChapter]),
      [['未回收', '核心', 1, null], ['已回收', '支线', 2, 3]]
    )

    // chapter_meta 键 "0001"/"3" 归一为数字
    assert.equal(f.chapterMeta.get(1).hook.type, '危机钩')
    assert.equal(f.chapterMeta.get(3).hook.strength, 'medium')

    assert.equal(f.summaries.get(1).frontMatter.hook_type, '危机钩')
    assert.equal(f.scratchpad.open_loops.length, 1)
    assert.equal(f.patterns.length, 2)
    assert.equal(f.outlines.volumes.length, 1)
    assert.match(f.outlines.volumes[0].详细大纲, /第3章：剑灵初醒/)
    assert.match(f.outlines.volumes[0].时间线, /演武场盘问/)
    assert.equal(f.settingFiles.length, 2)
    assert.equal(f.activeThreads.length, 1)
  } finally {
    await cleanup()
  }
})

test('sqlite 形态：精简 state + index.db 分置，实体/摘要/追读力从 db 读', async () => {
  const { v6Path, cleanup } = await tempV6Sqlite()
  try {
    const r = await readV6Project(v6Path)
    assert.equal(r.ok, true, r.error)
    const f = r.facts
    assert.equal(f.form, 'sqlite')
    assert.equal(f.project.title, '潮汐之下') // project_info 键

    const jy = f.entities.find((e) => e.id === 'jiangyao')
    assert.equal(jy.name, '江遥')
    assert.deepEqual(jy.aliases, ['小江'])
    assert.equal(jy.current.location, '滨海市') // current_json 解析

    assert.equal(f.dbSummaries.get(1), '江遥在退潮滩涂拾得停摆怀表，表盖刻字暗藏警告。')
    assert.equal(f.readingPower.get(1).hookType, '悬念钩')
    assert.deepEqual(f.readingPower.get(1).coolpointPatterns, ['异物入手'])
    assert.equal(f.stateChanges.length, 1)
    assert.equal(f.relationships.length, 1)
    // 缺 chase_debt 等表不炸（fixture db 故意没建）
    assert.equal(f.foreshadowing.length, 1) // 伏笔仍在精简 state.json
  } finally {
    await cleanup()
  }
})

test('容错：state.json 损坏 → 文件面照迁 + 如实 warning；源零写入', async () => {
  const { v6Path, cleanup } = await tempV6(inlineFixture)
  try {
    await fs.writeFile(path.join(v6Path, '.webnovel', 'state.json'), '{broken', 'utf8')
    const before = await fs.readFile(path.join(v6Path, '.webnovel', 'state.json'), 'utf8')

    const r = await readV6Project(v6Path)
    assert.equal(r.ok, true, r.error)
    assert.equal(r.facts.chapters.length, 3) // 正文照读
    assert.equal(r.facts.entities.length, 0)
    assert.ok(r.facts.warnings.some((w) => w.includes('state.json')))

    assert.equal(await fs.readFile(path.join(v6Path, '.webnovel', 'state.json'), 'utf8'), before)
  } finally {
    await cleanup()
  }
})

test('容错：整个 .webnovel/ 缺失 → 纯文件面迁移', async () => {
  const { v6Path, cleanup } = await tempV6(inlineFixture)
  try {
    await fs.rm(path.join(v6Path, '.webnovel'), { recursive: true, force: true })
    const r = await readV6Project(v6Path)
    assert.equal(r.ok, true, r.error)
    assert.equal(r.facts.chapters.length, 3)
    assert.equal(r.facts.foreshadowing.length, 0)
    assert.ok(r.facts.warnings.length > 0)
  } finally {
    await cleanup()
  }
})

test('不是 v6 项目（无 正文/ 无 .webnovel）→ 人话拒绝', async () => {
  const { v6Path, cleanup } = await tempV6(inlineFixture)
  try {
    await fs.rm(path.join(v6Path, '.webnovel'), { recursive: true, force: true })
    await fs.rm(path.join(v6Path, '正文'), { recursive: true, force: true })
    const r = await readV6Project(v6Path)
    assert.equal(r.ok, false)
    assert.match(r.error, /不像 v6 书项目/)
  } finally {
    await cleanup()
  }
})
