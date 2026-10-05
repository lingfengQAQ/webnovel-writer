import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { EDITOR_REQUEST_SOURCE } from '../src/message-sources'
import {
  EDITOR_DELIVERED_MESSAGE, EDITOR_DUPLICATE_REASON, EDITOR_ENTRY_LIMIT, EDITOR_PENDING_LIMIT, EDITOR_TTL_MS, EDITOR_UNKNOWN_REASON,
  EditorRequestHub, acceptEditorSuggestion, requestMessage,
  type EditorIntent, type EditorReply, type EditorRequestSnapshot,
} from '../src/study/editor-requests'
import { editorAcceptancePlan } from './fixtures/study-browser-host.mjs'

const event = (type: string, data: object = {}) => ({ type, data }) as SessionEvent

function snapshot(overrides: Partial<EditorRequestSnapshot> = {}): EditorRequestSnapshot {
  const selection = { text: '林舟在渡口停下。', line: 12, before: '潮声很近。', after: '信封还在。', ...overrides.selection }
  return {
    requestId: 'polish1',
    intent: 'polish',
    dirty: true,
    hash: '3f9a2c1b2d3e4f5061728394',
    ref: { space: 'book:acceptance-a', path: '草稿区/草稿/卷01-来信/稿2.md' },
    document: {
      owner: '林岚', path: '草稿区/草稿/卷01-来信/稿2.md', space: 'book:acceptance-a', version: 2,
      absolutePath: 'D:/books/林岚/草稿区/草稿/卷01-来信/稿2.md',
    },
    selection,
    ...overrides,
    selection,
  }
}

function agentWith(events: SessionEvent[], status = 'idle') {
  return {
    status,
    session: {
      get seq() { return events.length },
      eventAt: (seq: number) => events[seq],
    },
  }
}

function storedSnapshot(hub: EditorRequestHub, agent: object, requestId: string): EditorRequestSnapshot | undefined {
  const entries = (hub as unknown as { entries: WeakMap<object, Map<string, { snapshot: EditorRequestSnapshot }>> }).entries
  return entries.get(agent)?.get(requestId)?.snapshot
}

function editorMessage(request: EditorRequestSnapshot) {
  return { role: 'user', content: [{ type: 'text', text: requestMessage(request) }] }
}

describe('编辑器请求 Hub', () => {
  it('打开、回复、重复回复和未知编号', () => {
    const hub = new EditorRequestHub()
    const agent = agentWith([])
    hub.open(agent, snapshot())
    expect(hub.view(agent, ['polish1']).items[0]).toEqual({ requestId: 'polish1', state: 'queued' })
    expect(hub.reply(agent, 'polish1', { kind: 'replace', text: '林舟在渡口站定。' })).toEqual({ ok: true })
    expect(hub.view(agent, ['polish1']).items[0]).toMatchObject({ state: 'replied', reply: { kind: 'replace', text: '林舟在渡口站定。' } })
    expect(hub.reply(agent, 'polish1', { kind: 'replace', text: '另一版。' }).ok).toBe(false)
    expect(hub.reply(agent, 'missing', { kind: 'none' })).toMatchObject({ ok: false, reason: EDITOR_UNKNOWN_REASON })
    expect(hub.view(agent, ['polish1']).items[0]?.reply).toMatchObject({ text: '林舟在渡口站定。' })
  })

  it('编辑器来源的用户消息进入处理中，回合结束无回复则未答复，取消后不能再回复', () => {
    const events: SessionEvent[] = []
    const hub = new EditorRequestHub()
    const agent = agentWith(events, 'running')
    hub.open(agent, snapshot())
    hub.open(agent, snapshot({ requestId: 'wait001' }))
    expect(hub.view(agent, ['polish1', 'wait001'])).toMatchObject({
      busy: true,
      items: [{ requestId: 'polish1', state: 'queued' }, { requestId: 'wait001', state: 'queued' }],
    })
    events.push(event('turn/start'), event('user/message', { source: { kind: EDITOR_REQUEST_SOURCE, requestId: 'polish1' }, content: [], role: 'user', id: 'm1' }))
    expect(hub.view(agent, ['polish1', 'wait001']).items.map(item => item.state)).toEqual(['working', 'queued'])
    events.push(event('turn/end'))
    expect(hub.view(agent, ['polish1', 'wait001']).items.map(item => item.state)).toEqual(['unanswered', 'queued'])
    expect(hub.reply(agent, 'polish1', { kind: 'replace', text: '来晚了。' })).toMatchObject({ ok: false })
    events.push(event('turn/start'), event('user/message', { source: { kind: EDITOR_REQUEST_SOURCE, requestId: 'wait001' }, content: [], role: 'user', id: 'm2' }))
    expect(hub.cancel(agent, ['wait001'])).toEqual([{ requestId: 'wait001', state: 'cancelled' }])
    expect(hub.reply(agent, 'wait001', { kind: 'replace', text: '不该留下。' })).toMatchObject({ ok: false, reason: expect.stringContaining('作者已取消') })
    events.push(event('turn/end'))
    expect(hub.view(agent, ['wait001']).items[0]?.state).toBe('cancelled')
  })

  it('已回复的请求在回合结束时保持已回复', () => {
    const events: SessionEvent[] = [event('user/message', { source: { kind: EDITOR_REQUEST_SOURCE, requestId: 'polish1' }, content: [], role: 'user', id: 'm1' })]
    const hub = new EditorRequestHub()
    const agent = agentWith(events)
    hub.open(agent, snapshot())
    expect(hub.reply(agent, 'polish1', { kind: 'replace', text: '改过。' }).ok).toBe(true)
    events.push(event('turn/end'))
    expect(hub.view(agent, ['polish1']).items[0]?.state).toBe('replied')
  })

  it('超过三十分钟的终态被清除，未决上限与保留上限按会话计算', () => {
    let now = 1_000
    const hub = new EditorRequestHub(() => now)
    const agent = agentWith([])
    hub.open(agent, snapshot())
    hub.reply(agent, 'polish1', { kind: 'replace', text: '改过。' })
    now += EDITOR_TTL_MS - 1
    expect(hub.view(agent, ['polish1']).items[0]?.state).toBe('replied')
    now += 1
    expect(hub.view(agent, ['polish1']).items[0]?.state).toBe('unknown')

    const pending = agentWith([])
    for (let index = 0; index < EDITOR_PENDING_LIMIT; index++) hub.open(pending, snapshot({ requestId: `p${String(index).padStart(5, '0')}` }))
    expect(() => hub.open(pending, snapshot({ requestId: 'pextra' }))).toThrow(/未决请求已达 8/)

    const stored = agentWith([])
    for (let index = 0; index < EDITOR_ENTRY_LIMIT; index++) {
      const requestId = `k${String(index).padStart(5, '0')}`
      hub.open(stored, snapshot({ requestId }))
      hub.reply(stored, requestId, { kind: 'none', note: '收好。' })
    }
    hub.open(stored, snapshot({ requestId: 'kfresh' }))
    expect(hub.view(stored, ['k00000', 'kfresh']).items.map(item => item.state)).toEqual(['unknown', 'queued'])
    expect(hub.view(stored, ['k00001']).items[0]?.state).toBe('replied')
  })

  it('已采纳编号只保留本会话、本文档、已回复的替换或插入', () => {
    const hub = new EditorRequestHub()
    const agent = agentWith([])
    const other = agentWith([])
    const ref = snapshot().ref
    const cases: { id: string; intent: EditorIntent; reply: EditorReply; ref?: EditorRequestSnapshot['ref']; owner?: object }[] = [
      { id: 'kept01', intent: 'polish', reply: { kind: 'replace', text: '改过的句子。' } },
      { id: 'kept02', intent: 'continue', reply: { kind: 'insert', text: '续上一句。' } },
      { id: 'cmt001', intent: 'review', reply: { kind: 'comments', comments: [{ quote: '林舟在渡口停下。', note: '停得突然' }] } },
      { id: 'none01', intent: 'polish', reply: { kind: 'none', note: '不用改' } },
      { id: 'otherp', intent: 'polish', reply: { kind: 'replace', text: '别的文档。' }, ref: { space: ref.space, path: '其他.md' } },
    ]
    for (const item of cases) {
      const target = item.owner ?? agent
      hub.open(target, snapshot({ requestId: item.id, intent: item.intent, ...(item.ref ? { ref: item.ref } : {}) }))
      expect(hub.reply(target, item.id, item.reply).ok).toBe(true)
    }
    hub.open(other, snapshot({ requestId: 'other1' }))
    hub.reply(other, 'other1', { kind: 'replace', text: '他会话的句子。' })
    hub.open(agent, snapshot({ requestId: 'queue1' }))
    expect(hub.acceptedFor(agent, ['kept01', 'forged1', 'cmt001', 'kept02', 'none01', 'otherp', 'other1', 'queue1', 'kept01'], ref)).toEqual(['kept01', 'kept02'])
    expect(hub.acceptedFor(other, ['other1', 'kept01'], ref)).toEqual(['other1'])
  })

  it('新稿移动把同一 agent、同一文档的全部状态改到新路径', () => {
    const hub = new EditorRequestHub()
    const agent = agentWith([])
    const other = agentWith([])
    const from = snapshot().ref
    const to = { space: from.space, path: '草稿区/草稿/卷01-来信/稿3.md' }
    const opened = snapshot({ requestId: 'move01' })
    hub.open(agent, opened)
    hub.reply(agent, 'move01', { kind: 'replace', text: '改过。' })
    hub.open(agent, snapshot({ requestId: 'queue1' }))
    hub.open(agent, snapshot({ requestId: 'cancel1' }))
    hub.cancel(agent, ['cancel1'])
    const windows = snapshot({
      requestId: 'win001',
      document: { ...snapshot().document, absolutePath: 'D:\\books\\林岚\\草稿区\\草稿\\卷01-来信\\稿2.md' },
    })
    hub.open(agent, windows)
    hub.open(agent, snapshot({
      requestId: 'otherp',
      ref: { space: from.space, path: '其他.md' },
      document: { owner: '林岚', path: '其他.md', space: from.space, version: 1, absolutePath: 'D:/books/林岚/其他.md' },
    }))
    hub.reply(agent, 'otherp', { kind: 'replace', text: '别的文档。' })
    hub.open(other, snapshot({ requestId: 'else01' }))
    hub.reply(other, 'else01', { kind: 'replace', text: '他会话。' })
    hub.retarget(agent, from, from)
    expect(storedSnapshot(hub, agent, 'move01')).toBe(opened)
    hub.retarget(agent, from, to)
    expect(opened.ref).toEqual(from)
    expect(opened.document.absolutePath).toContain('稿2.md')
    const moved = storedSnapshot(hub, agent, 'move01')
    expect(moved).not.toBe(opened)
    expect(moved?.ref).toEqual(to)
    expect(moved?.document.path).toBe(to.path)
    expect(moved?.document.space).toBe(to.space)
    expect(moved?.document.version).toBe(2)
    expect(moved?.document.absolutePath).toBe('D:/books/林岚/草稿区/草稿/卷01-来信/稿3.md')
    expect(storedSnapshot(hub, agent, 'queue1')?.ref).toEqual(to)
    expect(storedSnapshot(hub, agent, 'cancel1')?.document.path).toBe(to.path)
    expect(storedSnapshot(hub, agent, 'win001')?.document.absolutePath).toBe('D:\\books\\林岚\\草稿区\\草稿\\卷01-来信\\稿3.md')
    expect(hub.view(agent, ['queue1', 'cancel1']).items.map(item => item.state)).toEqual(['queued', 'cancelled'])
    expect(hub.acceptedFor(agent, ['move01', 'queue1', 'cancel1', 'win001'], to)).toEqual(['move01'])
    expect(hub.acceptedFor(agent, ['move01'], from)).toEqual([])
    expect(hub.acceptedFor(agent, ['otherp'], { space: from.space, path: '其他.md' })).toEqual(['otherp'])
    expect(storedSnapshot(hub, agent, 'otherp')?.document.absolutePath).toBe('D:/books/林岚/其他.md')
    expect(hub.acceptedFor(other, ['else01'], from)).toEqual(['else01'])
    expect(storedSnapshot(hub, other, 'else01')?.ref).toEqual(from)
  })

  it('followup 文本写明工具、文档和意图边界', () => {
    const text = requestMessage(snapshot({ instruction: '句子再稳一点' }))
    expect(text.startsWith('【书房编辑器 · 润色】#polish1')).toBe(true)
    expect(text).toContain('林岚 / 草稿区/草稿/卷01-来信/稿2.md')
    expect(text).toContain('含未保存编辑')
    expect(text).toContain('基线 3f9a2c1b2d3e…')
    expect(text).toContain('> 林舟在渡口停下。')
    expect(text).toContain('作者要求：句子再稳一点')
    expect(text).toContain('不新增行动者、立场、动作或事实')
    expect(text).toContain('请调用 novel_editor_suggest（requestId=polish1）')
    expect(text).toContain('不要直接改写文件，也不要把这次请求当作推进章节的授权')
    expect(text).toContain('[在书房打开原文](<')
    expect(text).not.toContain('10-04')
    const continued = requestMessage(snapshot({ requestId: 'cont001', intent: 'continue', selection: { text: '', line: 4, before: '到这里。', after: '' } }))
    expect(continued).toContain('【书房编辑器 · 续写】#cont001')
    expect(continued).toContain('第 4 行之后（续写插入点）')
    expect(continued).toContain('从插入点接着写，不改动前文')
    expect(continued).not.toContain('原文：')
  })

  it('长上下文取紧邻操作位置的前文尾部、后文头部，保留完整 emoji', () => {
    const tail80 = '🙂'.repeat(76) + '靠近结尾'
    const continued = requestMessage(snapshot({ intent: 'continue', selection: { text: '', before: '远'.repeat(320) + tail80, after: '' } }))
    expect(continued.split('\n').find(line => line.startsWith('前文：'))).toBe('前文：…' + tail80)
    const tail40 = '🙂'.repeat(36) + '靠近选区'
    const head40 = '紧邻后文' + '🙂'.repeat(36)
    const polish = requestMessage(snapshot({ selection: { before: '远'.repeat(360) + tail40, after: head40 + '远'.repeat(360) } }))
    expect(polish.split('\n').find(line => line.startsWith('前文：'))).toBe('前文：…' + tail40)
    expect(polish.split('\n').find(line => line.startsWith('后文：'))).toBe('后文：' + head40 + '…')
    const short = requestMessage(snapshot({ selection: { before: '刚到。🙂', after: '随后。🙂' } }))
    expect(short).toContain('前文：刚到。🙂\n后文：随后。🙂')
  })
})

describe('书房编辑器验收脚本', () => {
  function plan(request: EditorRequestSnapshot, extra = '') {
    const message = editorMessage(request)
    if (extra) message.content[0]!.text += '\n' + extra
    return editorAcceptancePlan([message])
  }

  it('按意图选择替换、批注、插入或不调用工具，标记可以覆盖', () => {
    const replaced = plan(snapshot())
    expect(replaced).toMatchObject({ action: 'tool', branch: 'replace', requestId: 'polish1' })
    expect(replaced.args.text).toBe('林舟在渡口停下。（验收改写）')
    expect(plan(snapshot({ requestId: 'exp001', intent: 'expand' })).branch).toBe('replace')
    expect(plan(snapshot({ requestId: 'cus001', intent: 'custom', instruction: '改得更冷' })).branch).toBe('replace')

    const comments = plan(snapshot({ requestId: 'rev001', intent: 'review' }))
    expect(comments).toMatchObject({ action: 'tool', branch: 'comments', requestId: 'rev001' })
    expect(comments.args.comments[0].quote).toBe('林舟在渡口停下。')

    const inserted = plan(snapshot({ requestId: 'cont001', intent: 'continue', selection: { text: '', line: 8, before: '到这里。', after: '' } }))
    expect(inserted).toMatchObject({ action: 'tool', branch: 'insert', args: { kind: 'insert', text: '验收续写。' } })

    expect(plan(snapshot({ requestId: 'cdn001', intent: 'condense' }))).toMatchObject({ action: 'finish', branch: 'none' })
    expect(plan(snapshot(), '【脚本:none】')).toMatchObject({ action: 'finish', branch: 'none' })
    expect(plan(snapshot({ requestId: 'cdn001', intent: 'condense' }), '【脚本:insert】')).toMatchObject({ action: 'tool', branch: 'insert' })
    expect(editorAcceptancePlan([{ role: 'user', content: [{ type: 'text', text: '普通对话' }] }])).toEqual({ action: 'ignore' })
  })

  it('同一条请求已经调用过工具后不再调用', () => {
    const message = editorMessage(snapshot())
    const again = editorAcceptancePlan([message, { role: 'assistant', content: [{ type: 'tool-call', name: 'novel_editor_suggest' }] }])
    expect(again).toMatchObject({ action: 'finish', handled: true, requestId: 'polish1', branch: 'replace' })
  })
})

describe('工具回复校验', () => {
  function setup(intent: EditorIntent, text = '林舟在渡口停下。', requestId = 'polish1') {
    const hub = new EditorRequestHub()
    const agent = { id: 'main' }
    hub.open(agent, snapshot({ requestId, intent, selection: { text, line: 2, before: '前', after: '后' } }))
    const run = (args: Record<string, unknown>) => acceptEditorSuggestion(hub, agent, { requestId, ...args })
    return { hub, agent, run }
  }

  it('未知、取消、重复和未答复都返回明确原因', () => {
    const { hub, agent, run } = setup('polish')
    expect(acceptEditorSuggestion(hub, agent, { requestId: 'missing', kind: 'none' })).toMatchObject({ ok: false, reason: EDITOR_UNKNOWN_REASON })
    expect(acceptEditorSuggestion(undefined, agent, { requestId: 'polish1', kind: 'none' }).reason).toBe(EDITOR_UNKNOWN_REASON)
    hub.cancel(agent, ['polish1'])
    expect(run({ kind: 'replace', text: '改过。' })).toMatchObject({ ok: false, reason: expect.stringContaining('作者已取消') })
    const second = setup('polish', '林舟在渡口停下。', 'again01')
    expect(second.run({ kind: 'replace', text: '改过。' })).toMatchObject({ ok: true, message: EDITOR_DELIVERED_MESSAGE })
    expect(second.run({ kind: 'replace', text: '再改。' })).toMatchObject({ ok: false, reason: EDITOR_DUPLICATE_REASON })
  })
})
