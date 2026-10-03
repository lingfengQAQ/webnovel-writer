import React, { useEffect, useRef, useState, type RefObject } from 'react'
import { Graph, type IPointerEvent } from '@antv/g6'
import { Expand, Focus, Minus, Plus } from 'lucide-react'
import type { Point } from './graph-model'
import { graphCanvasData, graphPalette, type CanvasEdge, type CanvasNode } from './graph-appearance'

interface Props {
  nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[]; positions: ReadonlyMap<string, Point>
  selected?: string; onSelect(id?: string): void; focus?: { id: string }; label: string
  fullscreenRoot: RefObject<HTMLDivElement>
  dragged: { wide: Map<string, Point>; narrow: Map<string, Point> }
}
type Action = (graph: Graph) => Promise<void> | void

export function GraphCanvas(props: Props) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null)
  const latest = useRef(props); latest.current = props
  const commands = useRef<{ render(): void; run(action: Action): void }>()
  const [full, setFull] = useState(false), [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const element = canvas.current!, wrapper = root.current!
    let disposed = false, graph: Graph | undefined, serial = Promise.resolve(), hover: string | undefined
    let fingerprint = '', theme = '', fitNext = true, oldFocus: Props['focus'], oldSize = ''
    const dragged = latest.current.dragged
    let narrow = false
    const report = () => { if (!disposed) { setReady(false); setError('图谱暂未加载，请重试。') } }
    const enqueue = (action: () => Promise<void> | void) => { serial = serial.then(() => { if (!disposed) return action() }).catch(report) }
    const render = async () => {
      const p = latest.current, width = Math.max(1, element.clientWidth)
      narrow = width < 460
      const height = narrow ? Math.max(620, Math.ceil(p.positions.size / 3) * 100 * width / 360) : 620
      element.style.height = height + 'px'
      const palette = graphPalette(wrapper)
      if (!graph) {
        graph = new Graph({ container: element, width, height, animation: false, padding: 24, zoomRange: [.15, 3],
          node: { type: n => String(n.type ?? 'circle') }, edge: { type: 'quadratic' },
          behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'] })
        graph.on('node:click', (e: IPointerEvent) => 'id' in e.target && latest.current.onSelect(e.target.id))
        graph.on('edge:click', (e: IPointerEvent) => 'id' in e.target && latest.current.onSelect(e.target.id))
        graph.on('canvas:click', () => latest.current.onSelect(undefined))
        graph.on('node:pointerover', (e: IPointerEvent) => { if (!latest.current.selected) { hover = 'id' in e.target ? e.target.id : undefined; schedule() } })
        graph.on('node:pointerout', () => { if (hover) { hover = undefined; schedule() } })
        graph.on('node:dragend', () => {
          if (!graph) return
          for (const n of graph.getNodeData()) {
            const [x, y] = graph.getElementPosition(n.id)
            if (x !== undefined && y !== undefined) dragged[narrow ? 'narrow' : 'wide'].set(n.id, { x, y })
          }
        })
      }
      const size = `${width}:${height}`, key = p.nodes.map(n => n.id).join('\n') + ':' + narrow
      if (key !== fingerprint || size !== oldSize) fitNext = true
      fingerprint = key; oldSize = size; theme = JSON.stringify(palette)
      const slots = new Map([...p.positions.keys()].map((id, i) => [id, { x: 65 + i % 3 * 118, y: 60 + Math.floor(i / 3) * 100 }]))
      const nodes = p.nodes.map(n => ({ ...n, ...(narrow ? slots.get(n.id) : undefined), ...dragged[narrow ? 'narrow' : 'wide'].get(n.id) }))
      graph.setSize(width, height)
      graph.setData(graphCanvasData(nodes, p.edges, palette, p.selected, p.selected ? undefined : hover, narrow))
      await graph.render()
      if (disposed) return
      if (fitNext && nodes.length) { await graph.fitView({}, false); fitNext = false }
      if (p.focus !== oldFocus && p.focus && nodes.some(n => n.id === p.focus!.id)) {
        await graph.zoomTo(narrow ? .85 : 1, false)
        await graph.focusElement(p.focus.id, false)
        oldFocus = p.focus
      }
      if (!disposed) { setError(''); setReady(true) }
    }
    const schedule = () => enqueue(render)
    commands.current = { render: schedule, run: action => enqueue(async () => { if (graph) await action(graph) }) }
    const resized = new ResizeObserver(() => { if (`${element.clientWidth}:${element.clientHeight}` !== oldSize) schedule() })
    resized.observe(element)
    const changedTheme = () => { if (JSON.stringify(graphPalette(wrapper)) !== theme) schedule() }
    const observer = new MutationObserver(changedTheme)
    for (let ancestor = wrapper.parentElement; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
    const media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', changedTheme)
    const changedFullscreen = () => setFull(document.fullscreenElement === latest.current.fullscreenRoot.current)
    document.addEventListener('fullscreenchange', changedFullscreen)
    schedule()
    return () => {
      disposed = true; commands.current = undefined; resized.disconnect(); observer.disconnect()
      media.removeEventListener('change', changedTheme); document.removeEventListener('fullscreenchange', changedFullscreen)
      // Let an in-flight draw settle before releasing its canvas, including StrictMode remounts.
      void serial.finally(() => graph?.destroy())
    }
  }, [])
  useEffect(() => { commands.current?.render() }, [props.nodes, props.edges, props.selected, props.focus, props.positions])
  const zoom = (factor: number) => commands.current?.run(g => g.zoomTo(Math.max(.15, Math.min(3, g.getZoom() * factor)), false))
  const fit = () => commands.current?.run(g => g.fitView({}, false))
  return <div className="nw-map nw-g6-map" ref={root} data-ready={ready}>
    <div className="nw-map-tools"><button type="button" onClick={() => zoom(1 / 1.2)} aria-label="缩小"><Minus size={16} /></button><button type="button" onClick={() => zoom(1.2)} aria-label="放大"><Plus size={16} /></button><button type="button" onClick={fit}><Focus size={15} />查看全图</button><button type="button" onClick={() => {
      void (full ? document.exitFullscreen() : props.fullscreenRoot.current?.requestFullscreen())?.catch(() => setError('暂时无法全屏'))
    }}><Expand size={15} />{full ? '退出全屏' : '全屏'}</button></div>
    <div className="nw-g6-scroll" role="group" aria-label={props.label} tabIndex={0} onKeyDown={event => {
      if (event.target !== event.currentTarget) return
      const moves: Record<string, [number, number]> = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2) }
      else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2) }
      else if (event.key === '0') { event.preventDefault(); fit() }
      else if (moves[event.key]) { event.preventDefault(); commands.current?.run(g => g.translateBy(moves[event.key]!, false)) }
    }}><div className="nw-g6-canvas" ref={canvas} /></div>
    <label className="nw-map-accessible">选择图谱记录<select aria-label="选择图谱记录" value={props.selected ?? ''} onChange={e => props.onSelect(e.target.value || undefined)}>
      <option value="">选择人物、关系或条目</option>
      <optgroup label="人物与条目">{props.nodes.map(n => <option key={n.id} value={n.id}>{n.kind}：{n.label}{n.sublabel ? '，' + n.sublabel : ''}</option>)}</optgroup>
      <optgroup label="关系">{props.edges.map(e => <option key={e.id} value={e.id}>关系：{e.label}（{props.nodes.find(n => n.id === e.from)?.label} → {props.nodes.find(n => n.id === e.to)?.label}）</option>)}</optgroup>
    </select></label>
    {error ? <p className="nw-g6-error" role="alert">{error}<button type="button" onClick={() => commands.current?.render()}>重试</button></p> : null}
  </div>
}
