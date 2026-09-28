/** Shared, read-only structural evidence for design advice and progress rendering. */
export interface DesignContentPart {
  readonly 名称: string
  readonly 状态?: string
  readonly 待补: readonly string[]
  readonly 有内容: boolean
}

function withoutComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, comment => comment.replace(/[^\r\n]/g, ''))
}

/** Presence only, not a judgement of literary quality. */
export function hasDesignContent(text: string): boolean {
  return withoutComments(text).split(/\r?\n/).some(line => {
    const value = line.trim()
    if (!value || /^#{1,6}\s|^待补[:：]|^[-*_]{3,}$|^```/.test(value)) return false
    if (/^(?:[-*]\s*)?[〔（(](?:留白|暂定|已确认|待补)[〕）)]$/.test(value)) return false
    const labeled = /^[-*]\s+(.+?)\s*[〔(].+?[〕)]\s*$/.exec(value)
    return labeled === null || /[：:]\s*\S/.test(labeled[1]!)
  })
}

export function parseDesignContent(text: string): readonly DesignContentPart[] {
  const lines = withoutComments(text).split(/\r?\n/)
  const parts: Array<{ 名称: string; 状态?: string; line: number; level: number }> = []
  const headings: Array<{ line: number; level: number }> = []
  for (const [line, text] of lines.entries()) {
    const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(text)
    const list = /^\s*-\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/.exec(text)
    const volumeRow = /^\s*-\s+(卷(?:\d+|[一二三四五六七八九十两]+)(?:[·\s：:（].*)?)\s*$/.exec(text)
    if (heading !== null) {
      const labeled = /^(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/.exec(heading[2]!)
      const level = heading[1]!.length
      headings.push({ line, level })
      parts.push({ 名称: (labeled?.[1] ?? heading[2]!).trim(), ...(labeled ? { 状态: labeled[2]!.trim() } : {}), line, level })
    } else if (list !== null) parts.push({ 名称: list[1]!.trim(), 状态: list[2]!.trim(), line, level: Infinity })
    else if (volumeRow !== null) parts.push({ 名称: volumeRow[1]!.trim(), line, level: Infinity })
  }
  return parts.map((part, index) => {
    const next = parts[index + 1]?.line ?? lines.length
    const headingEnd = headings.find(item => item.line > part.line && item.level <= part.level)?.line ?? lines.length
    const end = part.level === Infinity ? Math.min(next, headingEnd) : headingEnd
    const body = lines.slice(part.line + 1, end).join('\n')
    const 待补 = lines.slice(part.line + 1, Math.min(next, headingEnd)).filter(line => /^\s*待补[:：]/.test(line)).map(line => line.trim().replace(/^待补[:：]\s*/, ''))
    const volumeDescription = part.level === Infinity && /^卷(?:\d+|[一二三四五六七八九十两]+)(?=[·\s：:（]|$)/.test(part.名称)
      ? part.名称.replace(/^卷(?:\d+|[一二三四五六七八九十两]+)/, '').replace(/^[·\s：:]+/, '') : ''
    return { 名称: part.名称, ...(part.状态 === undefined ? {} : { 状态: part.状态 }), 待补,
      有内容: /[：:]\s*\S/.test(part.名称) || hasDesignContent(volumeDescription) || hasDesignContent(body) }
  })
}
