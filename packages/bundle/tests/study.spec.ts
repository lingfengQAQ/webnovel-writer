import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createServer, type Server } from 'node:http'
import { documentHash, serializeDocument } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { StudyService } from '../src/study/service'
import { createStudyHandler, savedMessage, trustedStudyRequest, type StudyWebRuntime } from '../src/study/web'
import type { StudySave } from '../src/study/types'
import { BookIndexManager } from '../src/indexing/manager'

let root: string
let server: Server | undefined
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
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined }
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

async function serve(followup = vi.fn(), indexing?: BookIndexManager) {
  const agent = { id: 'main', session: { header: { cwd: root } }, followup }
  const child = { ...agent, id: 'child' }
  const runtime: StudyWebRuntime = {
    agents: { get: id => id === 'main' ? agent : id === 'child' ? child : undefined, roots: () => [agent] },
    webRuntime: { trustedHosts: [] },
    webServer: { register: () => () => {} },
    connection: { requestRejection: request => request.headers.cookie === 'session=valid' ? undefined : 401 },
  }
  server = createServer(createStudyHandler(runtime, indexing))
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no listener')
  const base = `http://127.0.0.1:${address.port}`
  const post = async (method: string, input: object, headers: Record<string, string> = {}) => {
    const response = await fetch(base + '/webnovel/api/' + method, { method: 'POST', headers: {
      origin: base, 'sec-fetch-site': 'same-origin', 'x-webnovel-request': '1', 'content-type': 'application/json', cookie: 'session=valid', ...headers,
    }, body: JSON.stringify({ sessionId: 'main', ...input }) })
    return { status: response.status, body: await response.json() as { ok: boolean; value: StudySave; error: string } }
  }
  return { post, followup }
}

describe('书房 HTTP 保存和原生通知入口', () => {
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
      expect((await post('index-status', { space: 'book:fog' }, { cookie: '' })).status).toBe(401)
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
  it('同源标识不能替代宿主认证，跨站和无浏览器来源都拒绝', async () => {
    expect(trustedStudyRequest({ headers: { host: '127.0.0.1', 'x-webnovel-request': '1' } }, [])).toBe(false)
    const { post } = await serve()
    expect((await post('shelf', {}, { cookie: '' })).status).toBe(401)
    expect((await post('shelf', {}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post('shelf', {}, { origin: 'http://evil.example' })).status).toBe(403)
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
