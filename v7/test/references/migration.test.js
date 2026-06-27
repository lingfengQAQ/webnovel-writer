import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REF = fileURLToPath(new URL('../../references/', import.meta.url))

// 真·v6 遗毒模式(不含会误伤 craft 的「评分」泛词)
const V6 = /webnovel-(write|plan|init|review|query|dashboard|doctor|learn)|story-system|\/webnovel-|state\.json|设定集\/|webnovel\.py|创意约束|Pack [MU][0-9]|Context Agent|Checkers|评.{0,2}文笔/

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

test('迁移树零 v6 遗毒（逐文件 grep 把关）', async () => {
  const files = await walk(REF)
  assert.ok(files.length > 0, 'references/ 应已有迁移产物')
  const dirty = []
  for (const f of files) {
    // 迁移报告.md 是说明文档，正当点名它清除/弃用的 v6 物件，不参与内容洁净度扫描
    if (path.basename(f) === '迁移报告.md') continue
    const content = await fs.readFile(f, 'utf8')
    if (V6.test(content)) dirty.push(path.relative(REF, f))
  }
  assert.deepEqual(dirty, [], '这些迁移文件仍含 v6 遗毒：' + dirty.join('、'))
})

test('题材单一真源:CSV 在、markdown 双表不迁入', async () => {
  await fs.access(path.join(REF, '题材模板', 'genre-index.csv'))
  const files = (await walk(REF)).map((f) => path.basename(f))
  assert.ok(!files.includes('genre-profiles.md'), '不应迁入 markdown 题材双表 genre-profiles.md')
  assert.ok(!files.includes('genre-tropes.md'), '不应迁入 markdown 题材双表 genre-tropes.md')
})

test('CSV v6 列已删（适用技能/推荐检索表）', async () => {
  const a = await fs.readFile(path.join(REF, '题材模板', '题材与调性推理.csv'), 'utf8')
  assert.ok(!a.includes('适用技能'), '题材与调性推理.csv 应删 适用技能 列')
  assert.ok(!a.includes('推荐基础检索表'), '应删 推荐基础检索表 列')
  const b = await fs.readFile(path.join(REF, '爽点节奏', '爽点与节奏.csv'), 'utf8')
  assert.ok(!b.includes('适用技能'), '爽点与节奏.csv 应删 适用技能 列')
})

test('题材模板正文迁入且剥离创意约束段', async () => {
  const xiuxian = await fs.readFile(path.join(REF, '题材模板', 'genres', '修仙.md'), 'utf8')
  assert.match(xiuxian, /核心流派细分/, 'craft 内容保留')
  assert.ok(!xiuxian.includes('创意约束'), '剥离 v6 创意约束段')
})

test('迁移报告含真源选定表', async () => {
  const report = await fs.readFile(path.join(REF, '迁移报告.md'), 'utf8')
  assert.match(report, /真源选定/)
  assert.match(report, /genre-index\.csv/)
  assert.match(report, /reading-power-taxonomy/)
})
