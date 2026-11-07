import React, { useEffect, useRef, useState, type RefObject } from 'react'
import { Graph, type IPointerEvent } from '@antv/g6'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Point } from './graph-model'
import { IconFitView, IconFullscreen, IconMinus, IconPlus } from './icons'
import { HintTooltip } from './tooltip'
import { graphCanvasData, graphPalette, type CanvasEdge, type CanvasNode } from './graph-appearance'
import { useVisualExpansion } from './visual-expansion'
import { SelectMenu } from './select-menu'

interface Props {
  nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[]; positions: ReadonlyMap<string, Point>
  selected?: string; onSelect(id?: string): void; focus?: { id: string }; label: string
  fullscreenRoot: RefObject<HTMLDivElement>
  dragged: { wide: Map<string, Point>; narrow: Map<string, Point> }
  compact?: boolean
  readingCards?: boolean
}
type Action = (graph: Graph) => Promise<void> | void

export function GraphCanvas(props: Props) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null)
  const latest = useRef(props); latest.current = props
  const commands = useRef<{ render(): void; run(action: Action): void }>()
  const [error, setError] = useState('')
  const { expanded: full, toggle: toggleExpanded } = useVisualExpansion(() => latest.current.fullscreenRoot.current)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const element = canvas.current!, wrapper = root.current!
    let disposed = false, graph: Graph | undefined, serial = Promise.resolve(), hover: string | undefined
    let theme = '', fitNext = true, rendered = false, oldFocus: Props['focus'], oldSize = ''
    const dragged = latest.current.dragged
    let narrow = false
    const report = () => { if (!disposed) { setReady(false); setError('图谱暂未加载，请重试。') } }
    const enqueue = (action: () => Promise<void> | void) => { serial = serial.then(() => { if (!disposed) return action() }).catch(report) }
    const render = async () => {
      const p = latest.current, width = Math.max(1, element.clientWidth)
      narrow = width < 460
      const owner = element.closest<HTMLElement>('.nw-viz')
      const expanded = latest.current.fullscreenRoot.current?.hasAttribute('data-visual-expanded')
      const layoutTop = element.getBoundingClientRect().top + (expanded ? 0 : owner?.scrollTop ?? 0)
      const composer = Number.parseFloat(getComputedStyle(element).getPropertyValue('--dsh-composer-height')) || 152
      const height = p.compact ? Math.max(p.readingCards ? 320 : 180, Math.min(420, window.innerHeight - layoutTop - composer - 70)) : 620
      element.style.height = height + 'px'
      latest.current.fullscreenRoot.current?.style.setProperty('--nw-graph-view-height', `${height + 90}px`)
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
        graph.on('aftertransform', () => schedule())
      }
      const size = `${width}:${height}`
      const oldDimensions = oldSize.split(':').map(Number)
      const center = rendered && oldSize && size !== oldSize ? graph.getCanvasByViewport([oldDimensions[0]! / 2, oldDimensions[1]! / 2]) : undefined
      const changedSize = size !== oldSize
      oldSize = size; theme = JSON.stringify(palette)
      const slots = new Map([...p.positions.keys()].map((id, i) => [id, { x: 65 + i % 3 * 118, y: 60 + Math.floor(i / 3) * 100 }]))
      const nodes = p.nodes.map(n => ({ ...n, ...(narrow && !p.compact ? slots.get(n.id) : undefined), ...dragged[narrow ? 'narrow' : 'wide'].get(n.id) }))
      if (changedSize) graph.setSize(width, height)
      graph.setData(graphCanvasData(nodes, p.edges, palette, p.selected, p.selected ? undefined : hover, narrow, rendered ? graph.getZoom() : 1))
      await graph.render()
      rendered = true
      if (disposed) return
      if (fitNext && nodes.length) { await graph.fitView({}, false); if (p.compact && graph.getZoom() > 1) await graph.zoomTo(1, false); fitNext = false }
      else if (center) {
        const next = graph.getViewportByCanvas(center)
        await graph.translateBy([width / 2 - next[0]!, height / 2 - next[1]!], false)
      }
      if (p.focus !== oldFocus && p.focus && nodes.some(n => n.id === p.focus!.id)) {
        await graph.zoomTo(narrow ? .85 : 1, false)
        await graph.focusElement(p.focus.id, false)
        oldFocus = p.focus
      }
      if (!disposed) {
        wrapper.dataset.graphZoom = String(graph.getZoom())
        wrapper.dataset.graphCenter = JSON.stringify(graph.getCanvasByViewport([width / 2, height / 2]))
        setError(''); setReady(true)
      }
    }
    const schedule = () => enqueue(render)
    commands.current = { render: schedule, run: action => enqueue(async () => { if (graph) await action(graph) }) }
    const resized = new ResizeObserver(() => { if (`${element.clientWidth}:${element.clientHeight}` !== oldSize) schedule() })
    resized.observe(element)
    const changedTheme = () => { if (JSON.stringify(graphPalette(wrapper)) !== theme) schedule() }
    const observer = new MutationObserver(changedTheme)
    for (let ancestor = wrapper.parentElement; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
    const media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', changedTheme)
    schedule()
    return () => {
      disposed = true; commands.current = undefined; resized.disconnect(); observer.disconnect()
      media.removeEventListener('change', changedTheme)
      // Let an in-flight draw settle before releasing its canvas, including StrictMode remounts.
      void serial.finally(() => graph?.destroy())
    }
  }, [])
  useEffect(() => { commands.current?.render() }, [props.nodes, props.edges, props.selected, props.focus, props.positions])
  const zoom = (factor: number) => commands.current?.run(g => g.zoomTo(Math.max(.15, Math.min(3, g.getZoom() * factor)), false))
  const fit = () => commands.current?.run(g => g.fitView({}, false))
  return <div className="nw-map nw-g6-map" ref={root} data-ready={ready} data-compact={props.compact || undefined}>
    <div className="nw-map-tools"><HintTooltip tip="缩小 · -"><button type="button" className="nw-icon" onClick={() => zoom(1 / 1.2)} aria-label="缩小"><IconMinus size={16} /></button></HintTooltip><HintTooltip tip="放大 · +"><button type="button" className="nw-icon" onClick={() => zoom(1.2)} aria-label="放大"><IconPlus size={16} /></button></HintTooltip><Button variant="ghost" size="sm" icon={<IconFitView size={14} />} onClick={fit}>查看全图</Button><Button data-visual-expand="" variant="ghost" size="sm" icon={<IconFullscreen size={14} />} onClick={toggleExpanded}>{full ? '退出全屏' : '全屏'}</Button></div>
    <div className="nw-g6-scroll" role="group" aria-label={props.label} tabIndex={0} onKeyDown={event => {
      if (event.target !== event.currentTarget) return
      const moves: Record<string, [number, number]> = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2) }
      else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2) }
      else if (event.key === '0') { event.preventDefault(); fit() }
      else if (moves[event.key]) { event.preventDefault(); commands.current?.run(g => g.translateBy(moves[event.key]!, false)) }
    }}><div className="nw-g6-canvas" ref={canvas} /></div>
    <div className="nw-map-accessible"><SelectMenu label="选择图谱记录" value={props.selected ?? ''} onChange={id => props.onSelect(id || undefined)}
      options={[{ value: '', label: '选择人物、关系或星团' }, ...props.nodes.map(n => ({ value: n.id, label: `${n.kind}：${n.label}${n.sublabel ? '，' + n.sublabel : ''}` })),
        ...props.edges.filter(e => !e.grouped).map(e => ({ value: e.id, label: `关系：${e.label}（${props.nodes.find(n => n.id === e.from)?.label} → ${props.nodes.find(n => n.id === e.to)?.label}）` }))]} /></div>
    {error ? <p className="nw-g6-error" role="alert">{error}<Button className="nw-g6-retry" variant="outline" size="sm" onClick={() => commands.current?.render()}>重试</Button></p> : null}
  </div>
}
