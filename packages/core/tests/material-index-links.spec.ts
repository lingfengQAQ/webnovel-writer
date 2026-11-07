import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assembleMaterials, computeMaterials } from '../src/assembly/assemble'
import { loadMaterialPackage } from '../src/assembly/read'
import type { SupplementEdit } from '../src/assembly/sections'
import { rebuildResume } from '../src/recovery'
import { gateWriteDraft, reportDraftReadiness } from '../src/gate/writeDraft'
import { readBookMemoryCatalog } from '../src/memory/catalog'
import { serializeDocument } from '../src/repo/frontmatter'
import { memoryIndexLink } from '../src/repo/memory-index-links'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const key = { 卷: 1, 章: 1, 章名: '索引核对' }
const styleSection = '文风〔条目切片〕'
const volumeEdit: SupplementEdit = {
  操作: '设置', 编号: 'volume', 标题: '本章卷纲', 理由: '承接城门盘问', 性质: '原文',
  用途: '本章卷纲参考', 来源: { 域: '本书', 路径: paths.卷纲(1) },
}
let root: string
function put(relative: string, text: string): void {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text, 'utf8')
}
function memorySnapshot(): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(path.join(root, '本书记忆')).map(name => [name, fs.readFileSync(path.join(root, '本书记忆', name), 'utf8')]))
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-material-links-'))
  put(paths.契约(), serializeDocument({ 版本: 1 }, '# 契约\n## 叙事方式与文风基调\n第三人称，克制叙述。\n## 创作禁区与不可妥协项\n主角不以无辜者换取真相。'))
  put(paths.卷纲(1), '# 卷纲\n\n## 叙事结构\n\n主角在城门盘问后查明铜铃来历。\n')
  put(paths.确认细纲(1, 1, key.章名), serializeDocument({ 状态: '已确认', 版本: 1, 来源引用: ['作品契约/契约.md@1'] }, '# 章细纲\n## 定位段\n### 时空锚定\n城门口，清晨\n## 细纲段\n主角盘问守卫。'))
  put(paths.本书记忆条目('克制'), serializeDocument({ 名称: '克制', 类: '文风', 状态: '已确认' }, '克制叙述，保留仍有效的限制。'))
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-material-links-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

describe('material consumers retain index-link parse failures', () => {
  it.each([
    '- [克制](<./%ZZ.md>) — 类：文风',
    '- [克制](<./..%2F外部.md>) — 类：文风',
    '- [克制](克制.md) — 另一份.md) — 类：文风',
  ])('propagates an invalid index through material save, load and readiness: %s', row => {
    put(paths.本书记忆索引(), `# 索引\n${row}\n`)
    const before = memorySnapshot()
    expect(readBookMemoryCatalog(root).状态).toBe('读取错误')
    const result = computeMaterials(root, { ...key, 仅预览: true, 补充操作: [volumeEdit] })
    expect(result).toMatchObject({ ok: true, 状态: '段有缺' })
    const section = result.段?.find(item => item.段 === styleSection)
    expect(section).toMatchObject({ 完整性: '残缺', 选用原因: expect.stringContaining(paths.本书记忆索引()) })
    expect(result.gaps.join(';')).toContain(paths.本书记忆索引())
    expect(memorySnapshot()).toEqual(before)
    const saved = assembleMaterials(root, {
      ...key, 材料清单哈希: result.已有清单哈希, 补充操作: result.补充预览!.map(item => item.操作),
    })
    expect(saved).toMatchObject({ ok: true, 状态: '段有缺' })
    const loaded = loadMaterialPackage(root, key)
    expect(loaded.段[styleSection]).toContain('克制叙述，保留仍有效的限制。')
    expect(loaded.段[styleSection]).toContain(paths.本书记忆索引())
    expect(rebuildResume(root, key).injection.材料段[styleSection]).toBe(loaded.段[styleSection])
    const draft = `${paths.草稿目录(1, key.章名)}/稿1.md`
    expect(reportDraftReadiness(root, draft)?.材料包状态).toBe('段有缺')
    expect(gateWriteDraft(root, draft)).toEqual({ allow: true })
    expect(memorySnapshot()).toEqual(before)
  })

  it.each([`- ${memoryIndexLink('克制', '克制.md')} — 类：文风`, '- [[克制]]｜类：文风'])('preserves usable current and legacy wiki-only material rows: %s', row => {
    put(paths.本书记忆索引(), `# 索引\n${row}\n`)
    const before = memorySnapshot()
    const result = computeMaterials(root, { ...key, 仅预览: true, 补充操作: [volumeEdit] })
    expect(result).toMatchObject({ ok: true, 状态: '段齐备', gaps: [] })
    expect(result.段?.find(item => item.段 === styleSection)?.完整性).toBe('完整')
    expect(memorySnapshot()).toEqual(before)
  })
})
