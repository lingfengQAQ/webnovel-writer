import fs from 'node:fs'
import path from 'node:path'
import { register } from 'node:module'
import { performance } from 'node:perf_hooks'
register('../../../../scripts/strip-types-loader.mjs', import.meta.url)
const { StudyService } = await import('../../src/study/service.ts')
const { readGraphPage } = await import('../../src/study/graph-reader.ts')
const runtime = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const service = new StudyService(runtime.workspace), person = 'world:世界书/人物档案/人物0001.md'
const measurements = []
let previous
for (const [name, options] of [
  ['cold', { person, chapter: 2000 }], ['repeat', { person, chapter: 2000 }], ['change-chapter', { person, chapter: 1500 }],
  ['page', { person, chapter: 2000, relationPage: 1 }], ['select-person', { person: 'world:世界书/人物档案/人物2000.md', chapter: 1500 }],
]) {
  const started = performance.now(), graph = await service.graphForReader('book:scale-synthetic')
  const verified = performance.now(), view = readGraphPage(graph, options), ended = performance.now()
  const repeated = performance.now(); readGraphPage(graph, options); const projectionHitMs = performance.now() - repeated
  measurements.push({ name, verifiedReadMs: Math.round(verified - started), projectionMs: Math.round(ended - verified), totalMs: Math.round(ended - started),
    projectionHitMs: Math.round(projectionHitMs * 100) / 100, sourceArraysReused: previous?.records === graph.records,
    responseBytes: Buffer.byteLength(JSON.stringify(view)), records: graph.records.length, edges: graph.edges.length, groups: view.clusters.total, relationPage: view.relations.page, relationPages: view.relations.pages })
  previous = graph
}
const report = { synthetic: true, onDisk: true, node: process.version, platform: process.platform, sourceByteVerificationEveryRequest: true,
  cacheLimit: { books: 2, projectionsPerBook: 4 }, measurements }
fs.writeFileSync(path.join(path.dirname(process.argv[2]), 'reader-benchmark.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
