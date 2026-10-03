import type { Extraction, ModelInput, ModelRunner, ReferenceRoute, SourceMetadata } from '../../src/reference'
import { deflateRawSync } from 'node:zlib'

export const referenceMetadata: SourceMetadata = { title: '测试航图', author: '合成夹具', edition: 'v1', acquiredFrom: '本测试自行构造', allowedUses: '本地测试', basis: '自行编写', basisKind: 'user-declaration' }
export const referenceText = '第一章 航图\n船主需要航图。测绘员想渡海，他们约定交换。\n第二章 潮水\n潮水封住港口，两人只好等待。'
export function extractionFor(input: ModelInput): Extraction {
  const chunk = JSON.parse(input.text) as { text: string; start: number }
  const offset = chunk.text.search(/\S/), quote = chunk.text.slice(offset, offset + Math.min(12, chunk.text.length - offset))
  return { evidence: [{ start: chunk.start + offset, end: chunk.start + offset + quote.length, quote }],
    observations: [{ kind: 'event', statement: '双方存在不同的需求。', actor: '船主与测绘员', eventOrder: '先各有需求，再协商。', disclosureOrder: '随当前片段披露。', characterKnowledge: '双方知道彼此提出的要求，其他未知。', readerKnowledge: '读者知道当前谈判，其他未知。', evidence: [0] }],
    hypotheses: [{ statement: '互相依赖可能维持合作，仅是局部解释。', evidence: [0] }], openQuestions: ['港口何时开放未知。'],
    mechanisms: [{ title: '互相需要的合作', tags: ['合作'], observation: '当前人物各有所需。', explanation: '独立诉求可能延长合作。', expectation: '合作是否能持续。', choicesAndConsequences: '愿意交换条件，结果仍待后文。', conditions: '彼此不能轻易替代。', failures: '一方无需另一方时失效。', questions: '你的主角分别缺少什么？', noCopy: '不复制具体人物组合、航图事件链和措辞。', unknowns: '只见局部，其他解释未知。', evidence: [0] }] }
}
export class FakeReferenceRunner implements ModelRunner {
  calls = 0
  current: ReferenceRoute = { provider: 'fake', model: 'fixture', service: 'local-fixture' }
  handler?: (input: ModelInput, signal: AbortSignal) => Promise<string>
  async route() { return { ...this.current } }
  async maxInputChars() { return 600 }
  async run(input: ModelInput, signal: AbortSignal) { this.calls++; return this.handler ? this.handler(input, signal) : JSON.stringify(extractionFor(input)) }
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1 }
  return (crc ^ 0xffffffff) >>> 0
}
/** Minimal ZIP writer for synthetic text fixtures, not copied EPUB content. */
export function referenceZip(files: [string, string | Buffer][]): Buffer {
  const local: Buffer[] = [], directory: Buffer[] = []; let offset = 0
  for (const [name, raw] of files) {
    const filename = Buffer.from(name), bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw), compressed = deflateRawSync(bytes), crc = crc32(bytes)
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42)
    local.push(header, filename, compressed); directory.push(central, filename); offset += header.length + filename.length + compressed.length
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, central, end])
}
export function epubFiles(version = '3.0'): [string, string][] {
  return [['mimetype', 'application/epub+zip'], ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OPS/book.opf', `<package version="${version}"><manifest><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="a"/><itemref idref="b" linear="no"/></spine></package>`],
    ['OPS/b.xhtml', '<html><body><aside id="note">补充说明。</aside></body></html>'], ['OPS/a.xhtml', '<html><body><h1 id="first">第一节</h1><p>自行编写的航图故事。<a href="b.xhtml#note">注</a></p><h2 id="second">第二节</h2><p>他们开始谈判。</p></body></html>'],
    ['OPS/nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="a.xhtml#first">航图</a><a href="a.xhtml#second">谈判</a></nav></body></html>']]
}
