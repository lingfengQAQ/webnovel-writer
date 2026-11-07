import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { removeSync } from '../src/repo/remove'
import { readAuthorMemoryCatalog, readBookMemoryCatalog } from '../src/memory/catalog'
import { rebuildBookMemoryIndex, writeBookMemory } from '../src/memory/book'
import { writeAuthorMemory } from '../src/memory/author'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { memoryIndexLink, memoryIndexText, parseMemoryIndexLinks } from '../src/repo/memory-index-links'

const temporary = fs.realpathSync.native(os.tmpdir())
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(temporary, 'webnovel-memory-links-')) })
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-memory-links-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

const input = (name: string) => ({ 类: '决策' as const, 名称: name, 来源: '对谈', 裁决记录: '作者批准', 描述: '保留已确认选择', 正文: `关于${name}的独立决定。` })
const indexPath = () => path.join(root, '本书记忆', '索引.md')
function snapshot(): Record<string, string> {
  const directory = path.join(root, '本书记忆')
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')]))
}
const encoded = (name: string) => encodeURIComponent(`${name}.md`).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

interface MarkdownToken {
  readonly type: string
  attrGet(name: string): string | null
}
const MarkdownIt = createRequire(new URL('../../bundle/package.json', import.meta.url))('markdown-it') as new () => {
  parseInline(text: string, environment: object): readonly { readonly children: readonly MarkdownToken[] }[]
}

describe('memory index filenames roundtrip through actual writers and catalogs', () => {
  it.each(['计划(备选)', '计划[备选]', '计划]备选', '计划#备选', '计划%备选', '计划 备选', '计划😀[备选]%41', '名称.md) — 另一份', '计划(未闭合', '计划](', '甲&乙'])('keeps the exact legal filename %s in a usable link', name => {
    expect(writeBookMemory(root, input(name))).toMatchObject({ ok: true, changed: true, relPath: `本书记忆/${name}.md` })
    const before = snapshot()
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '正常', 问题: [], 条目: [{ 名称: name, 全文位置: `本书记忆/${name}.md` }] })
    expect(before['索引.md']).toContain(`](<./${encoded(name)}>)`)
    expect(snapshot()).toEqual(before)
    expect(writeBookMemory(root, input(name))).toMatchObject({ ok: true, changed: false })
    expect(snapshot()).toEqual(before)
  })

  it('leaves ordinary existing Chinese index lines byte-compatible', () => {
    expect(writeBookMemory(root, input('普通条目')).ok).toBe(true)
    expect(fs.readFileSync(indexPath(), 'utf8')).toBe('# 本书记忆索引\n\n- [普通条目](普通条目.md) — 保留已确认选择｜类：决策｜来源：对谈\n')
    expect(readBookMemoryCatalog(root).状态).toBe('正常')
  })

  it.each([
    ['计划(备选)', '- [旧条目](计划(备选).md) — 旧说明\n'],
    ['计划[备选]', '- [旧标签[内层]](计划[备选].md) — 旧说明\n'],
    ['计划#备选', '- [旧条目](计划#备选.md)\n'],
    ['%41', '- [旧条目](%41.md)\n'],
    ['计划 备选', '- [旧条目](计划 备选.md)\n'],
    ['计划)备选', '- [旧条目](计划)备选.md) — 旧说明\n'],
    ['计划(备选', '- [旧条目](计划(备选.md) — 旧说明\n'],
  ])('rejects legacy raw destination %s without rewriting it', (name, line) => {
    expect(writeBookMemory(root, input(name)).ok).toBe(true)
    fs.writeFileSync(indexPath(), `# 原索引\n${line}`, 'utf8')
    const before = snapshot()
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '读取错误' })
    expect(snapshot()).toEqual(before)
  })

  it('keeps literal percent filenames distinct from decoded-looking siblings', () => {
    for (const name of ['A', '%41', 'a b', 'a%20b']) expect(writeBookMemory(root, input(name)).ok).toBe(true)
    expect(readBookMemoryCatalog(root).状态).toBe('正常')
    fs.writeFileSync(indexPath(), '- [旧条目](%41.md)\n- [旧条目](a%20b.md)\n', 'utf8')
    const before = snapshot()
    const catalog = readBookMemoryCatalog(root)
    expect(catalog.状态).toBe('读取错误')
    expect(catalog.问题.join(';')).toContain('解析索引失败')
    expect(snapshot()).toEqual(before)
  })

  it('does not reinterpret a deleted legacy percent filename as an existing sibling', () => {
    expect(writeBookMemory(root, input('A')).ok).toBe(true)
    fs.writeFileSync(indexPath(), '- [旧条目](%41.md)\n', 'utf8')
    const before = snapshot()
    const catalog = readBookMemoryCatalog(root)
    expect(catalog.状态).toBe('读取错误')
    expect(catalog.问题.join(';')).toContain('解析索引失败')
    expect(snapshot()).toEqual(before)
  })

  it('does not let an encoded percent filename cover its decoded-looking sibling', () => {
    for (const name of ['A', '%41']) expect(writeBookMemory(root, input(name)).ok).toBe(true)
    fs.writeFileSync(indexPath(), '- [编码条目](<./%2541.md>)\n', 'utf8')
    const catalog = readBookMemoryCatalog(root)
    expect(catalog.状态).toBe('索引失效')
    expect(catalog.问题).toEqual(['索引未收录：A.md'])
    fs.unlinkSync(path.join(root, '本书记忆', '%41.md'))
    expect(readBookMemoryCatalog(root).问题).toContain('索引指向不存在的文件：%41.md')
  })

  it('uses the same safe links for authors without changing memory ownership', () => {
    const name = '作者(例外)[A]%'
    expect(writeAuthorMemory(root, input(name))).toMatchObject({ ok: true, changed: true, relPath: `书房/作者记忆/${name}.md` })
    expect(readAuthorMemoryCatalog(root)).toMatchObject({ 归属: '作者', 状态: '正常', 问题: [], 条目: [{ 名称: name, 全文位置: `书房/作者记忆/${name}.md` }] })
    expect(fs.existsSync(path.join(root, '本书记忆'))).toBe(false)
    expect(fs.readFileSync(path.join(root, '书房', '作者记忆', '索引.md'), 'utf8')).toContain(`](<./${encoded(name)}>)`)
  })

  it('keeps link-like descriptive text on one row without changing stored metadata', () => {
    const request = { ...input('普通条目'), 描述: '关于note.md) — [样例]的决定', 来源: '对谈\n- [伪条目](错误.md) — 保留原文' }
    expect(writeBookMemory(root, request).ok).toBe(true)
    const file = path.join(root, '本书记忆', '普通条目.md')
    const original = fs.readFileSync(file, 'utf8')
    const parsed = parseDocument(original)
    expect(parsed).toMatchObject({ ok: true, data: { fields: { 描述: request.描述, 来源: request.来源 }, body: `${request.正文}\n` } })
    const index = fs.readFileSync(indexPath(), 'utf8')
    expect(index.split('\n').filter(line => line.startsWith('- ['))).toHaveLength(1)
    expect(index).toContain('note.md\\) — \\[样例\\]')
    expect(index).toContain('来源：对谈 - \\[伪条目\\]\\(错误.md\\)')
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '正常', 问题: [] })
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
  })

  it('rebuilds unusual display labels without modifying their original document', () => {
    expect(writeBookMemory(root, input('普通条目')).ok).toBe(true)
    const file = path.join(root, '本书记忆', '普通条目.md')
    const original = serializeDocument({ 名称: '别名.md) — [样例]\n下一行', 类: '决策', 来源: '已存原值' }, '保留正文。')
    fs.writeFileSync(file, original, 'utf8')
    rebuildBookMemoryIndex(root)
    const index = fs.readFileSync(indexPath(), 'utf8')
    expect(index).toContain('- [别名.md\\) — \\[样例\\] 下一行](普通条目.md)')
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '正常', 问题: [] })
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
  })

  it('does not add a suffix-based length restriction to existing authored filenames', () => {
    const name = '甲'.repeat(100)
    const directory = path.join(root, '本书记忆')
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, `${name}.md`), serializeDocument({ 类: '决策', 名称: name }, '已有作者原文。'), 'utf8')
    fs.writeFileSync(indexPath(), `- ${memoryIndexLink(name, `${name}.md`)}\n`, 'utf8')
    const before = snapshot()
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '正常', 问题: [], 条目: [{ 名称: name, 全文位置: `本书记忆/${name}.md` }] })
    expect(snapshot()).toEqual(before)
  })

  it.each([
    '- [歧义](A.md) — 丢失文件.md) — 旧说明\n',
    '- [编码无效](<./%ZZ.md>)\n',
    '- [路径越界](<./..%2F外部.md>)\n',
  ])('reports malformed or ambiguous index rows instead of accepting a sibling: %s', line => {
    expect(writeBookMemory(root, input('A')).ok).toBe(true)
    fs.writeFileSync(indexPath(), line, 'utf8')
    const before = snapshot()
    const catalog = readBookMemoryCatalog(root)
    expect(catalog).toMatchObject({ 状态: '读取错误', 条目: [{ 名称: 'A' }] })
    expect(catalog.问题.join(';')).toContain('解析索引失败：本书记忆/索引.md')
    expect(snapshot()).toEqual(before)
  })
})

describe('bounded memory index link grammar', () => {
  it('keeps wiki-only legacy rows distinct from inline links with nested labels', () => {
    expect(parseMemoryIndexLinks('- [[旧条目]]｜类：文风\n')).toEqual({ filenames: [], problems: [] })
    expect(parseMemoryIndexLinks('- [[标签]](实际.md) — 类：文风\n')).toEqual({ filenames: ['实际.md'], problems: [] })
    expect(parseMemoryIndexLinks('- [[标签]](<./%ZZ.md>) — 类：文风\n').problems).toEqual(['第1行链接无效或不明确'])
  })

  it.each(['a`b', 'a``b', 'a`b#c', '`code`', 'x`[y]z'])('renders a real Markdown link for the legal filename %s', name => {
    const filename = `${name}.md`
    const link = memoryIndexLink(name, filename)
    const links = new MarkdownIt().parseInline(link, {})[0]!.children.filter(token => token.type === 'link_open')
    expect(links).toHaveLength(1)
    expect(decodeURIComponent(links[0]!.attrGet('href')!.replace(/^\.\//, ''))).toBe(filename)
    expect(parseMemoryIndexLinks(`- ${link}\n`)).toEqual({ filenames: [filename], problems: [] })
  })

  it.each([
    '<./%2e%2e%2Foutside.md>', '<./dir%2Ffile.md>', '<./dir%5Cfile.md>', '<./C%3Afile.md>', '<./%00file.md>',
    '<./bad%.md>', '<./bad%GG.md>', '<./%C0%AF.md>', '<./has space.md>', '<./has#fragment.md>',
    '<./plain.json>', '<encoded.md>', '../outside.md', 'dir/file.md', 'dir\\file.md', 'C:file.md', 'CON.md', '<./NUL.md>',
  ])('rejects unsafe or malformed destination %s', destination => {
    const result = parseMemoryIndexLinks(`- [示例](${destination})\n`)
    expect(result.filenames).toEqual([])
    expect(result.problems).toEqual(['第1行链接无效或不明确'])
  })

  it('decodes explicit URIs once and keeps legacy percent characters literal', () => {
    expect(parseMemoryIndexLinks('- [旧](%41.md)\n- [新](<./%41.md>)\n- [字面值](<./%2541.md>)\n- [非路径](<./%252F.md>)\n')).toEqual({
      filenames: ['A.md', '%41.md', '%2F.md'], problems: ['第1行链接无效或不明确'],
    })
  })

  it('handles escaped nested labels and ignores headings and non-index prose', () => {
    const label = '标签[嵌套](甲)\\末尾\n下一行'
    const link = memoryIndexLink(label, '实际[目标].md')
    expect(parseMemoryIndexLinks(`# 标题\r\n\r\n- ${link} — ${memoryIndexText('[说明](文件.md)')}\r\n说明不构成索引\r\n`)).toEqual({ filenames: ['实际[目标].md'], problems: [] })
    expect(label).toContain('\n')
  })

  it('validates filename stems, including the existing 100-character contract', () => {
    const maximum = `${'a'.repeat(100)}.md`
    expect(parseMemoryIndexLinks(`- ${memoryIndexLink('最大名称', maximum)}\n`)).toEqual({ filenames: [maximum], problems: [] })
    const excessive = `${'a'.repeat(101)}.md`
    expect(() => memoryIndexLink('超长', excessive)).toThrow('记忆索引目标须为单个合法 Markdown 文件名')
    expect(parseMemoryIndexLinks(`- [超长](${excessive})\n`).problems).toHaveLength(1)
  })

  it.each(['../bad.md', 'bad/name.md', 'bad\\name.md', 'bad.json', 'bad.md\n', 'CON.md', 'nul.md', 'COM1.md', '.md'])('refuses unsafe write-side filename %s', filename => {
    expect(() => memoryIndexLink('名称', filename)).toThrow('记忆索引目标须为单个合法 Markdown 文件名')
  })
})
