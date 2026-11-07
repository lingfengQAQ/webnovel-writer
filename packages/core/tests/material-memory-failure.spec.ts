import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import {
  assembleMaterials, computeMaterials, loadMaterialPackage, readManifest, rebuildResume,
  serializeDocument, type ComputedMaterials, type SupplementEdit,
} from '../src/index'
import { gateWriteDraft, reportDraftReadiness } from '../src/gate/writeDraft'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const key = { 卷: 1, 章: 1, 章名: '文风核对' } as const
const styleSection = '文风〔条目切片〕'
const volumeEdit: SupplementEdit = {
  操作: '设置', 编号: 'volume', 标题: '本章卷纲', 理由: '本章承接城门盘问', 性质: '原文',
  用途: '本章卷纲参考', 来源: { 域: '本书', 路径: paths.卷纲(1) },
}
let root: string

function put(rel: string, text: string): void {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text, 'utf8')
}

function outline(body = '主角在城门口盘问守卫。'): void {
  put(paths.确认细纲(key.卷, key.章, key.章名), serializeDocument({
    状态: '已确认', 版本: 1, 来源引用: ['作品契约/契约.md@1'],
  }, `# 章细纲\n\n## 定位段\n\n### 时空锚定\n城门口，清晨\n\n## 细纲段\n\n${body}\n`))
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-material-memory-'))
  put(paths.契约(), serializeDocument({ 版本: 1 }, [
    '# 契约', '## 叙事方式与文风基调', '第三人称，克制叙述。',
    '## 创作禁区与不可妥协项', '主角不以无辜者换取真相。',
  ].join('\n')))
  put(paths.卷纲(1), '# 卷纲\n\n## 叙事结构\n\n主角在城门盘问后查明铜铃来历。\n')
  outline()
})

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-material-memory-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function healthy(name = '克制叙述', kind = '文风'): void {
  put(paths.本书记忆条目(name), serializeDocument({ 名称: name, 类: kind, 状态: '已确认' }, `${name}原文。`))
}

function index(names: readonly string[] = ['克制叙述']): void {
  put(paths.本书记忆索引(), ['# 本书记忆索引', '', ...names.map(name => `- [[${name}]]｜类：文风｜描述：${name}约定`)].join('\n'))
}

function snapshot(sourcesOnly = false): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name)
      if (sourcesOnly && (child === '.webnovel' || child === '草稿区/材料包')) continue
      if (entry.isDirectory()) {
        if (!sourcesOnly) result[`${child}/`] = '<directory>'
        walk(child)
      } else result[child] = fs.readFileSync(path.join(root, child)).toString('base64')
    }
  }
  walk('')
  return result
}

function prepare(): ComputedMaterials {
  return computeMaterials(root, { ...key, 仅预览: true, 补充操作: [volumeEdit] })
}

function computeReadOnly(): ComputedMaterials {
  const before = snapshot()
  const result = prepare()
  expect(result.ok, result.gaps.join(';')).toBe(true)
  expect(snapshot()).toEqual(before)
  return result
}

function styleBody(result: ComputedMaterials): string {
  const file = result.文件?.find(item => item.relPath.includes(styleSection))
  expect(file).toBeDefined()
  return file!.content
}

function expectFailure(result: ComputedMaterials, failedPaths: readonly string[]): void {
  expect(result).toMatchObject({ ok: true, 状态: '段有缺' })
  const section = result.段?.find(item => item.段 === styleSection)
  expect(section?.完整性).toBe('残缺')
  for (const failedPath of failedPaths) {
    expect(result.gaps.join(';')).toContain(failedPath)
    expect(section?.选用原因).toContain(failedPath)
    expect(styleBody(result)).toContain(failedPath)
  }
  expect(styleBody(result)).toContain('读取警告')
  expect(styleBody(result)).not.toContain('（无文风记忆）')
}

function saveAndLoad(result: ComputedMaterials): string {
  const before = snapshot(true)
  const saved = assembleMaterials(root, {
    ...key, 材料清单哈希: result.已有清单哈希, 补充操作: result.补充预览!.map(item => item.操作),
  })
  expect(saved).toMatchObject({ ok: true, 状态: result.状态, gaps: result.gaps })
  expect(snapshot(true)).toEqual(before)
  const afterSave = snapshot()
  const loaded = loadMaterialPackage(root, key)
  const resumed = rebuildResume(root, key)
  const draftPath = `草稿区/草稿/卷01-${key.章名}/稿1.md`
  expect(loaded.段[styleSection]).toBe(styleBody(result))
  expect(resumed.injection.材料段[styleSection]).toBe(loaded.段[styleSection])
  expect(readManifest(root, key)?.段.find(item => item.段 === styleSection))
    .toEqual(result.段?.find(item => item.段 === styleSection))
  expect(reportDraftReadiness(root, draftPath)?.材料包状态).toBe(result.状态)
  expect(gateWriteDraft(root, draftPath)).toEqual({ allow: true })
  expect(snapshot()).toEqual(afterSave)
  return loaded.段[styleSection]!
}

describe('STYLE-FAILURE: material completeness preserves memory failures', () => {
  it.each([false, true])('keeps readable selected entries and every failed path through save/load (index=%s)', withIndex => {
    healthy()
    put('本书记忆/坏甲.md', '---\n类: [\n---\n不能作为正文消费的坏甲。\n')
    put('本书记忆/坏乙.md', serializeDocument({ 类: '未知' }, '不能作为正文消费的坏乙。'))
    if (withIndex) index(['克制叙述', '坏甲', '坏乙'])
    const result = computeReadOnly()
    expectFailure(result, ['本书记忆/坏甲.md', '本书记忆/坏乙.md'])
    const body = saveAndLoad(result)
    expect(body).toContain('克制叙述原文。')
    expect(body).not.toContain('不能作为正文消费')
    expect(rebuildResume(root, key).statusCard).toContain('本书记忆：部分解析失败（1 条可用）')
  })

  it.each([false, true])('reports all-bad memories as incomplete, not empty or catalog-complete (index=%s)', withIndex => {
    put('本书记忆/坏条目.md', '---\n名称: 坏条目\n类: [\n---\n坏原文不应进入材料。\n')
    if (withIndex) index(['坏条目'])
    const result = computeReadOnly()
    expectFailure(result, ['本书记忆/坏条目.md'])
    expect(saveAndLoad(result)).not.toContain('坏原文不应进入材料')
    expect(rebuildResume(root, key).statusCard).toContain('本书记忆：解析失败（0 条可用）')
  })

  it.each([false, true])('retains failure when the readable entries are all filtered out (index=%s)', withIndex => {
    healthy('已确认决定', '决策')
    put('本书记忆/无法判类.md', '---\n类: [\n---\n未知类别原文。\n')
    if (withIndex) index([])
    const result = computeReadOnly()
    expectFailure(result, ['本书记忆/无法判类.md'])
    expect(styleBody(result)).toContain('不能据此判定文风记忆为空')
    expect(saveAndLoad(result)).not.toContain('已确认决定原文。')
  })

  it.each(['absent', 'directory', 'index', 'decision'])('allows genuine optional emptiness (%s)', kind => {
    if (kind === 'directory') fs.mkdirSync(path.join(root, '本书记忆'))
    if (kind === 'index') index([])
    if (kind === 'decision') healthy('已确认决定', '决策')
    const result = computeReadOnly()
    expect(result).toMatchObject({ ok: true, 状态: '段齐备', gaps: [] })
    expect(result.段?.find(item => item.段 === styleSection)?.完整性).toBe('空')
    expect(saveAndLoad(result)).toContain('（无文风记忆）')
  })

  it.each(['', '# 文风\n'])('keeps a valid empty legacy category usable without demanding other categories: %j', text => {
    put(paths.记忆('文风'), text)
    const result = computeReadOnly()
    expect(result).toMatchObject({ ok: true, 状态: '段齐备', gaps: [] })
    expect(result.段?.find(item => item.段 === styleSection)?.完整性).toBe('空')
    expect(saveAndLoad(result)).not.toContain('读取警告')
  })

  it('keeps current-format entries usable but reports their missing required index', () => {
    healthy()
    const result = computeReadOnly()
    expectFailure(result, [paths.本书记忆索引()])
    expect(result.gaps.join(';')).toContain('索引缺失')
    expect(result.段?.find(item => item.段 === styleSection)?.来源).toEqual([paths.本书记忆条目('克制叙述')])
    expect(saveAndLoad(result)).toContain('克制叙述原文。')
    expect(fs.existsSync(path.join(root, paths.本书记忆索引()))).toBe(false)
  })

  it('does not inject legacy prose as style materials; reports maintenance need', () => {
    const oldText = '# 文风\n\n约定前言也保留。\n\n## 旧约定\n状态：已确认\n### 正文\n旧式叙述原文。\n'
    put(paths.记忆('文风'), oldText)
    const healthyResult = computeReadOnly()
    expect(healthyResult.段?.find(item => item.段 === styleSection)?.完整性).toBe('残缺')
    expect(styleBody(healthyResult)).not.toContain(oldText.trim())
    put('本书记忆/无法判类.md', '---\n类: [\n---\n坏原文。\n')
    const result = computeReadOnly()
    expectFailure(result, ['本书记忆/无法判类.md'])
    expect(saveAndLoad(result)).not.toContain(oldText.trim())
  })

  it.each([
    '---\n类: [\n---\n## 不可回退\n旧形坏正文。\n',
    '---\n类: 未知\n---\n## 不可回退\n旧形坏正文。\n',
    '# 文风\n## 不可回退\n状态：已确认\n状态：候选\n旧形坏正文。\n',
  ])('does not hide malformed legacy-named documents in the no-index fallback: %s', text => {
    put(paths.记忆('文风'), text)
    const result = computeReadOnly()
    expectFailure(result, [paths.记忆('文风')])
    expect(saveAndLoad(result)).not.toContain('旧形坏正文。')
  })

  it.each([false, true])('preserves named selection and recent-entry limits (index=%s)', withIndex => {
    const names = Array.from({ length: 7 }, (_, i) => `风格${i}`)
    names.forEach(name => healthy(name))
    if (withIndex) index(names)
    const recent = computeReadOnly()
    if (withIndex) expect(recent).toMatchObject({ 状态: '段齐备', gaps: [] })
    else expectFailure(recent, [paths.本书记忆索引()])
    expect(recent.段?.find(item => item.段 === styleSection)?.来源).toEqual([
      ...names.slice(2).map(name => paths.本书记忆条目(name)), ...(withIndex ? [paths.本书记忆索引()] : []),
    ])
    expect(styleBody(recent)).not.toContain('风格0原文。')
    expect(styleBody(recent)).not.toContain('风格1原文。')
    for (const name of names.slice(2)) expect(styleBody(recent)).toContain(`${name}原文。`)
    outline('沿用[[风格0]]，主角继续盘问。')
    const named = computeReadOnly()
    if (withIndex) expect(named).toMatchObject({ 状态: '段齐备', gaps: [] })
    else expectFailure(named, [paths.本书记忆索引()])
    expect(styleBody(named)).toContain('风格0原文。')
    for (const name of names.slice(1)) expect(styleBody(named)).not.toContain(`${name}原文。`)
    expect(saveAndLoad(named)).toBe(styleBody(named))
  })

  it.each([
    '---\n无效: [\n---\n- [[坏索引行]]｜类：文风\n',
    '---\n索引没有闭合\n- [[坏索引行]]｜类：文风\n',
  ])('does not consume malformed index frontmatter as trustworthy catalog rows: %s', text => {
    healthy()
    put(paths.本书记忆索引(), text)
    const result = computeReadOnly()
    expectFailure(result, [paths.本书记忆索引()])
    expect(styleBody(result)).toContain('索引解析失败')
    expect(styleBody(result)).not.toContain('### 文风索引')
    expect(saveAndLoad(result)).toContain('克制叙述原文。')
    expect(result.段?.find(item => item.段 === styleSection)?.来源).not.toContain(paths.本书记忆索引())
  })

  it('does not call a catalog declaration with no readable entries genuine emptiness', () => {
    index(['未找到正文'])
    const result = computeReadOnly()
    expect(result).toMatchObject({ ok: true, 状态: '段有缺' })
    expect(result.段?.find(item => item.段 === styleSection)?.完整性).toBe('残缺')
    expect(styleBody(result)).toContain('本书记忆不存在')
    expect(saveAndLoad(result)).toContain('未找到正文')
  })

  it.each(['ENOENT', 'EACCES'])('surfaces a discovered unreadable entry instead of optional absence (%s)', code => {
    healthy()
    healthy('暂不可读')
    const before = snapshot()
    const readFile = fs.readFileSync
    let faultHit = false
    vi.spyOn(fs, 'readFileSync').mockImplementation(((filename, ...args) => {
      if (String(filename) === path.join(root, '本书记忆/暂不可读.md')) {
        faultHit = true
        throw Object.assign(new Error('injected entry read failure'), { code })
      }
      return readFile(filename, ...args)
    }) as typeof fs.readFileSync)
    syncBuiltinESMExports()
    const result = prepare()
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    expect(faultHit).toBe(true)
    expectFailure(result, ['本书记忆/暂不可读.md'])
    expect(styleBody(result)).toContain(code === 'ENOENT' ? '文件缺失' : '文件读取失败')
    expect(styleBody(result)).toContain('克制叙述原文。')
    expect(snapshot()).toEqual(before)
  })

  it('does not treat an unreadable index as an absent index or hide it with legacy fallback', () => {
    const oldText = '# 文风\n\n旧文件引言。\n## 旧约定\n### 正文\n可用旧约定正文。\n'
    put(paths.记忆('文风'), oldText)
    index(['旧约定'])
    const before = snapshot()
    const readFile = fs.readFileSync
    let faultHit = false
    vi.spyOn(fs, 'readFileSync').mockImplementation(((filename, ...args) => {
      if (String(filename) === path.join(root, paths.本书记忆索引())) {
        faultHit = true
        throw Object.assign(new Error('injected index read failure'), { code: 'EACCES' })
      }
      return readFile(filename, ...args)
    }) as typeof fs.readFileSync)
    syncBuiltinESMExports()
    const result = prepare()
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    expect(faultHit).toBe(true)
    expectFailure(result, [paths.本书记忆索引()])
    expect(styleBody(result)).toContain('索引读取失败')
    expect(styleBody(result)).not.toContain('可用旧约定正文。')
    expect(styleBody(result)).not.toContain('旧文件引言。')
    expect(snapshot()).toEqual(before)
  })

  it('reports directory enumeration failure rather than declaring the optional memory absent', () => {
    healthy()
    const before = snapshot()
    const readDirectory = fs.readdirSync
    let faultHit = false
    vi.spyOn(fs, 'readdirSync').mockImplementation(((directory, ...args) => {
      if (String(directory) === path.join(root, '本书记忆')) {
        faultHit = true
        throw Object.assign(new Error('injected directory failure'), { code: 'EACCES' })
      }
      return readDirectory(directory, ...args)
    }) as typeof fs.readdirSync)
    syncBuiltinESMExports()
    const result = prepare()
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    expect(faultHit).toBe(true)
    expectFailure(result, ['本书记忆'])
    expect(styleBody(result)).toContain('目录读取失败')
    expect(snapshot()).toEqual(before)
  })
})
