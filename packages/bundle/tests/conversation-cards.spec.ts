import React, { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NovelToolCard } from '../src/client/tool-result-card'
import { resultFiles } from '../src/client/result-files'
import { createQuoteInputs, insertQuoteReference, quoteReference, quoteSource } from '../src/client/quote-reference'
import type { StudyDocument } from '../src/study/types'
import { documentQuote } from '../src/client/quote'
import { savedSummary } from '../src/study/web'
import { callStudy } from '../src/client/api'
import type { ClientHost } from '../src/client/host'
import { saveNotice, SaveNotice } from '../src/client/save-notice'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'

vi.mock('../src/client/api', () => ({ callStudy: vi.fn() }))

const document: StudyDocument = { ref: { space: 'book:fog', path: '草稿区/草稿/卷01-来信/稿1.md' }, owner: '雾港', name: '稿1.md', absolutePath: 'C:/作品 空间/雾港/草稿区/草稿/卷01-来信/稿1.md', body: '来信。\n重复。\n重复。', hash: 'a'.repeat(64), version: 1 }
function props(value: unknown, args = '{ "bookId": "fog" }'): ToolCallViewProps {
  return { toolName: 'novel_get_book_progress', sessionId: 'session-a', phase: 'result', openFile: vi.fn(), inspect: vi.fn(),
    block: { content: [{ type: 'text', text: JSON.stringify(value) }], call: { argsRaw: args }, isError: false },
    useDisclosure: () => { const [expanded, setExpanded] = useState(false); return { expanded, toggle: () => setExpanded(value => !value) } },
  } as unknown as ToolCallViewProps
}

describe('原生结果卡与引用', () => {
  it('只适配声明过的保存通知，旧消息、索引故障和其他触发源交回宿主', async () => {
    const Native = vi.fn(() => React.createElement('div', null, 'native trigger'))
    for (const source of [{ kind: 'plugin:webnovel' }, { kind: 'goal', form: 'notice', summary: '目标完成' }, { kind: 'plugin:webnovel', form: 'notice' }]) {
      expect(saveNotice(source)).toBeUndefined()
      let card!: ReturnType<typeof create>
      await act(async () => { card = create(React.createElement(SaveNotice, { props: { node: { data: { source, content: [] } } } as unknown as ChatNodeViewProps<'turn-trigger'>, Native, host: {} as ClientHost })) })
      expect(card.root.findByType('div').children).toEqual(['native trigger'])
      await act(async () => card.unmount())
    }
    expect(Native).toHaveBeenCalledTimes(3)
  })

  it('保存通知收起时仅显示作者摘要，展开仍保留超过宿主预览上限的完整正文', async () => {
    const raw = '保存编号：test-operation\n文件哈希：' + 'a'.repeat(64) + '\n本次差异：' + '完整原文。'.repeat(5000)
    const Native = vi.fn(() => null), source = { kind: 'plugin:webnovel', form: 'notice', summary: '雾港 · 稿2.md 已保存；请主控核对本次修改' }
    let card!: ReturnType<typeof create>
    await act(async () => { card = create(React.createElement(SaveNotice, { props: { node: { data: { source, content: [{ type: 'text', text: raw }] } } } as unknown as ChatNodeViewProps<'turn-trigger'>, Native, host: {} as ClientHost })) })
    try {
      expect(card.root.findAllByType('pre')).toHaveLength(0)
      await act(async () => card.root.findByType('button').props.onClick())
      expect(card.root.findByType('pre').children.join('')).toBe(raw)
      expect(Native).not.toHaveBeenCalled()
    } finally { await act(async () => card.unmount()) }
  })
  it('原文视图完整保留参数和结果，切换不改变宿主状态或执行工具', async () => {
    const original = { ok: true, 完成: true, 审核通过: false, 待处置数: 2, message: '有问题需要处理。\n第二行保留。' }
    const input = props(original, '{\n "bookId": "fog", "额外": "原始字节"\n}')
    let card!: ReturnType<typeof create>
    await act(async () => { card = create(React.createElement(NovelToolCard, input)) })
    try {
      expect(card.root.findByType('section').props['data-state']).toBe('attention')
      expect(card.root.findAllByType('pre')).toHaveLength(0)
      await act(async () => { card.root.findByProps({ className: 'nw-result-heading' }).props.onClick() })
      expect(card.root.findByProps({ className: 'nw-result-detail' }).children.join('')).toBe(original.message)
      await act(async () => { card.root.findAllByProps({ role: 'tab' }).find(tab => tab.children.includes('原文'))!.props.onClick() })
      expect(card.root.findAllByType('pre').map(node => node.children.join(''))).toEqual(['{\n "bookId": "fog", "额外": "原始字节"\n}', JSON.stringify(original)])
      expect(input.openFile).not.toHaveBeenCalled()
      expect(input.inspect).not.toHaveBeenCalled()
    } finally { await act(async () => card.unmount()) }
  })

  it('只从结果中的文件字段定位，不把正文里的路径、跨目录或协议当成可打开文件', () => {
    const files = resultFiles(props({ ok: true, relPath: '草稿区/稿2.md', body: { path: '别的正文.md' }, files: ['../越界.md', 'https://example.com/a.md', 'C:/已导出/成品.txt'], hits: [{ path: '定稿/卷01/0001-来信.md' }] }))
    expect(files.map(file => file.path)).toEqual(['草稿区/稿2.md', 'C:/已导出/成品.txt', '定稿/卷01/0001-来信.md'])
    expect(files[0]?.bookId).toBe('fog')
    expect(files[1]?.bookId).toBeUndefined()
    const mixed = props({ ok: true, path: 'a.md' })
    if (mixed.phase === 'result') mixed.block.content.push({ type: 'text', text: 'another result' })
    expect(resultFiles(mixed)).toEqual([])
    expect(resultFiles(props({ ok: true, files: [{ path: '大纲/正确.md', description: '请参照另一个文件.md' }] })).map(file => file.path)).toEqual(['大纲/正确.md'])
    expect(resultFiles(props({ ok: true, reportPath: 'C:/书房/参考小说/报告.md' })).map(file => file.path)).toEqual(['C:/书房/参考小说/报告.md'])
    expect(resultFiles(props({ ok: true, 内容问题: [{ 路径: '作品契约/契约.md', 问题: '缺少分部' }, { 路径: '作品契约/契约.md', 问题: '下一分部缺失' }] })).map(file => file.path)).toEqual(['作品契约/契约.md'])
  })

  it.each(['switch', 'unmount', 'next-click'] as const)('文件定位返回前 %s，过期请求不打开到当前侧栏', async action => {
    let snapshot = { byId: { 'session-a': { retainedBy: { mainView: 1 } } } }
    let mounted = 'session-a'
    const host = { sessions: { list: { getSnapshot: () => snapshot } }, sidebarRight: { mounted: { getSnapshot: () => mounted } } } as unknown as ClientHost
    const input = { ...props({ ok: true, relPath: '草稿区/稿1.md' }), host }
    let resolve!: (value: StudyDocument) => void
    vi.mocked(callStudy).mockReset().mockImplementationOnce(() => new Promise(done => { resolve = done as typeof resolve })).mockResolvedValue(document)
    let card!: ReturnType<typeof create>, pending!: Promise<void>
    await act(async () => { card = create(React.createElement(NovelToolCard, input)) })
    await act(async () => { card.root.findByProps({ className: 'nw-result-heading' }).props.onClick() })
    await act(async () => { card.root.findAllByType('button').find(button => button.children.includes('稿1.md'))!.props.onClick() })
    if (action === 'switch') { snapshot = { byId: { 'session-a': { retainedBy: { mainView: 0 } } } }; mounted = 'session-b' }
    if (action === 'unmount') await act(async () => card.unmount())
    if (action === 'next-click') await act(async () => { pending = card.root.findAllByType('button').find(button => button.children.includes('稿1.md'))!.props.onClick(); await pending })
    await act(async () => { resolve(document) })
    expect(input.openFile).toHaveBeenCalledTimes(action === 'next-click' ? 1 : 0)
    if (action !== 'unmount') await act(async () => card.unmount())
  })

  it('作者记忆按工作区相对输出定位，不重复拼接共享根书房', async () => {
    const input = props({ ok: true, scope: 'author', relPath: '书房/作者记忆/节奏.md' }, '{"scope":"author"}')
    vi.mocked(callStudy).mockReset().mockResolvedValue(document)
    let card!: ReturnType<typeof create>
    await act(async () => { card = create(React.createElement(NovelToolCard, input)) })
    try {
      await act(async () => card.root.findByProps({ className: 'nw-result-heading' }).props.onClick())
      await act(async () => card.root.findAllByType('button').find(button => button.children.includes('节奏.md'))!.props.onClick())
      expect(callStudy).toHaveBeenCalledWith('session-a', 'read', { ref: { space: 'shared', path: '作者记忆/节奏.md' } }, expect.any(AbortSignal))
      expect(input.openFile).toHaveBeenCalledWith(document.absolutePath)
    } finally { await act(async () => card.unmount()) }
  })

  it('引用快照保留完整未保存原文与位置；复制无编码路径，发送与恢复无需旁路存储', async () => {
    const text = document.body + '\n新写的一段。'
    const reference = quoteReference('session-a', document, text, '重复。', 3)
    expect(reference.label).toContain('未保存')
    expect(reference.label).not.toContain('%')
    expect(reference.clipboardText).toBe(documentQuote(document, text, '重复。', 3))
    const restored = JSON.parse(JSON.stringify(reference))
    const source = quoteSource(vi.fn())
    const serialized = await source.codec!.serialize(restored.ref, new AbortController().signal)
    expect(serialized).toContain('未保存编辑，磁盘哈希仅标识编辑基线')
    expect(serialized).toContain('正文第 3 行起')
    expect(serialized).toContain(document.hash)
    expect(serialized).toContain('> 重复。')
    expect(source.codec!.clipboardText(restored.ref)).not.toContain('%20')
    const aborted = new AbortController(); aborted.abort()
    await expect(source.codec!.serialize(restored.ref, aborted.signal)).rejects.toThrow()
  })

  it('追加引用使用当前末尾和版本，拒绝插入时不覆盖已有标签或文本', () => {
    const insertReference = vi.fn(() => false)
    const input = { insertReference, state: { getSnapshot: () => ({ draft: '已有标签和问题', draftRev: 7, phase: 'plain', occurrences: [] }) } } as unknown as Pick<SessionInput, 'state' | 'insertReference'>
    const reference = quoteReference('session-a', document, document.body, '来信。')
    expect(insertQuoteReference(input, { captureInsertion: () => ({ start: 3, end: 7, draftRev: 7 }) }, reference)).toBe(false)
    expect(insertReference).toHaveBeenCalledExactlyOnceWith(reference, { start: 7, end: 7, draftRev: 7 })
    const open = vi.fn(), source = quoteSource(open)
    expect(source.openReference!({ sessionId: 'other' } as never, reference)).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(source.openReference!({ sessionId: 'session-a' } as never, reference)).toBe(true)
    expect(open).toHaveBeenCalledWith('session-a', document.absolutePath)
  })

  it.each(['plain', 'claimed'])('%s 保留宿主原生引用块及文件标签，不从展开文本重算坐标', phase => {
    const insertReference = vi.fn(() => true)
    const input = { insertReference, state: { getSnapshot: () => ({ draft: '展开后的长引用正文'.repeat(20), draftRev: 19, phase }) } } as unknown as Pick<SessionInput, 'state' | 'insertReference'>
    expect(insertQuoteReference(input, { captureInsertion: () => ({ start: 2, end: 9, draftRev: 20 }) }, quoteReference('session-a', document, document.body, '来信。'))).toBe(true)
    expect(insertReference.mock.calls[0]?.[1]).toEqual({ start: 9, end: 9, draftRev: 20 })
  })

  it.each(['submitting', 'sending'])('%s 锁定时不发出引用插入', phase => {
    const insertReference = vi.fn()
    const input = { insertReference, state: { getSnapshot: () => ({ phase }) } } as unknown as Pick<SessionInput, 'state' | 'insertReference'>
    expect(insertQuoteReference(input, { captureInsertion: () => { throw new Error('must not capture while sending') } }, quoteReference('session-a', document, document.body, '来信。'))).toBe(false)
    expect(insertReference).not.toHaveBeenCalled()
  })

  it('命令之前的插入点拒绝引用，保持原命令不降级', () => {
    const input = { insertReference: vi.fn(), state: { getSnapshot: () => ({ phase: 'claimed' }) } } as unknown as Pick<SessionInput, 'state' | 'insertReference'>
    expect(insertQuoteReference(input, { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) }, quoteReference('session-a', document, document.body, '来信。'))).toBe(false)
    expect(input.insertReference).not.toHaveBeenCalled()
  })

  it('输入动作按会话绑定，旧挂载卸载不清掉新挂载的动作', () => {
    const inputs = createQuoteInputs(), capture = () => ({ start: 0, end: 1, draftRev: 3 })
    const offOld = inputs.bind('session-a', { captureInsertion: capture })
    const offNew = inputs.bind('session-a', { captureInsertion: capture })
    offOld()
    const input = { insertReference: vi.fn(() => true), state: { getSnapshot: () => ({ phase: 'plain' }) } } as unknown as Pick<SessionInput, 'state' | 'insertReference'>
    const quote = quoteReference('session-a', document, document.body, '来信。')
    expect(inputs.insert('other', input, quote)).toBe(false)
    expect(inputs.insert('session-a', input, quote)).toBe(true)
    offNew(); expect(inputs.insert('session-a', input, quote)).toBe(false)
  })

  it('通知摘要区分保存与提交，长文件名不吞掉主控待核对含义', () => {
    expect(savedSummary({ document, commit: 'saved' })).toBe('雾港 · 稿1.md 已保存；请主控核对本次修改')
    expect(savedSummary({ document, commit: 'failed' })).toContain('提交待重试')
    const long = savedSummary({ document: { ...document, owner: '书'.repeat(300), name: '文'.repeat(300) }, commit: 'failed' })
    expect(Array.from(long).length).toBeLessThanOrEqual(120)
    expect(long).toContain('请主控核对本次修改')
    expect(long).not.toContain(document.hash)
  })
})
