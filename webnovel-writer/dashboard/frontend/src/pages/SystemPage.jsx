import { useEffect, useMemo, useState } from 'react'
import { useDashboardContext } from '../App.jsx'
import Badge from '../components/Badge.jsx'
import DataTable from '../components/DataTable.jsx'
import {
    fetchCommits,
    fetchContractsSummary,
    fetchEnvStatus,
    fetchStoryRuntimeHealth,
    probeEnvStatus,
} from '../api.js'
import { formatChapterLabel, formatDateTime, formatNumber } from '../lib/format.js'

function statusTone(status) {
    const text = String(status || '').toLowerCase()
    if (text === 'accepted' || text === 'done' || text === 'ok' || text === 'full') return 'green'
    if (text === 'rejected' || text === 'failed' || text === 'error') return 'red'
    if (text === 'skipped' || text === 'missing' || text === 'bm25_only') return 'amber'
    return 'blue'
}

function projectionSummary(projectionStatus) {
    const values = Object.values(projectionStatus || {})
    if (!values.length) return '无投影'
    if (values.every(value => value === 'done')) return '5 路 projection OK'
    return values.join(' / ')
}

function StatCard({ label, value, sub, tone = 'plain' }) {
    return (
        <article className="card stat-card">
            <span className="stat-label">{label}</span>
            <span className={`stat-value ${tone === 'plain' ? 'plain' : ''}`.trim()}>{value}</span>
            <span className="stat-sub">{sub}</span>
        </article>
    )
}

export default function SystemPage() {
    const { refreshToken } = useDashboardContext()
    const [runtimeHealth, setRuntimeHealth] = useState(null)
    const [contractsSummary, setContractsSummary] = useState(null)
    const [commits, setCommits] = useState([])
    const [envStatus, setEnvStatus] = useState(null)
    const [probeResult, setProbeResult] = useState(null)
    const [probing, setProbing] = useState(false)

    useEffect(() => {
        let cancelled = false

        Promise.allSettled([
            fetchStoryRuntimeHealth(),
            fetchContractsSummary(),
            fetchCommits({ limit: 12 }),
            fetchEnvStatus(),
        ]).then(results => {
            if (cancelled) return

            setRuntimeHealth(results[0].status === 'fulfilled' ? results[0].value : null)
            setContractsSummary(results[1].status === 'fulfilled' ? results[1].value : null)
            setCommits(results[2].status === 'fulfilled' ? (results[2].value.items || []) : [])
            setEnvStatus(results[3].status === 'fulfilled' ? results[3].value : null)
        })

        return () => {
            cancelled = true
        }
    }, [refreshToken])

    const latestCommit = commits[0] || null
    const contractRows = useMemo(() => {
        if (!contractsSummary) return []
        return [
            {
                type: 'MASTER_SETTING',
                count: contractsSummary.master?.exists ? 1 : 0,
                desc: [contractsSummary.master?.primary_genre, contractsSummary.master?.core_tone].filter(Boolean).join(' · ') || '未检测到主合同',
            },
            {
                type: 'VOLUME_BRIEF',
                count: contractsSummary.counts?.volumes || 0,
                desc: `当前卷 ${contractsSummary.current_volume || '—'} · ${contractsSummary.current_contracts?.volume ? '存在' : '缺失'}`,
            },
            {
                type: 'CHAPTER_BRIEF',
                count: contractsSummary.counts?.chapters || 0,
                desc: `${formatChapterLabel(contractsSummary.chapter)} · ${contractsSummary.current_contracts?.chapter ? '存在' : '缺失'}`,
            },
            {
                type: 'REVIEW_CONTRACT',
                count: contractsSummary.counts?.reviews || 0,
                desc: `${contractsSummary.current_contracts?.review ? '当前章已生成审查合同' : '当前章缺少审查合同'}`,
            },
            {
                type: 'COMMIT',
                count: contractsSummary.counts?.commits || 0,
                desc: `${contractsSummary.current_contracts?.commit ? '当前章已有 commit' : '当前章无 commit'}`,
            },
        ]
    }, [contractsSummary])

    const envRows = useMemo(() => {
        if (probeResult?.checks?.length) {
            return probeResult.checks.map(item => ({
                name: item.name,
                ok: item.ok,
                detail: item.detail,
            }))
        }
        if (!envStatus) return []

        return [
            {
                name: 'embed',
                ok: envStatus.embed?.api_key_present,
                detail: `${envStatus.embed?.model || 'unknown'} · ${envStatus.embed?.base_url || 'no base url'}`,
            },
            {
                name: 'rerank',
                ok: envStatus.rerank?.api_key_present,
                detail: `${envStatus.rerank?.model || 'unknown'} · ${envStatus.rerank?.base_url || 'no base url'}`,
            },
            {
                name: 'vector_db',
                ok: envStatus.vector_db?.exists && !envStatus.vector_db?.error,
                detail: `${envStatus.vector_db?.record_count || 0} records · ${envStatus.vector_db?.size_bytes || 0} bytes`,
            },
            {
                name: 'rag_mode',
                ok: Boolean(envStatus.rag_mode),
                detail: envStatus.rag_mode,
            },
        ]
    }, [envStatus, probeResult])

    return (
        <section className="dashboard-page">
            <header className="page-header">
                <h2>系统状态</h2>
            </header>

            <div className="stat-grid">
                <StatCard
                    label="Story Runtime"
                    value={runtimeHealth?.mainline_ready ? 'Mainline' : 'Fallback'}
                    sub={`fallback: ${(runtimeHealth?.fallback_sources || []).join(', ') || 'none'}`}
                />
                <StatCard
                    label="Latest Commit"
                    value={latestCommit?.status || runtimeHealth?.latest_commit_status || 'missing'}
                    sub={latestCommit ? `${formatChapterLabel(latestCommit.chapter)} · ${projectionSummary(latestCommit.projection_status)}` : '暂无 commit 数据'}
                />
                <StatCard
                    label="RAG Mode"
                    value={envStatus?.rag_mode || 'unknown'}
                    sub={`${envStatus?.embed?.api_key_present ? 'embed ready' : 'embed missing'} · ${envStatus?.rerank?.api_key_present ? 'rerank ready' : 'rerank missing'}`}
                />
                <StatCard
                    label="Vector DB"
                    value={formatNumber(envStatus?.vector_db?.record_count || 0)}
                    sub={`${envStatus?.vector_db?.size_bytes || 0} bytes`}
                />
            </div>

            <article className="card">
                <div className="card-header">
                    <div>
                        <div className="section-label">CONTRACT TREE</div>
                        <div className="card-title">合同树概览</div>
                    </div>
                    {contractsSummary ? <Badge tone="purple">{formatChapterLabel(contractsSummary.chapter)}</Badge> : null}
                </div>
                <DataTable
                    columns={[
                        { key: 'type', label: '类型' },
                        {
                            key: 'count',
                            label: '数量',
                            render: row => <Badge tone={row.count > 0 ? 'green' : 'red'}>{row.count}</Badge>,
                        },
                        { key: 'desc', label: '说明' },
                    ]}
                    rows={contractRows}
                    rowKey="type"
                    pageSize={6}
                    emptyText="暂无合同树数据"
                    minWidth={680}
                />
            </article>

            <article className="card">
                <div className="card-header">
                    <div>
                        <div className="section-label">RECENT COMMITS</div>
                        <div className="card-title">最近 Commit 历史</div>
                    </div>
                    <Badge tone="amber">{commits.length} 条</Badge>
                </div>
                <DataTable
                    columns={[
                        {
                            key: 'chapter',
                            label: '章节',
                            render: row => formatChapterLabel(row.chapter),
                        },
                        {
                            key: 'status',
                            label: '状态',
                            render: row => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
                        },
                        {
                            key: 'state',
                            label: 'state',
                            render: row => <Badge tone={statusTone(row.projection_status?.state)}>{row.projection_status?.state || '—'}</Badge>,
                        },
                        {
                            key: 'index',
                            label: 'index',
                            render: row => <Badge tone={statusTone(row.projection_status?.index)}>{row.projection_status?.index || '—'}</Badge>,
                        },
                        {
                            key: 'summary',
                            label: 'summary',
                            render: row => <Badge tone={statusTone(row.projection_status?.summary)}>{row.projection_status?.summary || '—'}</Badge>,
                        },
                        {
                            key: 'memory',
                            label: 'memory',
                            render: row => <Badge tone={statusTone(row.projection_status?.memory)}>{row.projection_status?.memory || '—'}</Badge>,
                        },
                        {
                            key: 'vector',
                            label: 'vector',
                            render: row => <Badge tone={statusTone(row.projection_status?.vector)}>{row.projection_status?.vector || '—'}</Badge>,
                        },
                        {
                            key: 'updated_at',
                            label: '更新时间',
                            render: row => formatDateTime(row.updated_at),
                        },
                    ]}
                    rows={commits}
                    rowKey={(row, index) => `${row.chapter || 0}-${index}`}
                    pageSize={8}
                    emptyText="暂无 commit 记录"
                    minWidth={980}
                />
            </article>

            <article className="card">
                <div className="card-header">
                    <div>
                        <div className="section-label">RAG DIAGNOSIS</div>
                        <div className="card-title">RAG 环境</div>
                    </div>
                    <button
                        type="button"
                        className="page-btn"
                        disabled={probing}
                        onClick={() => {
                            setProbing(true)
                            probeEnvStatus()
                                .then(payload => setProbeResult(payload))
                                .finally(() => setProbing(false))
                        }}
                    >
                        {probing ? '诊断中…' : '运行诊断'}
                    </button>
                </div>
                {probeResult?.checked_at ? (
                    <div className="diagnosis-meta">
                        上次诊断：{formatDateTime(probeResult.checked_at)} · {probeResult.ok ? '全部通过' : '存在缺项'}
                    </div>
                ) : null}
                <DataTable
                    columns={[
                        { key: 'name', label: '组件' },
                        {
                            key: 'ok',
                            label: '状态',
                            render: row => <Badge tone={row.ok ? 'green' : 'red'}>{row.ok ? 'OK' : '缺失'}</Badge>,
                        },
                        { key: 'detail', label: '详情' },
                    ]}
                    rows={envRows}
                    rowKey="name"
                    pageSize={6}
                    emptyText="暂无环境信息"
                    minWidth={680}
                />
            </article>
        </section>
    )
}
