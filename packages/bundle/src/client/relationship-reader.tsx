import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Input, PathLabel, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StoryGraphRecord } from '../study/graph-types'
import type { GraphReaderRequest, GraphReaderView, ReaderPage, ReaderRelation } from '../study/graph-reader'
import { IconChevronLeft, IconChevronRight, IconClose, IconOpen, IconSearch } from './icons'
import type { EditorStore } from './store'
import type { ClientHost } from './host'
import { useStudy } from './hooks'
import { GraphCanvas } from './graph-canvas'
import { GraphControls } from './graph-controls'
import type { Point } from './graph-model'
import { SelectMenu } from './select-menu'
import { collapseVisual } from './visual-expansion'
import { DEFAULT_WEBNOVEL_PREFERENCES, type WebnovelPreferences } from '../preferences'

const MODES = [{ value: 'person', label: '人物聚焦' }, { value: 'chapter', label: '本章记录' }, { value: 'all', label: '全书星团' }] as const
const qualifiers: Record<string, string> = { asserted: '原文陈述', negated: '否定', reported: '他人说法', uncertain: '不确定或预期' }
function Pager({ page, label, change }: { page: ReaderPage<unknown>; label: string; change(value: number): void }) {
  if (page.pages < 2) return null
  return <div className="nw-reader-pages"><span className="nw-viz-note">{page.page + 1} / {page.pages} · {page.total}项</span>
    <Button size="sm" variant="ghost" icon={<IconChevronLeft size={14} />} aria-label={`上一页${label}`} disabled={!page.page} onClick={() => change(page.page - 1)} />
    <Button size="sm" variant="ghost" icon={<IconChevronRight size={14} />} aria-label={`下一页${label}`} disabled={page.page + 1 === page.pages} onClick={() => change(page.page + 1)} /></div>
}
const stateLabel = (view: GraphReaderView) => {
  const state = view.graph.index?.state
  if (view.graph.index?.cache === 'invalid') return '缓存待核对'
  if (!state?.enabled) return '未启用抽取'
  if (state.paused) return '已暂停'
  if (state.phase === 'running' || state.phase === 'queued') return `更新中 ${state.completed ?? 0}/${state.total ?? 0}`
  if (view.graph.index?.cache === 'stale') return '证据待更新'
  return state.phase === 'ready' ? '索引已就绪' : '索引需关注'
}

/** Pages are projected on the Host; full-book evidence never becomes a giant DOM or response. */
export function RelationshipGraph({ sessionId, space, store, refresh, host, preferences = DEFAULT_WEBNOVEL_PREFERENCES }: {
  sessionId: string; space: string; store: EditorStore; refresh: number; host?: ClientHost; preferences?: WebnovelPreferences
}) {
  const [version, setVersion] = useState(0), [request, setRequest] = useState<GraphReaderRequest>({ mode: 'person' })
  const [query, setQuery] = useState(''), [peopleOpen, setPeopleOpen] = useState(false), [recordsOpen, setRecordsOpen] = useState(false)
  const [focus, setFocus] = useState<{ id: string }>()
  const explorer = useRef<HTMLDivElement>(null), views = useId()
  const layout = useRef({ key: '', points: new Map<string, Point>() })
  const dragged = useRef({ wide: new Map<string, Point>(), narrow: new Map<string, Point>() })
  const options: GraphReaderRequest = { reader: preferences.defaultGraphPerspective === 'reader', unknown: preferences.defaultGraphShowUnknown,
    plans: preferences.defaultGraphShowPlans, ...request }
  const data = useStudy<GraphReaderView>(sessionId, 'graph-view', { space, ...options }, refresh + version)
  const prior = useRef<GraphReaderView>()
  if (data.value) prior.current = data.value
  const view = data.value ?? prior.current
  useEffect(() => {
    if (request.evidenceId && data.value) explorer.current?.querySelector('[data-evidence-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [request.evidenceId, data.value])
  const patch = (next: GraphReaderRequest) => setRequest(previous => ({ ...previous, ...next }))
  useEffect(() => {
    if (query === (request.query ?? '')) return
    const timer = setTimeout(() => patch({ query, catalogPage: 0, relationPage: 0, evidencePage: 0 }), 180)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (!view?.graph.index?.state?.enabled || view.graph.index.state.paused) return
    const timer = setTimeout(() => setVersion(value => value + 1), ['running', 'queued'].includes(view.graph.index.state.phase) ? 1500 : 15000)
    return () => clearTimeout(timer)
  }, [view])
  const points = useMemo(() => {
    if (!view) return new Map<string, Point>()
    const key = view.person?.id ?? ''
    if (layout.current.key !== key) { layout.current = { key, points: new Map() }; dragged.current.wide.clear(); dragged.current.narrow.clear() }
    const visible = new Set(view.graph.records.map(item => item.id))
    const positions = new Map([...layout.current.points].filter(([id]) => visible.has(id)))
    if (key) positions.set(key, { x: 300, y: 220 })
    let slot = 0
    for (const item of view.graph.records) if (!positions.has(item.id)) {
      let point: Point
      do {
        const angle = -Math.PI / 2 + slot % 8 / 8 * Math.PI * 2, ring = 1 + Math.floor(slot / 8); slot++
        point = { x: 300 + Math.cos(angle) * 235 * ring, y: 220 + Math.sin(angle) * 150 * ring }
      } while ([...positions.values()].some(value => Math.hypot(value.x - point.x, value.y - point.y) < 1))
      positions.set(item.id, point)
    }
    layout.current.points = positions
    return positions
  }, [view?.graph.records, view?.person?.id])
  if (!view) return <p className={data.error ? 'nw-error' : 'nw-empty'} role="status">{data.error || '正在读取关系索引…'}</p>
  const chapter = view.filter.chapter, mode = view.mode, person = view.person
  const selectPerson = (id: string) => {
    patch({ person: id, cluster: undefined, relation: undefined, relationPage: 0, evidencePage: 0, clusterPage: 0, memberPage: 0, transitionPage: 0, evidenceId: undefined, mode: 'person' })
    setRecordsOpen(false); setFocus({ id }); setPeopleOpen(false)
  }
  const selectRelation = (relation: ReaderRelation) => { patch({ relation: relation.id, evidencePage: 0, transitionPage: 0, evidenceId: undefined }); setRecordsOpen(true) }
  const select = (id?: string) => {
    if (id?.startsWith('group-link:')) id = id.slice(11)
    if (id?.startsWith('cluster:')) { patch({ cluster: id.slice(8), relation: undefined, relationPage: 0, memberPage: 0, evidencePage: 0, evidenceId: undefined }); setRecordsOpen(false); return }
    const edge = view.relations.items.find(item => item.id === id) ?? (view.selectedRelation?.id === id ? view.selectedRelation : undefined)
    if (edge) selectRelation(edge)
    else if (id) selectPerson(id)
  }
  const jumpChapter = (next: number) => patch({ chapter: next, relationPage: 0, evidencePage: 0 })
  const previous = view.recordChapters.filter(at => at < chapter).at(-1), next = view.recordChapters.find(at => at > chapter)
  const open = async (record: StoryGraphRecord) => {
    collapseVisual(explorer.current)
    await store.open(sessionId, record.source, view.evidence.find(item => item.id === record.evidenceId)?.location)
  }
  const sceneNames = new Map([...view.catalog.items, ...view.graph.records, ...(person ? [person] : [])].map(item => [item.id, item.label]))
  const otherName = (relation: ReaderRelation) => sceneNames.get(relation.from === person?.id ? relation.to : relation.from)
    ?? (relation.from === person?.id ? relation.to : relation.from).split('/').at(-1)?.replace(/\.md$/, '')
  const groupedEdges = view.graph.records.filter(item => item.kind === '星团' && person && mode !== 'all').map(item => ({ id: `group-link:${item.id}`, from: person!.id, to: item.id, label: '', grouped: true }))
  const selected = view.selectedRelation?.id ?? person?.id
  return <div className="nw-relations nw-reader" aria-busy={data.loading}>
    <div className="nw-reader-status"><span className="nw-viz-note">截至第 {chapter} 章 · {view.totals.entities}项资料 · {view.totals.evidence}条可见证据</span>
      <details className="nw-reader-manage"><summary className="nw-relation-options-title">{stateLabel(view)} · 管理</summary>
        <GraphControls graph={view.graph} {...{ sessionId, space, host }} changed={() => setVersion(value => value + 1)} openSource={path => { void store.open(sessionId, { space, path }) }} /></details></div>
    <div className="nw-reader-toolbar"><Button variant="ghost" size="sm" aria-expanded={peopleOpen} onClick={() => setPeopleOpen(value => !value)}>人物索引</Button>
      <SegmentedControl id={views} label="关系阅读方式" value={mode} options={MODES} onChange={mode => patch({ mode, cluster: undefined, relation: undefined, relationPage: 0, evidencePage: 0 })} />
      <details className="nw-relation-options"><summary className="nw-relation-options-title">阅读范围</summary><div className="nw-reader-filters">
        <SelectMenu label="星团分组字段" value={view.groupField ?? ''} options={view.groupFields.map(field => ({ value: field, label: field }))} onChange={groupField => patch({ groupField, cluster: undefined, clusterPage: 0, memberPage: 0, relationPage: 0 })} />
        <Checkbox checked={view.filter.reader} label="仅明确已披露" onChange={reader => patch({ reader })} />
        <Checkbox checked={view.filter.unknown} disabled={view.filter.reader} label="包括未知时间" onChange={unknown => patch({ unknown })} />
        <Checkbox checked={view.filter.plans} label="包括计划资料" onChange={plans => patch({ plans })} />
        <label className="nw-reader-field">较早关系阈值（章）<Input type="number" aria-label="较早关系阈值" min={1} max={1000000} value={request.foldAfter ?? 180} onChange={e => { const n = Number(e.target.value); if (Number.isSafeInteger(n) && n > 0) patch({ foldAfter: n, relationPage: 0 }) }} /></label>
        <span className="nw-viz-note">星团按可见势力/家族标签收纳较早证据，不表示退场或关系失效。</span></div></details>
    </div>
    {data.error ? <p className="nw-error" role="alert">{data.error}</p> : null}
    <div className={`nw-reader-workspace ${peopleOpen ? 'people-open' : ''}`}>
      <aside className="nw-people-index" aria-label="人物索引"><div className="nw-reader-section-head"><strong>人物与资料</strong><Tag>{view.catalog.total}</Tag></div>
        <Input icon={<IconSearch size={14} />} aria-label="搜索图谱" placeholder="姓名、别名、路径" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="nw-people-list">{view.catalog.items.map(item => <button type="button" className="nw-person-row" key={item.id} aria-pressed={person?.id === item.id} onClick={() => selectPerson(item.id)}>
          <span className="nw-person-name">{item.displayName}</span><span className="nw-person-note">{item.kind} · {item.recordChapter ? `最近记录 第${item.recordChapter}章` : '时间未知'}</span></button>)}</div>
        <Pager page={view.catalog} label="人物索引" change={catalogPage => patch({ catalogPage })} />
      </aside>
      <div className="nw-reader-content">
        <div className="nw-reader-breadcrumb"><strong>{person?.displayName ?? '关系资料'}</strong>
          {view.cluster ? <><span className="nw-viz-note">/ {view.cluster.label} · {view.cluster.members}人</span><Button variant="ghost" size="sm" icon={<IconClose size={14} />} onClick={() => patch({ cluster: undefined, relationPage: 0 })}>收起星团</Button></> : <span className="nw-viz-note">{view.clusters.total}个星团 · {view.groupField ? `按「${view.groupField}」` : '未标分组字段'} · 超过{view.foldAfter}章无新证据时折叠</span>}</div>
        <div ref={explorer} className="nw-story-explorer nw-explorer has-detail nw-reader-explorer">
          <div className="nw-reader-canvas-column"><GraphCanvas label="人物关系图" compact readingCards positions={points} dragged={dragged.current} fullscreenRoot={explorer}
            nodes={view.graph.records.map(node => ({ ...points.get(node.id)!, id: node.id, label: node.label, kind: node.kind, sublabel: node.status, plan: node.plan, card: true }))}
            edges={[...view.graph.edges.map(edge => ({ ...edge, label: `${edge.label}${edge.qualifier && edge.qualifier !== 'asserted' ? ' · ' + qualifiers[edge.qualifier] : ''}`,
              caption: `${edge.label.replace(' · 最近记载', '')}${edge.qualifier && edge.qualifier !== 'asserted' ? ' · ' + qualifiers[edge.qualifier] : ''}`,
              dashed: !edge.relation, extracted: edge.evidenceKind === 'extracted', active: edge.from === selected || edge.to === selected || edge.id === selected })), ...groupedEdges.map(edge => ({ ...edge, active: selected === person?.id }))]}
            selected={selected} focus={focus} onSelect={select} />
            <div className="nw-reader-timeline"><Button size="sm" variant="ghost" icon={<IconChevronLeft size={14} />} aria-label="上一个有记录章" disabled={previous === undefined} onClick={() => jumpChapter(previous!)} />
              <label className="nw-reader-chapter">截至章节<Input type="number" aria-label="图谱章节" min={1} max={view.graph.maxChapter} value={chapter} onChange={e => { const at = Number(e.target.value); if (Number.isSafeInteger(at) && at > 0) jumpChapter(at) }} /></label>
              <span className="nw-viz-note">/ {view.graph.maxChapter}</span><Button size="sm" variant="ghost" icon={<IconChevronRight size={14} />} aria-label="下一个有记录章" disabled={next === undefined} onClick={() => jumpChapter(next!)} />
              <Button size="sm" variant="ghost" onClick={() => jumpChapter(view.graph.maxChapter)}>最新</Button></div>
            <p className="nw-reader-legend">边文字为最近记载，不代表当前关系。实线 · 明确关系　点线 · 抽取　箭头 · 引用　星团 · 展开资料</p>
          </div>
          <aside className="nw-inspector nw-reader-inspector" aria-label="关系证据详情">
            <div className="nw-reader-section-head"><strong>{view.selectedRelation ? '关系证据' : person?.displayName ?? '资料详情'}</strong><Button size="sm" variant="ghost" onClick={() => { setRecordsOpen(value => !value); patch({ relation: undefined, evidencePage: 0 }) }}>{recordsOpen ? '关联方' : '人物记录'}</Button></div>
            {!recordsOpen ? <>
              {view.cluster && view.members.total ? <details className="nw-relation-options"><summary className="nw-relation-options-title">星团成员 · {view.members.total}</summary>{view.members.items.map(member => <button type="button" key={member.id} className="nw-person-row" onClick={() => selectPerson(member.id)}>{member.displayName}</button>)}<Pager page={view.members} label="星团成员" change={memberPage => patch({ memberPage })} /></details> : null}
              {view.clusters.total && !view.cluster ? <section aria-label="关系星团"><h3 className="nw-relation-section-title">{mode === 'all' ? '标签星团' : '较早关系星团'}</h3>
                {view.clusters.items.map(cluster => <button type="button" className="nw-cluster-row" key={cluster.id} onClick={() => { patch({ cluster: cluster.id, relationPage: 0, memberPage: 0, relation: undefined }); setRecordsOpen(false) }}><strong>{cluster.label}</strong><span className="nw-person-note">{cluster.members}人 · {cluster.evidence}条证据{cluster.lastChapter ? ` · 最近第${cluster.lastChapter}章` : ''}</span></button>)}<Pager page={view.clusters} label="星团" change={clusterPage => patch({ clusterPage })} /></section> : null}
              <section aria-label="完整关系证据列表"><h3 className="nw-relation-section-title">{view.cluster ? '星团关联方' : mode === 'person' ? '近期关联方' : '关系与引用'} · {view.relations.total}</h3>
                {view.relations.items.map(relation => <button type="button" key={relation.id} className="nw-relation-line" onClick={() => selectRelation(relation)}><strong className="nw-person-name">{otherName(relation)}</strong>
                  <span className="nw-relation-line-label">最近记载：{relation.latest?.label}{relation.latest?.qualifier ? ` · ${qualifiers[relation.latest.qualifier]}` : ''}</span>
                  <span className="nw-person-note">{relation.count}条证据 · {relation.lastChapter ? `最近第${relation.lastChapter}章` : '时间未知'}{relation.changed ? ' · 本章记录' : ''}</span></button>)}
                {!view.relations.total ? <p className="nw-empty">当前范围暂无关联方，可展开星团或调整章节。</p> : null}
                <Pager page={view.relations} label="关联方" change={relationPage => patch({ relationPage })} /></section>
            </> : <><h3 className="nw-relation-section-title">{view.selectedRelation ? '关系记载与变化' : '逐条人物记录'} · {view.details.total}</h3>
              {view.selectedRelation ? <section aria-label="关系记载变化"><p className="nw-viz-note">以下是证据中标签或限定的变化，不代表完整关系状态。</p><ol className="nw-reader-transitions">{view.transitions.items.map(point => <li key={point.id}><button type="button" className="nw-link-button" onClick={() => patch({ evidenceId: point.evidenceId ?? point.id })}>{point.chapter ? `第${point.chapter}章` : '时间未知'} · {point.label}{point.qualifier ? `（${qualifiers[point.qualifier]}）` : ''}</button></li>)}</ol><Pager page={view.transitions} label="关系变化" change={transitionPage => patch({ transitionPage })} /></section> : null}
              <ol className="nw-graph-history">{view.details.items.map((item, i) => {
                const evidence = view.evidence.find(row => row.id === item.evidenceId)
                const qualifier = 'qualifier' in item ? String(item.qualifier) : undefined
                return <li key={`${item.id}:${item.line}:${i}`} data-evidence-selected={request.evidenceId === item.evidenceId || request.evidenceId === item.id || undefined}><span className="nw-person-note">{item.recordChapter ? `第 ${item.recordChapter} 章记载` : '记录时间未知'}{qualifier ? ' · ' + qualifiers[qualifier] : ''}</span>
                  <p className="nw-evidence-quote">{evidence?.location.quote ?? item.preview}</p><PathLabel path={item.source.path} />
                  <button type="button" className="nw-link-button" aria-label={`打开第 ${evidence?.location.startLine ?? item.line} 行历史来源`} onClick={() => void open(item)}><IconOpen size={14} />打开原文</button>
                  {evidence?.relatedChapters?.map(ref => <button type="button" key={ref.path} className="nw-link-button" onClick={() => { collapseVisual(explorer.current); void store.open(sessionId, ref) }}>关联定稿章 · {ref.path.split('/').at(-1)}</button>)}</li>
              })}</ol><Pager page={view.details} label="原文证据" change={evidencePage => patch({ evidencePage, evidenceId: undefined })} /></>}
          </aside>
        </div>
      </div>
    </div>
    {view.unassigned.total ? <details className="nw-unassigned"><summary className="nw-relation-options-title">未归属证据 · {view.unassigned.total}</summary>{view.unassigned.items.map(item => <div key={item.id}><p className="nw-viz-note">{item.from} → {item.to} · {item.label} · {qualifiers[item.qualifier]}</p><button type="button" className="nw-link-button" onClick={() => void open(item)}>打开原文</button></div>)}<Pager page={view.unassigned} label="未归属证据" change={unassignedPage => patch({ unassignedPage })} /></details> : null}
    {view.graph.warnings.length ? <details className="nw-viz-notes"><summary className="nw-relation-options-title">来源诊断 · {view.graph.warnings.length}</summary><ul className="nw-viz-notes-list">{view.graph.warnings.map((item, i) => <li key={i}><button type="button" className="nw-link-button" onClick={() => void store.open(sessionId, { space, path: item.path })}>{item.path}</button>：{item.message}</li>)}</ul></details> : null}
  </div>
}
