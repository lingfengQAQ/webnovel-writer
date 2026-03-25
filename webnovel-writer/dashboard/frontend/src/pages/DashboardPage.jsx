import PageScaffold from '../components/PageScaffold.jsx'

const MODULE_CARDS = [
    { id: 'skills', title: '技能模块', status: 'Skeleton Ready' },
    { id: 'settings', title: '设定词典模块', status: 'Skeleton Ready' },
    { id: 'outline', title: '双纲拆分模块', status: 'Skeleton Ready' },
]

export default function DashboardPage() {
    return (
        <PageScaffold
            title="数据总览"
            badge="T03"
            description="前端核心骨架已切分为独立页面，支持后续代理按页面并行填充功能。"
        >
            <div className="dashboard-grid">
                {MODULE_CARDS.map(card => (
                    <div className="card stat-card" key={card.id}>
                        <span className="stat-label">{card.title}</span>
                        <span className="stat-value plain">{card.status}</span>
                        <span className="stat-sub">Route: #/{card.id}</span>
                    </div>
                ))}
            </div>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">当前里程碑</span>
                    <span className="card-badge badge-green">W1</span>
                </div>
                <p style={{ margin: 0, lineHeight: 1.7 }}>
                    本页面使用 mock 内容，仅用于验证路由与骨架可用性。后续任务将逐步替换为 API 驱动数据。
                </p>
            </div>
        </PageScaffold>
    )
}
