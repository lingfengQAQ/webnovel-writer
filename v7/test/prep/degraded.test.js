import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { tempBookCtx } from '../commands/_helper.js'
import { createDegradationCollector } from '../../src/util/degradation.js'

/**
 * P1-F6 备料链：故障注入——cache.query 对 secrets 查询恒抛（模拟缓存损坏）。
 * 期望：DTO 返回值与材料文本都带 degraded（含位置与原因），无故障时两键全不出现。
 */

function breakQuery(cache, includes) {
  const orig = cache.query.bind(cache)
  cache.query = async (sql, params) => {
    if (String(sql).includes(includes)) {
      const err = new Error('注入：SQLITE_CORRUPT 模拟缓存损坏')
      err.code = 'SQLITE_CORRUPT'
      throw err
    }
    return orig(sql, params)
  }
}

test('备料链：secrets 缓存损坏 → DTO 与材料文本都带 degraded', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.degradation = createDegradationCollector()
    breakQuery(ctx.cache, 'FROM secrets')

    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, true, r.error)
    assert.ok(Array.isArray(r.degraded), '返回值必须带 degraded 数组')
    const secretEvent = r.degraded.find((e) => e.site === 'SecretReader.listUnrevealed')
    assert.ok(secretEvent, 'degraded 含 SecretReader.listUnrevealed 事件')
    assert.match(secretEvent.reason, /SQLITE_CORRUPT/)

    assert.match(r.content, /## 材料缺料提醒（degraded）/, '材料文本含缺料提醒段')
    assert.match(r.content, /SecretReader\.listUnrevealed/, '材料文本含站点定位')

    const onDisk = await fs.readFile(path.join(ctx.repoPath, '工作区', '本章写作材料.md'), 'utf8')
    assert.match(onDisk, /材料缺料提醒/, '落盘材料同样可见缺料提醒')
  } finally {
    await cleanup()
  }
})

test('备料链：无故障 → degraded 键与提醒段全部不出现（旧消费者零感知）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.degradation = createDegradationCollector()
    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, true, r.error)
    assert.equal('degraded' in r, false, '无事件时返回对象不得有 degraded 键')
    assert.doesNotMatch(r.content, /材料缺料提醒/, '无事件时材料文本不得有提醒段')
  } finally {
    await cleanup()
  }
})
