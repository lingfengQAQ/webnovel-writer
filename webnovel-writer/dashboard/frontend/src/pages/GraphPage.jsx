import PageScaffold from '../components/PageScaffold.jsx'

export default function GraphPage() {
    return (
        <PageScaffold
            title="关系图谱"
            badge="Mock"
            description="占位页面：图谱引擎将由后续任务补充，此处先保证页面路由可切换。"
        >
            <div className="card">
                <div className="empty-state">
                    <div className="empty-icon">G</div>
                    <p>Graph canvas placeholder</p>
                </div>
            </div>
        </PageScaffold>
    )
}
