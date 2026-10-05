import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditorStore, fileKey } from '../src/client/store'
import { callStudy, StudyApiError } from '../src/client/api'
import { documentQuote } from '../src/client/quote'
import { parseStudyLink, studyLink, studyFileLink } from '../src/study/links'
import type { StudyDocument, StudySave } from '../src/study/types'

vi.mock('../src/client/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/api')>(), callStudy: vi.fn() }))
const request = vi.mocked(callStudy)
const doc = (name = 'a'): StudyDocument => ({ ref: { space: 'book:one', path: `大纲/${name}.md` }, owner: '作品', name: name + '.md', absolutePath: '/workspace/作品/大纲/' + name + '.md', body: '原文\n', hash: 'old-hash', version: 1 })
const result = (document: StudyDocument): StudySave => ({ operationId: 'test-operation-id', document, previousPath: document.ref.path, changed: true, changes: [], commit: 'saved', notification: 'delivered', route: '核对设计' })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { request.mockReset(); vi.stubGlobal('window', { confirm: vi.fn(() => true) }) })
afterEach(() => vi.unstubAllGlobals())

describe('编辑器会话与保存竞态', () => {
  it('打开成功才通知原生侧栏，每次打开均可重新显示且保留未保存缓冲', async () => {
    const reveal = vi.fn(), store = createEditorStore(reveal)
    request.mockResolvedValueOnce(doc())
    await store.open('one', doc().ref)
    const key = fileKey(doc().ref)
    store.updateBuffer('one', key, { text: '未保存内容' })
    store.cancelOpen('one')
    await store.open('one', doc().ref)
    expect(reveal.mock.calls).toEqual([['one'], ['one']])
    expect(request).toHaveBeenCalledTimes(1)
    expect(store.get('one').buffers[key]?.text).toBe('未保存内容')
  })
  it('关闭期间取消未完成的打开，不让迟到结果重新展开侧栏', async () => {
    const reveal = vi.fn(), store = createEditorStore(reveal), pending = deferred<StudyDocument>()
    request.mockReturnValueOnce(pending.promise)
    const opening = store.open('one', doc().ref)
    store.cancelOpen('one'); pending.resolve(doc()); await opening
    expect(reveal).not.toHaveBeenCalled()
    expect(store.get('one').buffers).toEqual({})
  })
  it('后点文档优先，迟到的旧打开响应不能抢焦点', async () => {
    const store = createEditorStore(), old = deferred<StudyDocument>(), latest = deferred<StudyDocument>()
    request.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const first = store.open('one', doc('a').ref), second = store.open('one', doc('b').ref)
    latest.resolve(doc('b')); await second
    old.resolve(doc('a')); await first
    expect(store.get('one').current).toBe(fileKey(doc('b').ref))
  })
  it('旧会话返回只更新旧缓冲区，不污染另一会话', async () => {
    const store = createEditorStore(), pending = deferred<StudyDocument>()
    request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(doc('b'))
    const first = store.open('one', doc().ref)
    await store.open('two', doc('b').ref)
    pending.resolve(doc()); await first
    expect(store.get('two').current).toBe(fileKey(doc('b').ref))
    expect(Object.keys(store.get('two').buffers)).toHaveLength(1)
  })
  it('保存期间新增的编辑不会被保存响应覆盖', async () => {
    const store = createEditorStore(), saved = deferred<StudySave>()
    request.mockResolvedValueOnce(doc()).mockReturnValueOnce(saved.promise)
    await store.open('one', doc().ref)
    const key = fileKey(doc().ref)
    store.updateBuffer('one', key, { text: '提交的修改' })
    const saving = store.save('one', key)
    store.updateBuffer('one', key, { text: '继续输入的修改' })
    saved.resolve(result({ ...doc(), body: '提交的修改\n', hash: 'new-hash' })); await saving
    expect(store.get('one').buffers[key]?.text).toBe('继续输入的修改')
    expect(store.get('one').buffers[key]?.document.body).toBe('提交的修改\n')
  })
  it('不确定的失败保留原编号重试，再保留其后的编辑', async () => {
    const store = createEditorStore()
    request.mockResolvedValueOnce(doc()).mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(result({ ...doc(), body: '第一次修改\n', hash: 'new' }))
    await store.open('one', doc().ref)
    const key = fileKey(doc().ref)
    store.updateBuffer('one', key, { text: '第一次修改' })
    await store.save('one', key)
    const attempt = store.get('one').buffers[key]?.attempt
    expect(attempt).toBeDefined()
    store.updateBuffer('one', key, { text: '随后修改' })
    await store.save('one', key)
    expect(request.mock.calls[2]?.[2]).toEqual(attempt)
    expect(store.get('one').buffers[key]?.text).toBe('随后修改')
  })
  it('版本冲突保留编辑，磁盘比较不会自动覆盖', async () => {
    const store = createEditorStore()
    request.mockResolvedValueOnce(doc()).mockRejectedValueOnce(new StudyApiError('conflict', '版本变化')).mockResolvedValueOnce({ ...doc(), body: '磁盘新版', hash: 'new' })
    await store.open('one', doc().ref)
    const key = fileKey(doc().ref)
    store.updateBuffer('one', key, { text: '我的编辑' })
    await store.save('one', key); await store.compare('one', key)
    expect(store.get('one').buffers[key]?.text).toBe('我的编辑')
    expect(store.get('one').buffers[key]?.document.hash).toBe('old-hash')
    store.useDisk('one', key, true)
    expect(store.get('one').buffers[key]?.document.hash).toBe('new')
    expect(store.get('one').buffers[key]?.text).toBe('我的编辑')
  })
  it('载入磁盘版本不再弹出确认，直接替换未保存文字', async () => {
    const store = createEditorStore()
    request.mockResolvedValueOnce(doc())
    await store.open('one', doc().ref)
    const key = fileKey(doc().ref)
    store.updateBuffer('one', key, { text: '我的编辑' })
    store.receive('one', { ...doc(), body: '磁盘新版', hash: 'new' })
    const confirm = vi.mocked(window.confirm)
    confirm.mockClear()
    store.useDisk('one', key, false)
    expect(confirm).not.toHaveBeenCalled()
    expect(store.get('one').buffers[key]?.text).toBe('磁盘新版')
    expect(store.get('one').buffers[key]?.document.hash).toBe('new')
    expect(store.get('one').buffers[key]?.disk).toBeUndefined()
  })
  it('关闭脏文档可以取消，卸载后的请求不写回状态', async () => {
    const store = createEditorStore()
    request.mockResolvedValueOnce(doc())
    await store.open('one', doc().ref)
    const key = fileKey(doc().ref)
    store.updateBuffer('one', key, { text: '未保存' })
    vi.mocked(window.confirm).mockReturnValue(false)
    expect(store.close('one', key)).toBe(false)
    expect(store.hasUnsaved()).toBe(true)
    store.dispose()
    expect(store.hasUnsaved()).toBe(false)
  })
  it('保存记下已采纳编号，失败重试沿用同一份，通知重试再带上', async () => {
    const store = createEditorStore()
    const saved = { ...result({ ...doc(), body: '采纳后的正文\n', hash: 'new' }), notification: 'failed' as const }
    request.mockResolvedValueOnce(doc())
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce({ notification: 'delivered' })
    await store.open('one', doc().ref)
    const key = fileKey(doc().ref)
    store.updateBuffer('one', key, { text: '采纳后的正文' })
    await store.save('one', key, ['abc123'])
    const attempt = store.get('one').buffers[key]?.attempt
    expect(attempt?.accepted).toEqual(['abc123'])
    await store.save('one', key, ['other'])
    expect(request.mock.calls[2]?.[2]).toEqual(attempt)
    expect(store.get('one').buffers[key]?.accepted).toEqual(['abc123'])
    await store.retry('one', key, 'notify')
    expect(request.mock.calls[3]?.[1]).toBe('notify')
    expect(request.mock.calls[3]?.[2]).toMatchObject({ accepted: ['abc123'], operationId: 'test-operation-id' })
  })
})

describe('完整原文引用', () => {
  it('原生文件链接保留中文、空格和文件名中的特殊字符', () => {
    const source = 'C:\\书房 甲\\稿件#1?(修订)%.md'
    const link = studyFileLink(source)
    expect(decodeURIComponent(link)).toBe(source.replace(/\\/g, '/'))
    expect(link).not.toMatch(/[?#<>()[\]]/)
  })
  it('桌面旧链接校验协议和完整主机，不把不透明 origin 当成同源', () => {
    const ref = { space: 'book:one', path: '草稿区/稿1.md' }
    const link = studyLink('dsh-app://app/', 'one', ref)
    expect(parseStudyLink(link, 'dsh-app://app/')).toEqual({ sessionId: 'one', ref })
    expect(parseStudyLink(link.replace('://app/', '://other/'), 'dsh-app://app/')).toBeUndefined()
    expect(parseStudyLink('file:///?webnovel={}', 'dsh-app://app/')).toBeUndefined()
  })
  it('文档链接结构化往返中文路径，拒绝外站和非法载荷', () => {
    const ref = { space: 'book:one', path: '草稿区/稿1.md' }
    const link = studyLink('http://127.0.0.1:6094', 'one', ref)
    expect(parseStudyLink(link, 'http://127.0.0.1:6094')).toEqual({ sessionId: 'one', ref })
    expect(parseStudyLink(link, 'http://evil.example')).toBeUndefined()
    expect(parseStudyLink('http://127.0.0.1:6094/?webnovel=bad', 'http://127.0.0.1:6094')).toBeUndefined()
  })
  it('长中文引用保留全文和来源，不因超过 500 字符退化成路径', () => {
    const text = '中文段落。'.repeat(200)
    const quote = documentQuote({ ...doc(), body: text }, text, text)
    expect(quote).toContain(text)
    expect(quote).toContain('book:one')
    expect(quote).toContain('old-hash')
    expect(quote).toContain('正文第 1 行')
  })
  it('重复段落不猜位置，未保存引用明确标注基线', () => {
    const quote = documentQuote(doc(), '重复。\n重复。', '重复。')
    expect(quote).toContain('未猜测位置')
    expect(quote).toContain('未保存编辑')
    expect(quote).not.toContain('正文第')
  })
  it('已知行号直接使用，重复段落也不改猜', () => {
    const quote = documentQuote(doc(), '重复。\n重复。', '重复。', 2)
    expect(quote).toContain('正文第 2 行起')
    expect(quote).not.toContain('未猜测位置')
    expect(quote).toContain('未保存编辑')
  })
})
