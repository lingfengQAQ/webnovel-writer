import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import manifest from '../assets/manifest.json'
import { actions, labels, sizes, constrain, type CompanionStore, type Position } from './state'
import { PetPlayer } from './player'

export interface PetProps { store: CompanionStore }
function usePlayback() {
  const [visible, setVisible] = useState(!document.hidden)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const visibility = () => setVisible(!document.hidden)
    const motion = () => setReduced(query.matches)
    document.addEventListener('visibilitychange', visibility); query.addEventListener('change', motion)
    return () => { document.removeEventListener('visibilitychange', visibility); query.removeEventListener('change', motion) }
  }, [])
  return visible && !reduced
}

export function PetOverlay({ store }: PetProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight })
  const [position, setPosition] = useState<Position | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ x: number; y: number; origin: Position; moved: boolean; id: number }>()
  const ignoreClick = useRef(false)
  const animate = usePlayback()
  const height = Math.min(sizes[state.preferences.size], Math.max(80, viewport.height - 16))
  const point = constrain(position ?? state.preferences.position, height, viewport.width, viewport.height)
  useEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => { if (!drag.current) setPosition(null) }, [state.preferences.position])
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !menuButton.current?.contains(event.target)) setMenu(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])
  useEffect(() => { if (!state.preferences.visible) setMenu(false) }, [state.preferences.visible])
  const close = () => { setMenu(false); menuButton.current?.focus() }
  const finishDrag = (event: React.PointerEvent<SVGPathElement>, canceled = false) => {
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    drag.current = undefined
    ignoreClick.current = start.moved || canceled
    if (start.moved && !canceled) store.preferences({ position: point })
    setPosition(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  if (!state.preferences.visible) return null
  return <section className="whale-companion" aria-label="鲸鱼娘桌宠" data-action={state.action}
    style={{ left: point.x, top: point.y, width: height * .75, height }}>
    <PetPlayer action={state.action} animate={animate} store={store} />
    <svg className="whale-hit" viewBox={`0 0 ${manifest.width} ${manifest.height}`} aria-label="鲸鱼娘">
      <path d={manifest.hitPath} fill="transparent" role="button" tabIndex={0} aria-label="与鲸鱼娘互动；按 Shift F10 打开菜单"
        onPointerDown={event => {
          if (event.button !== 0) return
          ignoreClick.current = false; store.touch()
          drag.current = { x: event.clientX, y: event.clientY, origin: point, moved: false, id: event.pointerId }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const start = drag.current
          if (!start || start.id !== event.pointerId) return
          const dx = event.clientX - start.x, dy = event.clientY - start.y
          if (Math.hypot(dx, dy) > 5) start.moved = true
          if (start.moved) setPosition(constrain({ x: start.origin.x + dx, y: start.origin.y + dy }, height, viewport.width, viewport.height))
        }}
        onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)}
        onClick={() => { if (ignoreClick.current) { ignoreClick.current = false; return } store.preview('interact') }}
        onContextMenu={event => { event.preventDefault(); setMenu(true) }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); store.preview('interact') }
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setMenu(true) }
        }} />
    </svg>
    <button className="whale-menu-button" ref={menuButton} type="button" title="桌宠设置" aria-label="打开桌宠菜单" aria-expanded={menu}
      onClick={() => setMenu(value => !value)}>···</button>
    <span className="whale-caption" aria-live="polite">{state.label}</span>
    {menu && <div className="whale-menu" ref={menuRef} role="dialog" aria-label="桌宠菜单"
      style={{ ...(point.x < 220 ? { left: 0 } : { right: 0 }), ...(point.y < 200 ? { top: 28 } : { bottom: 0 }) }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <div className="whale-menu-heading"><strong>鲸鱼娘</strong><button type="button" aria-label="关闭桌宠菜单" onClick={close}>×</button></div>
      <label>大小<select aria-label="桌宠大小" value={state.preferences.size} onChange={e => store.preferences({ size: e.target.value as keyof typeof sizes })}>
        <option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label>
      <button type="button" disabled={state.busy} onClick={() => { state.action === 'rest' ? store.touch() : store.sleep(); close() }}>{state.action === 'rest' ? '唤醒' : '休息一下'}</button>
      <button type="button" onClick={() => { store.preferences({ position: null }); setPosition(null); close() }}>重置位置</button>
      <button type="button" onClick={() => store.preferences({ visible: false })}>隐藏桌宠</button>
      <small>可从设置 → 通用 → 鲸鱼娘桌宠恢复</small>
      <details><summary>预览动作</summary><div className="whale-previews">{actions.map(action => <button type="button" key={action} disabled={state.busy}
        onClick={() => { store.preview(action); close() }}>{labels[action]}</button>)}</div>{state.busy && <small>当前会话工作中，结束后可预览。</small>}</details>
      {state.mediaError && <p role="status">{state.mediaError}</p>}
    </div>}
  </section>
}

export function PetSettings({ store }: PetProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <section className="whale-settings" aria-label="鲸鱼娘桌宠设置">
    <div><strong>鲸鱼娘桌宠</strong><p>在窗口里陪你写作，跟随当前会话切换动作。</p></div>
    <label><input type="checkbox" checked={state.preferences.visible} onChange={e => store.preferences({ visible: e.target.checked })} />显示桌宠</label>
    <label>大小<select aria-label="设置桌宠大小" value={state.preferences.size} onChange={e => store.preferences({ size: e.target.value as keyof typeof sizes })}>
      <option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label>
    <button type="button" onClick={() => store.preferences({ visible: true, position: null })}>恢复默认位置</button>
    {state.mediaError && <p role="status">{state.mediaError}</p>}
  </section>
}
