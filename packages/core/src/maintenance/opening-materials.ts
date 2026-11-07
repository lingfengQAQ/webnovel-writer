import { checkSupplementPurpose, isSupplement, parseMaterialManifest } from '../assembly/read'
import { 材料包十段, sectionFileName } from '../assembly/sections'
import { materialHash } from '../assembly/source'
import { relPathProblem } from '../repo/rel-path'
import type { ReadonlyBookSnapshot } from './snapshot'

/** Validate retained package bytes, not the freshness of its historical sources. */
export function inspectOpeningMaterials(reader: ReadonlyBookSnapshot, dir: string, manifest: string, volume: number, chapter?: number): void {
  const add = (code: string, relative: string, detail: string): void => { reader.issues.push({ 代码: code, 路径: relative, 说明: detail }) }
  let parsed: ReturnType<typeof parseMaterialManifest>
  try { parsed = parseMaterialManifest(manifest) } catch (error) {
    add('OPENING_MATERIAL_MANIFEST', `${dir}/材料清单.json`, error instanceof Error ? error.message : String(error))
    return
  }
  const supplements = parsed.sections.filter(isSupplement)
  if (parsed.extended) {
    const base = parsed.sections.filter(item => !isSupplement(item))
    if (base.length !== 材料包十段.length) add('OPENING_MATERIAL_BASE', `${dir}/材料清单.json`, '扩展材料包的基础十段清单不完整')
    for (const item of base) {
      const index = (材料包十段 as readonly string[]).indexOf(item.段)
      const file = `${dir}/${sectionFileName(index, 材料包十段[index]!)}`
      if (reader.readFile(file) === undefined) add('OPENING_MATERIAL_BASE', file, '扩展材料包中已登记的基础材料文件不可读')
    }
  }
  for (const item of supplements) {
    const file = `${dir}/${item.文件}`
    const source = item.来源快照.路径
    if (relPathProblem(source, { strict: true }) !== null || source.includes('\\') || source.split('/').some(part => !part || part.startsWith('.') || /[\x00-\x1f:]/.test(part))) {
      add('OPENING_SUPPLEMENT_SOURCE', file, '补充记录的来源路径不合法，未读取来源或改写摘录')
      continue
    }
    try { checkSupplementPurpose(item.用途, item.性质, item.来源快照, volume) } catch (error) {
      add('OPENING_SUPPLEMENT_SCOPE', file, error instanceof Error ? error.message : String(error))
    }
    if (chapter !== undefined && item.适用章上限 !== chapter) add('OPENING_SUPPLEMENT_SCOPE', file, '补充附件的适用章与已归档章节不一致')
    const text = reader.readFile(file)
    if (text === undefined) add('OPENING_SUPPLEMENT_MISSING', file, '已登记的补充附件不可读')
    else if (materialHash(text) !== item.内容哈希 || Array.from(text).length !== item.字数) add('OPENING_SUPPLEMENT_CHANGED', file, '补充附件的哈希或字数与登记快照不一致')
  }
  for (const entry of reader.listDirectory(`${dir}/补充`) ?? []) {
    const relative = `补充/${entry.name}`
    const file = `${dir}/${relative}`
    if (entry.kind !== 'file') {
      add('OPENING_SUPPLEMENT_UNKNOWN', file, '补充目录包含未支持的目录或链接，未当作附件消费')
      continue
    }
    // Removing a supplement retires its manifest row, not its retained file.
    reader.readFile(file)
  }
}
