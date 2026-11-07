import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { performance } from 'node:perf_hooks'
register('../../../../scripts/strip-types-loader.mjs', import.meta.url)
const { graphScaleSource } = await import('./graph-scale-data.ts')
const { StudyService } = await import('../../src/study/service.ts')
const { readGraphPage } = await import('../../src/study/graph-reader.ts')
const runtime = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
assert.equal(path.resolve(runtime.workspace), path.join(path.resolve(runtime.root), 'workspace'))
assert.match(path.basename(runtime.root), /^webnovel-browser-/)
const book = path.join(runtime.workspace, '千章星团验收'), fixture = graphScaleSource()
assert.equal(fs.existsSync(book), false, 'Use a fresh synthetic book directory')
const put = (name, text) => { const target = path.join(book, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text) }
put('作品契约/契约.md', fixture.source.contract)
for (const [name, text] of fixture.files) put(name, text)
for (let i = 2; i <= 2000; i++) {
  const person = `人物${String(i).padStart(4, '0')}`, chapter = i < 1500 ? i % 600 + 1 : 1900 + i % 100
  put(`世界书/人物关系/${person}.md`, `---\n名称: 主角与${person}\n类型: 关系\n性质: 事实\n来源: 第${chapter}章\n关系双方: [人物0001, ${person}]\n关系: ${i % 3 ? '盟友' : '立场分歧'}\n---\n人物0001与${person}在第${chapter}章留下关系记录。`)
}
const started = performance.now(), source = new StudyService(runtime.workspace).graph('book:scale-synthetic'), sourceMs = performance.now() - started
const viewStarted = performance.now(), view = readGraphPage(source, { person: 'world:世界书/人物档案/人物0001.md', chapter: 2000 })
const report = { synthetic: true, onDisk: true, records: source.records.length, edges: source.edges.length, entities: source.entities.length,
  sourceMs: Math.round(sourceMs), viewMs: Math.round(performance.now() - viewStarted), responseBytes: Buffer.byteLength(JSON.stringify(view)),
  totalGroups: view.clusters.total, recentPairs: view.relations.total, book }
fs.writeFileSync(path.join(path.dirname(process.argv[2]), 'scale-source-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
