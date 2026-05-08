import { useEffect, useMemo, useState } from 'react'
import { useDashboardContext } from '../App.jsx'
import { fetchChapterTrend, fetchChapters } from '../api.js'
import Badge from '../components/Badge.jsx'
import ChartWrapper from '../components/ChartWrapper.jsx'
import Pager from '../components/Pager.jsx'
import { STRAND_COLORS, buildBoxplotData } from '../lib/charts.js'
import { average, formatChapterLabel, formatNumber, formatShortNumber } from '../lib/format.js'
import { groupChaptersByVolume } from '../lib/story.js'

const WINDOW_SIZE = 50

function buildHookOption(items) {
    return {
        tooltip: { trigger: 'axis' },
        xAxis: {
            type: 'category',
            data: items.map(item => item.chapter),
            axisLabel: { interval: 9, formatter: value => `${value}` },
        },
        yAxis: {
            type: 'value',
            min: 0,
            max: 5,
            axisLabel: {
                formatter: value => ['', 'weak', '', 'medium', '', 'strong'][value] || '',
            },
        },
        series: [
            {
                type: 'line',
                data: items.map(item => item.hook_strength_value || 0),
                symbol: 'rect',
                symbolSize: 8,
                lineStyle: { width: 3, color: '#f5a524' },
                itemStyle: {
                    color: '#f5a524',
                    borderColor: '#2a220f',
                    borderWidth: 2,
                },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(245, 165, 36, 0.32)' },
                            { offset: 1, color: 'rgba(245, 165, 36, 0)' },
                        ],
                    },
                },
            },
        ],
    }
}

function buildStrandStackOption(items) {
    const chapters = items.map(item => item.chapter)
    return {
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, data: ['Quest', 'Fire', 'Constellation'] },
        xAxis: {
            type: 'category',
            data: chapters,
            axisLabel: { interval: 9, formatter: value => `${value}` },
        },
        yAxis: {
            type: 'value',
            max: 1,
            splitNumber: 1,
        },
        series: [
            {
                name: 'Quest',
                type: 'bar',
                stack: 'strand',
                data: items.map(item => (item.strand === 'quest' ? 1 : 0)),
                barWidth: '64%',
                itemStyle: {
                    color: STRAND_COLORS.quest,
                    borderColor: '#2a220f',
                    borderWidth: 1,
                },
            },
            {
                name: 'Fire',
                type: 'bar',
                stack: 'strand',
                data: items.map(item => (item.strand === 'fire' ? 1 : 0)),
                itemStyle: {
                    color: STRAND_COLORS.fire,
                    borderColor: '#2a220f',
                    borderWidth: 1,
                },
            },
            {
                name: 'Constellation',
                type: 'bar',
                stack: 'strand',
                data: items.map(item => (item.strand === 'constellation' ? 1 : 0)),
                itemStyle: {
                    color: STRAND_COLORS.constellation,
                    borderColor: '#2a220f',
                    borderWidth: 1,
                },
            },
        ],
    }
}

function buildWordBoxOption(groups) {
    return {
        tooltip: { trigger: 'item' },
        xAxis: {
            type: 'category',
            data: groups.map(group => group.label),
        },
        yAxis: {
            type: 'value',
            axisLabel: {
                formatter: value => `${formatShortNumber(Number(value) / 1000)}k`,
            },
        },
        series: [
            {
                type: 'boxplot',
                data: buildBoxplotData(groups),
                itemStyle: {
                    color: '#fffaf0',
                    borderColor: '#26a8ff',
                    borderWidth: 2,
                },
            },
        ],
    }
}

function StatCard({ label, value, sub }) {
    return (
        <article className="card stat-card">
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
            <span className="stat-sub">{sub}</span>
        </article>
    )
}

export default function PacingPage() {
    const { projectInfo, refreshToken } = useDashboardContext()
    const [allChapters, setAllChapters] = useState([])
    const [windowIndex, setWindowIndex] = useState(0)
    const [windowPayload, setWindowPayload] = useState({ items: [], total: 0, latest_chapter: 0 })
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setWindowIndex(0)
    }, [refreshToken])

    useEffect(() => {
        let cancelled = false

        fetchChapters()
            .then(payload => {
                if (!cancelled) {
                    setAllChapters(payload)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setAllChapters([])
                }
            })

        return () => {
            cancelled = true
        }
    }, [refreshToken])

    useEffect(() => {
        let cancelled = false
        setLoading(true)

        fetchChapterTrend({ limit: WINDOW_SIZE, offset: windowIndex * WINDOW_SIZE })
            .then(payload => {
                if (!cancelled) {
                    setWindowPayload(payload)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setWindowPayload({ items: [], total: 0, latest_chapter: 0 })
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false)
                }
            })

        return () => {
            cancelled = true
        }
    }, [refreshToken, windowIndex])

    const totalPages = Math.max(1, Math.ceil((windowPayload.total || 0) / WINDOW_SIZE))
    const displayPage = Math.max(1, totalPages - windowIndex)
    const groups = useMemo(
        () => groupChaptersByVolume(allChapters, projectInfo),
        [allChapters, projectInfo],
    )
    const items = windowPayload.items || []
    const hookAverage = useMemo(() => average(items.map(item => item.hook_strength_value)), [items])
    const transitionCount = useMemo(
        () => items.filter(item => item.is_transition).length,
        [items],
    )
    const currentStart = items[0]?.chapter || 0
    const currentEnd = items[items.length - 1]?.chapter || 0

    return (
        <section className="dashboard-page">
            <header className="page-header">
                <h2>节奏雷达</h2>
                <Badge tone="amber">{windowPayload.total || 0} 章数据</Badge>
            </header>

            <div className="stat-grid">
                <StatCard
                    label="当前窗口"
                    value={currentStart && currentEnd ? `${currentStart} - ${currentEnd}` : '—'}
                    sub="默认最近 50 章"
                />
                <StatCard
                    label="平均钩子强度"
                    value={hookAverage ? formatShortNumber(hookAverage) : '—'}
                    sub="映射 weak=1 / medium=3 / strong=5"
                />
                <StatCard
                    label="过渡章"
                    value={String(transitionCount)}
                    sub="当前窗口内标记为 transition 的章节"
                />
                <StatCard
                    label="总字数"
                    value={formatNumber(allChapters.reduce((sum, item) => sum + Number(item.word_count || 0), 0))}
                    sub={`最新章节 ${formatChapterLabel(windowPayload.latest_chapter)}`}
                />
            </div>

            <article className="card">
                <div className="card-header">
                    <div>
                        <div className="section-label">HOOK TREND</div>
                        <div className="card-title">钩子强度走势</div>
                    </div>
                    <Badge tone="green">
                        {currentStart && currentEnd ? `${formatChapterLabel(currentStart)} - ${formatChapterLabel(currentEnd)}` : '最近窗口'}
                    </Badge>
                </div>
                {items.length ? (
                    <>
                        <ChartWrapper option={buildHookOption(items)} loading={loading} />
                        <Pager
                            page={displayPage}
                            totalPages={totalPages}
                            currentStart={currentStart}
                            currentEnd={currentEnd}
                            totalItems={windowPayload.total || 0}
                            onPrevious={() => setWindowIndex(current => Math.min(totalPages - 1, current + 1))}
                            onNext={() => setWindowIndex(current => Math.max(0, current - 1))}
                            onLatest={() => setWindowIndex(0)}
                            stepLabel={String(WINDOW_SIZE)}
                        />
                    </>
                ) : (
                    <div className="empty-state">
                        <p>暂无钩子强度数据</p>
                    </div>
                )}
            </article>

            <div className="content-grid two-columns">
                <article className="card">
                    <div className="card-header">
                        <div>
                            <div className="section-label">STRAND STACK</div>
                            <div className="card-title">Strand 分布（逐章）</div>
                        </div>
                        <Badge tone="purple">堆叠柱状图</Badge>
                    </div>
                    {items.length ? (
                        <ChartWrapper option={buildStrandStackOption(items)} />
                    ) : (
                        <div className="empty-state">
                            <p>暂无 Strand 数据</p>
                        </div>
                    )}
                </article>

                <article className="card">
                    <div className="card-header">
                        <div>
                            <div className="section-label">WORD BOXPLOT</div>
                            <div className="card-title">章节字数分布</div>
                        </div>
                        <Badge tone="blue">按卷分组</Badge>
                    </div>
                    {groups.length ? (
                        <ChartWrapper option={buildWordBoxOption(groups)} />
                    ) : (
                        <div className="empty-state">
                            <p>暂无章节字数数据</p>
                        </div>
                    )}
                </article>
            </div>
        </section>
    )
}
