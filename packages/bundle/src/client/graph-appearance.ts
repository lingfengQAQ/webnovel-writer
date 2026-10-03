import type { GraphData } from '@antv/g6'
import type { Point } from './graph-model'

export const graphKinds: Readonly<Record<string, { key: string; type: string; size: number | [number, number] }>> = {
  人物: { key: 'person', type: 'circle', size: 68 },
  组织: { key: 'organization', type: 'rect', size: [98, 48] },
  地点: { key: 'place', type: 'ellipse', size: [102, 54] },
  事件: { key: 'event', type: 'rect', size: [102, 46] },
  线索: { key: 'clue', type: 'diamond', size: [102, 76] },
}
export interface CanvasNode extends Point { id: string; label: string; kind: string; sublabel?: string; plan?: boolean; muted?: boolean }
export interface CanvasEdge { id: string; from: string; to: string; label: string; dashed?: boolean; active?: boolean }
export type GraphPalette = Record<string, string>

/** Resolve host CSS into canvas colors, including color-mix and theme changes. */
export function graphPalette(root: HTMLElement): GraphPalette {
  const probe = document.createElement('span'); probe.hidden = true; root.append(probe)
  const color = (value: string) => { probe.style.color = value; return getComputedStyle(probe).color }
  const palette: GraphPalette = { bg: color('var(--dsw-alias-bg-base)'), text: color('var(--dsw-alias-label-primary)'),
    line: color('var(--dsw-alias-border-l3)'), active: color('var(--dsw-alias-link)') }
  for (const { key } of Object.values(graphKinds)) {
    palette[key] = color(`var(--nw-graph-${key})`)
    palette[key + 'Fill'] = color(`color-mix(in srgb,var(--nw-graph-${key}) 11%,var(--dsw-alias-bg-base))`)
  }
  probe.remove()
  return palette
}

export function graphCanvasData(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], palette: GraphPalette, selected?: string, hover?: string, narrow = false): GraphData {
  const picked = hover ?? selected, nodePicked = nodes.some(n => n.id === picked)
  const selectedEdge = edges.find(e => e.id === picked)
  const near = hover ? new Set([hover, ...edges.filter(e => e.from === hover || e.to === hover).flatMap(e => [e.from, e.to])])
    : selectedEdge ? new Set([selectedEdge.from, selectedEdge.to]) : undefined
  return {
    nodes: nodes.map(n => {
      const kind = graphKinds[n.kind] ?? graphKinds.事件!
      return { id: n.id, type: kind.type, data: { label: n.label, kind: n.kind }, style: { x: n.x, y: n.y, size: kind.size,
        fill: palette[kind.key + 'Fill'], stroke: n.id === picked ? palette.active : n.plan ? palette[kind.key] : palette.line,
        lineWidth: n.id === picked ? 2.5 : 1, opacity: near ? near.has(n.id) ? 1 : .23 : n.muted ? .23 : 1,
        halo: false, lineDash: n.plan ? [5, 3] : [], radius: n.kind === '事件' ? 16 : 5,
        labelText: Array.from(n.label).length > 9 ? Array.from(n.label).slice(0, 8).join('') + '…' : n.label,
        labelPlacement: 'center', labelFill: palette.text, labelFontSize: narrow ? 18 : 15,
        labelFontFamily: 'system-ui,sans-serif', labelFontWeight: 400, cursor: 'pointer' } }
    }),
    edges: edges.map((e, index) => {
      const active = hover ? e.from === hover || e.to === hover : e.active || e.id === picked
      return { id: e.id, source: e.from, target: e.to, data: { label: e.label }, style: {
        stroke: active ? palette.active : palette.line, lineWidth: active ? 1.8 : 1.2,
        opacity: (nodePicked || selectedEdge) && !active ? .18 : 1, halo: false,
        lineDash: e.dashed ? [4, 4] : [], endArrow: !!e.dashed, endArrowSize: 5,
        labelText: active || nodes.length < 12 ? e.label : '', labelFontSize: 13, labelFontWeight: 400,
        labelFill: palette.text, labelAutoRotate: false, labelBackground: true, labelBackgroundFill: palette.bg,
        labelPadding: [2, 4], curveOffset: 10 + index % 3 * 12, cursor: 'pointer' } }
    }),
  }
}
