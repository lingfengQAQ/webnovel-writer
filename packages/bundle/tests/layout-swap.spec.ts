import { describe, expect, it } from 'vitest'
import { applySwap, probeFrame, readSwapPreference, restoreSwap, SWAP_STORAGE_KEY, swappable, writeSwapPreference } from '../src/client/layout-swap'

interface Fake {
  parentElement: Fake | null
  previousElementSibling: Fake | null
  children: Fake[]
  attrs: Record<string, string>
  display: string
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  querySelector(selector: string): Fake | null
}

function node(attrs: Record<string, string> = {}, children: Fake[] = [], display = 'block'): Fake {
  const current: Fake = {
    parentElement: null,
    previousElementSibling: null,
    children,
    attrs: { ...attrs },
    display,
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) },
    setAttribute(name, value) { this.attrs[name] = value },
    removeAttribute(name) { delete this.attrs[name] },
    querySelector(selector) { return find(this, selector) },
  }
  children.forEach((child, index) => {
    child.parentElement = current
    child.previousElementSibling = index > 0 ? children[index - 1]! : null
  })
  return current
}

function matches(current: Fake, selector: string): boolean {
  const attr = /^\[([a-z0-9-]+)\]$/i.exec(selector)
  return !!attr?.[1] && current.hasAttribute(attr[1])
}

function find(current: Fake, selector: string): Fake | null {
  for (const child of current.children) {
    if (matches(child, selector)) return child
    const nested = find(child, selector)
    if (nested) return nested
  }
  return null
}

function storage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value },
    removeItem: (key: string) => { delete data[key] },
  }
}

function frameOf(options: { display?: string; collapsed?: boolean; fullscreen?: boolean; panel?: boolean; sibling?: boolean; rightbar?: boolean } = {}) {
  const panel = node({ 'data-sidebar-right-panel': 'push' })
  const rightbar = node(options.rightbar === false ? {} : { 'data-rightbar-col': '' }, options.panel === false ? [] : [panel])
  const center = node()
  const sidebar = node()
  const attrs: Record<string, string> = {}
  if (options.collapsed) attrs['data-rightbar-collapsed'] = ''
  if (options.fullscreen) attrs['data-rightbar-fullscreen'] = ''
  const children = options.sibling === false ? [rightbar] : [sidebar, center, rightbar]
  const frame = node(attrs, children, options.display ?? 'grid')
  const root = node({}, [frame])
  const doc = {
    documentElement: root,
    querySelector: (selector: string) => find(root, selector),
    defaultView: { getComputedStyle: (element: Fake) => ({ display: element.display }) },
  }
  return { doc, frame, center, rightbar, panel }
}

describe('布局互换自检', () => {
  it('四项都满足时返回框架、中间列、右栏和面板', () => {
    const { doc, frame, center, rightbar, panel } = frameOf()
    expect(probeFrame(doc)).toEqual({ frame, center, rightbar, panel })
  })

  it('没有右栏列、不是网格、没有前一列或没有面板时失败', () => {
    expect(probeFrame(frameOf({ rightbar: false }).doc)).toBeUndefined()
    expect(probeFrame(frameOf({ display: 'block' }).doc)).toBeUndefined()
    expect(probeFrame(frameOf({ sibling: false }).doc)).toBeUndefined()
    expect(probeFrame(frameOf({ panel: false }).doc)).toBeUndefined()
  })

  it('收起或全屏时不可互换，占列时可以', () => {
    expect(swappable(frameOf().frame)).toBe(true)
    expect(swappable(frameOf({ collapsed: true }).frame)).toBe(false)
    expect(swappable(frameOf({ fullscreen: true }).frame)).toBe(false)
  })

  it('偏好按 webnovel-layout-swap 读写', () => {
    const box = storage()
    expect(readSwapPreference(box)).toBe(false)
    writeSwapPreference(box, true)
    expect(box.data[SWAP_STORAGE_KEY]).toBe('1')
    expect(readSwapPreference(box)).toBe(true)
    writeSwapPreference(box, false)
    expect(box.data[SWAP_STORAGE_KEY]).toBeUndefined()
  })

  it('切换写入或去掉 html 标记', () => {
    const { doc } = frameOf()
    const box = storage()
    expect(applySwap(doc, box, true)).toBe(true)
    expect(doc.documentElement.hasAttribute('data-webnovel-swap')).toBe(true)
    expect(readSwapPreference(box)).toBe(true)
    expect(applySwap(doc, box, false)).toBe(true)
    expect(doc.documentElement.hasAttribute('data-webnovel-swap')).toBe(false)
    expect(readSwapPreference(box)).toBe(false)
  })

  it('自检失败不写标记，恢复时清掉已有标记但保留偏好', () => {
    const broken = frameOf({ panel: false })
    const box = storage({ [SWAP_STORAGE_KEY]: '1' })
    broken.doc.documentElement.setAttribute('data-webnovel-swap', '')
    expect(applySwap(broken.doc, box, true)).toBe(false)
    expect(box.data[SWAP_STORAGE_KEY]).toBe('1')
    expect(restoreSwap(broken.doc, box)).toBe(false)
    expect(broken.doc.documentElement.hasAttribute('data-webnovel-swap')).toBe(false)
    expect(box.data[SWAP_STORAGE_KEY]).toBe('1')
  })

  it('结构还在时按偏好恢复标记，收起也不清掉', () => {
    const ready = frameOf({ collapsed: true })
    const box = storage({ [SWAP_STORAGE_KEY]: '1' })
    expect(restoreSwap(ready.doc, box)).toBe(true)
    expect(ready.doc.documentElement.hasAttribute('data-webnovel-swap')).toBe(true)
    expect(swappable(ready.frame)).toBe(false)
  })
})
