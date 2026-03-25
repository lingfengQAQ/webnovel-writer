import PageScaffold from '../components/PageScaffold.jsx'

const MOCK_ENTITIES = [
    { id: 'char-lin-001', name: '林昭', type: '角色', tier: 'A' },
    { id: 'faction-lotus-002', name: '白莲宗', type: '势力', tier: 'S' },
    { id: 'loc-star-003', name: '玄星城', type: '地点', tier: 'B' },
]

export default function EntitiesPage() {
    return (
        <PageScaffold
            title="设定词典"
            badge={`${MOCK_ENTITIES.length} 条 mock`}
            description="占位页面：后续由 T09 接入设定集抽离与词典冲突处理能力。"
        >
            <div className="card">
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>名称</th>
                                <th>类型</th>
                                <th>层级</th>
                            </tr>
                        </thead>
                        <tbody>
                            {MOCK_ENTITIES.map(item => (
                                <tr key={item.id}>
                                    <td>{item.id}</td>
                                    <td>{item.name}</td>
                                    <td>{item.type}</td>
                                    <td>{item.tier}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </PageScaffold>
    )
}
