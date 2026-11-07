import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeIndexState, readIndexState, readPersistedIndexAuto, emptyIndexState, withBookWrite } from '@webnovel/core'
import { invalidateIndexCache } from '../../core/src/retrieval/state'
import { removeSync } from '../../core/src/repo/remove'
import { BookIndexManager, type IndexBook } from '../src/indexing/manager'
import { createIndexAutoPreference } from '../src/preferences-host'

let workspace: string
const runtimes: BookIndexManager[] = []
beforeEach(() => { workspace = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'preferences-migration-')) })
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.close(); removeSync(workspace) })
function book(name: string, raw: object): IndexBook {
  const root = path.join(workspace, name)
  fs.mkdirSync(path.join(root, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(root, '作品契约/契约.md'), `---\n书id: ${name}\n---\n`)
  fs.mkdirSync(path.join(root, '.webnovel'))
  fs.writeFileSync(path.join(root, '.webnovel/finalized-search-state.json'), JSON.stringify(raw))
  return { root, bookId: name, name, workspace }
}
function persisted(item: IndexBook) { return fs.readFileSync(path.join(item.root, '.webnovel/finalized-search-state.json'), 'utf8') }
function host(initial?: boolean) {
  let raw = initial === undefined ? {} : { autoIndexOnCommit: initial }
  let revision = 1
  let failure: Error | undefined
  let beforeWrite: (() => Promise<void>) | undefined
  const update = vi.fn(async (_ns: string, patch: object, expected?: number) => {
    await beforeWrite?.()
    if (failure) throw failure
    if (expected !== revision) throw Object.assign(new Error('冲突'), { code: 'SETTINGS_CONFLICT' })
    raw = { ...raw, ...patch }; revision++
  })
  const service = { describe: () => [{ ns: 'webnovel' as never, value: raw, user: raw, schema: {}, revision, autoGenerate: false, applies: 'live' as const }], update }
  return { service, update, preference: createIndexAutoPreference(() => service, () => undefined),
    change: (value: boolean) => { raw = { autoIndexOnCommit: value }; revision++ },
    fail: (error?: Error) => { failure = error },
    wait: (callback: () => Promise<void>) => { beforeWrite = callback } }
}
function runtime(settings: ReturnType<typeof host>) {
  const instance = new BookIndexManager({ getProvider: () => undefined, autoPreference: settings.preference, pollMs: 60_000, debounceMs: 60_000 })
  runtimes.push(instance); return instance
}

describe('profile auto-index preference and original book migration', () => {
  it('moves a valid true once, preserves state controls and never stores a second auto flag', async () => {
    const settings = host(), item = book('one', { ...emptyIndexState(), auto: true, paused: true, phase: 'paused', generation: 3 })
    const first = runtime(settings)
    expect(await first.status(item)).toMatchObject({ auto: true, paused: true, generation: 3 })
    expect(settings.update).toHaveBeenCalledWith('webnovel', { autoIndexOnCommit: true }, 1)
    expect(JSON.parse(persisted(item))).not.toHaveProperty('auto')
    await changeIndexState(item.root, state => ({ ...state, completedChunks: 1 }))
    expect(JSON.parse(persisted(item))).not.toHaveProperty('auto')
    await first.close()
    expect(await runtime(settings).status(item)).toMatchObject({ auto: true, paused: true, completedChunks: 1 })
    expect(settings.update).toHaveBeenCalledTimes(1)
  })
  it('preserves the old bytes when Host persistence fails, then retries the same value', async () => {
    const settings = host(), item = book('one', { ...emptyIndexState(), auto: true }), original = persisted(item)
    settings.fail(new Error('只读 profile'))
    const index = runtime(settings)
    await expect(index.status(item)).rejects.toThrow('只读')
    expect(persisted(item)).toBe(original); expect(settings.preference.get()).toBeUndefined()
    settings.fail()
    expect(await index.status(item)).toMatchObject({ auto: true })
    expect(JSON.parse(persisted(item))).not.toHaveProperty('auto')
  })
  it('respects an explicit false and never revives it from a later old book', async () => {
    const settings = host(false), index = runtime(settings)
    for (const name of ['one', 'two']) {
      const item = book(name, { ...emptyIndexState(), auto: true })
      expect(await index.status(item)).toMatchObject({ auto: false })
      expect(JSON.parse(persisted(item))).not.toHaveProperty('auto')
    }
    expect(settings.update).not.toHaveBeenCalled()
  })
  it('fences a delayed migration against a newer author choice', async () => {
    const settings = host(), item = book('one', { ...emptyIndexState(), auto: true }), index = runtime(settings)
    let release!: () => void
    settings.wait(() => new Promise<void>(done => { release = done }))
    const pending = index.status(item)
    await vi.waitFor(() => expect(settings.update).toHaveBeenCalledTimes(1))
    settings.change(false); release()
    expect(await pending).toMatchObject({ auto: false })
    expect(settings.preference.get()).toBe(false)
    expect(JSON.parse(persisted(item))).not.toHaveProperty('auto')
  })
  it('coalesces simultaneous old books into one persisted migration', async () => {
    const settings = host(), index = runtime(settings)
    const books = ['one', 'two'].map(name => book(name, { ...emptyIndexState(), auto: true, paused: true, phase: 'paused' }))
    expect((await Promise.all(books.map(item => index.status(item)))).every(state => state.auto)).toBe(true)
    expect(settings.update).toHaveBeenCalledTimes(1)
    for (const item of books) expect(JSON.parse(persisted(item))).not.toHaveProperty('auto')
  })
  it.each([{ schema: 999, auto: true }, { schema: 1, auto: true }])('does not migrate invalid state %j', async raw => {
    const settings = host(), index = runtime(settings), item = book('broken', raw), original = persisted(item)
    expect(() => readPersistedIndexAuto(item.root)).toThrow('后台索引状态无法读取')
    await expect(index.status(item)).rejects.toThrow('后台索引状态无法读取')
    expect(settings.update).not.toHaveBeenCalled(); expect(settings.preference.get()).toBeUndefined()
    expect(persisted(item)).toBe(original)
  })
  it('retains pause through cache invalidation and lets the Host report the global control after reopening', async () => {
    const settings = host(true), item = book('one', { ...emptyIndexState(), paused: true, phase: 'paused', indexedHead: 'old', generation: 4 })
    withBookWrite(item.root, () => invalidateIndexCache(item.root))
    expect(readIndexState(item.root)).toMatchObject({ phase: 'paused', generation: 5 })
    expect(await runtime(settings).status(item)).toMatchObject({ auto: true, paused: true, generation: 5 })
    expect(JSON.parse(persisted(item))).not.toHaveProperty('auto')
  })
})
