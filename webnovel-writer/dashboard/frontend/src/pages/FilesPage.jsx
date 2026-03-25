import PageScaffold from '../components/PageScaffold.jsx'

const MOCK_FILES = [
    '设定集/角色.md',
    '设定集/势力.md',
    '大纲/总纲.md',
    '大纲/细纲.md',
]

export default function FilesPage() {
    return (
        <PageScaffold
            title="文档浏览"
            badge={`${MOCK_FILES.length} 个文件`}
            description="占位页面：后续可切换为真实文件树与内容读取接口。"
        >
            <div className="card">
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
                    {MOCK_FILES.map(path => (
                        <li key={path}>{path}</li>
                    ))}
                </ul>
            </div>
        </PageScaffold>
    )
}
