import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardContext } from '../App.jsx'
import {
    fetchEntities,
    fetchRelationships,
    fetchRelationshipEvents,
    fetchStateChanges,
} from '../api.js'
import Badge from '../components/Badge.jsx'
import ChartWrapper from '../components/ChartWrapper.jsx'
import DataTable from '../components/DataTable.jsx'
import { formatChapterLabel, formatJSONText } from '../lib/format.js'
import { getLatestChapter } from '../lib/story.js'

const TYPE_COLORS = {
    角色: '#26a8ff',
    势力: '#7f5af0',
    地点: '#2ec27e',
    法宝: '#f5a524',
}

const CATEGORY_NAMES = ['角色', '势力', '地点', '其他']

function parsePositiveChapter(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
}

function resolveCategory(type) {
    if (type === '角色') return '角色'
    if (type === '势力') return '势力'
    if (type === '地点') return '地点'
    return '其他'
}

function buildGraphData(entities, relationships, events, currentChapter) {
    const eventRows = [...events]
        .filter(row => (parsePositiveChapter(row.chapter) || 0) <= currentChapter)
        .sort((left, right) => (parsePositiveChapter(left.chapter) || 0) - (parsePositiveChapter(right.chapter) || 0))

    const latestEventByPair = new Map()
    for (const row of eventRows) {
        if (!row?.from_entity || !row?.to_entity) continue
        latestEventByPair.set(`${row.from_entity}|${row.to_entity}`, row)
    }

    const baseRelationships = [...relationships]
        .filter(row => (parsePositiveChapter(row.chapter) || 0) <= currentChapter)
        .sort((left, right) => (parsePositiveChapter(left.chapter) || 0) - (parsePositiveChapter(right.chapter) || 0))

    const linkMap = new Map()
    for (const row of baseRelationships) {
        if (!row?.from_entity || !row?.to_entity) continue
        const key = `${row.from_entity}|${row.to_entity}`
        linkMap.set(key, row)
    }
    for (const [key, row] of latestEventByPair.entries()) {
        linkMap.set(key, row)
    }

    const visibleEntityMap = new Map()
    for (const entity of entities) {
        const firstAppearance = parsePositiveChapter(entity?.first_appearance)
        if (!firstAppearance || firstAppearance <= currentChapter) {
            visibleEntityMap.set(entity.id, entity)
        }
    }

    for (const row of linkMap.values()) {
        const fromEntity = entities.find(entity => entity.id === row.from_entity)
        const toEntity = entities.find(entity => entity.id === row.to_entity)
        if (fromEntity) visibleEntityMap.set(fromEntity.id, fromEntity)
        if (toEntity) visibleEntityMap.set(toEntity.id, toEntity)
    }

    const nodes = [...visibleEntityMap.values()].map(entity => {
        const category = resolveCategory(entity.type)
        return {
            id: entity.id,
            name: entity.canonical_name || entity.id,
            value: entity.tier || '',
            category: CATEGORY_NAMES.indexOf(category),
            symbolSize: entity.is_protagonist ? 34 : entity.tier === 'S' ? 30 : entity.tier === 'A' ? 26 : 22,
            itemStyle: {
                color: entity.is_protagonist ? '#f5a524' : TYPE_COLORS[category] || '#00b8d4',
                borderColor: '#2a220f',
                borderWidth: 2,
            },
            label: {
                show: true,
                color: '#2a220f',
                fontSize: 11,
                fontWeight: 600,
            },
            type: entity.type,
            firstAppearance: entity.first_appearance,
        }
    })

    const links = [...linkMap.values()]
        .filter(row => visibleEntityMap.has(row.from_entity) && visibleEntityMap.has(row.to_entity))
        .map(row => ({
            source: row.from_entity,
            target: row.to_entity,
            name: row.description || row.event_type || row.type || '关联',
            lineStyle: {
                color: '#8f7f5c',
                width: 2,
                curveness: 0.1,
            },
            label: {
                show: true,
                color: '#5d5035',
                fontSize: 11,
            },
        }))

    return { nodes, links }
}

function buildGraphOption(data) {
    return {
        tooltip: {
            formatter: params => {
                if (params.dataType === 'edge') {
                    return params.data?.name || '关系'
                }
                return `${params.data?.name || '实体'}<br/>${params.data?.type || '未知类型'}`
            },
        },
        legend: {
            bottom: 0,
            data: CATEGORY_NAMES,
        },
        series: [
            {
                type: 'graph',
                layout: 'force',
                roam: true,
                symbol: 'rect',
                animationDuration: 300,
                animationEasingUpdate: 'cubicOut',
                categories: CATEGORY_NAMES.map(name => ({
                    name,
                    itemStyle: { color: TYPE_COLORS[name] || '#00b8d4' },
                })),
                force: {
                    repulsion: 360,
                    edgeLength: [120, 200],
                    gravity: 0.08,
                },
                lineStyle: {
                    color: '#8f7f5c',
                    width: 2,
                    curveness: 0.1,
                },
                edgeLabel: {
                    show: true,
                    formatter: params => params.data?.name || '',
                    color: '#5d5035',
                    fontSize: 11,
                },
                emphasis: {
                    focus: 'adjacency',
                    label: { show: true },
                },
                data: data.nodes,
                links: data.links,
            },
        ],
    }
}

function TypeFilter({ types, value, onChange }) {
    return (
        <div className="filter-group">
            <button
                type="button"
                className={`filter-btn ${value === '' ? 'active' : ''}`.trim()}
                onClick={() => onChange('')}
            >
                全部
            </button>
            {types.map(type => (
                <button
                    key={type}
                    type="button"
                    className={`filter-btn ${value === type ? 'active' : ''}`.trim()}
                    onClick={() => onChange(type)}
                >
                    {type}
                </button>
            ))}
        </div>
    )
}

function EntityListTable({ rows, selectedId, onSelect }) {
    if (!rows.length) {
        return (
            <div className="empty-state">
                <p>暂无实体数据</p>
            </div>
        )
    }

    return (
        <div className="table-wrap">
            <table className="data-table entity-table">
                <thead>
                    <tr>
                        <th>名称</th>
                        <th>类型</th>
                        <th>层级</th>
                        <th>首现</th>
                        <th>末现</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(entity => (
                        <tr
                            key={entity.id}
                            className={`entity-row ${selectedId === entity.id ? 'selected' : ''}`.trim()}
                            onClick={() => onSelect(entity)}
                        >
                            <td className={`entity-name ${entity.is_protagonist ? 'protagonist' : ''}`.trim()}>
                                {entity.canonical_name}
                            </td>
                            <td>
                                <Badge tone="blue">{entity.type || '未知'}</Badge>
                            </td>
                            <td>{entity.tier || '—'}</td>
                            <td>{formatChapterLabel(entity.first_appearance)}</td>
                            <td>{formatChapterLabel(entity.last_appearance)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export default function CharactersPage() {
    const { projectInfo, refreshToken } = useDashboardContext()
    const [tab, setTab] = useState('list')
    const [entities, setEntities] = useState([])
    const [relationships, setRelationships] = useState([])
    const [relationshipEvents, setRelationshipEvents] = useState([])
    const [typeFilter, setTypeFilter] = useState('')
    const [selected, setSelected] = useState(null)
    const [changes, setChanges] = useState([])
    const [playing, setPlaying] = useState(false)
    const latestChapter = getLatestChapter(projectInfo)
    const [graphChapter, setGraphChapter] = useState(latestChapter)

    useEffect(() => {
        setGraphChapter(latestChapter)
    }, [latestChapter, refreshToken])

    useEffect(() => {
        let cancelled = false

        Promise.allSettled([
            fetchEntities(),
            fetchRelationships({ limit: 1000 }),
            fetchRelationshipEvents({ limit: 5000 }),
        ]).then(results => {
            if (cancelled) return

            const entityRows = results[0].status === 'fulfilled' ? results[0].value : []
            setEntities(entityRows)
            setRelationships(results[1].status === 'fulfilled' ? results[1].value : [])
            setRelationshipEvents(results[2].status === 'fulfilled' ? results[2].value : [])

            if (entityRows.length) {
                setSelected(current => current || entityRows[0])
            }
        })

        return () => {
            cancelled = true
        }
    }, [refreshToken])

    useEffect(() => {
        if (!selected?.id) {
            setChanges([])
            return
        }

        let cancelled = false
        fetchStateChanges({ entity: selected.id, limit: 30 })
            .then(payload => {
                if (!cancelled) {
                    setChanges(payload)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setChanges([])
                }
            })

        return () => {
            cancelled = true
        }
    }, [selected])

    const advanceGraphRef = useRef(null)
    advanceGraphRef.current = () => {
        setGraphChapter(current => {
            if (current >= latestChapter) {
                setPlaying(false)
                return latestChapter
            }
            return Math.min(latestChapter, current + 5)
        })
    }

    useEffect(() => {
        if (!playing) return undefined
        const timer = window.setInterval(() => advanceGraphRef.current(), 120)
        return () => window.clearInterval(timer)
    }, [playing])

    const types = useMemo(() => {
        return [...new Set(entities.map(entity => entity.type).filter(Boolean))].sort()
    }, [entities])

    const filteredEntities = useMemo(() => {
        return typeFilter ? entities.filter(entity => entity.type === typeFilter) : entities
    }, [entities, typeFilter])

    useEffect(() => {
        if (selected && filteredEntities.some(entity => entity.id === selected.id)) return
        setSelected(filteredEntities[0] || null)
    }, [filteredEntities, selected])

    const graphData = useMemo(() => {
        return buildGraphData(entities, relationships, relationshipEvents, graphChapter)
    }, [entities, graphChapter, relationshipEvents, relationships])

    return (
        <section className="dashboard-page">
            <header className="page-header">
                <h2>角色图鉴</h2>
                <Badge tone="green">{filteredEntities.length} / {entities.length} 个实体</Badge>
            </header>

            <TypeFilter types={types} value={typeFilter} onChange={setTypeFilter} />

            <div className="tab-strip">
                <button
                    type="button"
                    className={`tab-btn ${tab === 'list' ? 'active' : ''}`.trim()}
                    onClick={() => setTab('list')}
                >
                    实体列表
                </button>
                <button
                    type="button"
                    className={`tab-btn ${tab === 'graph' ? 'active' : ''}`.trim()}
                    onClick={() => setTab('graph')}
                >
                    关系图谱
                </button>
            </div>

            {tab === 'list' ? (
                <div className="split-layout">
                    <div className="split-main">
                        <article className="card">
                            <div className="card-header">
                                <div>
                                    <div className="section-label">ENTITY INDEX</div>
                                    <div className="card-title">实体列表</div>
                                </div>
                                <Badge tone="cyan">{typeFilter || '全部类型'}</Badge>
                            </div>
                            <EntityListTable
                                rows={filteredEntities}
                                selectedId={selected?.id}
                                onSelect={setSelected}
                            />
                        </article>
                    </div>

                    <div className="split-side">
                        <article className="card sticky-card">
                            <div className="card-header">
                                <div>
                                    <div className="section-label">ENTITY DETAIL</div>
                                    <div className="card-title">{selected?.canonical_name || '未选择实体'}</div>
                                </div>
                                {selected?.tier ? <Badge tone="purple">{selected.tier}</Badge> : null}
                            </div>
                            {selected ? (
                                <div className="entity-detail">
                                    <p><strong>类型：</strong>{selected.type || '未知'}</p>
                                    <p><strong>ID：</strong><code>{selected.id}</code></p>
                                    <p><strong>首现：</strong>{formatChapterLabel(selected.first_appearance)}</p>
                                    <p><strong>末现：</strong>{formatChapterLabel(selected.last_appearance)}</p>
                                    {selected.desc ? <p className="entity-desc">{selected.desc}</p> : null}
                                    {selected.current_json ? (
                                        <div className="entity-current-block">
                                            <div className="mini-label">当前状态</div>
                                            <pre className="code-block">{formatJSONText(selected.current_json)}</pre>
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="empty-state compact">
                                    <p>从左侧选择一个实体查看详情</p>
                                </div>
                            )}

                            <div className="detail-divider" />

                            <div className="card-header compact-header">
                                <div>
                                    <div className="section-label">STATE CHANGES</div>
                                    <div className="card-title">状态变化历史</div>
                                </div>
                                <Badge tone="amber">{changes.length} 条</Badge>
                            </div>
                            <DataTable
                                columns={[
                                    {
                                        key: 'chapter',
                                        label: '章',
                                        render: row => formatChapterLabel(row.chapter),
                                    },
                                    { key: 'field', label: '字段' },
                                    {
                                        key: 'change',
                                        label: '变化',
                                        render: row => `${row.old_value ?? '—'} → ${row.new_value ?? '—'}`,
                                    },
                                ]}
                                rows={changes}
                                rowKey={(row, index) => `${row.entity_id || 'entity'}-${row.chapter || 0}-${index}`}
                                pageSize={6}
                                emptyText="暂无状态变化记录"
                                minWidth={420}
                            />
                        </article>
                    </div>
                </div>
            ) : (
                <article className="card">
                    <div className="card-header">
                        <div>
                            <div className="section-label">RELATION GRAPH</div>
                            <div className="card-title">关系图谱</div>
                        </div>
                        <Badge tone="blue">ECharts graph · 力导向 · 时间轴</Badge>
                    </div>

                    <div className="graph-toolbar">
                        <button
                            type="button"
                            className="page-btn icon-btn"
                            onClick={() => {
                                if (playing) {
                                    setPlaying(false)
                                    return
                                }
                                if (graphChapter >= latestChapter) {
                                    setGraphChapter(1)
                                }
                                setPlaying(true)
                            }}
                        >
                            {playing ? '暂停' : '播放'}
                        </button>
                        <span className="range-label">第 1 章</span>
                        <input
                            className="timeline-slider"
                            type="range"
                            min="1"
                            max={String(latestChapter)}
                            value={graphChapter}
                            onChange={event => {
                                const nextChapter = Number(event.target.value)
                                startTransition(() => {
                                    setGraphChapter(nextChapter)
                                })
                            }}
                        />
                        <span className="range-label">{formatChapterLabel(latestChapter)}</span>
                        <Badge tone="blue">{formatChapterLabel(graphChapter)}</Badge>
                        <Badge tone="green">{graphData.nodes.length} 节点</Badge>
                        <Badge tone="purple">{graphData.links.length} 关系</Badge>
                    </div>

                    {graphData.nodes.length ? (
                        <ChartWrapper
                            className="tall"
                            height={420}
                            option={buildGraphOption(graphData)}
                        />
                    ) : (
                        <div className="empty-state">
                            <p>当前章节窗口没有可视化关系</p>
                        </div>
                    )}
                </article>
            )}
        </section>
    )
}
