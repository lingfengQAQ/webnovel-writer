import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  planTimelineBody, preparePlanTimeline, prepareVolumeOutline,
  volumeOutlineGaps, writePlanTimeline, writeVolumeOutline,
} from '../src/design/volume'
import { parseDocument, serializeDocument, unwrap } from '../src/repo/frontmatter'
import { removeSync } from '../src/repo/remove'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-volume-contract-')) })
afterEach(() => { removeSync(root) })

function put(rel: string, text: string): void {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
}

const outlineBody = [
  '# 卷纲', '',
  '## 叙事结构 〔已确认〕', '', '主角先失去旧有依靠，再独自找回线索。', '',
  '## 弧线 〔暂定〕', '', '从依赖他人到接受自己的选择。', '',
  '## 线索推进 〔留白〕', '',
  '## 卷末兑现 〔暂定〕', '', '当年留下的字迹在门后重现。',
].join('\n')

const timelineBody = planTimelineBody({
  windowEvents: [{ 名称: '重返旧宅', 先后: '离开之后', 并行: '守门人换岗', 间隔: '三日后' }],
  anchors: [{ 名称: '卷末查明字迹的主人' }],
})

describe.each([
  { name: '卷纲', prepare: prepareVolumeOutline, write: writeVolumeOutline, body: outlineBody, generator: '卷纲确认' },
  { name: '计划时间线', prepare: preparePlanTimeline, write: writePlanTimeline, body: timelineBody, generator: '计划时间线确认' },
])('$name 更新合同', ({ name, prepare, write, body, generator }) => {
  const rel = `大纲/卷规划/卷02/${name}.md`

  it('首次准备使用领域版本协议，正文与标题保真且零写盘', () => {
    const op = prepare(root, 2, body)
    expect(op.relPath).toBe(rel)
    expect(op.result).toEqual({ relPath: rel, 版本: 1, 首次写入: true })
    expect(unwrap(parseDocument(op.content), name)).toEqual({
      fields: { 版本: 1, 父版本: null, 生成模块: generator, 来源快照: null, 状态: '已确认' },
      body: serializeDocument({}, body),
    })
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('正文变化保留作者元数据与扩展，版本只升一次且同步写入复用准备内容', () => {
    const preserved = {
      身份: { 卷: 2, 设计项: name },
      来源: '作者对谈',
      来源引用: ['大纲/故事骨架.md@2'],
      来源快照: { 契约: '作品契约/契约.md@1', 注记: ['保留原证据'] },
      作者裁决: { 人: '作者', 意见: '保留悬念' },
      自定义: { 标记: ['甲', '乙'], 空值: null, 空文本: '', 空列表: [] },
    }
    const before = serializeDocument({
      ...preserved, 版本: 3, 父版本: 2, 状态: '已确认', 生成模块: '作者手改',
    }, '# 原正文')
    put(rel, before)
    const otherRel = `大纲/卷规划/卷01/${name}.md`
    put(otherRel, '# 另一卷不变\n')

    const op = prepare(root, 2, body)
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(before)
    expect(op.result).toEqual({ relPath: rel, 版本: 4, 首次写入: false })
    expect(unwrap(parseDocument(op.content), name)).toEqual({
      fields: { ...preserved, 版本: 4, 父版本: 3, 状态: '已确认', 生成模块: generator },
      body: serializeDocument({}, body),
    })

    expect(write(root, 2, body)).toBeUndefined()
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(op.content)
    expect(fs.readFileSync(path.join(root, otherRel), 'utf8')).toBe('# 另一卷不变\n')
    const replay = prepare(root, 2, `${body.replace(/\r?\n/g, '\r\n')}\r\n\r\n`)
    expect(replay.content).toBe(op.content)
    expect(replay.result).toEqual({ relPath: rel, 版本: 4, 首次写入: false })
    write(root, 2, body)
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(op.content)
  })

  it('已确认的同正文重试保留旧文件每个字节、扩展与生成模块', () => {
    const before = [
      '---', '# 作者保留的注释', '自定义: [保留]', '状态: 已确认',
      '生成模块: 作者手改', '版本: 7', '父版本: 6', '---',
      body.replace(/\n+$/, ''), '', '',
    ].join('\n').replace(/\n/g, '\r\n')
    put(rel, before)
    const op = prepare(root, 2, `${body}\n\n`)
    expect(op.content).toBe(before)
    expect(op.result).toEqual({ relPath: rel, 版本: 7, 首次写入: false })
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(before)
    write(root, 2, body)
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(before)
  })

  it.each([{}, { 来源快照: null }])('已有来源快照省略或空值不被正文更新改写 (%#)', (snapshot) => {
    const fields = { ...snapshot, 版本: 2, 父版本: 1, 状态: '已确认', 生成模块: '作者手改' }
    put(rel, serializeDocument(fields, '# 原正文'))
    const op = prepare(root, 2, body)
    expect(unwrap(parseDocument(op.content), name).fields).toEqual({
      ...fields, 版本: 3, 父版本: 2, 生成模块: generator,
    })
  })

  it('正文里的 YAML、同名字段和围栏不成为元数据补丁', () => {
    put(rel, serializeDocument({ 版本: 2, 父版本: 1, 状态: '已确认', 自定义: '旧字段' }, body))
    const prose = [
      '---', '版本: 999', '状态: 留白', '自定义: 正文而非补丁', '---', '',
      body.replace(/\n+$/, ''), '',
      '> 来源: 引文而非元数据', '', '```yaml', '来源快照: 文中示例', '```', '',
      '时点: 当晚的钟声只是故事里的原句。',
    ].join('\n')
    const parsed = unwrap(parseDocument(prepare(root, 2, prose).content), name)
    expect(parsed.fields).toMatchObject({ 版本: 3, 父版本: 2, 状态: '已确认', 自定义: '旧字段', 生成模块: generator })
    expect(parsed.body).toBe(`${prose}\n`)
  })

  it('同正文由暂定确认时仍维护状态与版本，不把确认误判为无改动', () => {
    put(rel, serializeDocument({ 版本: 2, 父版本: 1, 状态: '暂定', 自定义: null }, body))
    const op = prepare(root, 2, body)
    expect(unwrap(parseDocument(op.content), name).fields).toMatchObject({
      版本: 3, 父版本: 2, 状态: '已确认', 自定义: null, 生成模块: generator,
    })
    expect(op.result.首次写入).toBe(false)
  })

  it.each([
    '---\n版本: [未闭合\n---\n原正文\n',
    '---\n版本: 3\n原正文\n',
    '---\n- 不是字段映射\n---\n原正文\n',
    '---\n版本: 3\n版本: 4\n---\n原正文\n',
  ])('损坏的已有元数据拒绝准备，不改写原文件 (%#)', (before) => {
    put(rel, before)
    expect(() => prepare(root, 2, body)).toThrow(/解析失败/)
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toBe(before)
  })

  it('目标为目录时读取失败，不当作首次创建', () => {
    const target = path.join(root, rel)
    fs.mkdirSync(target, { recursive: true })
    expect(() => prepare(root, 2, body)).toThrow()
    expect(fs.statSync(target).isDirectory()).toBe(true)
    expect(fs.readdirSync(target)).toEqual([])
  })
})

it('卷纲四段和计划时间线渐进标题不因版本化而改变', () => {
  expect(volumeOutlineGaps(outlineBody)).toEqual([])
  expect(timelineBody).toBe([
    '# 计划时间线', '', '## 窗口覆盖', '',
    '- 重返旧宅（先后:离开之后；并行:守门人换岗；间隔:三日后）', '',
    '## 窗口外锚点', '', '- 卷末查明字迹的主人', '',
  ].join('\n'))
})
