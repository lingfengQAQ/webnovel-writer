import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  loadRoutes,
  resolveLabel,
  resolveBookTags,
  readEntry,
  listChapterIndex,
  findDeclared,
  sceneCandidates,
  parseOutlineDeclarations,
} from '../../src/knowledge/index.js'

// 真源知识库（v7 包根）——样例条目即测试夹具
const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('loadRoutes 读路由表：题材/流派两维齐全', async () => {
  const rows = await loadRoutes(packageRoot)
  assert.ok(rows.length > 0)
  assert.ok(rows.some((r) => r.维度 === '题材' && r.名称 === '玄幻'))
  assert.ok(rows.some((r) => r.维度 === '流派' && r.名称 === '系统流'))
})

test('resolveLabel 别名归一：修仙→仙侠、系统→系统流；未收录返回 null', async () => {
  const rows = await loadRoutes(packageRoot)
  assert.equal(resolveLabel(rows, '修仙')?.名称, '仙侠')
  assert.equal(resolveLabel(rows, '系统')?.名称, '系统流')
  assert.equal(resolveLabel(rows, '玄幻')?.名称, '玄幻')
  assert.equal(resolveLabel(rows, '不存在的题材'), null)
  assert.equal(resolveLabel(rows, ''), null)
})

test('resolveBookTags：命中带条目全文、条目待补降级为空串、未命中如实列出', async () => {
  const r = await resolveBookTags(packageRoot, { 类型: '玄幻', 流派: ['退婚流', '自创流派'] })
  assert.equal(r.题材命中.名称, '玄幻')
  assert.match(r.题材命中.content, /骨架约定/)
  assert.equal(r.流派命中[0].名称, '退婚流')
  assert.deepEqual(r.未命中, ['自创流派'])
  // 路由行存在但条目待补（都市无条目文件）：归一有效、内容为空
  const r2 = await resolveBookTags(packageRoot, { 类型: '都市', 流派: [] })
  assert.equal(r2.题材命中.名称, '都市')
  assert.equal(r2.题材命中.content, '')
})

test('resolveBookTags 知识库缺失整体降级：全部未命中，不抛错', async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'wnw-noref-'))
  try {
    const r = await resolveBookTags(empty, { 类型: '玄幻', 流派: ['系统流'] })
    assert.equal(r.题材命中, null)
    assert.deepEqual(r.未命中, ['玄幻', '系统流'])
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})

test('listChapterIndex：节拍索引含编号/名称/一句话；缺目录返回空', async () => {
  const beats = await listChapterIndex(packageRoot, '节拍')
  const pa1 = beats.find((b) => b.编号 === 'PA-001')
  assert.ok(pa1)
  assert.equal(pa1.名称, '压抑蓄力爆发')
  assert.ok(pa1.一句话.length > 0)
  assert.deepEqual(await listChapterIndex(packageRoot, '不存在目录'), [])
})

test('findDeclared：编号命中、名称命中、混写命中、自定义返回 null', async () => {
  const byId = await findDeclared(packageRoot, '节拍', 'PA-001')
  assert.equal(byId.fm.名称, '压抑蓄力爆发')
  assert.ok(byId.落笔时.length > 0)
  const byName = await findDeclared(packageRoot, '追读', '悬念钩')
  assert.equal(byName.fm.名称, '悬念钩')
  const mixed = await findDeclared(packageRoot, '节拍', 'PA-002 微反转补刀')
  assert.equal(mixed.fm.名称, '微反转补刀')
  assert.equal(await findDeclared(packageRoot, '节拍', '自定义——先甜后抽'), null)
  assert.equal(await findDeclared(packageRoot, '节拍', ''), null)
})

test('readEntry 三节切片；文件缺失返回 null', async () => {
  const e = await readEntry(packageRoot, '场景/拍卖会.md')
  assert.ok(e.规划.length > 0)
  assert.ok(e.落笔时.length > 0)
  assert.ok(e.审稿时.length > 0)
  assert.ok(Array.isArray(e.fm.毒点) && e.fm.毒点.length > 0)
  assert.equal(await readEntry(packageRoot, '场景/不存在.md'), null)
})

test('sceneCandidates 关键词命中出候选，只出候选不拦截；无语料返回空', async () => {
  const hits = await sceneCandidates(packageRoot, ['本卷中段安排一场拍卖会，主角竞价夺宝'])
  assert.ok(hits.some((h) => h.名称 === '拍卖会'))
  assert.deepEqual(await sceneCandidates(packageRoot, []), [])
  assert.deepEqual(await sceneCandidates(packageRoot, ['与场景无关的日常文本']), [])
})

test('parseOutlineDeclarations：全角/半角冒号、多值场景、缺省为空', () => {
  const d = parseOutlineDeclarations(
    ['## 本章提案', '本章定位：推进章。', '本章节拍：PA-001 压抑蓄力爆发', '章尾钩子: 悬念钩', '本章场景：拍卖会、突破'].join('\n')
  )
  assert.equal(d.节拍, 'PA-001 压抑蓄力爆发')
  assert.equal(d.钩子, '悬念钩')
  assert.deepEqual(d.场景, ['拍卖会', '突破'])
  const empty = parseOutlineDeclarations('## 本章提案\n本章定位：过渡章。')
  assert.equal(empty.节拍, '')
  assert.equal(empty.钩子, '')
  assert.deepEqual(empty.场景, [])
})
