import { useState, useEffect, useCallback } from 'react'
import { fetchJSON, subscribeSSE } from './api.js'
import { I18nProvider, useI18n, LOCALES } from './i18n.jsx'
import ForceGraph3D from 'react-force-graph-3d'

// ====================================================================
// Language Switcher
// ====================================================================
function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  return (
    <div className="lang-switcher">
      {LOCALES.map(l => (
        <button
          key={l.code}
          className={`lang-btn ${locale === l.code ? 'active' : ''}`}
          onClick={() => setLocale(l.code)}
          title={l.label}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

// ====================================================================
// App (wrapped in I18nProvider)
// ====================================================================
export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  )
}

function AppInner() {
  const { t } = useI18n()
  const [page, setPage] = useState('dashboard')
  const [projectInfo, setProjectInfo] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [connected, setConnected] = useState(false)

  const loadProjectInfo = useCallback(() => {
    fetchJSON('/api/project/info')
      .then(setProjectInfo)
      .catch(() => setProjectInfo(null))
  }, [])

  useEffect(() => { loadProjectInfo() }, [loadProjectInfo, refreshKey])

  // SSE subscription
  useEffect(() => {
    const unsub = subscribeSSE(
      () => setRefreshKey(k => k + 1),
      { onOpen: () => setConnected(true), onError: () => setConnected(false) },
    )
    return () => { unsub(); setConnected(false) }
  }, [])

  const title = projectInfo?.project_info?.title || t('loading')

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>PIXEL WRITER HUB</h1>
          <div className="subtitle">{title}</div>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="icon">{item.icon}</span>
              <span>{t(`nav.${item.id}`)}</span>
            </button>
          ))}
        </nav>
        <div className="live-indicator">
          <span className={`live-dot ${connected ? '' : 'disconnected'}`} />
          {connected ? t('live.connected') : t('live.disconnected')}
        </div>
        <LanguageSwitcher />
      </aside>

      <main className="main-content">
        {page === 'dashboard' && <DashboardPage data={projectInfo} key={refreshKey} />}
        {page === 'entities' && <EntitiesPage key={refreshKey} />}
        {page === 'graph' && <GraphPage key={refreshKey} />}
        {page === 'chapters' && <ChaptersPage key={refreshKey} />}
        {page === 'files' && <FilesPage />}
        {page === 'reading' && <ReadingPowerPage key={refreshKey} />}
      </main>
    </div>
  )
}

const NAV_ITEMS = [
  { id: 'dashboard', icon: '📊', labelKey: 'nav.dashboard' },
  { id: 'entities', icon: '👤', labelKey: 'nav.entities' },
  { id: 'graph', icon: '🕸️', labelKey: 'nav.graph' },
  { id: 'chapters', icon: '📝', labelKey: 'nav.chapters' },
  { id: 'files', icon: '📁', labelKey: 'nav.files' },
  { id: 'reading', icon: '🔥', labelKey: 'nav.reading' },
]

const FULL_DATA_GROUPS = [
  { key: 'entities', titleKey: 'groups.entities', columns: ['id', 'canonical_name', 'type', 'tier', 'first_appearance', 'last_appearance'], domain: 'core' },
  { key: 'chapters', titleKey: 'groups.chapters', columns: ['chapter', 'title', 'word_count', 'location', 'characters'], domain: 'core' },
  { key: 'scenes', titleKey: 'groups.scenes', columns: ['chapter', 'scene_index', 'location', 'time', 'summary'], domain: 'core' },
  { key: 'aliases', titleKey: 'groups.aliases', columns: ['alias', 'entity_id', 'entity_type'], domain: 'core' },
  { key: 'stateChanges', titleKey: 'groups.stateChanges', columns: ['entity_id', 'field', 'old_value', 'new_value', 'chapter'], domain: 'core' },
  { key: 'relationships', titleKey: 'groups.relationships', columns: ['from_entity', 'to_entity', 'type', 'chapter', 'description'], domain: 'network' },
  { key: 'relationshipEvents', titleKey: 'groups.relationshipEvents', columns: ['from_entity', 'to_entity', 'type', 'chapter', 'event_type', 'description'], domain: 'network' },
  { key: 'readingPower', titleKey: 'groups.readingPower', columns: ['chapter', 'hook_type', 'hook_strength', 'is_transition', 'override_count', 'debt_balance'], domain: 'network' },
  { key: 'overrides', titleKey: 'groups.overrides', columns: ['chapter', 'constraint_type', 'constraint_id', 'due_chapter', 'status'], domain: 'network' },
  { key: 'debts', titleKey: 'groups.debts', columns: ['id', 'debt_type', 'current_amount', 'interest_rate', 'due_chapter', 'status'], domain: 'network' },
  { key: 'debtEvents', titleKey: 'groups.debtEvents', columns: ['debt_id', 'event_type', 'amount', 'chapter', 'note'], domain: 'network' },
  { key: 'reviewMetrics', titleKey: 'groups.reviewMetrics', columns: ['start_chapter', 'end_chapter', 'overall_score', 'severity_counts', 'created_at'], domain: 'quality' },
  { key: 'invalidFacts', titleKey: 'groups.invalidFacts', columns: ['source_type', 'source_id', 'reason', 'status', 'chapter_discovered'], domain: 'quality' },
  { key: 'checklistScores', titleKey: 'groups.checklistScores', columns: ['chapter', 'template', 'score', 'completion_rate', 'completed_items', 'total_items'], domain: 'quality' },
  { key: 'ragQueries', titleKey: 'groups.ragQueries', columns: ['query_type', 'query', 'results_count', 'latency_ms', 'chapter', 'created_at'], domain: 'ops' },
  { key: 'toolStats', titleKey: 'groups.toolStats', columns: ['tool_name', 'success', 'retry_count', 'error_code', 'chapter', 'created_at'], domain: 'ops' },
]

const FULL_DATA_DOMAINS = [
  { id: 'overview', labelKey: 'domains.overview' },
  { id: 'core', labelKey: 'domains.core' },
  { id: 'network', labelKey: 'domains.network' },
  { id: 'quality', labelKey: 'domains.quality' },
  { id: 'ops', labelKey: 'domains.ops' },
]


// ====================================================================
// Page 1: Dashboard
// ====================================================================

function DashboardPage({ data }) {
  const { t } = useI18n()
  if (!data) return <div className="loading">{t('loading')}</div>

  const info = data.project_info || {}
  const progress = data.progress || {}
  const protagonist = data.protagonist_state || {}
  const strand = data.strand_tracker || {}
  const foreshadowing = data.plot_threads?.foreshadowing || []

  const totalWords = progress.total_words || 0
  const targetWords = info.target_words || 2000000
  const pct = targetWords > 0 ? Math.min(100, (totalWords / targetWords * 100)).toFixed(1) : 0

  const unresolvedForeshadow = foreshadowing.filter(f => {
    const s = (f.status || '').toLowerCase()
    return s !== '已回收' && s !== '已兑现' && s !== 'resolved'
  })

  // Strand history
  const history = strand.history || []
  const strandCounts = { quest: 0, fire: 0, constellation: 0 }
  history.forEach(h => { if (strandCounts[h.strand] !== undefined) strandCounts[h.strand]++ })
  const total = history.length || 1

  return (
    <>
      <div className="page-header">
        <h2>📊 {t('dashboard.title')}</h2>
        <span className="card-badge badge-blue">{info.genre || t('dashboard.genre')}</span>
      </div>

      <div className="dashboard-grid">
        <div className="card stat-card">
          <span className="stat-label">{t('dashboard.totalWords')}</span>
          <span className="stat-value">{formatNumber(totalWords)}</span>
          <span className="stat-sub">{t('dashboard.target')} {formatNumber(targetWords)} {t('dashboard.chars')} · {pct}%</span>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="card stat-card">
          <span className="stat-label">{t('dashboard.currentChapter')}</span>
          <span className="stat-value">{t('chapters.chPrefix')} {progress.current_chapter || 0} {t('chapters.title')}</span>
          <span className="stat-sub">{t('dashboard.target')} {info.target_chapters || '?'} {t('chapters.title')} · {t('dashboard.vol')} {progress.current_volume || 1}</span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">{t('dashboard.protagonist')}</span>
          <span className="stat-value plain">{protagonist.name || t('dashboard.notSet')}</span>
          <span className="stat-sub">
            {protagonist.power?.realm || t('dashboard.unknownRealm')}
            {protagonist.location?.current ? ` · ${protagonist.location.current}` : ''}
          </span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">{t('dashboard.unresolvedForeshadow')}</span>
          <span className="stat-value" style={{ color: unresolvedForeshadow.length > 10 ? 'var(--accent-red)' : 'var(--accent-amber)' }}>
            {unresolvedForeshadow.length}
          </span>
          <span className="stat-sub">{t('dashboard.totalForeshadow')} {foreshadowing.length} {t('dashboard.foreshadowUnit')}</span>
        </div>
      </div>

      {/* Strand Weave */}
      <div className="card dashboard-section-card">
        <div className="card-header">
          <span className="card-title">{t('dashboard.strandTitle')}</span>
          <span className="card-badge badge-purple">{strand.current_dominant || '?'}</span>
        </div>
        <div className="strand-bar">
          <div className="segment strand-quest" style={{ width: `${(strandCounts.quest / total * 100).toFixed(1)}%` }} />
          <div className="segment strand-fire" style={{ width: `${(strandCounts.fire / total * 100).toFixed(1)}%` }} />
          <div className="segment strand-constellation" style={{ width: `${(strandCounts.constellation / total * 100).toFixed(1)}%` }} />
        </div>
        <div className="strand-legend">
          <span>🔵 Quest {(strandCounts.quest / total * 100).toFixed(0)}%</span>
          <span>🔴 Fire {(strandCounts.fire / total * 100).toFixed(0)}%</span>
          <span>🟣 Constellation {(strandCounts.constellation / total * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Foreshadowing */}
      {unresolvedForeshadow.length > 0 ? (
        <div className="card dashboard-section-card">
          <div className="card-header">
            <span className="card-title">⚠️ {t('dashboard.pendingForeshadow')}</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>{t('dashboard.content')}</th><th>{t('dashboard.status')}</th><th>{t('dashboard.plantedCh')}</th></tr></thead>
              <tbody>
                {unresolvedForeshadow.slice(0, 20).map((f, i) => (
                  <tr key={i}>
                    <td className="truncate" style={{ maxWidth: 400 }}>{f.content || f.description || '—'}</td>
                    <td><span className="card-badge badge-amber">{f.status || t('dashboard.status')}</span></td>
                    <td>{f.chapter || f.planted_chapter || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <MergedDataView />
    </>
  )
}


// ====================================================================
// Page 2: Entities
// ====================================================================

function EntitiesPage() {
  const { t } = useI18n()
  const [entities, setEntities] = useState([])
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [changes, setChanges] = useState([])

  useEffect(() => {
    fetchJSON('/api/entities').then(setEntities).catch(() => { })
  }, [])

  useEffect(() => {
    if (selected) {
      fetchJSON('/api/state-changes', { entity: selected.id, limit: 30 }).then(setChanges).catch(() => setChanges([]))
    }
  }, [selected])

  const types = [...new Set(entities.map(e => e.type))].sort()
  const filteredEntities = typeFilter ? entities.filter(e => e.type === typeFilter) : entities

  return (
    <>
      <div className="page-header">
        <h2>👤 {t('entities.title')}</h2>
        <span className="card-badge badge-green">{filteredEntities.length} / {entities.length} {t('entities.units')}</span>
      </div>

      <div className="filter-group">
        <button className={`filter-btn ${typeFilter === '' ? 'active' : ''}`} onClick={() => setTypeFilter('')}>{t('entities.all')}</button>
        {types.map(ty => (
          <button key={ty} className={`filter-btn ${typeFilter === ty ? 'active' : ''}`} onClick={() => setTypeFilter(ty)}>{ty}</button>
        ))}
      </div>

      <div className="split-layout">
        <div className="split-main">
          <div className="card">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>{t('entities.name')}</th><th>{t('entities.type')}</th><th>{t('entities.tier')}</th><th>{t('entities.first')}</th><th>{t('entities.last')}</th></tr></thead>
                <tbody>
                  {filteredEntities.map(e => (
                    <tr
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      className={`entity-row ${selected?.id === e.id ? 'selected' : ''}`}
                      onKeyDown={evt => (evt.key === 'Enter' || evt.key === ' ') && (evt.preventDefault(), setSelected(e))}
                      onClick={() => setSelected(e)}
                    >
                      <td className={e.is_protagonist ? 'entity-name protagonist' : 'entity-name'}>
                        {e.canonical_name} {e.is_protagonist ? '⭐' : ''}
                      </td>
                      <td><span className="card-badge badge-blue">{e.type}</span></td>
                      <td>{e.tier}</td>
                      <td>{e.first_appearance || '—'}</td>
                      <td>{e.last_appearance || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selected && (
          <div className="split-side">
            <div className="card">
              <div className="card-header">
                <span className="card-title">{selected.canonical_name}</span>
                <span className="card-badge badge-purple">{selected.tier}</span>
              </div>
              <div className="entity-detail">
                <p><strong>{t('entityDetail.typeLabel')}：</strong>{selected.type}</p>
                <p><strong>{t('entityDetail.idLabel')}：</strong><code>{selected.id}</code></p>
                {selected.desc && <p className="entity-desc">{selected.desc}</p>}
                {selected.current_json && (
                  <div className="entity-current-block">
                    <strong>{t('entityDetail.currentLabel')}：</strong>
                    <pre className="entity-json">
                      {formatJSON(selected.current_json)}
                    </pre>
                  </div>
                )}
              </div>
              {changes.length > 0 ? (
                <div className="entity-history">
                  <div className="card-title">{t('entities.historyTitle')}</div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>{t('entities.chapter')}</th><th>{t('entities.field')}</th><th>{t('entities.change')}</th></tr></thead>
                      <tbody>
                        {changes.map((c, i) => (
                          <tr key={i}>
                            <td>{c.chapter}</td>
                            <td>{c.field}</td>
                            <td>{c.old_value} → {c.new_value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  )
}


// ====================================================================
// Page 3: 3D Graph
// ====================================================================

function GraphPage() {
  const { t } = useI18n()
  const [relationships, setRelationships] = useState([])
  const [graphData, setGraphData] = useState({ nodes: [], links: [] })

  useEffect(() => {
    Promise.all([
      fetchJSON('/api/relationships', { limit: 1000 }),
      fetchJSON('/api/entities'),
    ]).then(([rels, ents]) => {
      setRelationships(rels)
      const typeColors = {
        '角色': '#4f8ff7', '地点': '#34d399', '星球': '#22d3ee', '神仙': '#f59e0b',
        '势力': '#8b5cf6', '招式': '#ef4444', '法宝': '#ec4899'
      }
      const relatedIds = new Set()
      rels.forEach(r => { relatedIds.add(r.from_entity); relatedIds.add(r.to_entity) })
      const entityMap = {}
      ents.forEach(e => { entityMap[e.id] = e })

      const nodes = [...relatedIds].map(id => ({
        id,
        name: entityMap[id]?.canonical_name || id,
        val: (entityMap[id]?.tier === 'S' ? 8 : entityMap[id]?.tier === 'A' ? 5 : 2),
        color: typeColors[entityMap[id]?.type] || '#5c6078'
      }))
      const links = rels.map(r => ({
        source: r.from_entity,
        target: r.to_entity,
        name: r.type
      }))
      setGraphData({ nodes, links })
    }).catch(() => { })
  }, [])

  return (
    <>
      <div className="page-header">
        <h2>🕸️ {t('graph.title')}</h2>
        <span className="card-badge badge-blue">{relationships.length} {t('graph.links')}</span>
      </div>
      <div className="card graph-shell">
        <ForceGraph3D
          graphData={graphData}
          nodeLabel="name"
          nodeColor="color"
          nodeRelSize={6}
          linkColor={() => 'rgba(127, 90, 240, 0.35)'}
          linkWidth={1}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleSpeed={d => 0.005 + Math.random() * 0.005}
          backgroundColor="#fffaf0"
          showNavInfo={false}
        />
      </div>
    </>
  )
}


// ====================================================================
// Page 4: Chapters
// ====================================================================

function ChaptersPage() {
  const { t } = useI18n()
  const [chapters, setChapters] = useState([])

  useEffect(() => {
    fetchJSON('/api/chapters').then(setChapters).catch(() => { })
  }, [])

  const totalWords = chapters.reduce((s, c) => s + (c.word_count || 0), 0)

  return (
    <>
      <div className="page-header">
        <h2>📝 {t('chapters.title')}</h2>
        <span className="card-badge badge-green">{chapters.length} {t('chapters.title')} · {formatNumber(totalWords)} {t('dashboard.chars')}</span>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>{t('chapters.chapter')}</th><th>{t('chapters.titleCol')}</th><th>{t('chapters.wordCount')}</th><th>{t('chapters.location')}</th><th>{t('chapters.characters')}</th></tr></thead>
            <tbody>
              {chapters.map(c => (
                <tr key={c.chapter}>
                  <td className="chapter-no">{t('chapters.chPrefix')} {c.chapter}</td>
                  <td>{c.title || '—'}</td>
                  <td>{formatNumber(c.word_count || 0)}</td>
                  <td>{c.location || '—'}</td>
                  <td className="truncate chapter-characters">{c.characters || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chapters.length === 0 ? <div className="empty-state"><div className="empty-icon">📭</div><p>{t('chapters.noChapters')}</p></div> : null}
      </div>
    </>
  )
}


// ====================================================================
// Page 5: Files
// ====================================================================

function FilesPage() {
  const { t } = useI18n()
  const [tree, setTree] = useState({})
  const [selectedPath, setSelectedPath] = useState(null)
  const [content, setContent] = useState('')

  useEffect(() => {
    fetchJSON('/api/files/tree').then(setTree).catch(() => { })
  }, [])

  useEffect(() => {
    if (selectedPath) {
      fetchJSON('/api/files/read', { path: selectedPath })
        .then(d => setContent(d.content))
        .catch(() => setContent(t('files.readFailed')))
    }
  }, [selectedPath])

  useEffect(() => {
    if (selectedPath) return
    const first = findFirstFilePath(tree)
    if (first) setSelectedPath(first)
  }, [tree, selectedPath])

  return (
    <>
      <div className="page-header">
        <h2>📁 {t('files.title')}</h2>
      </div>
      <div className="file-layout">
        <div className="file-tree-pane">
          {Object.entries(tree).map(([folder, items]) => (
            <div key={folder} className="folder-block">
              <div className="folder-title">📂 {folder}</div>
              <ul className="file-tree">
                <TreeNodes items={items} selected={selectedPath} onSelect={setSelectedPath} />
              </ul>
            </div>
          ))}
        </div>
        <div className="file-content-pane">
          {selectedPath ? (
            <div>
              <div className="selected-path">{selectedPath}</div>
              <div className="file-preview">{content}</div>
            </div>
          ) : (
            <div className="empty-state"><div className="empty-icon">📄</div><p>{t('files.selectFile')}</p></div>
          )}
        </div>
      </div>
    </>
  )
}


// ====================================================================
// Page 6: Reading Power
// ====================================================================

function ReadingPowerPage() {
  const { t } = useI18n()
  const [data, setData] = useState([])

  useEffect(() => {
    fetchJSON('/api/reading-power', { limit: 50 }).then(setData).catch(() => { })
  }, [])

  return (
    <>
      <div className="page-header">
        <h2>🔥 {t('reading.title')}</h2>
        <span className="card-badge badge-amber">{data.length} {t('reading.chapterData')}</span>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>{t('reading.chapterCol')}</th><th>{t('reading.hookType')}</th><th>{t('reading.hookStrength')}</th><th>{t('reading.transition')}</th><th>{t('reading.override')}</th><th>{t('reading.debtBalance')}</th></tr></thead>
            <tbody>
              {data.map(r => (
                <tr key={r.chapter}>
                  <td className="chapter-no">{t('chapters.chPrefix')} {r.chapter}</td>
                  <td>{r.hook_type || '—'}</td>
                  <td>
                    <span className={`card-badge ${r.hook_strength === 'strong' ? 'badge-green' : r.hook_strength === 'weak' ? 'badge-red' : 'badge-amber'}`}>
                      {r.hook_strength || '—'}
                    </span>
                  </td>
                  <td>{r.is_transition ? '✅' : '—'}</td>
                  <td>{r.override_count || 0}</td>
                  <td className={r.debt_balance > 0 ? 'debt-positive' : 'debt-normal'}>{(r.debt_balance || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.length === 0 ? <div className="empty-state"><div className="empty-icon">🔥</div><p>{t('reading.noData')}</p></div> : null}
      </div>
    </>
  )
}

function findFirstFilePath(tree) {
  const roots = Object.values(tree || {})
  for (const items of roots) {
    const p = walkFirstFile(items)
    if (p) return p
  }
  return null
}

function walkFirstFile(items) {
  if (!Array.isArray(items)) return null
  for (const item of items) {
    if (item?.type === 'file' && item?.path) return item.path
    if (item?.type === 'dir' && Array.isArray(item.children)) {
      const p = walkFirstFile(item.children)
      if (p) return p
    }
  }
  return null
}


// ====================================================================
// Merged Data View
// ====================================================================

function MergedDataView() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState({})
  const [domain, setDomain] = useState('overview')

  useEffect(() => {
    let disposed = false

    async function loadAll() {
      setLoading(true)
      const requests = [
        ['entities', fetchJSON('/api/entities')],
        ['chapters', fetchJSON('/api/chapters')],
        ['scenes', fetchJSON('/api/scenes', { limit: 200 })],
        ['relationships', fetchJSON('/api/relationships', { limit: 300 })],
        ['relationshipEvents', fetchJSON('/api/relationship-events', { limit: 200 })],
        ['readingPower', fetchJSON('/api/reading-power', { limit: 100 })],
        ['reviewMetrics', fetchJSON('/api/review-metrics', { limit: 50 })],
        ['stateChanges', fetchJSON('/api/state-changes', { limit: 120 })],
        ['aliases', fetchJSON('/api/aliases')],
        ['overrides', fetchJSON('/api/overrides', { limit: 120 })],
        ['debts', fetchJSON('/api/debts', { limit: 120 })],
        ['debtEvents', fetchJSON('/api/debt-events', { limit: 150 })],
        ['invalidFacts', fetchJSON('/api/invalid-facts', { limit: 120 })],
        ['ragQueries', fetchJSON('/api/rag-queries', { limit: 150 })],
        ['toolStats', fetchJSON('/api/tool-stats', { limit: 200 })],
        ['checklistScores', fetchJSON('/api/checklist-scores', { limit: 120 })],
      ]

      const entries = await Promise.all(
        requests.map(async ([key, p]) => {
          try {
            const val = await p
            return [key, val]
          } catch {
            return [key, []]
          }
        }),
      )
      if (!disposed) {
        setPayload(Object.fromEntries(entries))
        setLoading(false)
      }
    }

    loadAll()
    return () => { disposed = true }
  }, [])

  if (loading) return <div className="loading">{t('loading')}</div>

  const groups = domain === 'overview'
    ? FULL_DATA_GROUPS
    : FULL_DATA_GROUPS.filter(g => g.domain === domain)
  const totalRows = FULL_DATA_GROUPS.reduce((sum, g) => sum + (payload[g.key] || []).length, 0)
  const nonEmptyGroups = FULL_DATA_GROUPS.filter(g => (payload[g.key] || []).length > 0).length
  const maxChapter = FULL_DATA_GROUPS.reduce((max, g) => {
    const rows = payload[g.key] || []
    rows.slice(0, 120).forEach(r => {
      const c = extractChapter(r)
      if (c > max) max = c
    })
    return max
  }, 0)
  const domainStats = FULL_DATA_DOMAINS.filter(d => d.id !== 'overview').map(d => {
    const ds = FULL_DATA_GROUPS.filter(g => g.domain === d.id)
    const rowCount = ds.reduce((sum, g) => sum + (payload[g.key] || []).length, 0)
    const filled = ds.filter(g => (payload[g.key] || []).length > 0).length
    return { ...d, rowCount, filled, total: ds.length }
  })

  return (
    <>
      <div className="page-header section-page-header">
        <h2>🧪 {t('dataView.title')}</h2>
        <span className="card-badge badge-cyan">{FULL_DATA_GROUPS.length} {t('dataView.dataSources')}</span>
      </div>

      <div className="demo-summary-grid">
        <div className="card stat-card">
          <span className="stat-label">{t('dataView.totalRecords')}</span>
          <span className="stat-value">{formatNumber(totalRows)}</span>
          <span className="stat-sub">{t('dataView.totalRecordsSub')}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">{t('dataView.coveredSources')}</span>
          <span className="stat-value plain">{nonEmptyGroups}/{FULL_DATA_GROUPS.length}</span>
          <span className="stat-sub">{t('dataView.coveredSub')}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">{t('dataView.reachedCh')}</span>
          <span className="stat-value plain">{maxChapter > 0 ? `${t('chapters.chPrefix')} ${maxChapter}` : '—'}</span>
          <span className="stat-sub">{t('dataView.reachedSub')}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">{t('dataView.currentView')}</span>
          <span className="stat-value plain">{FULL_DATA_DOMAINS.find(d => d.id === domain)?.labelKey ? t(d.labelKey) : '—'}</span>
          <span className="stat-sub">{groups.length} {t('dataView.viewSub')}</span>
        </div>
      </div>

      <div className="demo-domain-tabs">
        {FULL_DATA_DOMAINS.map(item => (
          <button
            key={item.id}
            className={`demo-domain-tab ${domain === item.id ? 'active' : ''}`}
            onClick={() => setDomain(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {domain === 'overview' ? (
        <div className="demo-domain-grid">
          {domainStats.map(ds => (
            <div className="card" key={ds.id}>
              <div className="card-header">
                <span className="card-title">{t(ds.labelKey)}</span>
                <span className="card-badge badge-purple">{ds.filled}/{ds.total}</span>
              </div>
              <div className="domain-stat-number">{formatNumber(ds.rowCount)}</div>
              <div className="stat-sub">{t('dataView.totalRecordsSub')}</div>
            </div>
          ))}
        </div>
      ) : null}

      {groups.map(g => {
        const count = (payload[g.key] || []).length
        return (
          <div className="card demo-group-card" key={g.key}>
            <div className="card-header">
              <span className="card-title">{t(g.titleKey)}</span>
              <span className={`card-badge ${count > 0 ? 'badge-blue' : 'badge-amber'}`}>{count} {t('pagination.unit')}</span>
            </div>
            <MiniTable
              rows={payload[g.key] || []}
              columns={g.columns}
              pageSize={12}
            />
          </div>
        )
      })}
    </>
  )
}

function MiniTable({ rows, columns, pageSize = 12 }) {
  const { t } = useI18n()
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [rows, columns, pageSize])

  if (!rows || rows.length === 0) {
    return <div className="empty-state compact"><p>{t('pagination.noData')}</p></div>
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const list = rows.slice(start, start + pageSize)

  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {list.map((row, i) => (
              <tr key={i}>
                {columns.map(c => (
                  <td key={c} className="truncate" style={{ maxWidth: 240 }}>
                    {formatCell(row?.[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <button
          className="page-btn"
          type="button"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={safePage <= 1}
        >
          {t('pagination.prev')}
        </button>
        <span className="page-info">
          {t('pagination.page')} {safePage} / {totalPages} {t('pagination.of')} · {t('pagination.total')} {rows.length} {t('pagination.items')}
        </span>
        <button
          className="page-btn"
          type="button"
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={safePage >= totalPages}
        >
          {t('pagination.next')}
        </button>
      </div>
    </>
  )
}

function extractChapter(row) {
  if (!row || typeof row !== 'object') return 0
  const candidates = [
    row.chapter,
    row.start_chapter,
    row.end_chapter,
    row.chapter_discovered,
    row.first_appearance,
    row.last_appearance,
  ]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}


// ====================================================================
// Sub-component: File tree recursion
// ====================================================================

function TreeNodes({ items, selected, onSelect, depth = 0 }) {
  const [expanded, setExpanded] = useState({})
  if (!items || items.length === 0) return null

  return items.map((item, i) => {
    const key = item.path || `${depth}-${i}`
    if (item.type === 'dir') {
      const isOpen = expanded[key]
      return (
        <li key={key}>
          <div
            className="tree-item"
            role="button"
            tabIndex={0}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setExpanded(prev => ({ ...prev, [key]: !prev[key] })))}
            onClick={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
          >
            <span className="tree-icon">{isOpen ? '📂' : '📁'}</span>
            <span>{item.name}</span>
          </div>
          {isOpen && item.children && (
            <ul className="tree-children">
              <TreeNodes items={item.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
            </ul>
          )}
        </li>
      )
    }
    return (
      <li key={key}>
        <div
          className={`tree-item ${selected === item.path ? 'active' : ''}`}
          role="button"
          tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(item.path))}
          onClick={() => onSelect(item.path)}
        >
          <span className="tree-icon">📄</span>
          <span>{item.name}</span>
        </div>
      </li>
    )
  })
}


// ====================================================================
// Helpers: Number formatting
// ====================================================================

function formatNumber(n) {
  if (n >= 10000) return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(n / 10000) + ' 万'
  return new Intl.NumberFormat('zh-CN').format(n)
}

function formatJSON(str) {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

function formatCell(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  const s = String(v)
  return s.length > 180 ? `${s.slice(0, 180)}...` : s
}
