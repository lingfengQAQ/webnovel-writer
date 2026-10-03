import * as path from 'node:path'
import { crc32 } from 'node:zlib'
import * as yauzl from 'yauzl'
import { SaxesParser } from 'saxes'
import { REFERENCE_LIMITS as limits, ReferenceError, type ParsedSource, type ReadingUnit, type SourceIssue, type SourceLocation } from './types'

interface XmlNode { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] }
function xml(bytes: Uint8Array): XmlNode {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ReferenceError('epub-xml', 'EPUB XML 不是受支持的 UTF-8 文本') }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ReferenceError('epub-xml', 'EPUB 含 DTD 或实体声明，不展开外部实体')
  const root: XmlNode = { name: '', attrs: {}, children: [] }, stack = [root]
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => {
    if (stack.length > 256) throw new ReferenceError('epub-xml', 'EPUB XML 嵌套过深')
    const node: XmlNode = { name: tag.local, attrs: {}, children: [] }
    for (const attr of Object.values(tag.attributes)) { node.attrs[attr.name] = attr.value; if (!(attr.local in node.attrs)) node.attrs[attr.local] = attr.value }
    stack[stack.length - 1]!.children.push(node); stack.push(node)
  })
  parser.on('closetag', () => { stack.pop() })
  parser.on('text', value => stack[stack.length - 1]!.children.push(value))
  parser.on('cdata', value => stack[stack.length - 1]!.children.push(value))
  try { parser.write(text).close() } catch (error) {
    if (error instanceof ReferenceError) throw error
    throw new ReferenceError('epub-xml', 'EPUB XML 结构损坏或包含不支持的实体')
  }
  return root
}
const children = (node: XmlNode): XmlNode[] => node.children.filter((item): item is XmlNode => typeof item !== 'string')
const descendants = (node: XmlNode, name: string): XmlNode[] => children(node).flatMap(child => [...(child.name === name ? [child] : []), ...descendants(child, name)])
const nodeText = (node: XmlNode): string => node.children.map(child => typeof child === 'string' ? child : nodeText(child)).join('').trim()

function entryName(name: string): string {
  if (!name || /[\\\x00-\x1f:]/.test(name) || name.startsWith('/') || name.replace(/\/$/, '').split('/').some(p => !p || p === '..' || p === '.' || /[. ]$/.test(p))) throw new ReferenceError('epub-path', 'EPUB 条目路径不安全')
  return name.normalize('NFC')
}
function href(base: string, raw: string): { href: string; anchor?: string } {
  if (!raw || /^[a-z][a-z\d+.-]*:|^\/\//i.test(raw) || raw.includes('?')) throw new ReferenceError('epub-path', 'EPUB 引用必须位于本地包内')
  let decoded: string
  try { decoded = decodeURIComponent(raw) } catch { throw new ReferenceError('epub-path', 'EPUB 引用编码无效') }
  if (/[\\\x00-\x1f:]/.test(decoded) || decoded.startsWith('/')) throw new ReferenceError('epub-path', 'EPUB 引用路径不安全')
  const [file, anchor] = decoded.split('#')
  const resolved = file ? path.posix.normalize(path.posix.join(path.posix.dirname(base), file)) : base
  if (resolved === '..' || resolved.startsWith('../')) throw new ReferenceError('epub-path', 'EPUB 引用越出包边界')
  return { href: entryName(resolved), ...(anchor ? { anchor } : {}) }
}

/** Never extracts archive entries to disk. Counts the actual decompressed stream. */
async function unzip(bytes: Buffer, signal?: AbortSignal): Promise<Map<string, Buffer>> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new ReferenceError('epub-zip', 'EPUB ZIP 无法打开')); return }
      let settled = false, total = 0, count = 0
      const files = new Map<string, Buffer>(), names = new Set<string>()
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true; signal?.removeEventListener('abort', abort); zip.close()
        if (error) reject(error instanceof ReferenceError || signal?.aborted ? error : new ReferenceError('epub-zip', 'EPUB ZIP 损坏或解压失败'))
        else resolve(files)
      }
      const abort = () => finish(signal?.reason ?? new ReferenceError('cancelled', '解析已取消'))
      signal?.addEventListener('abort', abort, { once: true })
      zip.on('error', finish)
      zip.on('end', () => finish())
      zip.on('entry', entry => {
        if (settled) return
        try {
          signal?.throwIfAborted()
          const name = entryName(entry.fileName)
          if (++count > limits.entries || names.has(name)) throw new ReferenceError('epub-zip', 'EPUB 条目过多或路径重复')
          names.add(name)
          const mode = entry.externalFileAttributes >>> 16
          if ((mode & 0xf000) === 0xa000 || (entry.generalPurposeBitFlag & 1)) throw new ReferenceError('epub-encrypted', '不支持链接条目或加密 ZIP')
          if (entry.uncompressedSize > limits.entryBytes) throw new ReferenceError('epub-limit', 'EPUB 单条目超过解压限制')
          if (name.endsWith('/')) { zip.readEntry(); return }
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) { finish(error ?? new Error('stream')); return }
            const chunks: Buffer[] = []; let size = 0
            const abortStream = () => stream.destroy(new Error('cancelled'))
            signal?.addEventListener('abort', abortStream, { once: true })
            stream.on('error', error => { signal?.removeEventListener('abort', abortStream); finish(error) })
            stream.on('data', chunk => {
              size += chunk.length; total += chunk.length
              if (size > limits.entryBytes || total > limits.expandedBytes) { stream.destroy(); finish(new ReferenceError('epub-limit', 'EPUB 解压内容超过限制，未截断导入')); return }
              chunks.push(chunk)
            })
            stream.on('end', () => {
              signal?.removeEventListener('abort', abortStream)
              if (!settled) {
                const bytes = Buffer.concat(chunks)
                if (crc32(bytes) !== entry.crc32) { finish(new ReferenceError('epub-zip', 'EPUB 条目 CRC 校验失败')); return }
                files.set(name, bytes); zip.readEntry()
              }
            })
          })
        } catch (error) { finish(error) }
      })
      if (signal?.aborted) abort(); else zip.readEntry()
    })
  })
}

export async function parseEpub(bytes: Buffer, signal?: AbortSignal): Promise<ParsedSource> {
  const files = await unzip(bytes, signal)
  const read = (name: string) => { const data = files.get(name); if (!data) throw new ReferenceError('epub-missing', 'EPUB 缺少目录或正文资源'); return xml(data) }
  if (files.get('mimetype')?.toString('ascii').trim() !== 'application/epub+zip') throw new ReferenceError('epub-format', 'EPUB mimetype 缺失或不正确')
  const roots = descendants(read('META-INF/container.xml'), 'rootfile')
  const root = roots.find(node => node.attrs['media-type'] === 'application/oebps-package+xml')
  if (!root?.attrs['full-path']) throw new ReferenceError('epub-package', 'EPUB 没有可读取的 OPF 包')
  const opfPath = entryName(root.attrs['full-path']), opf = read(opfPath)
  const pkg = descendants(opf, 'package')[0]
  if (!pkg || !/^[23](?:\.|$)/.test(pkg.attrs.version ?? '')) throw new ReferenceError('epub-version', '仅支持 EPUB 2/3')
  const manifest = new Map<string, { href: string; media: string; properties: string }>()
  for (const item of descendants(opf, 'item')) {
    const id = item.attrs.id
    if (!id || manifest.has(id) || !item.attrs.href) throw new ReferenceError('epub-manifest', 'EPUB manifest 身份缺失或重复')
    manifest.set(id, { href: href(opfPath, item.attrs.href).href, media: item.attrs['media-type'] ?? '', properties: item.attrs.properties ?? '' })
  }
  const encryption = files.get('META-INF/encryption.xml')
  if (encryption) for (const encrypted of descendants(xml(encryption), 'EncryptedData')) {
    const uri = descendants(encrypted, 'CipherReference')[0]?.attrs.URI
    const algorithm = descendants(encrypted, 'EncryptionMethod')[0]?.attrs.Algorithm
    const name = uri ? href('_root_', uri).href : ''
    const item = [...manifest.values()].find(item => item.href === name)
    const font = item && /font|opentype/.test(item.media)
    if (!font || !['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'].includes(algorithm ?? '')) throw new ReferenceError('epub-encrypted', 'EPUB 包含正文或不支持的资源加密，不处理 DRM')
  }
  const navigation = new Map<string, string>()
  for (const item of manifest.values()) {
    if (item.properties.split(/\s+/).includes('nav')) {
      for (const nav of descendants(read(item.href), 'nav').filter(node => (node.attrs['epub:type'] ?? node.attrs.type ?? '').split(/\s+/).includes('toc'))) {
        for (const link of descendants(nav, 'a')) if (link.attrs.href) { const ref = href(item.href, link.attrs.href); navigation.set(ref.href + (ref.anchor ? '#' + ref.anchor : ''), nodeText(link)) }
      }
    }
    if (item.media === 'application/x-dtbncx+xml') for (const point of descendants(read(item.href), 'navPoint')) {
      const content = children(point).find(node => node.name === 'content'), label = children(point).find(node => node.name === 'navLabel')
      if (content?.attrs.src) { const ref = href(item.href, content.attrs.src); navigation.set(ref.href + (ref.anchor ? '#' + ref.anchor : ''), label ? nodeText(label) : '') }
    }
  }
  const units: ReadingUnit[] = [], issues: SourceIssue[] = [], seen = new Set<string>()
  const readingOrder = descendants(opf, 'itemref')
  const queued = new Set(readingOrder.map(item => item.attrs.idref))
  const anchorTargets = new Set<string>()
  for (const spine of readingOrder) {
    signal?.throwIfAborted()
    const item = manifest.get(spine.attrs.idref ?? '')
    if (!item) throw new ReferenceError('epub-spine', 'EPUB spine 指向缺失的 manifest 项')
    if (seen.has(item.href)) throw new ReferenceError('epub-spine', 'EPUB spine 重复引用同一正文资源，需核对阅读顺序')
    seen.add(item.href)
    if (!files.has(item.href) || item.media !== 'application/xhtml+xml') {
      issues.push({ code: 'unsupported-content', message: `正文资源不可读取或不支持：${item.href}`, blocking: true }); continue
    }
    const document = read(item.href), body = descendants(document, 'body')[0]
    if (!body) throw new ReferenceError('epub-body', 'EPUB XHTML 缺少 body')
    let text = '', nodeNumber = 0
    const locations: SourceLocation[] = [], links: ReadingUnit['links'] = [], anchors = new Map<string, number>()
    const newline = () => { if (text && !text.endsWith('\n')) text += '\n' }
    const walk = (node: XmlNode) => {
      if (['script', 'style', 'head'].includes(node.name)) return
      const block = /^(?:p|div|section|article|aside|h[1-6]|li|blockquote|br|tr)$/.test(node.name)
      if (block) newline()
      const anchor = node.attrs.id ?? node.attrs['xml:id']
      if (anchor) { if (anchors.has(anchor)) throw new ReferenceError('epub-anchor', 'EPUB 正文存在重复锚点'); anchors.set(anchor, text.length); anchorTargets.add(item.href + '#' + anchor) }
      if (['img', 'svg', 'math', 'object', 'iframe', 'audio', 'video'].includes(node.name)) issues.push({ code: 'non-text-content', message: `正文包含未解读的非文字内容：${item.href}`, blocking: true })
      locations.push({ char: text.length, href: item.href, ...(anchor ? { anchor } : {}), node: ++nodeNumber })
      if (node.name === 'a' && node.attrs.href && !/^[a-z][a-z\d+.-]*:|^\/\//i.test(node.attrs.href)) links.push({ at: text.length, ...href(item.href, node.attrs.href) })
      for (const child of node.children) { if (typeof child === 'string') text += child.replace(/\s+/g, ' '); else walk(child) }
      if (block) newline()
    }
    walk(body)
    // Linked footnotes outside the spine remain separate supplemental reading units.
    for (const link of links) {
      const target = [...manifest.entries()].find(([, entry]) => entry.href === link.href && entry.media === 'application/xhtml+xml')
      if (target && !queued.has(target[0])) { queued.add(target[0]); readingOrder.push({ name: 'itemref', attrs: { idref: target[0], linear: 'no' }, children: [] }) }
    }
    if (!text.trim()) { issues.push({ code: 'image-content', message: `正文没有可提取文字：${item.href}`, blocking: true }); continue }
    const boundaries = [{ offset: 0, title: navigation.get(item.href) ?? item.href }]
    for (const [key, title] of navigation) if (key.startsWith(item.href + '#')) {
      const anchor = key.slice(item.href.length + 1), offset = anchors.get(anchor)
      if (offset === undefined) issues.push({ code: 'missing-anchor', message: `目录锚点不存在：${key}`, blocking: true })
      else boundaries.push({ offset, title })
    }
    boundaries.sort((a, b) => a.offset - b.offset)
    const unique = boundaries.filter((item, index) => index === boundaries.length - 1 || item.offset !== boundaries[index + 1]!.offset)
    for (let i = 0; i < unique.length; i++) {
      const start = unique[i]!.offset, end = unique[i + 1]?.offset ?? text.length
      if (!text.slice(start, end).trim()) continue
      units.push({ id: `u-${String(units.length + 1).padStart(6, '0')}`, title: unique[i]!.title, text: text.slice(start, end), linear: spine.attrs.linear !== 'no',
        locations: locations.filter(loc => loc.char >= start && loc.char < end).map(loc => ({ ...loc, char: loc.char - start })),
        links: links.filter(link => link.at >= start && link.at < end).map(link => ({ ...link, at: link.at - start })) })
    }
  }
  if (!units.length) throw new ReferenceError('epub-empty', 'EPUB 没有可支持的文本正文')
  for (const unit of units) for (const link of unit.links) if (!files.has(link.href) || (link.anchor && !anchorTargets.has(link.href + '#' + link.anchor))) issues.push({ code: 'missing-link', message: '正文链接或脚注资源/锚点缺失', unitId: unit.id, blocking: true })
  return { format: 'epub', encoding: 'utf-8', units, issues }
}
