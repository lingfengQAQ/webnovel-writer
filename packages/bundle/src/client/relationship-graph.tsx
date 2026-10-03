import React, { useMemo, useRef, useState } from 'react'
import { ExternalLink, Network, Search, X } from 'lucide-react'
import { projectStoryGraph, storyGraphHistory, type StoryGraph } from '../study/graph-types'
import type { EditorStore } from './store'
import { useStudy } from './hooks'
import { GraphCanvas } from './graph-canvas'
import { graphKinds } from './graph-appearance'
import { graphLayout, graphPath, neighbors, type Point } from './graph-model'


export function RelationshipGraph({ sessionId, space, store, refresh }: { sessionId: string; space: string; store: EditorStore; refresh: number }) {
  const data = useStudy<StoryGraph>(sessionId, 'graph', { space }, refresh)
  const [at, setAt] = useState<number>(), [reader, setReader] = useState(false), [unknown, setUnknown] = useState(true), [plans, setPlans] = useState(false)
  const [query, setQuery] = useState(''), [picked, setPicked] = useState<string>(), [focus, setFocus] = useState<{ id: string }>()
  const [depth, setDepth] = useState(0), [target, setTarget] = useState('')
  const explorer = useRef<HTMLDivElement>(null)
  const dragged = useRef({ wide: new Map<string, Point>(), narrow: new Map<string, Point>() })
  const model = data.value
  const chapter = Math.min(at ?? model?.maxChapter ?? 1, model?.maxChapter ?? 1)
  const projected = useMemo(() => model ? projectStoryGraph(model, { chapter, reader, unknown, plans }) : undefined, [model, chapter, reader, unknown, plans])
  const cachedPositions = useRef(new Map<string, Point>())
  const positions = useMemo(() => {
    if (model) cachedPositions.current = graphLayout(model.records, model.edges, cachedPositions.current)
    return cachedPositions.current
  }, [model])
  if (data.error) return <p className="nw-error" role="alert">{data.error}</p>
  if (!model || !projected) return <p className="nw-empty">正在读取人物关系…</p>
  const selected = projected.nodes.find(n => n.id === picked) ?? projected.edges.find(e => e.id === picked)
  const selectedEdge = projected.edges.find(e => e.id === picked)
  const selectedNode = projected.nodes.find(n => n.id === picked)
  const related = selectedNode ? neighbors(selectedNode.id, projected.edges, depth || 1) : undefined
  const validTarget = projected.nodes.some(n => n.id === target) ? target : ''
  const route = selectedNode && validTarget ? graphPath(selectedNode.id, validTarget, projected.edges) : undefined
  const history = selected ? storyGraphHistory(model, selected.id, { chapter, reader, unknown, plans }) : []
  const needle = query.trim().toLocaleLowerCase()
  const matches = projected.nodes.filter(n => (n.label + ' ' + n.kind).toLocaleLowerCase().includes(needle))
  let visible = projected.nodes
  if (needle) {
    const ids = new Set(matches.flatMap(n => [...neighbors(n.id, projected.edges, 1)]))
    visible = [...matches, ...projected.nodes.filter(n => ids.has(n.id) && !matches.includes(n))]
  }
  if (depth && related) visible = visible.filter(n => related.has(n.id))
  if (route) { const ids = new Set(route); visible = projected.nodes.filter(n => ids.has(n.id)) }
  const count = visible.length
  visible = visible.slice(0, 180)
  const ids = new Set(visible.map(n => n.id))
  const edges = projected.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  const select = (id?: string) => { setPicked(id); setTarget(''); setDepth(0) }
  const reset = () => { setDepth(0); setTarget(''); setQuery('') }
  return <>
    <div className="nw-graph-time"><div><span>章节</span><strong>第 {chapter} 章</strong><button type="button" onClick={() => { setAt(model.maxChapter); setPicked(undefined); reset() }}>回到最新</button></div>
      <input aria-label="图谱章节时间线" type="range" min={1} max={model.maxChapter} value={chapter} onChange={e => { setAt(Number(e.target.value)); setPicked(undefined); reset() }} />
      <div className="nw-time-range"><span>第 1 章</span><span>第 {model.maxChapter} 章</span></div></div>
    <div className="nw-viz-toolbar"><label className="nw-viz-search"><Search size={16} /><input aria-label="搜索图谱" placeholder="找人物、找线索" value={query} onChange={e => { setQuery(e.target.value); setPicked(undefined); setDepth(0); setTarget('') }} /></label>
      <select aria-label="图谱信息视图" value={reader ? 'reader' : 'author'} onChange={e => { setReader(e.target.value === 'reader'); setPicked(undefined); reset() }}><option value="author">作者视角</option><option value="reader">仅已披露</option></select></div>
    {needle ? <div className="nw-map-search-results" aria-label="搜索结果">{matches.slice(0, 12).map(n => <button type="button" key={n.id} onClick={() => { setPicked(n.id); setTarget(''); setDepth(0); setFocus({ id: n.id }) }}>{n.label}<small>{n.kind}</small></button>)}{!matches.length ? <span>没有找到，换个词试试</span> : null}</div> : null}
    <div className="nw-graph-options"><label><input type="checkbox" checked={unknown} disabled={reader} onChange={e => { setUnknown(e.target.checked); setPicked(undefined); reset() }} />时间未标注</label><label><input type="checkbox" checked={plans} onChange={e => { setPlans(e.target.checked); setPicked(undefined); reset() }} />包括计划</label><span>{visible.length} 个节点 · {edges.length} 条关联</span></div>
    <div className="nw-graph-legend">{Object.entries(graphKinds).map(([name, kind]) => <span key={name}><i className={`kind-${kind.key}`} />{name}</span>)}<span>实线 · 关系</span><span>虚线箭头 · 引用</span></div>
    <div ref={explorer} className={`nw-story-explorer nw-explorer ${selected ? 'has-detail' : ''}`}>
      {visible.length ? <GraphCanvas label="人物关系图" positions={positions} dragged={dragged.current} fullscreenRoot={explorer}
        nodes={visible.map(n => ({ ...positions.get(n.id)!, id: n.id, label: n.label, kind: n.kind, plan: n.plan,
          sublabel: n.status || (n.chapter ? `第 ${n.chapter} 章` : '时间未标注'),
          muted: !!selectedNode && !related?.has(n.id) && !route?.includes(n.id) }))}
        edges={edges.map(e => ({ ...e, dashed: !e.relation, active: route ? route.some((id, i) => i < route.length - 1 &&
          (e.from === id && e.to === route[i + 1] || e.relation && e.to === id && e.from === route[i + 1])) :
          e.id === picked || !!selectedNode && (e.from === picked || e.to === picked) }))}
        selected={picked} focus={focus} onSelect={select} />
        : <div className="nw-graph-empty"><Network size={38} /><h3>{model.records.length ? '当前没有匹配记录' : '还没有人物关系'}</h3><p>{model.records.length ? '调整章节或筛选条件试试。' : '人物、关系与事件会随写作逐步呈现。'}</p></div>}
      {selected ? <aside className="nw-inspector"><button className="nw-icon" type="button" aria-label="关闭详情" onClick={() => { setPicked(undefined); setDepth(0); setTarget('') }}><X size={16} /></button><small>{selected.kind}{selected.plan ? ' · 计划' : ''}</small><h3>{selected.label}</h3><p>{selected.status || '状态未标注'} · {selected.chapter === undefined ? '时间未标注' : `第 ${selected.chapter} 章`}</p>
        <p>{selected.revealChapter === undefined ? '披露章未标注' : `第 ${selected.revealChapter} 章披露`}{selected.endChapter === undefined ? '' : ` · 第 ${selected.endChapter} 章起失效`}</p>
        {selectedNode ? <><div className="nw-inspector-actions"><button type="button" aria-pressed={depth === 1} onClick={() => { setDepth(depth === 1 ? 0 : 1); setTarget('') }}>直接关联</button><button type="button" aria-pressed={depth === 2} onClick={() => { setDepth(depth === 2 ? 0 : 2); setTarget('') }}>更多关联</button></div>
          <label className="nw-path-picker">查关系<select aria-label="关系终点" value={validTarget} onChange={e => { setTarget(e.target.value); setDepth(0); setQuery('') }}><option value="">选一个人物或条目</option>{projected.nodes.filter(n => n.id !== picked).map(n => <option key={n.id} value={n.id}>{n.label} · {n.kind}</option>)}</select></label>
          {validTarget ? <p role="status">{route ? route.map(id => projected.nodes.find(n => n.id === id)?.label).join(' → ') : '没有找到可连接的路径'}</p> : null}
          {depth || target ? <button className="nw-text-button" type="button" onClick={reset}>清除筛选</button> : null}</> : null}
        <details key={selected.id} className="nw-related-records"><summary>关联记录</summary>
          {selectedNode ? projected.edges.filter(e => e.from === picked || e.to === picked).map(e => {
            const other = projected.nodes.find(n => n.id === (e.from === picked ? e.to : e.from))!
            return <div key={e.id}><button type="button" onClick={() => { select(other.id); setQuery(''); setFocus({ id: other.id }) }}>{other.label}</button><button type="button" aria-label={`查看关系：${e.label}`} onClick={() => select(e.id)}>{e.label}{e.plan ? ' · 计划' : ''}</button></div>
          }) : selectedEdge ? [selectedEdge.from, selectedEdge.to].map(id => <button key={id} type="button" onClick={() => { select(id); setQuery(''); setFocus({ id }) }}>{projected.nodes.find(n => n.id === id)?.label}</button>) : null}
        </details>
        <h4>历史记录</h4><ol className="nw-graph-history">{history.map((past, i) => <li key={i}><small>{past.chapter === undefined ? '时间未标注' : `第 ${past.chapter} 章`}</small><span>{past.label} · {past.status || '状态未标注'}{past.plan ? ' · 计划' : ''}{past.endChapter === undefined ? '' : ` · 第 ${past.endChapter} 章起失效`}</span><button type="button" aria-label={`打开第 ${past.line} 行历史来源`} onClick={() => void store.open(sessionId, past.source)}>打开原文</button></li>)}</ol>
        <h4>简介</h4><p className="nw-inspector-body">{selected.preview || '暂无简介'}</p><h4>出处</h4><small className="nw-source-path">{selected.source.path} · 第 {selected.line} 行</small><button className="nw-source-button" type="button" onClick={() => void store.open(sessionId, selected.source)}><ExternalLink size={14} />打开原文</button></aside> : null}
    </div>
    {count > 180 ? <p className="nw-viz-note">当前显示 {count} 个匹配节点中的前 180 个，搜索可缩小范围。</p> : null}
    {projected.unknown > 0 ? <p className="nw-viz-note">{projected.unknown} 条记录尚未标注时间{reader ? '；未明确披露的记录已隐藏' : ''}。</p> : null}
    {projected.events.length ? <section className="nw-graph-events"><h3>故事足迹 <small>{projected.events.length}</small></h3><div>{projected.events.slice(-40).map(event => <button type="button" key={`${event.id}:${event.chapter}:${event.line}`} onClick={() => { if (event.chapter) setAt(event.chapter); select(event.id); setFocus({ id: event.id }); reset() }}><small>{event.chapter ? `第 ${event.chapter} 章` : '时间未标注'}</small><strong>{event.label}</strong></button>)}</div>{projected.events.length > 40 ? <p className="nw-viz-note">展示最近 40 条，可沿章节回看。</p> : null}</section> : null}
    {model.warnings.length ? <details className="nw-viz-notes"><summary>资料提示 · {model.warnings.length}</summary><ul>{model.warnings.map((w, i) => <li key={i}>{w.path}：{w.message}</li>)}</ul></details> : null}
  </>
}
