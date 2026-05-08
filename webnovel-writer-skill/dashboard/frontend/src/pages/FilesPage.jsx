import { startTransition, useEffect, useMemo, useState } from 'react'
import { useDashboardContext } from '../App.jsx'
import Badge from '../components/Badge.jsx'
import { fetchFileContent, fetchFilesTree } from '../api.js'
import { findFirstFilePath } from '../lib/files.js'

function countTreeItems(items) {
    return (items || []).reduce(
        (count, item) => count + (item.type === 'file' ? 1 : countTreeItems(item.children)),
        0,
    )
}

function TreeNodes({ items, expanded, selectedPath, onToggle, onSelect, depth = 0 }) {
    if (!Array.isArray(items) || !items.length) return null

    return items.map(item => {
        const key = item.path || `${depth}-${item.name}`
        if (item.type === 'dir') {
            const isOpen = expanded[key] ?? depth < 1
            return (
                <li key={key}>
                    <button
                        type="button"
                        className={`tree-item tree-dir ${isOpen ? 'open' : ''}`.trim()}
                        onClick={() => onToggle(key)}
                    >
                        <span className="tree-glyph" />
                        <span className="tree-name">{item.name}</span>
                    </button>
                    {isOpen ? (
                        <ul className="tree-children">
                            <TreeNodes
                                items={item.children}
                                expanded={expanded}
                                selectedPath={selectedPath}
                                onToggle={onToggle}
                                onSelect={onSelect}
                                depth={depth + 1}
                            />
                        </ul>
                    ) : null}
                </li>
            )
        }

        return (
            <li key={key}>
                <button
                    type="button"
                    className={`tree-item tree-file ${selectedPath === item.path ? 'active' : ''}`.trim()}
                    onClick={() => onSelect(item.path)}
                >
                    <span className="tree-glyph file" />
                    <span className="tree-name">{item.name}</span>
                </button>
            </li>
        )
    })
}

export default function FilesPage() {
    const { refreshToken } = useDashboardContext()
    const [tree, setTree] = useState({})
    const [expanded, setExpanded] = useState({})
    const [selectedPath, setSelectedPath] = useState(null)
    const [content, setContent] = useState('')
    const [loadingContent, setLoadingContent] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetchFilesTree()
            .then(payload => {
                if (!cancelled) {
                    setTree(payload)
                    const initialPath = findFirstFilePath(payload)
                    if (initialPath) {
                        setSelectedPath(current => current || initialPath)
                    }
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setTree({})
                }
            })

        return () => {
            cancelled = true
        }
    }, [refreshToken])

    useEffect(() => {
        if (!selectedPath) return undefined

        let cancelled = false
        setLoadingContent(true)
        fetchFileContent(selectedPath)
            .then(payload => {
                if (!cancelled) {
                    setContent(payload.content || '')
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setContent('[读取失败]')
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingContent(false)
                }
            })

        return () => {
            cancelled = true
        }
    }, [selectedPath])

    const totalFiles = useMemo(() => {
        return Object.values(tree).reduce((count, items) => count + countTreeItems(items), 0)
    }, [tree])
    const lineCount = content ? content.split(/\r?\n/).length : 0

    return (
        <section className="dashboard-page">
            <header className="page-header">
                <h2>文档浏览</h2>
                <Badge tone="blue">{totalFiles} 个文件</Badge>
            </header>

            <div className="content-grid files-layout">
                <article className="card files-tree-card">
                    <div className="card-header">
                        <div>
                            <div className="section-label">FILE TREE</div>
                            <div className="card-title">目录树</div>
                        </div>
                        <Badge tone="cyan">正文 / 大纲 / 设定集</Badge>
                    </div>

                    <div className="folder-group-list">
                        {Object.entries(tree).map(([folder, items]) => (
                            <section key={folder} className="folder-block">
                                <div className="folder-title">
                                    <span>{folder}</span>
                                    <Badge tone="purple">{countTreeItems(items)}</Badge>
                                </div>
                                <ul className="file-tree">
                                    <TreeNodes
                                        items={items}
                                        expanded={expanded}
                                        selectedPath={selectedPath}
                                        onToggle={path => {
                                            startTransition(() => {
                                                setExpanded(current => ({ ...current, [path]: !current[path] }))
                                            })
                                        }}
                                        onSelect={setSelectedPath}
                                    />
                                </ul>
                            </section>
                        ))}
                    </div>
                </article>

                <article className="card files-preview-card">
                    <div className="card-header">
                        <div>
                            <div className="section-label">FILE PREVIEW</div>
                            <div className="card-title">内容预览</div>
                        </div>
                        {selectedPath ? (
                            <div className="header-badges">
                                <Badge tone="amber">{lineCount} 行</Badge>
                                <Badge tone="green">{content.length} 字符</Badge>
                            </div>
                        ) : null}
                    </div>

                    {selectedPath ? (
                        <>
                            <div className="selected-path">{selectedPath}</div>
                            <pre className={`file-preview ${loadingContent ? 'loading' : ''}`.trim()}>
                                {loadingContent ? '读取中…' : content}
                            </pre>
                        </>
                    ) : (
                        <div className="empty-state">
                            <p>选择左侧文件以预览内容</p>
                        </div>
                    )}
                </article>
            </div>
        </section>
    )
}
