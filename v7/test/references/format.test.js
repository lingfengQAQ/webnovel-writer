import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { parseFrontMatter } from '../../src/storage/parsers/front-matter.js'
import { extractSection } from '../../src/util/markdown.js'
import { loadRoutes } from '../../src/knowledge/index.js'

/**
 * 知识库格式校验（验收 A5）：front matter 可解析、分维正确、节齐全、路由键唯一、
 * 内容纪律的机器可查部分（毒点非空于章级条目）。内容质量本身走人工审查关（A6-A8），不在此测。
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../references')
const 章级目录 = ['节拍', '追读', '场景']
const 书级目录 = ['题材', '流派']

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

test('书级条目三节齐全（骨架约定/读者预期/毒点展开）', async () => {
  for (const dir of 书级目录) {
    for (const f of await mdFiles(dir)) {
      const raw = await fs.readFile(path.join(ROOT, dir, f), 'utf8')
      const fm = parseFrontMatter(raw)
      for (const sec of ['骨架约定', '读者预期', '毒点展开']) {
        assert.ok(extractSection(fm.body, sec), `${dir}/${f} 缺「${sec}」节`)
      }
      assert.ok(Array.isArray(fm.data.毒点) && fm.data.毒点.length > 0, `${dir}/${f} 毒点为空`)
    }
  }
})

test('题材条目不携带关系结算枚举或题材默认值', async () => {
  for (const f of await mdFiles('题材')) {
    const raw = await fs.readFile(path.join(ROOT, '题材', f), 'utf8')
    const fm = parseFrontMatter(raw)
    assert.equal('恩怨清算默认' in fm.data, false, `题材/${f} 仍有已删除的题材默认值`)
    assert.equal('恩怨清算' in fm.data, false, `题材/${f} 仍有已删除的关系结算枚举`)
  }
})

test('路由表：名称唯一、别名不与任何名称冲突、维度合法、条目文件存在或为空', async () => {
  const rows = await loadRoutes(path.join(ROOT, '..'))
  assert.ok(rows.length > 0)
  const names = rows.map((r) => r.名称)
  assert.equal(new Set(names).size, names.length, '路由名称有重复')
  const nameSet = new Set(names)
  for (const r of rows) {
    assert.ok(['题材', '流派'].includes(r.维度), `路由 ${r.名称} 维度不合法：${r.维度}`)
    for (const a of r.别名) {
      assert.ok(!nameSet.has(a), `路由 ${r.名称} 的别名「${a}」与既有名称冲突`)
    }
    if (r.条目) {
      // 分维正确：条目路径的目录须与维度一致
      assert.ok(r.条目.startsWith(`${r.维度}/`), `路由 ${r.名称} 条目目录与维度不符：${r.条目}`)
      await fs.access(path.join(ROOT, ...r.条目.split('/')))
    }
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
