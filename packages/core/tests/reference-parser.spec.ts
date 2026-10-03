import { describe, expect, it } from 'vitest'
import { previewReference, referencePreviewView, REFERENCE_LIMITS } from '../src/reference'
import { epubFiles, referenceZip } from './fixtures/reference'

describe('本地 TXT 与 EPUB 接入', () => {
  it.each(['utf-8', 'utf-16le', 'utf-16be'] as const)('严格解码 %s/BOM 并保留原字节定位', async encoding => {
    const text = '序章\r\n风起。\r\n第一章 合作\r\n船靠岸。'
    const bytes = encoding === 'utf-8' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]) : Buffer.concat([encoding === 'utf-16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xfe, 0xff]), encoding === 'utf-16le' ? Buffer.from(text, 'utf16le') : Buffer.from(text, 'utf16le').swap16()])
    const result = await previewReference(bytes, 'test.txt')
    expect(result.parsed.units).toHaveLength(2)
    expect(result.parsed.units[1]!.text).toContain('船靠岸')
    const loc = result.parsed.units[1]!.locations[0]!
    const raw = bytes.subarray(loc.byteStart, loc.byteEnd)
    expect(new TextDecoder(encoding).decode(raw)).toBe('第一章 合作\r\n')
    expect(JSON.stringify(referencePreviewView(result))).not.toContain('船靠岸')
  })
  it.each([['gb18030', 'd6d0cec4'], ['big5', 'a4a4a4e5']] as const)('歧义编码 %s 须显式选择', async (encoding, hex) => {
    const bytes = Buffer.from(hex, 'hex')
    await expect(previewReference(bytes, 'book.txt')).rejects.toMatchObject({ code: 'encoding-required' })
    const result = await previewReference(bytes, 'book.txt', { encoding })
    expect(result.parsed.units[0]!.text).toBe('中文')
    expect(result.parsed.issues).toContainEqual(expect.objectContaining({ code: 'unconfirmed-boundaries', blocking: true }))
  })
  it('重复目录、卷内重置与缺章不覆盖阅读单元', async () => {
    const result = await previewReference(Buffer.from('第一章 标题\n第二章 标题\n第一卷\n第一章 开始\n有正文。\n第三章 缺口\n另有正文。\n第二卷\n第一章 再来\n继续。'), 'test.txt')
    expect(new Set(result.parsed.units.map(unit => unit.id)).size).toBe(result.parsed.units.length)
    expect(result.parsed.issues.some(issue => issue.code === 'chapter-sequence')).toBe(true)
    expect(result.parsed.issues.some(issue => issue.code === 'heading-only')).toBe(true)
  })
  it.each(['2.0', '3.0'])('EPUB %s 依据 spine 与目录锚点读取，保留非 linear 和脚注', async version => {
    const { parsed } = await previewReference(referenceZip(epubFiles(version)), 'book.epub')
    expect(parsed.units.map(unit => unit.title)).toEqual(['航图', '谈判', 'OPS/b.xhtml'])
    expect(parsed.units[0]!.links).toContainEqual(expect.objectContaining({ href: 'OPS/b.xhtml', anchor: 'note' }))
    expect(parsed.units[2]!.linear).toBe(false)
    expect(parsed.units[0]!.locations.some(loc => loc.anchor === 'first')).toBe(true)
  })
  it('EPUB 2 NCX 锚点与 spine 外脚注均保留', async () => {
    const files = epubFiles('2.0').filter(([name]) => name !== 'OPS/nav.xhtml').map(([name, value]): [string, string] => [name, name === 'OPS/book.opf' ? value.replace('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>').replace('<itemref idref="b" linear="no"/>', '') : value])
    files.push(['OPS/toc.ncx', '<ncx><navMap><navPoint id="one"><navLabel><text>航图</text></navLabel><content src="a.xhtml#first"/></navPoint><navPoint id="two"><navLabel><text>谈判</text></navLabel><content src="a.xhtml#second"/></navPoint></navMap></ncx>'])
    const result = await previewReference(referenceZip(files), 'book.epub')
    expect(result.parsed.units.map(unit => unit.title)).toEqual(['航图', '谈判', 'OPS/b.xhtml'])
    expect(result.parsed.units[2]!.linear).toBe(false)
    expect(result.parsed.issues).toEqual([])
  })
  it('显式卷标题允许卷内章号重置，不误报标题缺正文', async () => {
    const { parsed } = await previewReference(Buffer.from('第一卷\n第一章 起航\n船开了。\n第二卷\n第一章 靠岸\n船到了。'), 'book.txt')
    expect(parsed.units).toHaveLength(4)
    expect(parsed.issues).toEqual([])
  })
  it.each(['../escape', '/absolute', 'a\\b', 'C:/bad', 'OPS/a.xhtml'])('拒绝 ZIP 危险或重复路径 %s', async filename => {
    await expect(previewReference(referenceZip([...epubFiles(), [filename, 'unexpected']]), 'book.epub')).rejects.toBeDefined()
  })
  it('拒绝 DTD、坏 ZIP、正文加密；字体混淆不误判 DRM', async () => {
    const files = epubFiles()
    const badCrc = referenceZip(files), central = badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    badCrc.writeUInt32LE(0, central + 16)
    await expect(previewReference(badCrc, 'book.epub')).rejects.toMatchObject({ code: 'epub-zip' })
    await expect(previewReference(Buffer.from('bad zip'), 'book.epub')).rejects.toMatchObject({ code: 'epub-zip' })
    await expect(previewReference(referenceZip(files.map(([name, value]) => [name, name === 'OPS/a.xhtml' ? '<!DOCTYPE html><html><body>text</body></html>' : value])), 'book.epub')).rejects.toMatchObject({ code: 'epub-xml' })
    const encryption = (uri: string) => `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="${uri}"/></CipherData></EncryptedData></encryption>`
    await expect(previewReference(referenceZip([...files, ['META-INF/encryption.xml', encryption('OPS/a.xhtml')]]), 'book.epub')).rejects.toMatchObject({ code: 'epub-encrypted' })
    const font = files.map(([name, value]): [string, string] => [name, name === 'OPS/book.opf' ? value.replace('</manifest>', '<item id="font" href="font.otf" media-type="application/vnd.ms-opentype"/></manifest>') : value])
    const result = await previewReference(referenceZip([...font, ['OPS/font.otf', 'font'], ['META-INF/encryption.xml', encryption('OPS/font.otf')]]), 'book.epub')
    expect(result.parsed.units).toHaveLength(3)
  })
  it('图片正文缺口、超限和预取消不能报为完整解析', async () => {
    const files = epubFiles().map(([name, value]): [string, string] => [name, name === 'OPS/b.xhtml' ? '<html><body><img src="page.png"/></body></html>' : value])
    const result = await previewReference(referenceZip(files), 'book.epub')
    expect(result.parsed.issues).toContainEqual(expect.objectContaining({ code: 'image-content', blocking: true }))
    await expect(previewReference(referenceZip([...epubFiles(), ['OPS/large', Buffer.alloc(REFERENCE_LIMITS.entryBytes + 1, 65)]]), 'book.epub')).rejects.toMatchObject({ code: 'epub-limit' })
    await expect(previewReference(referenceZip(epubFiles()), 'book.epub', {}, AbortSignal.abort())).rejects.toBeDefined()
  })
})
