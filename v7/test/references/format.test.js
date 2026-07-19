import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { parseFrontMatter } from '../../src/storage/parsers/front-matter.js'
import { extractSection } from '../../src/util/markdown.js'
import { loadRoutes } from '../../src/knowledge/index.js'
import { CANONICAL_TOPIC_NAMES } from '../../src/knowledge/contract.js'

/**
 * 知识库格式校验（验收 A5）：front matter 可解析、分维正确、节齐全、路由键唯一、
 * 内容纪律的机器可查部分（毒点非空于章级条目）。内容质量本身走人工审查关（A6-A8），不在此测。
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../references')
const 章级目录 = ['节拍', '追读', '场景']
const 书级格式 = Object.freeze({
  题材: Object.freeze({ 字段: ['名称'], 小节: ['核心承诺', '选择边界', '本书化问题', '失败模式'] }),
  流派: Object.freeze({ 字段: ['名称'], 小节: ['推进引擎', '组合边界', '本书化问题', '失败模式'] }),
  创意约束: Object.freeze({ 字段: ['名称', '一句话'], 小节: ['约束机制', '适用边界', '本书化问题', '失败模式'] }),
})
const 书级目录 = Object.keys(书级格式)
const canonicalTopicSet = new Set(CANONICAL_TOPIC_NAMES)

async function mdFiles(dir) {
  try {
    return (await fs.readdir(path.join(ROOT, dir))).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
}

test('知识条目 front matter 全部可解析且有 名称', async () => {
  for (const dir of [...章级目录, ...书级目录]) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      assert.equal(fm.ok, true, `${dir}/${f} front matter 解析失败：${fm.error}`)
      assert.ok(fm.data?.名称, `${dir}/${f} 缺 名称`)
    }
  }
})

test('章级条目三节齐全（规划这一章时/落笔时/审稿时）且毒点非空', async () => {
  for (const dir of 章级目录) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      for (const sec of ['规划这一章时', '落笔时', '审稿时']) {
        assert.ok(extractSection(fm.body, sec), `${dir}/${f} 缺「${sec}」节`)
      }
      assert.ok(Array.isArray(fm.data.毒点) && fm.data.毒点.length > 0, `${dir}/${f} 毒点为空`)
      assert.ok(fm.data.一句话, `${dir}/${f} 缺 一句话（紧凑索引展示用）`)
    }
  }
})

test('书级条目只保留有消费者的字段，并按维度提供四个调用小节', async () => {
  for (const dir of 书级目录) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      assert.deepEqual(
        Object.keys(fm.data).sort(),
        [...书级格式[dir].字段].sort(),
        `${dir}/${f} front matter 含无消费者字段`
      )
      for (const sec of 书级格式[dir].小节) {
        assert.ok(extractSection(fm.body, sec), `${dir}/${f} 缺「${sec}」节`)
      }
    }
  }
})

test('书级通用知识不携带固定配比、固定章频或旧关系结算默认', async () => {
  const fixedPatterns = [
    /7\s*[:：]\s*3/,
    /60\s*[-~—至到]\s*70\s*%/,
    /30\s*[-~—至到]\s*40\s*%/,
    /每\s*(?:\d+|[零〇一二两三四五六七八九十百千万]+)\s*章/u,
    /默认.{0,8}(?:\d+|[零〇一二两三四五六七八九十百千万]+)\s*章/u,
  ]
  for (const dir of 书级目录) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      for (const pattern of fixedPatterns) {
        assert.doesNotMatch(raw, pattern, `${dir}/${f} 含通用固定节奏模板`)
      }
      assert.doesNotMatch(raw, /恩怨清算|默认档|圣母/, `${dir}/${f} 含已删除的关系结算默认措辞`)
    }
  }
})

test('路由表：名称/别名唯一、维度合法，19 个题材和 24 个流派与文件一一对应', async () => {
  const rows = await loadRoutes(path.join(ROOT, '..'))
  assert.ok(rows.length > 0)
  const names = rows.map((r) => r.名称)
  assert.equal(new Set(names).size, names.length, '路由名称有重复')
  const nameSet = new Set(names)
  const aliases = new Set()
  for (const r of rows) {
    assert.ok(['题材', '流派'].includes(r.维度), `路由 ${r.名称} 维度不合法：${r.维度}`)
    if (r.维度 === '流派') {
      const compatibleTopics = String(r.题材 || '').split('|').map((topic) => topic.trim()).filter(Boolean)
      assert.ok(!compatibleTopics.includes('全部'), `路由 ${r.名称} 不得用“全部”占位兼容题材`)
      for (const topic of compatibleTopics) {
        assert.ok(canonicalTopicSet.has(topic), `路由 ${r.名称} 含未知兼容题材「${topic}」`)
      }
    }
    for (const a of r.别名) {
      assert.ok(!nameSet.has(a), `路由 ${r.名称} 的别名「${a}」与既有名称冲突`)
      assert.ok(!aliases.has(a), `路由别名「${a}」重复指向多个 canonical`)
      aliases.add(a)
    }
    if (r.条目) {
      // 分维正确：条目路径的目录须与维度一致
      assert.ok(r.条目.startsWith(`${r.维度}/`), `路由 ${r.名称} 条目目录与维度不符：${r.条目}`)
      await fs.access(path.join(ROOT, ...r.条目.split('/')))
    }
  }

  const topicRoutes = rows.filter((row) => row.维度 === '题材')
  const genreRoutes = rows.filter((row) => row.维度 === '流派')
  assert.equal(topicRoutes.length, 19, '题材 canonical 应为 19 个')
  assert.equal(genreRoutes.length, 24, '流派 canonical 应为 24 个')
  assert.deepEqual(
    topicRoutes.map((row) => row.名称).sort(),
    [...CANONICAL_TOPIC_NAMES].sort(),
    '作品契约正式题材名单与路由不一致'
  )
  for (const [dir, routed] of [
    ['题材', topicRoutes],
    ['流派', genreRoutes],
  ]) {
    const actual = (await mdFiles(dir)).map((file) => `${dir}/${file}`).sort()
    const expected = routed.map((row) => row.条目).sort()
    assert.deepEqual(expected, actual, `${dir} 文件与路由不是一一对应`)
  }
})

test('毒点措辞不以禁止某类角色替代叙事结果核对', async () => {
  for (const dir of [...章级目录, ...书级目录]) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      for (const p of fm.data.毒点 || []) {
        assert.ok(
          !/不得出现.{0,6}角色/.test(p),
          `${dir}/${f} 毒点「${p}」疑似用禁角色人设替代叙事结果核对`
        )
      }
    }
  }
})
