import PageScaffold from '../components/PageScaffold.jsx'

const MOCK_CHAPTERS = [
    { chapter: 1, title: '星门初启', words: 3200 },
    { chapter: 2, title: '夜雨追踪', words: 4100 },
    { chapter: 3, title: '白塔交易', words: 3800 },
]

export default function ChaptersPage() {
    return (
        <PageScaffold
            title="章节一览"
            badge={`${MOCK_CHAPTERS.length} 章`}
            description="占位页面：后续任务会对接章节 API 与过滤器。"
        >
            <div className="card">
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>章节</th>
                                <th>标题</th>
                                <th>字数</th>
                            </tr>
                        </thead>
                        <tbody>
                            {MOCK_CHAPTERS.map(item => (
                                <tr key={item.chapter}>
                                    <td>第 {item.chapter} 章</td>
                                    <td>{item.title}</td>
                                    <td>{item.words}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </PageScaffold>
    )
}
