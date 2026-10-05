import { describe, expect, it } from 'vitest'
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import { history, redo, undo } from '@codemirror/commands'
import { addItems, adoptedField, collab, collabField, collapsedPending, dismissItem, acceptItem, expiredGhosts, findItem, noteAdopted, requestBlocked, resolveAsk, type CollabItem, type PendingItem } from '../src/client/editor/collab'
import { readableDiff } from '../src/client/editor/diff'
import { EditorMemory } from '../src/client/editor/memory'
import { createEditorRequests, type EditorAsk, type EditorSurface } from '../src/client/editor/requests'
import { fileKey } from '../src/client/store'
import type { StudyDocument } from '../src/study/types'

function editor(doc: string) {
  let state = EditorState.create({ doc, extensions: [history(), collab] })
  const dispatch = (transaction: Transaction) => { state = transaction.state }
  return {
    get state() { return state },
    update(spec: TransactionSpec) { state = state.update(spec).state },
    run(command: (target: { state: EditorState; dispatch: (transaction: Transaction) => void }) => boolean) { return command({ state, dispatch }) },
    text: () => state.doc.toString(),
  }
}

const suggestion = {
  kind: 'suggestion' as const, id: 'abc123', intent: 'polish' as const,
  from: 0, to: 5, original: '他慢慢走来', text: '他轻轻走来', touched: false,
}

describe('协同状态', () => {
  it('锚点随前文插入移动', () => {
    const view = editor('一二三四')
    view.update({ effects: addItems.of([{ kind: 'suggestion', id: 'abc123', intent: 'polish', from: 2, to: 4, original: '三四', text: '五六', touched: false }]) })
    view.update({ changes: { from: 0, insert: '甲' } })
    expect(findItem(view.state, 'abc123')).toMatchObject({ from: 3, to: 5 })
  })

  it('删掉整段后，处理中的请求收成空范围', () => {
    let state = EditorState.create({ doc: '他慢慢走来', extensions: [collab] })
    state = state.update({ effects: addItems.of([{ ...suggestion, kind: 'pending', status: 'working' }]) }).state
    const next = state.update({ changes: { from: 0, to: 5, insert: '' } })
    expect(collapsedPending(next)).toEqual(['abc123'])
    expect(findItem(next.state, 'abc123')).toMatchObject({ from: 0, to: 0 })
  })

  it('等待中改了原文会标成 touched', () => {
    const view = editor('他慢慢走来')
    view.update({ effects: addItems.of([{ ...suggestion, kind: 'pending', status: 'working' } satisfies PendingItem]) })
    view.update({ changes: { from: 1, to: 2, insert: '已' } })
    expect(findItem(view.state, 'abc123')).toMatchObject({ kind: 'pending', touched: true })
  })

  it('接受可以撤销再重做，建议和已采纳编号一起回来', () => {
    const view = editor('他慢慢走来')
    view.update({ effects: addItems.of([suggestion]) })
    expect(view.run(acceptItem('abc123'))).toBe(true)
    expect(view.text()).toBe('他轻轻走来')
    expect(view.state.field(collabField)).toEqual([])
    expect(view.state.field(adoptedField)).toEqual(['abc123'])
    expect(view.run(undo)).toBe(true)
    expect(view.text()).toBe('他慢慢走来')
    expect(findItem(view.state, 'abc123')).toMatchObject({ kind: 'suggestion', text: '他轻轻走来' })
    expect(view.state.field(adoptedField)).toEqual([])
    expect(view.run(redo)).toBe(true)
    expect(view.text()).toBe('他轻轻走来')
    expect(findItem(view.state, 'abc123')).toBeUndefined()
    expect(view.state.field(adoptedField)).toEqual(['abc123'])
  })

  it('原文已被改动时第一次接受只要求确认', () => {
    const view = editor('他慢慢走来')
    view.update({ effects: addItems.of([{ ...suggestion, touched: true }]) })
    expect(view.run(acceptItem('abc123'))).toBe(false)
    expect(view.text()).toBe('他慢慢走来')
    expect(findItem(view.state, 'abc123')).toMatchObject({ confirm: true })
    expect(view.run(acceptItem('abc123'))).toBe(true)
    expect(view.text()).toBe('他轻轻走来')
  })

  it('拒绝可以撤销恢复', () => {
    const view = editor('他慢慢走来')
    view.update({ effects: addItems.of([suggestion]) })
    expect(view.run(dismissItem('abc123'))).toBe(true)
    expect(findItem(view.state, 'abc123')).toBeUndefined()
    expect(view.run(undo)).toBe(true)
    expect(findItem(view.state, 'abc123')).toMatchObject({ kind: 'suggestion' })
  })

  it('灰字附近被改就作废', () => {
    let state = EditorState.create({ doc: '他慢慢走来', extensions: [collab] })
    state = state.update({ effects: addItems.of([{ kind: 'ghost', id: 'ghost1', intent: 'continue', from: 5, to: 5, text: '然后他停下。' }]) }).state
    const next = state.update({ changes: { from: 5, to: 5, insert: '。' } })
    expect(findItem(next.state, 'ghost1')).toBeUndefined()
    expect(expiredGhosts(next)).toEqual(['ghost1'])
  })

  it('同一范围已有建议时不再发起', () => {
    const view = editor('他慢慢走来')
    view.update({ effects: addItems.of([suggestion]) })
    expect(requestBlocked(view.state, 1, 3)).toBe(true)
    expect(requestBlocked(view.state, 5, 5)).toBe(false)
  })

  it('同一续写点的 pending 和 ghost 都阻止重复，结束后可再发起', () => {
    const pointItems: CollabItem[] = [
      { kind: 'pending', id: 'point01', intent: 'continue', from: 4, to: 4, original: '', status: 'working', touched: false },
      { kind: 'ghost', id: 'point01', intent: 'continue', from: 4, to: 4, text: '续写。' },
    ]
    for (const item of pointItems) {
      const view = editor('原文句子')
      view.update({ selection: { anchor: 4 }, effects: addItems.of([item]) })
      expect(resolveAsk(view.state, 'continue')).toMatchObject({ ok: false })
      expect(requestBlocked(view.state, 3, 3)).toBe(false)
      expect(requestBlocked(view.state, 3, 4)).toBe(false)
      view.run(dismissItem(item.id))
      expect(resolveAsk(view.state, 'continue')).toMatchObject({ ok: true })
    }
  })

  it('采纳续写后可在新位置续写，撤销采纳后原点继续被占用', () => {
    const view = editor('原文句子')
    view.update({ selection: { anchor: 4 }, effects: addItems.of([{ kind: 'ghost', id: 'point01', intent: 'continue', from: 4, to: 4, text: '续写。' }]) })
    expect(view.run(acceptItem('point01'))).toBe(true)
    expect(resolveAsk(view.state, 'continue')).toMatchObject({ ok: true })
    view.run(undo)
    expect(requestBlocked(view.state, 4, 4)).toBe(true)
  })

  it('两字以内夹在改动中间的相同片段并进修改', () => {
    const parts = readableDiff('甲乙丙丁戊', '甲X丙Y戊')
    const deleted = parts.find(part => part.type === 'del')
    const inserted = parts.find(part => part.type === 'ins')
    expect(deleted?.text).toContain('丙')
    expect(inserted?.text).toContain('丙')
    expect(parts.filter(part => part.type === 'equal').map(part => part.text).join('')).not.toContain('丙')
  })
})

const draft = (path = '草稿/稿1.md'): StudyDocument => ({
  ref: { space: 'book:one', path }, owner: '作品', name: '稿1.md', absolutePath: '/作品/' + path, body: '原文句子', hash: 'hash-1', version: 1,
})

function pending(id: string, text = '原文句子'): PendingItem {
  return { kind: 'pending', id, intent: 'polish', from: 0, to: text.length, original: text, status: 'sending', touched: false }
}

function harness(options?: { visible?: () => boolean; alive?: (sessionId: string, key: string) => boolean; ask?: () => Promise<unknown>; cancel?: () => Promise<unknown> }) {
  const memory = new EditorMemory()
  const calls: { sessionId: string; method: string; body: object }[] = []
  const queued: { run: () => Promise<void> | void; delay: number; dead: boolean }[] = []
  let replies: Record<string, { state: string; reply?: object }> = {}
  const visible = options?.visible ?? (() => true)
  const client = createEditorRequests({
    call: async (sessionId, method, body = {}) => {
      calls.push({ sessionId, method, body })
      if (method === 'ask') return options?.ask ? options.ask() : { requestId: (body as { requestId?: string }).requestId, busy: false }
      if (method === 'ask-cancel' && options?.cancel) return options.cancel()
      if (method === 'suggestions') {
        const ids = (body as { requestIds?: string[] }).requestIds ?? []
        return { busy: false, items: ids.map(requestId => ({ requestId, ...(replies[requestId] ?? { state: 'queued' }) })) }
      }
      return { items: [] }
    },
    memory,
    hasBuffer: options?.alive ?? (() => true),
    visible,
    schedule: (run, delay) => {
      const entry = { run, delay, dead: false }
      queued.push(entry)
      return { cancel() { entry.dead = true } }
    },
  })
  return {
    client, memory, calls, queued,
    setReplies(next: typeof replies) { replies = next },
    async fire() {
      const entry = queued.shift()
      if (!entry || entry.dead) return
      await entry.run()
    },
  }
}

function askOf(id: string, identity: string, key: string, sessionId = 'one'): EditorAsk {
  return {
    sessionId, key, identity, requestId: id, intent: 'polish',
    ref: draft().ref, hash: draft().hash, dirty: false,
    selection: { text: '原文句子', line: 1, before: '', after: '' },
  }
}

function surfaceOf(initial: EditorState): EditorSurface & { readonly current: () => EditorState } {
  let state = initial
  return {
    get state() { return state },
    current: () => state,
    dispatch(spec) { state = state.update(spec).state },
  }
}

describe('协同请求投递', () => {
  function delayedAsk() {
    let resolve!: (value: unknown) => void
    let reject!: (reason: Error) => void
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  function waiting(id: string) {
    return EditorState.create({ doc: '原文句子', extensions: collab }).update({ effects: addItems.of([pending(id)]) }).state
  }

  it('发送期间取消立即移除 pending，成功响应后只补发一次取消且不轮询', async () => {
    const response = delayedAsk()
    const h = harness({ ask: () => response.promise })
    const key = fileKey(draft().ref), identity = 'one:' + key
    const surface = surfaceOf(waiting('sending1'))
    h.client.mount('one', key, identity, surface)
    const submitting = h.client.submit(askOf('sending1', identity, key))
    await h.client.cancel('one', ['sending1'])
    await h.client.cancel('one', ['sending1'])
    const pendingAfterCancel = findItem(surface.state, 'sending1')
    const callsBeforeAck = h.calls.map(call => call.method)
    response.resolve({ busy: true })
    await submitting
    expect(pendingAfterCancel).toBeUndefined()
    expect(callsBeforeAck).toEqual(['ask'])
    expect(h.client.overlay('sending1')?.decision).toBe('cancelled')
    expect(h.calls.filter(call => call.method === 'ask-cancel')).toEqual([{ sessionId: 'one', method: 'ask-cancel', body: { requestIds: ['sending1'] } }])
    expect(h.queued).toHaveLength(0)
    await h.client.cancel('one', ['sending1'])
    expect(h.calls.filter(call => call.method === 'ask-cancel')).toHaveLength(1)
  })

  it('取消不能跨会话，发送中的条目不会被已有轮询当成 unknown', async () => {
    const response = delayedAsk()
    let delayed = false
    const h = harness({ ask: () => delayed ? response.promise : Promise.resolve({ busy: false }) })
    const key = fileKey(draft().ref), identity = 'one:' + key
    const surface = surfaceOf(waiting('sending1'))
    h.client.mount('one', key, identity, surface)
    await h.client.submit(askOf('opened1', identity, key))
    delayed = true
    const submitting = h.client.submit(askOf('sending1', identity, key))
    await h.client.cancel('two', ['sending1'])
    await h.fire()
    response.resolve({ busy: false })
    await submitting
    expect(h.calls.find(call => call.method === 'suggestions')?.body).toEqual({ requestIds: ['opened1'] })
    expect(h.calls.some(call => call.method === 'ask-cancel')).toBe(false)
    expect(findItem(surface.state, 'sending1')).toMatchObject({ kind: 'pending', status: 'working' })
  })

  it.each(['cancel', 'discard', 'dispose'] as const)('发送期间 %s 不会被迟到响应复活', async action => {
    const response = delayedAsk()
    const h = harness({ ask: () => response.promise })
    const key = fileKey(draft().ref), identity = 'one:' + key
    const surface = surfaceOf(waiting('sending1'))
    h.client.mount('one', key, identity, surface)
    const submitting = h.client.submit(askOf('sending1', identity, key))
    if (action === 'cancel') await h.client.cancel('one', ['sending1'])
    else if (action === 'discard') h.client.discard('one', key)
    else h.client.dispose()
    response.resolve({ busy: false })
    await submitting
    expect(h.queued).toHaveLength(0)
    expect(h.calls.filter(call => call.method === 'ask-cancel')).toHaveLength(1)
    expect(registry(h.client).watches.get('sending1')?.phase).toBe('settled')
  })

  it('发送失败清除等待状态并保留错误提示，取消后的失败不再提示', async () => {
    for (const cancelled of [false, true]) {
      const response = delayedAsk()
      const h = harness({ ask: () => response.promise })
      const key = fileKey(draft().ref), identity = 'one:' + key
      const surface = surfaceOf(waiting('sending1'))
      h.client.mount('one', key, identity, surface)
      const submitting = h.client.submit(askOf('sending1', identity, key))
      if (cancelled) await h.client.cancel('one', ['sending1'])
      response.reject(new Error('发送失败'))
      expect(await submitting).toMatchObject({ ok: false })
      expect(findItem(surface.state, 'sending1')).toBeUndefined()
      expect(h.queued).toHaveLength(0)
      expect(h.client.pull(identity)).toEqual(cancelled ? [] : ['发送失败'])
      expect(registry(h.client).watches.get('sending1')?.phase).toBe('settled')
    }
  })

  it('发送尚未确认时生成新稿，状态和回复仍交到新稿', async () => {
    const response = delayedAsk()
    const from = draft(), to = draft('草稿/稿2.md')
    const fromKey = fileKey(from.ref), toKey = fileKey(to.ref)
    const fromId = 'one:' + fromKey, toId = 'one:' + toKey
    let activeKey = fromKey
    const h = harness({ ask: () => response.promise, alive: (_session, key) => key === activeKey })
    const old = surfaceOf(waiting('sending1'))
    h.client.mount('one', fromKey, fromId, old)
    const submitting = h.client.submit(askOf('sending1', fromId, fromKey))
    h.memory.move('one', from, to)
    h.client.retarget('one', fromKey, toKey)
    h.client.unmount(fromId)
    h.memory.set(fromId, old.state)
    activeKey = toKey
    const fresh = surfaceOf(h.memory.get(toId)!)
    h.client.mount('one', toKey, toId, fresh)
    response.resolve({ busy: true })
    await submitting
    expect(findItem(fresh.state, 'sending1')).toMatchObject({ kind: 'pending', status: 'queued' })
    h.setReplies({ sending1: { state: 'replied', reply: { kind: 'replace', text: '交到新稿' } } })
    await h.fire()
    expect(findItem(fresh.state, 'sending1')).toMatchObject({ kind: 'suggestion', text: '交到新稿' })
    expect(h.memory.get(fromId)).toBeUndefined()
  })

  it('发送中关标签仍更新缓存，取消传输失败保留提示且不复活请求', async () => {
    const response = delayedAsk()
    const h = harness({ ask: () => response.promise, cancel: async () => { throw new Error('取消传输失败') } })
    const key = fileKey(draft().ref), identity = 'one:' + key
    const surface = surfaceOf(waiting('sending1'))
    h.client.mount('one', key, identity, surface)
    const submitting = h.client.submit(askOf('sending1', identity, key))
    h.client.unmount(identity)
    h.memory.set(identity, surface.state)
    await h.client.cancel('one', ['sending1'])
    expect(findItem(h.memory.get(identity)!, 'sending1')).toBeUndefined()
    response.resolve({ busy: false })
    await submitting
    expect(h.client.pull(identity)).toEqual(['取消传输失败'])
    expect(h.client.overlay('sending1')?.decision).toBe('cancelled')
    expect(h.queued).toHaveLength(0)
  })

  it('已取消但仍在发送的登记不会被终态上限提前回收', async () => {
    const response = delayedAsk()
    let delayed = true
    const h = harness({ ask: () => delayed ? response.promise : Promise.resolve({ busy: false }) })
    const key = fileKey(draft().ref), identity = 'one:' + key
    const submitting = h.client.submit(askOf('sending1', identity, key))
    await h.client.cancel('one', ['sending1'])
    delayed = false
    for (let index = 0; index < 130; index++) {
      const id = `ended${index}`
      await h.client.submit(askOf(id, identity, key))
      await h.client.cancel('one', [id])
    }
    expect(registry(h.client).watches.get('sending1')?.phase).toBe('sending')
    expect(h.client.overlay('sending1')?.decision).toBe('cancelled')
    response.resolve({ busy: false })
    await submitting
    expect(h.calls.filter(call => call.method === 'ask-cancel' && (call.body as { requestIds: string[] }).requestIds.includes('sending1'))).toHaveLength(1)
  })

  it('没有未决请求时不轮询，可见 1 秒、隐藏 3 秒，完成后停止', async () => {
    const idle = harness()
    expect(idle.queued).toHaveLength(0)
    const shown = harness()
    const key = fileKey(draft().ref)
    const identity = 'one:' + key
    await shown.client.submit(askOf('pending1', identity, key))
    expect(shown.queued.map(entry => entry.delay)).toEqual([1000])
    expect(shown.calls.filter(call => call.method === 'suggestions')).toHaveLength(0)
    shown.setReplies({ pending1: { state: 'replied', reply: { kind: 'none', note: '不用改' } } })
    const state = EditorState.create({ doc: '原文句子', extensions: [collab] }).update({ effects: addItems.of([pending('pending1')]) }).state
    shown.memory.set(identity, state)
    await shown.fire()
    expect(shown.calls.filter(call => call.method === 'suggestions')).toHaveLength(1)
    expect(shown.queued).toHaveLength(0)

    let hidden = false
    const concealed = harness({ visible: () => hidden })
    hidden = false
    await concealed.client.submit(askOf('pending2', identity, key))
    expect(concealed.queued[0]?.delay).toBe(3000)
  })

  it('回复投到已挂载视图、只更新缓存，或在缓冲丢弃时报过期', async () => {
    const key = fileKey(draft().ref)
    const identity = 'one:' + key
    const otherKey = fileKey(draft('草稿/稿2.md').ref)
    const other = 'two:' + otherKey
    const mounted = harness()
    const initial = EditorState.create({ doc: '原文句子', extensions: [collab] }).update({ effects: addItems.of([pending('mounted1')]) }).state
    const surface = surfaceOf(initial)
    mounted.client.mount('one', key, identity, surface)
    await mounted.client.submit(askOf('mounted1', identity, key))
    mounted.setReplies({ mounted1: { state: 'replied', reply: { kind: 'replace', text: '改写句子', note: '更顺' } } })
    await mounted.fire()
    expect(findItem(surface.current(), 'mounted1')).toMatchObject({ kind: 'suggestion', text: '改写句子' })

    const cached = harness()
    const cachedState = EditorState.create({ doc: '原文句子', extensions: [collab] }).update({ effects: addItems.of([pending('cached1')]) }).state
    cached.memory.set(identity, cachedState)
    await cached.client.submit(askOf('cached1', identity, key))
    cached.setReplies({ cached1: { state: 'replied', reply: { kind: 'insert', text: '续上一句。' } } })
    await cached.fire()
    expect(findItem(cached.memory.get(identity)!, 'cached1')).toMatchObject({ kind: 'ghost', text: '续上一句。' })

    const dropped = harness({ alive: () => false })
    const droppedState = EditorState.create({ doc: '原文句子', extensions: [collab] }).update({ effects: addItems.of([pending('dropped1')]) }).state
    dropped.memory.set(identity, droppedState)
    await dropped.client.submit(askOf('dropped1', identity, key))
    dropped.setReplies({ dropped1: { state: 'replied', reply: { kind: 'replace', text: '不该写入' } } })
    await dropped.fire()
    expect(findItem(dropped.memory.get(identity)!, 'dropped1')).toMatchObject({ kind: 'pending' })
    expect(dropped.client.overlay('dropped1')?.decision).toBe('expired')

    const split = harness()
    const left = surfaceOf(EditorState.create({ doc: '甲会话', extensions: [collab] }).update({ effects: addItems.of([pending('left1', '甲会话')]) }).state)
    const right = surfaceOf(EditorState.create({ doc: '乙会话', extensions: [collab] }).update({ effects: addItems.of([pending('right1', '乙会话')]) }).state)
    split.client.mount('one', key, identity, left)
    split.client.mount('two', otherKey, other, right)
    await split.client.submit(askOf('left1', identity, key, 'one'))
    await split.client.submit(askOf('right1', other, otherKey, 'two'))
    split.setReplies({ left1: { state: 'replied', reply: { kind: 'replace', text: '只改甲' } }, right1: { state: 'queued' } })
    await split.fire()
    expect(findItem(left.current(), 'left1')).toMatchObject({ kind: 'suggestion', text: '只改甲' })
    expect(findItem(right.current(), 'right1')).toMatchObject({ kind: 'pending' })
    expect(split.calls.filter(call => call.method === 'suggestions').map(call => call.sessionId).sort()).toEqual(['one', 'two'])
  })

  it('撤销接受后，下一次保存快照不再包含该编号', () => {
    const view = editor('他慢慢走来')
    view.update({ effects: addItems.of([suggestion]) })
    view.run(acceptItem('abc123'))
    const key = fileKey(draft().ref)
    const identity = 'one:' + key
    const { client } = harness()
    expect(client.unsent(identity, view.state)).toEqual(['abc123'])
    view.run(undo)
    expect(client.unsent(identity, view.state)).toEqual([])
    view.run(redo)
    expect(client.unsent(identity, view.state)).toEqual(['abc123'])
    client.commit(identity, 'op-1', ['abc123'])
    expect(client.unsent(identity, view.state)).toEqual([])
    client.reopen(identity, 'abc123')
    view.run(undo)
    view.run(redo)
    expect(client.unsent(identity, view.state)).toEqual(['abc123'])
  })

  it('轮询中的请求超过上限也不回收', async () => {
    const { client } = harness()
    const key = fileKey(draft().ref)
    const identity = 'one:' + key
    for (let index = 0; index < 130; index++) await client.submit(askOf(`open${String(index).padStart(3, '0')}`, identity, key))
    const rows = registry(client)
    expect(rows.watches.size).toBe(130)
    expect(client.overlay('open000')?.intent).toBe('polish')
    expect(rows.watches.get('open000')?.phase).toBe('open')
  })

  it('已终结登记只保留最近 128 条，待决定和已挂载文档留下来', async () => {
    const mounted = harness()
    const key = fileKey(draft().ref)
    const identity = 'one:' + key
    const cachedKey = fileKey(draft('草稿/稿9.md').ref)
    const cachedIdentity = 'one:' + cachedKey
    const surface = surfaceOf(EditorState.create({ doc: '原文句子', extensions: [collab] }).update({ effects: addItems.of([
      pending('keepwait'),
      { kind: 'suggestion', id: 'undone1', intent: 'polish', from: 0, to: 4, original: '原文句子', text: '改写句子', touched: false },
    ]) }).state)
    mounted.client.mount('one', key, identity, surface)
    const cachedState = EditorState.create({ doc: '原文句子', extensions: [collab] }).update({ effects: addItems.of([pending('cached1')]) }).state
    mounted.memory.set(cachedIdentity, cachedState)
    await mounted.client.submit(askOf('keepwait', identity, key))
    await mounted.client.submit(askOf('cached1', cachedIdentity, cachedKey))
    mounted.setReplies({
      keepwait: { state: 'replied', reply: { kind: 'replace', text: '改写句子' } },
      cached1: { state: 'replied', reply: { kind: 'replace', text: '缓存里的建议' } },
    })
    await mounted.fire()
    expect(findItem(surface.current(), 'keepwait')).toMatchObject({ kind: 'suggestion' })
    expect(findItem(mounted.memory.get(cachedIdentity)!, 'cached1')).toMatchObject({ kind: 'suggestion' })
    mounted.client.record('undone1', 'accepted')
    mounted.client.reopen(identity, 'undone1')
    await mounted.client.submit(askOf('keepopen', identity, key))
    for (let index = 0; index < 160; index++) {
      const id = `done${String(index).padStart(3, '0')}`
      await mounted.client.submit(askOf(id, identity, key))
      await mounted.client.cancel('one', [id])
    }
    const rows = registry(mounted.client)
    expect(rows.watches.size).toBeLessThanOrEqual(128)
    expect(rows.base.size).toBeLessThanOrEqual(128)
    expect(rows.shown.size).toBeLessThanOrEqual(128)
    expect(rows.watches.get('keepopen')?.phase).toBe('open')
    expect(rows.watches.has('keepwait')).toBe(true)
    expect(rows.watches.has('cached1')).toBe(true)
    expect(rows.watches.has('done000')).toBe(false)
    expect(mounted.client.overlay('keepopen')?.intent).toBe('polish')
    expect(mounted.client.overlay('keepwait')?.intent).toBe('polish')
    expect(mounted.client.overlay('cached1')?.intent).toBe('polish')
    expect(mounted.client.overlay('undone1')).toMatchObject({ decision: 'reopened' })
    expect(mounted.client.overlay('done000')).toBeUndefined()
    expect(mounted.client.overlay('done159')).toMatchObject({ decision: 'cancelled' })
    expect(findItem(surface.current(), 'keepwait')).toMatchObject({ kind: 'suggestion' })
    expect(findItem(surface.current(), 'undone1')).toMatchObject({ kind: 'suggestion' })

    const docs = harness()
    const keep = surfaceOf(EditorState.create({ doc: '留着', extensions: [collab] }))
    docs.client.mount('one', 'keep', 'one:keep', keep)
    for (let index = 0; index < 200; index++) {
      const id = `one:doc${index}`
      docs.client.mount('one', `doc${index}`, id, surfaceOf(EditorState.create({ doc: String(index) })))
      docs.client.unmount(id)
    }
    const docRows = registry(docs.client)
    expect(docRows.docs.size).toBeLessThanOrEqual(128)
    expect(docRows.docs.has('one:keep')).toBe(true)
    expect(docRows.docs.has('one:doc0')).toBe(false)
    expect(docRows.docs.has('one:doc199')).toBe(true)
    docs.client.paint('one', 'keep', 'one:keep', { effects: addItems.of([pending('still')]) })
    expect(findItem(keep.current(), 'still')).toMatchObject({ kind: 'pending' })

    const saved = harness()
    const savedIdentity = 'one:' + fileKey(draft().ref)
    const view = editor('他慢慢走来')
    view.update({ effects: [noteAdopted.of('oldid'), noteAdopted.of('newid')] })
    saved.client.commit(savedIdentity, 'op-old', ['oldid'])
    for (let index = 0; index < 140; index++) saved.client.commit(savedIdentity, `op-${index}`, [])
    saved.client.commit(savedIdentity, 'op-new', ['newid'])
    saved.client.reopen(savedIdentity, 'oldid')
    saved.client.reopen(savedIdentity, 'newid')
    expect(saved.client.unsent(savedIdentity, view.state)).toEqual(['oldid', 'newid'])
    expect(registry(saved.client).committedOps.size).toBeLessThanOrEqual(128)
    expect(registry(saved.client).committedOps.has('op-old')).toBe(false)
    expect(registry(saved.client).committedOps.has('op-new')).toBe(true)
    saved.client.commit(savedIdentity, 'op-old', ['oldid'])
    saved.client.commit(savedIdentity, 'op-new', ['newid'])
    expect(saved.client.unsent(savedIdentity, view.state)).toEqual(['newid'])
  })
})

function registry(client: ReturnType<typeof createEditorRequests>) {
  return client as unknown as {
    watches: Map<string, { phase: string }>
    docs: Map<string, unknown>
    committedOps: Set<string>
    base: Map<string, string>
    shown: Map<string, string>
  }
}
