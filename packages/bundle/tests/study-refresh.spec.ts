import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorStore, fileKey } from '../src/client/store'
import { callStudy } from '../src/client/api'
import type { StudyDocument } from '../src/study/types'

vi.mock('../src/client/api', async original => ({ ...await original<typeof import('../src/client/api')>(), callStudy: vi.fn() }))
const request = vi.mocked(callStudy)
const doc = (hash = 'one'): StudyDocument => ({ ref: { space: 'book:a', path: '大纲/故事骨架.md' }, absolutePath: '/a/大纲/故事骨架.md', name: '故事骨架.md', owner: 'a', version: 1, body: hash, hash })
afterEach(() => { request.mockReset(); vi.useRealTimers() })

describe('书房外部刷新', () => {
  it('干净正文更新，但不生成保存通知或新业务状态', () => {
    const store = createEditorStore(); store.receive('a', doc()); store.receive('a', doc('two'))
    expect(store.get('a').buffers[fileKey(doc().ref)]).toMatchObject({ text: 'two', document: { hash: 'two' } })
    expect(request).not.toHaveBeenCalled()
  })
  it('保留未保存文字，外部变化仅进入可比较的磁盘版本', () => {
    const store = createEditorStore(), key = fileKey(doc().ref)
    store.receive('a', doc()); store.updateBuffer('a', key, { text: '我的编辑' }); store.receive('a', doc('two'))
    expect(store.get('a').buffers[key]).toMatchObject({ text: '我的编辑', document: { hash: 'one' }, disk: { hash: 'two' } })
    store.useDisk('a', key, true)
    expect(store.get('a').buffers[key]).toMatchObject({ text: '我的编辑', document: { hash: 'two' } })
  })
  it('保存中和结果未确认时不替换缓冲', () => {
    const store = createEditorStore(), key = fileKey(doc().ref)
    store.receive('a', doc()); store.updateBuffer('a', key, { saving: true }); store.receive('a', doc('two'))
    expect(store.get('a').buffers[key]?.document.hash).toBe('one')
    store.updateBuffer('a', key, { saving: false, attempt: { operationId: 'pending', body: 'one', hash: 'one', ref: doc().ref } })
    store.receive('a', doc('three')); expect(store.get('a').buffers[key]?.document.hash).toBe('one')
  })
  it('迟到的刷新不能覆盖更新后的保存基线', async () => {
    const store = createEditorStore(), key = fileKey(doc().ref)
    store.receive('a', doc())
    let deliver!: (value: StudyDocument) => void
    request.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve }))
    const pending = store.reload('a', key)
    store.receive('a', doc('saved')); deliver(doc('old-read')); await pending
    expect(store.get('a').buffers[key]?.text).toBe('saved')
  })
  it('手动刷新同时读取已有正文；不同会话互不影响', async () => {
    const store = createEditorStore(), key = fileKey(doc().ref)
    store.receive('a', doc()); store.receive('b', doc())
    request.mockResolvedValue(doc('new')); await store.refresh('a')
    expect(store.get('a').buffers[key]?.text).toBe('new'); expect(store.get('b').buffers[key]?.text).toBe('one')
  })
  it('目录突发变化合并为一次刷新，卸载后不再读取', async () => {
    vi.useFakeTimers()
    const store = createEditorStore(); store.receive('a', doc()); request.mockResolvedValue(doc())
    store.invalidate('a'); store.invalidate('a'); await vi.advanceTimersByTimeAsync(250)
    expect(request).toHaveBeenCalledTimes(1)
    store.invalidate('a'); store.dispose(); await vi.advanceTimersByTimeAsync(250)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('新稿保存通知标签替换，并保留该文档的编辑模式', async () => {
    const store = createEditorStore(), key = fileKey(doc().ref), moved = vi.fn()
    store.receive('a', doc()); store.updateBuffer('a', key, { text: '新正文', mode: 'edit' }); store.onMove(moved)
    const next = { ...doc('saved'), ref: { space: 'book:a', path: '草稿区/稿2.md' }, absolutePath: '/a/草稿区/稿2.md', body: '新正文' }
    request.mockResolvedValue({ document: next, changed: true, operationId: 'saved', previousPath: doc().ref.path, changes: [], commit: 'not-required', notification: 'delivered', route: '核对' })
    await store.save('a', key)
    expect(moved).toHaveBeenCalledWith('a', doc(), next)
    expect(store.get('a').buffers[key]).toBeUndefined()
    expect(store.get('a').buffers[fileKey(next.ref)]).toMatchObject({ mode: 'edit', text: '新正文' })
  })
})
