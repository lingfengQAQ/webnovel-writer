import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Expand, Focus, Minus, Network, Plus } from 'lucide-react'
import { artworkEdges, artworkNodes, artworkSvg, artworkViewBox } from './workflow-artwork'
import type { NodeActivity, WorkflowNodeId } from './workflow-display'

interface Camera { x: number; y: number; w: number; h: number }
const initial: Camera = { x: artworkViewBox[0], y: artworkViewBox[1], w: artworkViewBox[2], h: artworkViewBox[3] }
interface Props { activities: readonly NodeActivity[]; selected?: string; focus?: { id: string }; onSelect(id: WorkflowNodeId): void; finalized?: boolean }

export function scopeArtworkSvg(prefix: string) {
  // Match only the id attribute, never the id suffix in data-node-id/data-edge-id.
  return artworkSvg.replace(/(\s)id="([^"]+)"/g, (_, space: string, id: string) => space + 'id="' + prefix + '-' + id + '"')
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => 'url(#' + prefix + '-' + id + ')')
}

export function ArchifyWorkflow({ activities, selected, focus, onSelect, finalized }: Props) {
  const root = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), art = useRef<SVGGElement>(null)
  const prefix = useId().replace(/:/g, '')
  // Static, reviewed build-time SVG only; no API text ever enters this HTML sink.
  const markup = useMemo(() => ({ __html: scopeArtworkSvg(prefix) }), [prefix])
  const [camera, setCamera] = useState(initial), [full, setFull] = useState(false), [related, setRelated] = useState(false), [error, setError] = useState('')
  const drag = useRef<{ clientX: number; clientY: number; camera: Camera }>()
  const cameraRef = useRef(camera); cameraRef.current = camera
  const fullscreenRoot = () => root.current?.closest<HTMLElement>('.nw-flow-explorer') ?? root.current
  const nearby = useMemo(() => new Set([selected, ...artworkEdges.flatMap(e => e.from === selected ? [e.to] : e.to === selected ? [e.from] : [])]), [selected])

  useEffect(() => {
    for (const node of art.current?.querySelectorAll<SVGGElement>('g[data-node-id]') ?? []) {
      const id = node.dataset.nodeId!, activity = activities.find(a => a.id === id)
      const label = id === 'wait' && finalized ? '已定稿' : activity?.label
      node.setAttribute('aria-label', (node.dataset.nodeLabel ?? id) + (label ? '，' + label : ''))
      node.setAttribute('aria-pressed', String(id === selected))
      node.dataset.runState = activity?.state ?? ''
      node.dataset.relatedHidden = String(Boolean(related && selected && !nearby.has(id)))
      node.dataset.activeCount = String(activity?.activeCount ?? 0)
    }
    for (const edge of art.current?.querySelectorAll<SVGPathElement>('[data-edge-from]') ?? []) {
      edge.dataset.relatedHidden = String(Boolean(related && selected && edge.dataset.edgeFrom !== selected && edge.dataset.edgeTo !== selected))
    }
  }, [activities, selected, related, nearby, finalized])
  useEffect(() => {
    const target = artworkNodes.find(n => n.id === focus?.id)
    if (target) setCamera({ x: target.x + target.width / 2 - 220, y: target.y + target.height / 2 - 200, w: 440, h: 400 })
  }, [focus])
  const zoom = (factor: number) => setCamera(c => {
    const w = Math.max(260, Math.min(1800, c.w * factor)), h = c.h * w / c.w
    return { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h }
  })
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const matrix = element.getScreenCTM()?.inverse()
      if (!matrix) return
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix)
      setCamera(c => {
        const factor = Math.exp(Math.max(-.25, Math.min(.25, event.deltaY * .001)))
        const w = Math.max(260, Math.min(1800, c.w * factor)), ratio = w / c.w
        return { x: p.x - (p.x - c.x) * ratio, y: p.y - (p.y - c.y) * ratio, w, h: c.h * ratio }
      })
    }
    const changed = () => setFull(document.fullscreenElement === fullscreenRoot())
    element.addEventListener('wheel', wheel, { passive: false })
    document.addEventListener('fullscreenchange', changed)
    return () => { element.removeEventListener('wheel', wheel); document.removeEventListener('fullscreenchange', changed) }
  }, [])
  const select = (target: EventTarget | null) => {
    const id = target instanceof Element ? target.closest<SVGGElement>('g[data-node-id]')?.dataset.nodeId : undefined
    if (id && artworkNodes.some(n => n.id === id)) onSelect(id as WorkflowNodeId)
  }
  return <div ref={root} className="nw-archify">
    <div className="nw-map-tools">
      <button type="button" aria-label="缩小" onClick={() => zoom(1.2)}><Minus size={15} /></button>
      <button type="button" aria-label="放大" onClick={() => zoom(1 / 1.2)}><Plus size={15} /></button>
      <button type="button" onClick={() => setCamera(initial)}><Focus size={15} />查看全图</button>
      <button type="button" disabled={!selected} aria-pressed={related} onClick={() => setRelated(!related)}><Network size={15} />查看关联</button>
      <button type="button" onClick={() => { setError(''); void (full ? document.exitFullscreen() : fullscreenRoot()?.requestFullscreen())?.catch(() => setError('暂时无法全屏')) }}><Expand size={15} />{full ? '退出全屏' : '全屏'}</button>
    </div>
    <svg ref={svg} viewBox={[camera.x, camera.y, camera.w, camera.h].join(' ')} role="group" aria-label="写作流程图" tabIndex={0}
      onClick={e => select(e.target)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { if (e.target !== e.currentTarget) { e.preventDefault(); select(e.target) }; return }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1 / 1.2) }
        if (e.key === '-') { e.preventDefault(); zoom(1.2) }
        if (e.key === '0') { e.preventDefault(); setCamera(initial) }
        const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
        const move = moves[e.key]
        if (move && e.target === e.currentTarget) { e.preventDefault(); setCamera(c => ({ ...c, x: c.x + move[0] * c.w * .1, y: c.y + move[1] * c.h * .1 })) }
      }}
      onPointerDown={e => {
        if (e.button !== 0 || (e.target as Element).closest('[data-node-id]')) return
        drag.current = { clientX: e.clientX, clientY: e.clientY, camera: cameraRef.current }; e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const start = drag.current, matrix = svg.current?.getScreenCTM()?.inverse()
        if (!start || !matrix) return
        const a = new DOMPoint(start.clientX, start.clientY).matrixTransform(matrix), b = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
        setCamera({ ...start.camera, x: start.camera.x + a.x - b.x, y: start.camera.y + a.y - b.y })
      }} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }} onLostPointerCapture={() => { drag.current = undefined }}>
      <g ref={art} dangerouslySetInnerHTML={markup} />
      <g className="nw-archify-badges" aria-hidden="true">{artworkNodes.map(node => {
        const activity = activities.find(a => a.id === node.id)
        const label = node.id === 'wait' && finalized ? '已定稿' : activity?.label
        if (!label) return null
        const width = Math.max(44, Array.from(label).length * 8 + 12)
        return <g key={node.id} data-related-hidden={Boolean(related && selected && !nearby.has(node.id))} className={'nw-archify-badge state-' + (node.id === 'wait' ? 'success' : activity?.state)} transform={'translate(' + (node.x + node.width - width - 5) + ',' + (node.y - 9) + ')'}>
          <rect width={width} height={18} rx={5} /><text x={width / 2} y={12} textAnchor="middle">{label}</text>
        </g>
      })}</g>
    </svg>
    {error ? <p className="nw-viz-note" role="status">{error}</p> : null}
  </div>
}
