import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { parseFrontMatter } from '../../src/storage/parsers/front-matter.js'
import { extractSection } from '../../src/util/markdown.js'
import { KNOWLEDGE_FILTER_VALUES, loadRoutes } from '../../src/knowledge/index.js'
import { CANONICAL_TOPIC_NAMES } from '../../src/knowledge/contract.js'
import { LEGACY_CHAPTER_ENTRIES } from './legacy-chapter-entries.js'

/**
 * 知识库格式校验（验收 A5）：front matter 可解析、分维正确、节齐全、路由键唯一。
 * 章级四维按 design 3.1 目标 schema 校验；旧格式存量以 LEGACY_CHAPTER_ENTRIES 显式冻结,
 * 随批次 2/3/5 清空。内容质量本身走人工审查关（A6-A8），不在此测。
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../references')
const 章级目录 = ['节拍', '场景', '技法', '追读']
const 章级格式 = Object.freeze({
  节拍: Object.freeze({ 字段: ['编号', '名称', '一句话', '关键词'] }),
  场景: Object.freeze({ 字段: ['名称', '一句话', '关键词'] }),
  技法: Object.freeze({ 字段: ['名称', '类别', '作用层级', '触发问题', '一句话'] }),
  追读: Object.freeze({ 字段: ['名称', '一句话', '关键词'] }),
})
const 技法类别受控值 = Object.freeze(['对白', '描写', '视角', '信息', '情感', '结构', '战斗', '设定执行'])
const 技法作用层级受控值 = Object.freeze(['书', '卷', '跨章', '章', '场'])
const 章级禁用字段 = /毒点:|适用题材:|正例:|反例:|来源:|状态:|适用技能:|大模型指令:/u
const 书级格式 = Object.freeze({
  题材: Object.freeze({ 字段: ['名称'], 小节: ['核心承诺', '选择边界', '本书化问题', '失败模式'] }),
  流派: Object.freeze({ 字段: ['名称'], 小节: ['推进引擎', '组合边界', '本书化问题', '失败模式'] }),
  创意约束: Object.freeze({ 字段: ['名称', '一句话'], 小节: ['约束机制', '适用边界', '本书化问题', '失败模式'] }),
})
const 书级目录 = Object.keys(书级格式)
const 故事对象格式 = Object.freeze({
  设定: Object.freeze({ 字段: ['名称', '对象类型', '一句话'] }),
  人物: Object.freeze({ 字段: ['名称', '人物类别', '一句话'] }),
  命名: Object.freeze({ 字段: ['名称', '命名对象', '一句话'] }),
})
const 故事对象目录 = Object.keys(故事对象格式)
const canonicalTopicSet = new Set(CANONICAL_TOPIC_NAMES)

async function mdFiles(dir) {
  try {
    return (await fs.readdir(path.join(ROOT, dir))).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
}

test('知识条目 front matter 全部可解析且有 名称', async () => {
  for (const dir of [...章级目录, ...书级目录, ...故事对象目录]) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      assert.equal(fm.ok, true, `${dir}/${f} front matter 解析失败：${fm.error}`)
      assert.ok(fm.data?.名称, `${dir}/${f} 缺 名称`)
    }
  }
})

test('故事对象条目只保留最小索引字段和规划时切片', async () => {
  for (const dir of 故事对象目录) {
    const files = await mdFiles(dir)
    assert.ok(files.length > 0, `${dir} 尚未形成正式条目`)
    for (const f of files) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      assert.deepEqual(
        Object.keys(fm.data).sort(),
        [...故事对象格式[dir].字段].sort(),
        `${dir}/${f} front matter 含无消费者字段`
      )
      assert.ok(extractSection(fm.body, '规划时'), `${dir}/${f} 缺「规划时」节`)
      const allowed = KNOWLEDGE_FILTER_VALUES[dir]
      const field = dir === '设定' ? '对象类型' : dir === '人物' ? '人物类别' : '命名对象'
      const values = Array.isArray(fm.data[field]) ? fm.data[field] : [fm.data[field]]
      assert.ok(values.length > 0 && values.every((value) => allowed.includes(String(value))), `${dir}/${f} 含未登记受控值`)
      assert.ok(!values.includes('全部'), `${dir}/${f} 不得使用“全部”占位`)
      assert.doesNotMatch(raw, /编号:|适用技能:|分类:|层级:|关键词:|意图与同义词:|适用题材:|大模型指令:|毒点:|正例:|反例:|来源:|状态:/u)
      for (const forbidden of ['落笔时', '审稿时']) {
        assert.equal(extractSection(fm.body, forbidden), '', `${dir}/${f} 不应携带「${forbidden}」死切片`)
      }
    }
  }
})

test('章级条目三切片齐全（规划时/落笔时/审稿时），空目录不阻断', async () => {
  for (const dir of 章级目录) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      for (const sec of ['规划时', '落笔时', '审稿时']) {
        assert.ok(extractSection(fm.body, sec), `${dir}/${f} 缺「${sec}」节`)
      }
      assert.equal(extractSection(fm.body, '规划这一章时'), '', `${dir}/${f} 残留旧标题「规划这一章时」`)
      assert.ok(fm.data.一句话, `${dir}/${f} 缺 一句话（紧凑索引展示用）`)
    }
  }
})

test('章级旧格式冻结清单只减不增，且不含清单外文件', async () => {
  for (const dir of 章级目录) {
    const files = new Set(await mdFiles(dir))
    for (const legacy of LEGACY_CHAPTER_ENTRIES[dir]) {
      assert.ok(files.has(legacy), `${dir}/${legacy} 已不存在，须同步从 LEGACY_CHAPTER_ENTRIES 移除`)
    }
  }
  // 批次 2/3/5 完成后对应维度清单应清空；此断言防止收口后清单被遗忘
  assert.deepEqual(LEGACY_CHAPTER_ENTRIES.技法, [], '技法从空目录起步，不允许旧格式条目')
})

test('章级条目 front matter 只含目标 schema 字段，禁用字段与「全部」占位不得回流', async () => {
  for (const dir of 章级目录) {
    const legacy = new Set(LEGACY_CHAPTER_ENTRIES[dir])
    for (const f of await mdFiles(dir)) {
      if (legacy.has(f)) continue // 批次 2/3/5 待迁移存量,迁移后从清单删除即受本测试约束
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      assert.deepEqual(
        Object.keys(fm.data).sort(),
        [...章级格式[dir].字段].sort(),
        `${dir}/${f} front matter 与目标 schema 不符`
      )
      assert.doesNotMatch(raw, 章级禁用字段, `${dir}/${f} 含已删除的无消费者字段`)
      for (const [field, value] of Object.entries(fm.data)) {
        const values = Array.isArray(value) ? value : [value]
        assert.ok(values.length > 0 && values.every((item) => String(item).trim()), `${dir}/${f} 字段 ${field} 为空`)
        assert.ok(!values.map(String).includes('全部'), `${dir}/${f} 字段 ${field} 不得使用“全部”占位`)
      }
      if (dir === '技法') {
        assert.ok(技法类别受控值.includes(String(fm.data.类别)), `${dir}/${f} 类别「${fm.data.类别}」不在受控值中`)
        assert.ok(技法作用层级受控值.includes(String(fm.data.作用层级)), `${dir}/${f} 作用层级「${fm.data.作用层级}」不在受控值中`)
      }
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
  for (const dir of [...章级目录, ...书级目录, ...故事对象目录]) {
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

test('样例书文风夹具不恢复题材默认的关系结算或角色标签', async () => {
  const fixture = await fs.readFile(
    path.join(ROOT, '..', 'test', 'fixtures', 'sample-book', '文风', '文风铁律.md'),
    'utf8'
  )
  assert.doesNotMatch(fixture, /恩怨清算|反和解（按题材配浓度）|禁主角圣母/)
})
