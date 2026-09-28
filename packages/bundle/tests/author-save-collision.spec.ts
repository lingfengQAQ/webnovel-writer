import { afterAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { removeSync } from '../../core/src/repo/remove'
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-editor-retry-'))
afterAll(() => removeSync(scratch))
import { paths, serializeDocument } from '../../core/src/index'
import { StudyService } from '../src/study/service'
import { createEditorStore, fileKey } from '../src/client/store'
import { callStudy } from '../src/client/api'
import type { FileRef, StudyDocument, StudySave } from '../src/study/types'

vi.mock('../src/client/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/api')>(), callStudy: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('editor save recovery collision', () => {
  it('F01 preserves both dirty buffers when a lost-response receipt targets an open edited draft', async () => {
    const ws = fs.mkdtempSync(path.join(scratch, 'case-'))
    const root = path.join(ws, '作品')
    const put = (relative: string, content: string) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content) }
    put('作品契约/契约.md', serializeDocument({ 书id: 'b-audit' }, '测试作品'))
    const originalPath = path.posix.join(paths.草稿目录(1, '开篇'), '稿1.md')
    put(originalPath, serializeDocument({ 身份: { 卷: 1, 章: 1, 章名: '开篇' }, 版本: 1, 角色: '待审稿', 选定: true }, '原稿'))
    const service = new StudyService(ws)
    let loseSaveResponse = true
    vi.mocked(callStudy).mockImplementation(async (sessionId, method, input: any) => {
      if (method === 'read') return service.read(input.ref)
      if (method !== 'save') throw new Error('unexpected test operation')
      const saved = service.save(input.ref, input.hash, input.body, { sessionId }, input.operationId)
      if (loseSaveResponse) { loseSaveResponse = false; throw new Error('Response lost after successful disk save') }
      return { ...saved, notification: 'delivered' }
    })
    const store = createEditorStore()
    const originalRef = { space: 'book:b-audit', path: originalPath }
    const originalKey = fileKey(originalRef)
    await store.open('session', originalRef)
    store.updateBuffer('session', originalKey, { text: '第一次保存的正文' })
    await store.save('session', originalKey)
    expect(store.get('session').buffers[originalKey]?.attempt).toBeDefined()
    // The author refreshes the file tree, sees the successfully-created draft 2,
    // opens it and continues writing while draft 1 still offers Retry Save.
    const newRef = { ...originalRef, path: originalPath.replace('稿1.md', '稿2.md') }
    const newKey = fileKey(newRef)
    expect(fs.existsSync(path.join(root, newRef.path))).toBe(true)
    await store.open('session', newRef)
    store.updateBuffer('session', newKey, { text: '第二稿中刚写的、尚未保存的重要段落' })
    // Recover the uncertain original request exactly as the product instructs.
    await store.save('session', originalKey)
    expect(store.get('session').buffers[newKey]?.text).toBe('第二稿中刚写的、尚未保存的重要段落')
    expect(store.get('session').buffers[originalKey]?.text).toBe('第一次保存的正文')
    expect(store.get('session').buffers[originalKey]).toMatchObject({ saving: false, errorCode: 'conflict' })
    expect(store.get('session').buffers[originalKey]?.attempt).toBeDefined()
    expect(store.hasUnsaved()).toBe(true)
    fs.writeFileSync(path.join(ws, 'evidence.json'), JSON.stringify({ overwrittenUnsavedText: '第二稿中刚写的、尚未保存的重要段落', buffersAfterRetry: store.get('session'), hasUnsaved: store.hasUnsaved() }, null, 2))
    // Once the author has resolved the target edit, the same receipt can safely converge.
    store.updateBuffer('session', newKey, { text: store.get('session').buffers[newKey]!.document.body })
    await store.save('session', originalKey)
    expect(store.get('session').buffers[originalKey]).toBeUndefined()
    expect(store.get('session').buffers[newKey]?.text).toBe('第一次保存的正文\n')
    expect(store.hasUnsaved()).toBe(false)
  })

  it.each([
    ['saving', 'one'], ['attempt', 'one'], ['saving', 'two'], ['attempt', 'two'],
  ] as const)('preserves target %s when the original save completes with target session %s', async (state, targetSession) => {
    const originalRef: FileRef = { space: 'book:audit', path: '草稿区/草稿/卷01-开篇/稿1.md' }
    const targetRef = { ...originalRef, path: originalRef.path.replace('稿1.md', '稿2.md') }
    const original: StudyDocument = { ref: originalRef, owner: '作品', name: '稿1.md', absolutePath: '/fixture/稿1.md', body: '原文\n', hash: 'original', version: 1 }
    const target: StudyDocument = { ...original, ref: targetRef, name: '稿2.md', body: '第一次保存\n', hash: 'first-save', version: 2 }
    const saveResult = (document: StudyDocument, previousPath: string): StudySave => ({
      operationId: previousPath, document, previousPath, changed: true, changes: [], commit: 'not-required', notification: 'delivered', route: '生成新稿',
    })
    const sourceResponse = deferred<StudySave>(), targetResponse = deferred<StudySave>()
    vi.mocked(callStudy).mockImplementation(async (_session, method, input: any) => {
      if (method === 'read') return input.ref.path === originalRef.path ? original : target
      if (method !== 'save') throw new Error('unexpected test operation')
      if (input.ref.path === originalRef.path) return sourceResponse.promise
      if (state === 'attempt') throw new Error('Target save response was lost')
      return targetResponse.promise
    })
    const store = createEditorStore(), originalKey = fileKey(originalRef), targetKey = fileKey(targetRef)
    // Both panels subscribe to the same session store; another session remains isolated.
    const panels: Array<ReturnType<typeof store.get> | undefined> = [undefined, undefined]
    const offFirst = store.subscribe(() => { panels[0] = store.get(targetSession) })
    const offSecond = store.subscribe(() => { panels[1] = store.get(targetSession) })
    await store.open('one', originalRef)
    store.updateBuffer('one', originalKey, { text: '第一次保存' })
    const originalSave = store.save('one', originalKey)
    await store.open(targetSession, targetRef)
    store.updateBuffer(targetSession, targetKey, { text: '目标稿正在保存的重要正文' })
    const targetSave = store.save(targetSession, targetKey)
    if (state === 'attempt') await targetSave
    // Undo typing while the save is unresolved: text alone now looks clean,
    // but the request and its exact payload still need to survive the old response.
    store.updateBuffer(targetSession, targetKey, { text: target.body })
    const outstanding = store.get(targetSession).buffers[targetKey]!
    expect(outstanding.attempt?.body).toBe('目标稿正在保存的重要正文')
    expect(outstanding.saving).toBe(state === 'saving')
    sourceResponse.resolve(saveResult(target, originalRef.path))
    await originalSave
    expect(store.get(targetSession).buffers[targetKey]).toBe(outstanding)
    expect(panels[0]?.buffers[targetKey]).toBe(outstanding)
    expect(panels[1]?.buffers[targetKey]).toBe(outstanding)
    if (targetSession === 'one') {
      expect(store.get('one').buffers[originalKey]).toMatchObject({ saving: false, errorCode: 'conflict', text: '第一次保存' })
    } else {
      expect(store.get('one').buffers[originalKey]).toBeUndefined()
      expect(store.get('one').buffers[targetKey]?.document.hash).toBe('first-save')
    }
    expect(store.hasUnsaved()).toBe(true)
    if (state === 'saving') {
      const third = { ...target, ref: { ...targetRef, path: targetRef.path.replace('稿2.md', '稿3.md') }, body: '目标稿正在保存的重要正文\n', hash: 'target-save', version: 3 }
      targetResponse.resolve(saveResult(third, targetRef.path))
      await targetSave
      expect(store.get(targetSession).buffers[fileKey(third.ref)]?.document.body).toBe(third.body)
      expect(store.get(targetSession).buffers[fileKey(third.ref)]?.text).toBe(target.body)
    }
    offFirst(); offSecond(); store.dispose()
  })
})
