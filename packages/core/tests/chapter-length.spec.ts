import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { chapterLengthIdentity, checkChapterLength, contractTemplate, parseChapterLength, prepareContract, readChapterLength, writeContract } from '../src/index'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(removeSync))
const body = '### 章节篇幅\n- 目标汉字数: 2000\n- 下限汉字数: 1600\n- 上限汉字数: 2400'
const contract = (content = body, state: '已确认' | '暂定' = '已确认') => contractTemplate({ 阅读体验与情绪承诺: { state, body: content } })

describe('契约章节篇幅', () => {
  it.each([[1599, '偏短', 1], [1600, '范围内', 0], [2000, '范围内', 0], [2400, '范围内', 0], [2401, '偏长', 1]] as const)('边界 %i → %s', (count, result, delta) => {
    expect(checkChapterLength(parseChapterLength(contract()), count)).toMatchObject({ 结果: result, 差额: delta, 实测汉字数: count })
  })

  it.each([
    body.replace('2000', '0'), body.replace('2000', '2.5'), body.replace('2000', '-1'),
    body.replace('2000', '9007199254740992'), body.replace('1600', '2401'),
    body.replace('- 上限汉字数: 2400', ''), `${body}\n- 目标汉字数: 2000`,
    `${body}\n${body}`, body.replace('目标汉字数', '目标字数'),
  ])('错误数值、缺项和重复字段不能猜测', (content) => {
    expect(parseChapterLength(contract(content)).状态).toBe('配置错误')
  })

  it('范围限定在正确子节，注释/代码示例不生效；未配置或未确认不判达标', () => {
    expect(parseChapterLength(contract(`\`\`\`md\n${body}\n\`\`\`\n<!-- ${body} -->`)).状态).toBe('未配置')
    expect(chapterLengthIdentity(parseChapterLength(contract('阅读体验正文')))).toBeUndefined()
    expect(checkChapterLength(parseChapterLength(contract(body, '暂定')), 5000).结果).toBe('未确认')
    expect(parseChapterLength(contract().replace('阅读体验与情绪承诺', '其他分部')).状态).toBe('配置错误')
    expect(parseChapterLength(contract(`${body}\n### 情绪温度\n温暖。`)).状态).toBe('已配置')
  })

  it('原契约工具准备保留其他分部；非法区间不落盘；读取错误显式返回', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-length-'))
    roots.push(root)
    writeContract(root, { 阅读体验与情绪承诺: { state: '已确认', body }, 主角原则与关系边界: { state: '已确认', body: '保留主角原则。' } }, { 书id: 'book' })
    const target = path.join(root, '作品契约/契约.md')
    const before = fs.readFileSync(target, 'utf8')
    expect(prepareContract(root, { 核心看点与差异化: { state: '已确认', body: '新的看点。' } }).content).toContain(body)
    expect(() => prepareContract(root, { 阅读体验与情绪承诺: { state: '已确认', body: body.replace('1600', '2600') } })).toThrow('下限')
    expect(fs.readFileSync(target, 'utf8')).toBe(before)
    expect(readChapterLength(root)).toMatchObject({ 状态: '已配置', 范围: { 目标汉字数: 2000 } })
    fs.unlinkSync(target)
    expect(readChapterLength(root).状态).toBe('未配置')
    fs.mkdirSync(target)
    expect(readChapterLength(root).状态).toBe('配置错误')
  })
})
