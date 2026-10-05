import { describe, expect, it } from 'vitest'
import { countProseText, parseDocument, serializeDocument } from '../src/index'

describe('正文确定性统计', () => {
  it('按码点计字符，区分汉字、标点、空白、英文、数字和 emoji，排除候选事实及元数据', () => {
    const document = parseDocument(serializeDocument({ 说明: '元数据不计数' }, '# 章\r\n\r\n甲𠮷，A1😀。\r\n\r\n## 草稿候选事实\r\n- 事实：不计这些文字。'))
    expect(document.ok).toBe(true)
    if (!document.ok) throw new Error('fixture parse failed')
    expect(countProseText(document.data.body)).toEqual({ 字符数: 12, 非空白字符数: 9, 汉字数: 3 })
  })

  it('换行与首尾空白不影响结果；候选标题须整行匹配，空正文不由候选填充', () => {
    expect(countProseText(' \r\n甲乙\r\n ')).toEqual(countProseText('甲乙'))
    expect(countProseText('## 草稿候选事实\n- 事实：只有候选')).toEqual({ 字符数: 0, 非空白字符数: 0, 汉字数: 0 })
    expect(countProseText('## 草稿候选事实补充\n甲')).toEqual({ 字符数: 13, 非空白字符数: 11, 汉字数: 9 })
  })
})
