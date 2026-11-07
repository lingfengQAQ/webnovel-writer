import type { GraphSource } from '../../src/study/graph'
import type { StoryGraph } from '../../src/study/graph-types'

/** Synthetic quantities are real; source content is deliberately invented. */
export function graphScaleSource(entities = 2000, chapters = 2000, recordsPerPerson = 20) {
  const files = new Map<string, string>()
  const person = (index: number) => `人物${String(index).padStart(4, '0')}`
  for (let index = 1; index <= entities; index++) {
    const label = person(index), records: string[] = []
    const count = index === 1 ? chapters : recordsPerPerson
    for (let record = 1; record <= count; record++) {
      const at = index === 1 ? record : 1 + ((record - 1) * 97 + index) % chapters
      const other = person(index === 1 ? 2 : (index + record) % entities + 1)
      records.push(`### 事实@第${String(at).padStart(4, '0')}章\n来源：定稿/卷01/${String(at).padStart(4, '0')}-合成.md\n${label}为[[${other}]]提供了线索。此记录只用于规模验收。`)
    }
    files.set(`世界书/人物档案/${label}.md`, `---\n名称: ${label}\n类型: 人物\n性质: 事实\n来源: 第1章\n势力: 宗门${index % 12 + 1}\n家族: 家族${index % 20 + 1}\n别名: [别名${index}]\n---\n人物资料。\n${records.join('\n')}`)
  }
  const source: GraphSource = { bookId: 'scale-synthetic', bookName: '千章合成规模样本', maxChapter: chapters,
    contract: '---\n书id: scale-synthetic\n书仓格式版本: 1\n---\n合成规模样本',
    read(relative) { const raw = files.get(relative); if (raw === undefined) throw Object.assign(new Error('Missing fixture'), { code: 'not-found' }); return raw },
    list(relative) {
      if (relative === '世界书') return [{ directory: true, draft: false, name: '人物档案', ref: { space: 'book:scale-synthetic', path: '世界书/人物档案' } }]
      return [...files.keys()].filter(key => key.startsWith(relative + '/')).map(key => ({ name: key.split('/').at(-1)!, directory: false, draft: false, ref: { space: 'book:scale-synthetic', path: key } }))
    } }
  return { source, files, entities, chapters, sourceBytes: [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0) }
}

export function addScaleRelations(graph: StoryGraph): StoryGraph {
  // Declared synthetic relation evidence, independent of production extraction quality.
  const records = graph.records.filter(item => item.recordChapter)
  const entities = graph.entities!
  const edges = records.map((record, index) => ({ ...record, id: `scale-relation-${index}`, from: entities[0]!.id,
    to: entities[1 + index % (entities.length - 1)]!.id, relation: true, evidenceKind: 'extracted' as const,
    label: index % 4 === 0 ? '立场分歧' : '相互帮助', qualifier: index % 7 === 0 ? 'reported' : 'asserted' }))
  return { ...graph, edges: [...graph.edges, ...edges] }
}
