import { ReferenceError, type ParsedSource, type ParseOptions, type ReadingUnit, type TextEncoding, type SourceIssue } from './types'

function decode(bytes: Uint8Array, encoding: TextEncoding): string {
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text)) throw new Error('binary')
    return text
  } catch { throw new ReferenceError('encoding-invalid', '原文无法按指定编码严格解码，请核对编码或文件格式') }
}

function encodingOf(bytes: Uint8Array, options: ParseOptions): { encoding: TextEncoding; bom: number } {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? { encoding: 'utf-8' as const, bom: 3 }
    : bytes[0] === 0xff && bytes[1] === 0xfe ? { encoding: 'utf-16le' as const, bom: 2 }
      : bytes[0] === 0xfe && bytes[1] === 0xff ? { encoding: 'utf-16be' as const, bom: 2 } : undefined
  if (options.encoding && !['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'big5'].includes(options.encoding)) throw new ReferenceError('encoding-invalid', '不支持该编码')
  if (bom && options.encoding && bom.encoding !== options.encoding) throw new ReferenceError('encoding-conflict', '指定编码与 BOM 不一致')
  if (bom) return bom
  if (options.encoding) return { encoding: options.encoding, bom: 0 }
  try { decode(bytes, 'utf-8'); return { encoding: 'utf-8', bom: 0 } } catch {
    throw new ReferenceError('encoding-required', 'TXT 编码不明确，请指定 utf-16le、utf-16be、gb18030 或 big5；未用乱码继续解析')
  }
}

/** Raw line spans preserve byte locations even for variable-width Chinese encodings. */
function linesOf(bytes: Uint8Array, encoding: TextEncoding, bom: number) {
  const step = encoding.startsWith('utf-16') ? 2 : 1
  const code = (i: number) => step === 1 ? bytes[i] : encoding === 'utf-16le' ? bytes[i]! | bytes[i + 1]! << 8 : bytes[i]! << 8 | bytes[i + 1]!
  const lines: { text: string; byteStart: number; byteEnd: number }[] = []
  let start = bom
  for (let i = bom; i < bytes.length; i += step) {
    if (code(i) !== 10 && code(i) !== 13) continue
    const end = code(i) === 13 && code(i + step) === 10 ? i + step * 2 : i + step
    lines.push({ text: decode(bytes.subarray(start, i), encoding), byteStart: start, byteEnd: end })
    start = end; i = end - step
  }
  if (start < bytes.length) lines.push({ text: decode(bytes.subarray(start), encoding), byteStart: start, byteEnd: bytes.length })
  return lines
}

function chapterNumber(title: string): number | undefined {
  const value = /^第([\d零〇一二两三四五六七八九十百千万]+)[章回节]/.exec(title)?.[1]
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const scale: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0, pending = 0
  for (const char of value) { if (char in digits) pending = digits[char]!; else { total += (pending || 1) * scale[char]!; pending = 0 } }
  return total + pending
}

export function parseTxt(bytes: Uint8Array, options: ParseOptions = {}): ParsedSource {
  const { encoding, bom } = encodingOf(bytes, options)
  decode(bytes.subarray(bom), encoding)
  const lines = linesOf(bytes, encoding, bom)
  const heading = (s: string) => s.length <= 100 && /^(?:第[\d零〇一二两三四五六七八九十百千万]+[章节回卷部集]|序章|序言|楔子|引子|前言|后记|尾声|番外|附录)(?:\s|[：:·、.\-]|$|[^\d零〇一二两三四五六七八九十百千万])/.test(s)
  const starts = lines.flatMap((line, i) => heading(line.text.trim()) ? [i] : [])
  const issues: SourceIssue[] = []
  if (!starts.length) issues.push({ code: 'unconfirmed-boundaries', message: '未发现可靠章界，按连续文本建立阅读单元；请确认选定范围，不代表恢复了章节', blocking: true })
  if (starts[0] !== 0) starts.unshift(0)
  const units: ReadingUnit[] = []
  let previous: number | undefined
  for (let n = 0; n < starts.length; n++) {
    const first = starts[n]!, end = starts[n + 1] ?? lines.length
    const part = lines.slice(first, end)
    if (!part.some(line => line.text.trim())) continue
    const id = `u-${String(units.length + 1).padStart(6, '0')}`
    const title = heading(part[0]!.text.trim()) ? part[0]!.text.trim() : `阅读单元 ${units.length + 1}`
    const current = chapterNumber(title)
    const volumeHeading = /^第[\d零〇一二两三四五六七八九十百千万]+[卷部集]/.test(title)
    if (volumeHeading) previous = undefined
    if (current !== undefined && previous !== undefined && current !== previous + 1) issues.push({ code: 'chapter-sequence', message: '章号出现缺口、重复或重置，请核对目录与卷界', unitId: id, blocking: true })
    if (current !== undefined) previous = current
    if (!volumeHeading && heading(title) && !part.slice(1).some(line => line.text.trim())) issues.push({ code: 'heading-only', message: '只有标题，可能是目录行或缺少正文', unitId: id, blocking: true })
    let char = 0
    const locations = part.map((line, index) => { const loc = { char, line: first + index + 1, byteStart: line.byteStart, byteEnd: line.byteEnd }; char += line.text.length + 1; return loc })
    units.push({ id, title, text: part.map(line => line.text).join('\n'), linear: true, locations, links: [] })
  }
  if (!units.length) throw new ReferenceError('empty-source', '文件没有可读取正文')
  return { format: 'txt', encoding, units, issues }
}
