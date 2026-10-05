import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { documentHash, serializeDocument } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { StudyService } from '../src/study/service'
import { createStudyHandler, savedMessage, STUDY_API_PATH, type StudyWebRuntime } from '../src/study/web'
import { EditorRequestHub } from '../src/study/editor-requests'
import { createNovelTools } from '../src/novel-tools'
import { EDITOR_REQUEST_SOURCE } from '../src/message-sources'
import type { StudySave } from '../src/study/types'
import { BookIndexManager } from '../src/indexing/manager'

let root: string
function put(relative: string, text: string) { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); return target }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-study-'))
  for (const [name, id] of [['雾港', 'fog'], ['长夜', 'night']]) {
    put(`${name}/作品契约/契约.md`, serializeDocument({ 书id: id }, name!))
    put(`${name}/大纲/卷01/细纲.md`, serializeDocument({ 版本: 1 }, '真实细纲'))
  }
  put('雾港/草稿区/草稿/卷01-开篇/稿1.md', serializeDocument({ 身份: { 卷: 1, 章: 1, 章名: '开篇' }, 版本: 1, 角色: '待审稿' }, '待审稿正文'))
  put('雾港/.private.md', '不可暴露')
  put('书房/知识库/笔记.md', '# 资料\n\n原文。\n')
})
afterEach(async () => {
  removeSync(root)
})

describe('真实书房目录服务', () => {
  it('章节完成数使用定稿事实，不依赖建议环节的显示措辞', () => {
    const service = new StudyService(root)
    expect(service.chapters('book:fog').chapters[0]?.finalized).toBe(false)
    put('雾港/定稿/卷01/0001-开篇.md', serializeDocument({ 角色: '已定稿', 版本: 1 }, '已经入档的正文'))
    expect(service.chapters('book:fog').chapters.find(item => item.chapter === 1)).toMatchObject({ finalized: true, status: '完成' })
  })
  it('多书与共享资料分开，逐层只返回直接子项', () => {
    const service = new StudyService(root)
    expect(service.shelf().books.map(book => book.id).sort()).toEqual(['book:fog', 'book:night'])
    expect(service.shelf().shared).toBe(true)
    const top = service.tree({ space: 'book:fog', path: '' })
    expect(top.map(entry => entry.name)).toEqual(['作品契约', '大纲', '草稿区'])
    expect(top.some(entry => entry.ref.path.includes('细纲.md'))).toBe(false)
    expect(service.tree({ space: 'book:fog', path: '草稿区/草稿/卷01-开篇' })[0]).toMatchObject({ badge: '待审稿', draft: true })
  })
  it('同名搜索带独立书范围，书名也可检索', () => {
    const service = new StudyService(root)
    expect(service.search('细纲').entries.map(entry => entry.ref.space).sort()).toEqual(['book:fog', 'book:night'])
    expect(service.search('雾港').entries.every(entry => entry.ref.space === 'book:fog')).toBe(true)
    expect(service.search('笔记').entries[0]?.ref.space).toBe('shared')
  })
  it('路径穿越、隐藏文件、共享目录别名拒绝', () => {
    const service = new StudyService(root)
    expect(() => service.read({ space: 'book:fog', path: '../长夜/作品契约/契约.md' })).toThrow()
    expect(() => service.read({ space: 'book:fog', path: '.private.md' })).toThrow()
    fs.symlinkSync(path.join(root, '长夜'), path.join(root, '雾港', 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(service.tree({ space: 'book:fog', path: '' }).find(entry => entry.name === 'alias')?.error).toMatch(/链接|别名/)
    fs.unlinkSync(path.join(root, '雾港', 'alias'))
  })
  it('重复书id显式报错，不选择第一本', () => {
    put('长夜/作品契约/契约.md', serializeDocument({ 书id: 'fog' }, '同id'))
    const service = new StudyService(root)
    expect(service.shelf().books.every(book => !!book.error)).toBe(true)
    expect(() => service.read({ space: 'book:fog', path: '作品契约/契约.md' })).toThrow(/不唯一/)
  })
  it('解析失败只读，正文不会被截断或重写', () => {
    put('书房/知识库/损坏.md', '---\n不闭合\n原文')
    const doc = new StudyService(root).read({ space: 'shared', path: '知识库/损坏.md' })
    expect(doc.readOnly).toMatch(/格式异常/)
    expect(doc.body).toContain('不闭合')
  })
  it('对话绝对路径和书id路径都解析到正确文件，其他路径交回宿主', () => {
    const service = new StudyService(root)
    expect(service.resolve(path.join(root, '雾港', '大纲', '卷01', '细纲.md'))?.ref.space).toBe('book:fog')
    expect(service.resolve('fog:大纲/卷01/细纲.md')?.ref.space).toBe('book:fog')
    expect(service.resolve(path.join(os.tmpdir(), 'outside.txt'))).toBeNull()
  })
  it('保存共享资料后仍可读回原差异，其他会话不能重用记录', () => {
    const service = new StudyService(root)
    const ref = { space: 'shared', path: '知识库/笔记.md' }
    const doc = service.read(ref)
    const result = service.save(ref, doc.hash, '修改后的资料', { sessionId: 'owner' }, 'shared-operation-001')
    expect(result.commit).toBe('not-required')
    expect(result.changes.some(part => part.removed && part.value.includes('原文'))).toBe(true)
    expect(service.saved(ref, result.document.hash, result.operationId, 'owner').changes).toEqual(result.changes)
    expect(() => service.saved(ref, result.document.hash, result.operationId, 'other')).toThrow(/当前会话/)
    expect(() => service.saved(ref, doc.hash, result.operationId, 'owner')).toThrow(/已变化/)
  })
})

async function serve(followup = vi.fn(), indexing?: BookIndexManager, editorRequests = new EditorRequestHub()) {
  const agent = { id: 'main', status: 'idle' as string, session: { header: { cwd: root } }, followup }
  const child = { ...agent, id: 'child' }
  const runtime: StudyWebRuntime = {
    agents: { get: id => id === 'main' ? agent : id === 'child' ? child : undefined, roots: () => [agent] },
  }
  const handler = createStudyHandler(runtime, indexing, undefined, editorRequests)
  const base = 'http://127.0.0.1'
  const post = async (method: string, input: object, headers: Record<string, string> = {}) => {
    const response = await handler(new Request(base + STUDY_API_PATH + method, { method: 'POST', headers: {
      'x-webnovel-request': '1', 'content-type': 'application/json', ...headers,
    }, body: JSON.stringify({ sessionId: 'main', ...input }) }))
    return { status: response.status, body: await response.json() as { ok: boolean; code?: string; value: StudySave; error: string } }
  }
  return { post, followup, handler, agent, editorRequests }
}

describe('已通过宿主认证的书房 Fetch 保存和原生通知入口', () => {
  it('#167 保存通知有核对完成条件，提交成功与失败不会混为补写设计', async () => {
    const { post, followup } = await serve()
    const ref = { space: 'book:fog', path: '作品契约/契约.md' }
    const doc = new StudyService(root).read(ref)
    const response = await post('save', { ref, hash: doc.hash, body: doc.body.trimEnd() + '。\n', operationId: 'issue-167-punctuation' })
    expect(response.status).toBe(200)
    expect(new StudyService(root).read(ref).body).toContain('雾港。')
    const notification = JSON.stringify(followup.mock.calls[0])
    expect(notification).toContain('本次保存处理完成')
    expect(notification).toContain('不自动滚窗')
    expect(response.body.value.route).toContain('核对并报告')
    expect(savedMessage({ ...response.body.value, commit: 'saved', commitError: undefined })).toContain('无需补提交')
    expect(savedMessage({ ...response.body.value, commit: 'failed', commitError: 'index locked' })).toContain('编辑器重试提交')
  })

  it('索引控制沿用认证和主会话范围，不接受客户端指定根目录或未知操作', async () => {
    const indexing = new BookIndexManager({ getProvider: () => undefined })
    try {
      const { post } = await serve(vi.fn(), indexing)
      expect((await post('index-control', { space: 'book:fog', action: 'enable', sessionId: 'child' })).status).toBe(400)
      expect((await post('index-status', { space: 'shared' })).status).toBe(400)
      expect((await post('index-control', { space: 'book:fog', action: 'invalid' })).status).toBe(400)
      const paused = await post('index-control', { space: 'book:fog', action: 'pause', cwd: 'C:/outside', root: 'C:/outside' })
      expect(paused.status).toBe(200)
      expect(paused.body.value).toMatchObject({ bookId: 'fog', phase: 'paused', paused: true, recipientSession: 'main' })
      expect(fs.existsSync(path.join(root, '雾港/.webnovel/finalized-search-state.json'))).toBe(true)
      expect(fs.existsSync(path.join(root, '长夜/.webnovel/finalized-search-state.json'))).toBe(false)
    } finally { await indexing.close() }
  })
  it('接收已认证的桌面请求，仍要求业务标识和 JSON 格式', async () => {
    const { post } = await serve()
    expect((await post('shelf', {})).status).toBe(200)
    expect((await post('shelf', {}, { 'x-webnovel-request': '' })).status).toBe(403)
    expect((await post('shelf', {}, { 'content-type': 'text/plain' })).status).toBe(400)
  })
  it('取消与超限请求不会进入保存', async () => {
    const { handler, followup } = await serve()
    const headers = { 'x-webnovel-request': '1', 'content-type': 'application/json' }
    const abort = new AbortController(); abort.abort()
    const canceled = await handler(new Request('http://127.0.0.1' + STUDY_API_PATH + 'save', { method: 'POST', headers, signal: abort.signal, body: '{}' }))
    expect(canceled.status).toBe(400)
    const oversized = await handler(new Request('http://127.0.0.1' + STUDY_API_PATH + 'save', { method: 'POST', headers, body: ' '.repeat(8 * 1024 * 1024 + 1) }))
    expect(oversized.status).toBe(400)
    expect(await oversized.text()).toContain('8 MiB')
    expect(followup).not.toHaveBeenCalled()
  })
  it('只接受真实根 Agent，拒绝子级或任意客户端 cwd', async () => {
    const { post } = await serve()
    expect((await post('shelf', { sessionId: 'child' })).status).toBe(400)
    const response = await post('shelf', { cwd: 'C:/outside' })
    expect(response.status).toBe(200)
    expect(JSON.stringify(response.body)).toContain(root.replace(/\\/g, '\\\\'))
  })
  it('保存后发送完整原生消息，同一编号重试只落一份内容', async () => {
    const { post, followup } = await serve()
    const input = { ref: { space: 'shared', path: '知识库/笔记.md' }, hash: documentHash(fs.readFileSync(path.join(root, '书房/知识库/笔记.md'), 'utf8')), body: '已保存的真实资料', operationId: 'http-operation-001' }
    const response = await post('save', input)
    expect(response.status).toBe(200)
    expect(response.body.value.notification).toBe('delivered')
    expect(JSON.stringify(followup.mock.calls[0])).toContain('已保存的真实资料')
    expect(JSON.stringify(followup.mock.calls[0])).toContain('plugin')
    expect((await post('save', input)).status).toBe(200)
    expect(followup).toHaveBeenCalledTimes(1)
  })
  it('通知失败与保存成功分开，重试携原始差异', async () => {
    const followup = vi.fn().mockImplementationOnce(() => { throw new Error('queue unavailable') })
    const { post } = await serve(followup)
    const ref = { space: 'shared', path: '知识库/笔记.md' }
    const hash = new StudyService(root).read(ref).hash
    const response = await post('save', { ref, hash, body: '作者更改', operationId: 'http-operation-002' })
    expect(response.body.value.notification).toBe('failed')
    expect(new StudyService(root).read(ref).body).toContain('作者更改')
    const retried = await post('notify', { ref, hash: response.body.value.document.hash, operationId: response.body.value.operationId })
    expect(retried.body.value.notification).toBe('delivered')
    expect(JSON.stringify(followup.mock.calls.at(-1))).toContain('原文')
    expect(JSON.stringify(followup.mock.calls.at(-1))).toContain('作者更改')
  })
})

function askInput(doc: { hash: string; ref: { space: string; path: string } }, extra: Record<string, unknown> = {}) {
  return {
    requestId: 'polish1', intent: 'polish', dirty: true, ref: doc.ref, hash: doc.hash,
    selection: { text: '待审稿正文', line: 1, before: '前文', after: '后文' },
    ...extra,
  }
}

describe('书房编辑器请求', () => {
  it('沿用头部、会话和主 Agent 校验，子会话与非法字段被拒绝', async () => {
    const { post, followup } = await serve()
    const doc = new StudyService(root).read({ space: 'book:fog', path: '草稿区/草稿/卷01-开篇/稿1.md' })
    expect((await post('ask', askInput(doc), { 'x-webnovel-request': '' })).status).toBe(403)
    expect((await post('ask', { ...askInput(doc), sessionId: 'child' })).status).toBe(400)
    expect((await post('suggestions', { requestIds: ['polish1'], sessionId: 'child' })).status).toBe(400)
    const base = askInput(doc)
    for (const input of [
      { ...base, requestId: 'BAD' },
      { ...base, intent: 'rewrite' },
      { ...base, intent: 'custom' },
      { ...base, instruction: '啊'.repeat(501) },
      { ...base, selection: { ...base.selection, text: '' } },
      { ...base, selection: { ...base.selection, text: '啊'.repeat(8001) } },
      { ...base, selection: { ...base.selection, before: '啊'.repeat(401) } },
      { ...base, selection: { ...base.selection, line: 0 } },
      { ...base, dirty: 'yes' },
    ]) expect((await post('ask', input)).status).toBe(400)
    const continued = await post('ask', { ...base, requestId: 'cont001', intent: 'continue', selection: { text: '', line: 2, before: '到这里', after: '' } })
    expect(continued.status).toBe(200)
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('哈希不一致返回 409，只读文档只允许审读', async () => {
    const { post, followup, editorRequests, agent } = await serve()
    const doc = new StudyService(root).read({ space: 'book:fog', path: '草稿区/草稿/卷01-开篇/稿1.md' })
    const stale = await post('ask', askInput(doc, { hash: '0'.repeat(64) }))
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('conflict')
    expect(stale.body.error).toContain('磁盘版本已变化')
    expect(followup).not.toHaveBeenCalled()
    expect(editorRequests.view(agent, ['polish1']).items[0]?.state).toBe('unknown')
    put('雾港/定稿/卷01/0001-开篇.md', serializeDocument({ 角色: '已定稿', 版本: 1 }, '已经入档的正文'))
    const frozen = new StudyService(root).read({ space: 'book:fog', path: '定稿/卷01/0001-开篇.md' })
    const write = await post('ask', askInput(frozen, { selection: { text: '已经入档的正文', line: 1, before: '', after: '' } }))
    expect(write.status).toBe(400)
    expect(write.body.error).toContain('只读文档只允许审读')
    const review = await post('ask', askInput(frozen, { requestId: 'review1', intent: 'review', selection: { text: '已经入档的正文', line: 1, before: '', after: '' } }))
    expect(review.status).toBe(200)
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('followup 失败时回滚请求，同一编号可以重新发起', async () => {
    const followup = vi.fn(() => { throw new Error('queue unavailable') })
    const { post, editorRequests, agent } = await serve(followup)
    const doc = new StudyService(root).read({ space: 'book:fog', path: '草稿区/草稿/卷01-开篇/稿1.md' })
    const failed = await post('ask', askInput(doc))
    expect(failed.status).toBe(400)
    expect(failed.body.error).toContain('主 Agent 没有收到请求')
    expect(editorRequests.view(agent, ['polish1']).items[0]?.state).toBe('unknown')
    followup.mockImplementation(() => undefined)
    expect((await post('ask', askInput(doc))).status).toBe(200)
  })

  it('每个会话最多 8 个未决请求', async () => {
    const { post, followup } = await serve()
    const doc = new StudyService(root).read({ space: 'book:fog', path: '草稿区/草稿/卷01-开篇/稿1.md' })
    for (let index = 0; index < 8; index++) {
      const response = await post('ask', askInput(doc, { requestId: `p${String(index).padStart(5, '0')}` }))
      expect(response.status).toBe(200)
    }
    const overflow = await post('ask', askInput(doc, { requestId: 'pextra' }))
    expect(overflow.status).toBe(400)
    expect(overflow.body.error).toContain('未决请求已达 8')
    expect(followup).toHaveBeenCalledTimes(8)
  })

  it('轮询看到排队、处理中、已回复、未答复和取消', async () => {
    const events: { type: string; data: object }[] = []
    const followup = vi.fn((message: object) => {
      events.push({ type: 'turn/start', data: { turn: 1 } })
      events.push({ type: 'user/message', data: message })
    })
    const editorRequests = new EditorRequestHub()
    const agent = {
      id: 'main', status: 'running',
      session: { header: { cwd: root }, get seq() { return events.length }, eventAt: (seq: number) => events[seq] },
      followup,
    }
    const runtime: StudyWebRuntime = { agents: { get: id => id === 'main' ? agent : undefined, roots: () => [agent] } }
    const handler = createStudyHandler(runtime, undefined, undefined, editorRequests)
    const post = async (method: string, input: object) => {
      const response = await handler(new Request('http://127.0.0.1' + STUDY_API_PATH + method, {
        method: 'POST', headers: { 'x-webnovel-request': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'main', ...input }),
      }))
      return { status: response.status, body: await response.json() as { ok: boolean; error: string; value: { requestId?: string; busy?: boolean; items?: { requestId: string; state: string; reply?: { kind: string; text?: string } }[] } } }
    }
    const doc = new StudyService(root).read({ space: 'book:fog', path: '草稿区/草稿/卷01-开篇/稿1.md' })
    followup.mockImplementationOnce(() => undefined)
    const queued = await post('ask', askInput(doc))
    expect(queued.body.value).toMatchObject({ requestId: 'polish1', busy: true })
    expect((await post('suggestions', { requestIds: ['polish1', 'missing'] })).body.value.items).toEqual([
      { requestId: 'polish1', state: 'queued' }, { requestId: 'missing', state: 'unknown' },
    ])
    followup.mockImplementation((message: object) => {
      events.push({ type: 'turn/start', data: { turn: 1 } })
      events.push({ type: 'user/message', data: message })
    })
    expect((await post('ask', askInput(doc, { requestId: 'work001' }))).status).toBe(200)
    expect((await post('suggestions', { requestIds: ['work001'] })).body.value.items?.[0]?.state).toBe('working')
    const source = followup.mock.calls.at(-1)?.[0] as { source?: { kind?: string; requestId?: string }; content?: { text?: string }[] }
    expect(source.source).toEqual({ kind: EDITOR_REQUEST_SOURCE, requestId: 'work001' })
    expect(source.content?.[0]?.text).toContain('请调用 novel_editor_suggest（requestId=work001）')
    expect(source.content?.[0]?.text).toContain('不要直接改写文件')
    const suggest = createNovelTools({
      workspaceRoot: () => { throw new Error('不应读取书仓') },
      bookRootOfBookId: () => { throw new Error('不应读取书仓') },
      editorRequests,
    }).find(tool => tool.name === 'novel_editor_suggest')!
    expect(await suggest.execute({ requestId: 'work001', kind: 'replace', text: '改过的正文。', note: '更稳。' }, { agent })).toMatchObject({ ok: true, delivered: true })
    expect((await post('suggestions', { requestIds: ['work001'] })).body.value.items?.[0]).toMatchObject({ state: 'replied', reply: { kind: 'replace', text: '改过的正文。' } })
    expect((await post('ask', askInput(doc, { requestId: 'rev001', intent: 'review' }))).status).toBe(200)
    expect(await suggest.execute({ requestId: 'rev001', kind: 'comments', comments: [{ quote: '待审稿正文', note: '可以再具体。' }] }, { agent })).toMatchObject({ ok: true })
    expect((await post('suggestions', { requestIds: ['rev001'] })).body.value.items?.[0]?.reply).toMatchObject({ kind: 'comments' })
    expect((await post('ask', askInput(doc, { requestId: 'mute01' }))).status).toBe(200)
    events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    expect((await post('suggestions', { requestIds: ['mute01', 'work001'] })).body.value.items?.map(item => item.state)).toEqual(['unanswered', 'replied'])
    expect((await post('ask', askInput(doc, { requestId: 'cancel1' }))).status).toBe(200)
    expect((await post('ask-cancel', { requestIds: ['cancel1', 'missing'] })).body.value.items).toEqual([
      { requestId: 'cancel1', state: 'cancelled' }, { requestId: 'missing', state: 'unknown' },
    ])
    expect(await suggest.execute({ requestId: 'cancel1', kind: 'replace', text: '不该写入。' }, { agent })).toMatchObject({ ok: false, reason: expect.stringContaining('作者已取消') })
  })

  it('保存和通知重试只列出本会话已回复的替换或插入', async () => {
    const followup = vi.fn().mockImplementationOnce(() => { throw new Error('queue unavailable') })
    const { post, agent, editorRequests } = await serve(followup)
    const ref = { space: 'shared', path: '知识库/笔记.md' }
    const doc = new StudyService(root).read(ref)
    const base = {
      dirty: false, hash: doc.hash, ref: doc.ref,
      document: { owner: doc.owner, path: doc.ref.path, space: doc.ref.space, version: doc.version, absolutePath: doc.absolutePath },
      selection: { text: '原文。', line: 1, before: '', after: '' },
    }
    editorRequests.open(agent, { ...base, requestId: 'kept01', intent: 'polish' })
    editorRequests.reply(agent, 'kept01', { kind: 'replace', text: '改后的原文。' })
    editorRequests.open(agent, { ...base, requestId: 'cmt001', intent: 'review' })
    editorRequests.reply(agent, 'cmt001', { kind: 'comments', comments: [{ quote: '原文。', note: '别扭' }] })
    editorRequests.open(agent, { ...base, requestId: 'ins001', intent: 'continue', ref: { space: doc.ref.space, path: '其他.md' } })
    editorRequests.reply(agent, 'ins001', { kind: 'insert', text: '续上一句。' })
    const other = { session: {} }
    editorRequests.open(other, { ...base, requestId: 'other1', intent: 'polish' })
    editorRequests.reply(other, 'other1', { kind: 'replace', text: '他会话的句子。' })
    const accepted = ['kept01', 'cmt001', 'ins001', 'other1', 'forged1']
    const saved = await post('save', { ref, hash: doc.hash, body: '作者改过的资料。', operationId: 'editor-save-0001', accepted })
    expect(saved.body.value.notification).toBe('failed')
    const first = JSON.stringify(followup.mock.calls[0])
    expect(first).toContain('本次改动含 1 处作者在编辑器中采纳的主 Agent 建议（#kept01）')
    expect(first).not.toContain('cmt001')
    expect(first).not.toContain('ins001')
    expect(first).not.toContain('other1')
    expect(first).not.toContain('forged1')
    const retried = await post('notify', { ref, hash: saved.body.value.document.hash, operationId: saved.body.value.operationId, accepted })
    expect(retried.body.value.notification).toBe('delivered')
    const second = JSON.stringify(followup.mock.calls[1])
    expect(second).toContain('本次改动含 1 处作者在编辑器中采纳的主 Agent 建议（#kept01）')
    expect(second).not.toContain('forged1')
    expect((await post('notify', { ref, hash: saved.body.value.document.hash, operationId: saved.body.value.operationId, accepted: ['forged1'] })).body.value.notification).toBe('delivered')
    expect(followup).toHaveBeenCalledTimes(2)
    expect(savedMessage({ ...saved.body.value, commit: 'not-required' }, undefined, ['kept01'])).toContain('#kept01')
    expect(savedMessage({ ...saved.body.value, commit: 'not-required' })).not.toContain('采纳的主 Agent 建议')
  })

  it('两次保存之间生成新稿后，后一次采纳编号仍进入保存通知', async () => {
    const { post, followup, agent, editorRequests } = await serve()
    const ref = { space: 'book:fog', path: '草稿区/草稿/卷01-开篇/稿1.md' }
    const doc = new StudyService(root).read(ref)
    const base = {
      dirty: false, hash: doc.hash, ref: doc.ref,
      document: { owner: doc.owner, path: doc.ref.path, space: doc.ref.space, version: doc.version, absolutePath: doc.absolutePath },
      selection: { text: '待审稿正文', line: 1, before: '', after: '' },
    }
    editorRequests.open(agent, { ...base, requestId: 'move01', intent: 'polish' })
    editorRequests.reply(agent, 'move01', { kind: 'replace', text: '第一次采纳。' })
    editorRequests.open(agent, { ...base, requestId: 'move02', intent: 'polish' })
    editorRequests.reply(agent, 'move02', { kind: 'replace', text: '第二次采纳。' })
    const otherRef = { space: 'book:fog', path: '作品契约/契约.md' }
    const otherDoc = new StudyService(root).read(otherRef)
    editorRequests.open(agent, {
      ...base, requestId: 'stay01', intent: 'polish', ref: otherDoc.ref,
      document: { owner: otherDoc.owner, path: otherDoc.ref.path, space: otherDoc.ref.space, version: otherDoc.version, absolutePath: otherDoc.absolutePath },
    })
    editorRequests.reply(agent, 'stay01', { kind: 'replace', text: '别的文档。' })
    const otherAgent = { session: {} }
    editorRequests.open(otherAgent, { ...base, requestId: 'else01', intent: 'polish' })
    editorRequests.reply(otherAgent, 'else01', { kind: 'replace', text: '他会话。' })
    const first = await post('save', { ref, hash: doc.hash, body: '第一次保存的正文。', operationId: 'editor-move-0001', accepted: ['move01'] })
    expect(first.status, first.body.error).toBe(200)
    expect(first.body.value.previousPath).toBe(doc.ref.path)
    expect(first.body.value.document.ref.path).not.toBe(doc.ref.path)
    const firstNotice = JSON.stringify(followup.mock.calls.at(-1))
    expect(firstNotice).toContain('#move01')
    expect(firstNotice).not.toContain('#move02')
    const next = first.body.value.document
    expect(editorRequests.acceptedFor(agent, ['move02'], next.ref)).toEqual(['move02'])
    expect(editorRequests.acceptedFor(agent, ['move02'], doc.ref)).toEqual([])
    const second = await post('save', {
      ref: next.ref, hash: next.hash, body: '第二次保存的正文。', operationId: 'editor-move-0002',
      accepted: ['move02', 'stay01', 'else01', 'forged1'],
    })
    expect(second.status).toBe(200)
    const secondNotice = JSON.stringify(followup.mock.calls.at(-1))
    expect(secondNotice).toContain('作者在编辑器中采纳的主 Agent 建议（#move02）')
    expect(secondNotice).not.toContain('#stay01')
    expect(secondNotice).not.toContain('#else01')
    expect(secondNotice).not.toContain('#forged1')
    expect(editorRequests.acceptedFor(agent, ['stay01'], otherDoc.ref)).toEqual(['stay01'])
    expect(editorRequests.acceptedFor(otherAgent, ['else01'], doc.ref)).toEqual(['else01'])
    expect(editorRequests.acceptedFor(agent, ['else01'], doc.ref)).toEqual([])
  })
})
