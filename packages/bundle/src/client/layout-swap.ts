export const SWAP_STORAGE_KEY = 'webnovel-layout-swap'

export interface SwapStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface SwapNode<T extends SwapNode<T>> {
  parentElement: T | null
  previousElementSibling: T | null
  hasAttribute(name: string): boolean
  querySelector(selector: string): T | null
}

interface SwapRoot {
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

export interface ProbeHit<T> {
  frame: T
  center: T
  rightbar: T
  panel: T
}

/** 右栏列在网格里，前一列是中间对话，列内有右侧栏面板。任一不符就不可用。 */
export function probeFrame<T extends SwapNode<T>>(doc: {
  querySelector(selector: string): T | null
  defaultView?: { getComputedStyle(element: T): { display: string } } | null
}): ProbeHit<T> | undefined {
  const rightbar = doc.querySelector('[data-rightbar-col]')
  const frame = rightbar?.parentElement
  if (!rightbar || !frame) return
  if (doc.defaultView?.getComputedStyle(frame).display !== 'grid') return
  const center = rightbar.previousElementSibling
  if (!center) return
  const panel = rightbar.querySelector('[data-sidebar-right-panel]')
  if (!panel) return
  return { frame, center, rightbar, panel }
}

/** 右栏占着网格列：没有收起，也没有全屏盖住框架。 */
export function swappable(frame: { hasAttribute(name: string): boolean }): boolean {
  return !frame.hasAttribute('data-rightbar-collapsed') && !frame.hasAttribute('data-rightbar-fullscreen')
}

export function readSwapPreference(storage: SwapStorage): boolean {
  try { return storage.getItem(SWAP_STORAGE_KEY) === '1' } catch { return false }
}

export function writeSwapPreference(storage: SwapStorage, on: boolean): void {
  try {
    if (on) storage.setItem(SWAP_STORAGE_KEY, '1')
    else storage.removeItem(SWAP_STORAGE_KEY)
  } catch { /* private mode */ }
}

export function setSwapMark(root: SwapRoot, on: boolean): void {
  const has = root.hasAttribute('data-webnovel-swap')
  if (on && !has) root.setAttribute('data-webnovel-swap', '')
  else if (!on && has) root.removeAttribute('data-webnovel-swap')
}

/** 自检通过才写入偏好和标记。失败时两者都不写。 */
export function applySwap<T extends SwapNode<T>>(doc: {
  documentElement: SwapRoot
  querySelector(selector: string): T | null
  defaultView?: { getComputedStyle(element: T): { display: string } } | null
}, storage: SwapStorage, on: boolean): boolean {
  if (!probeFrame(doc)) return false
  writeSwapPreference(storage, on)
  setSwapMark(doc.documentElement, on)
  return true
}

/** 结构还在时按偏好恢复标记；自检失败则去掉标记，不改偏好。 */
export function restoreSwap<T extends SwapNode<T>>(doc: {
  documentElement: SwapRoot
  querySelector(selector: string): T | null
  defaultView?: { getComputedStyle(element: T): { display: string } } | null
}, storage: SwapStorage): boolean {
  if (!probeFrame(doc)) {
    setSwapMark(doc.documentElement, false)
    return false
  }
  setSwapMark(doc.documentElement, readSwapPreference(storage))
  return true
}
