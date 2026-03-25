import PageScaffold from '../components/PageScaffold.jsx'

const MOCK_READING_POWER = [
    { chapter: 1, hook: '开场悬念', strength: 'strong' },
    { chapter: 2, hook: '人物反差', strength: 'medium' },
    { chapter: 3, hook: '冲突升级', strength: 'strong' },
]

export default function ReadingPowerPage() {
    return (
        <PageScaffold
            title="追读力"
            badge="Mock"
            description="占位页面：后续会接入真实追读力指标。"
        >
            <div className="card">
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>章节</th>
                                <th>钩子类型</th>
                                <th>强度</th>
                            </tr>
                        </thead>
                        <tbody>
                            {MOCK_READING_POWER.map(item => (
                                <tr key={item.chapter}>
                                    <td>第 {item.chapter} 章</td>
                                    <td>{item.hook}</td>
                                    <td>{item.strength}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </PageScaffold>
    )
}
