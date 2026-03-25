import { useCallback, useEffect, useMemo, useState } from 'react'
import PageScaffold from '../components/PageScaffold.jsx'
import { useContextMenu } from '../components/ContextMenuProvider.jsx'
import {
    extractSettingDictionary,
    fetchSettingsFileTree,
    getConflictIdFromEntry,
    isMockResponse,
    listSettingDictionary,
    readSettingsFile,
    resolveDictionaryConflict,
} from '../api/settings.js'

const LAYOUT_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 14,
}

const LIST_STYLE = {
    margin: 0,
    padding: 0,
    listStyle: 'none',
}

const TREE_ROW_STYLE = {
    width: '100%',
    border: '2px solid transparent',
    borderRadius: 6,
    background: 'transparent',
    textAlign: 'left',
    padding: '6px 8px',
    cursor: 'pointer',
    fontSize: 13,
    color: '#5d5035',
}

const PREVIEW_STYLE = {
    border: '2px solid #8f7f5c',
    background: '#fff',
    padding: 10,
    minHeight: 180,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.7,
    fontSize: 13,
    overflow: 'auto',
}

const TOOLBAR_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 10,
}

const BUTTON_STYLE = {
    border: '2px solid #2a220f',
    background: '#fff8e6',
    color: '#2a220f',
    fontSize: 13,
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
}

function collectFirstFilePath(nodes) {
    const stack = Array.isArray(nodes) ? [...nodes] : []
    while (stack.length > 0) {
        const node = stack.shift()
        if (!node) continue
        if (node.type === 'file') {
            return node.path
        }
        if (Array.isArray(node.children)) {
            stack.unshift(...node.children)
        }
    }
    return ''
}

function TreeNodeList({ nodes, selectedPath, onSelect, depth = 0 }) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return null
    }

    return (
        <ul style={LIST_STYLE}>
            {nodes.map(node => {
                const isFile = node.type === 'file'
                const isSelected = isFile && node.path === selectedPath
                return (
                    <li key={node.path} style={{ marginBottom: 2 }}>
                        <button
                            type="button"
                            style={{
                                ...TREE_ROW_STYLE,
                                paddingLeft: 8 + depth * 14,
                                background: isSelected ? '#e6f7ff' : 'transparent',
                                borderColor: isSelected ? '#26a8ff' : 'transparent',
                                fontWeight: isFile ? 600 : 700,
                                cursor: isFile ? 'pointer' : 'default',
                            }}
                            onClick={() => {
                                if (isFile) {
                                    onSelect(node.path)
                                }
                            }}
                        >
                            {isFile ? 'FILE ' : 'DIR '}
                            {node.name}
                        </button>
                        {!isFile ? (
                            <TreeNodeList
                                nodes={node.children || []}
                                selectedPath={selectedPath}
                                onSelect={onSelect}
                                depth={depth + 1}
                            />
                        ) : null}
                    </li>
                )
            })}
        </ul>
    )
}

export default function SettingsPage() {
    const { openForEvent } = useContextMenu()
    const [lastAction, setLastAction] = useState('尚未触发')
    const [fileNodes, setFileNodes] = useState([])
    const [dictionaryItems, setDictionaryItems] = useState([])
    const [selectedPath, setSelectedPath] = useState('')
    const [selectedContent, setSelectedContent] = useState('')
    const [loadingTree, setLoadingTree] = useState(true)
    const [loadingDictionary, setLoadingDictionary] = useState(true)
    const [loadingContent, setLoadingContent] = useState(false)
    const [extracting, setExtracting] = useState(false)
    const [modeTag, setModeTag] = useState('api')

    const refreshDictionary = useCallback(async () => {
        setLoadingDictionary(true)
        const response = await listSettingDictionary({ limit: 200, offset: 0 })
        setDictionaryItems(Array.isArray(response.items) ? response.items : [])
        if (isMockResponse(response)) {
            setModeTag('mock')
        }
        setLoadingDictionary(false)
    }, [])

    const readFile = useCallback(async path => {
        if (!path) {
            setSelectedContent('')
            return
        }

        setLoadingContent(true)
        const response = await readSettingsFile({ path })
        setSelectedPath(path)
        setSelectedContent(response.content || '')
        if (isMockResponse(response)) {
            setModeTag('mock')
        }
        setLoadingContent(false)
    }, [])

    const refreshTree = useCallback(async () => {
        setLoadingTree(true)
        const response = await fetchSettingsFileTree()
        const nodes = Array.isArray(response.nodes) ? response.nodes : []
        setFileNodes(nodes)
        if (isMockResponse(response)) {
            setModeTag('mock')
        }
        const initialPath = selectedPath || collectFirstFilePath(nodes)
        if (initialPath) {
            await readFile(initialPath)
        }
        setLoadingTree(false)
    }, [readFile, selectedPath])

    useEffect(() => {
        void Promise.all([refreshTree(), refreshDictionary()])
    }, [refreshDictionary, refreshTree])

    const applyLocalStatus = useCallback((entryId, status) => {
        setDictionaryItems(prev => {
            return prev.map(item => {
                if (item.id !== entryId) {
                    return item
                }
                return { ...item, status }
            })
        })
    }, [])

    const handleDictionaryAction = useCallback(async payload => {
        const actionId = payload.actionId
        const entryId = payload.meta?.entryId || ''
        const sourceFile = payload.meta?.sourceFile || ''
        const conflictId = payload.meta?.conflictId || ''

        if (actionId === 'view-source') {
            await readFile(sourceFile)
            setLastAction(`${actionId} -> ${sourceFile}`)
            return
        }

        if (actionId === 'mark-confirmed') {
            if (conflictId) {
                const response = await resolveDictionaryConflict({
                    id: conflictId,
                    decision: 'confirm',
                    attrs: {},
                })
                if (isMockResponse(response)) {
                    setModeTag('mock')
                }
            }
            applyLocalStatus(entryId, 'confirmed')
            setLastAction(`${actionId} -> ${entryId}`)
            return
        }

        if (actionId === 'resolve-conflict') {
            if (conflictId) {
                const response = await resolveDictionaryConflict({
                    id: conflictId,
                    decision: 'confirm',
                    attrs: {},
                })
                if (isMockResponse(response)) {
                    setModeTag('mock')
                }
                await refreshDictionary()
                setLastAction(`${actionId} -> ${conflictId}`)
                return
            }

            applyLocalStatus(entryId, 'confirmed')
            setLastAction(`${actionId} -> no_conflict_id(local_apply)`)
            return
        }

        setLastAction(`${actionId} -> ${entryId || 'unknown'}`)
    }, [applyLocalStatus, readFile, refreshDictionary])

    const openDictionaryMenu = useCallback((event, item) => {
        const conflictId = getConflictIdFromEntry(item)
        openForEvent(event, {
            sourceId: 'settings.dictionary.entry',
            meta: {
                entryId: item.id,
                sourceFile: item.source_file,
                conflictId,
            },
            onAction: payload => {
                void handleDictionaryAction(payload)
            },
            items: [
                {
                    id: 'view-source',
                    actionId: 'view-source',
                    label: '定位源文件',
                    shortcut: 'V',
                },
                {
                    id: 'mark-confirmed',
                    actionId: 'mark-confirmed',
                    label: '标记为已确认',
                    disabled: item.status === 'confirmed',
                    shortcut: 'C',
                },
                {
                    id: 'resolve-conflict',
                    actionId: 'resolve-conflict',
                    label: '处理冲突',
                    disabled: item.status !== 'conflict',
                    shortcut: 'R',
                },
            ],
        })
    }, [handleDictionaryAction, openForEvent])

    const runExtract = useCallback(async () => {
        setExtracting(true)
        const response = await extractSettingDictionary({ incremental: true })
        if (isMockResponse(response)) {
            setModeTag('mock')
        }
        setLastAction(`dictionary.extract -> +${response.extracted} / conflicts ${response.conflicts}`)
        await refreshDictionary()
        setExtracting(false)
    }, [refreshDictionary])

    const dictionaryBadge = useMemo(() => {
        if (loadingDictionary) {
            return '词典加载中'
        }
        return `${dictionaryItems.length} 条`
    }, [dictionaryItems.length, loadingDictionary])

    return (
        <PageScaffold
            title="设定集"
            badge="Settings & Dictionary"
            description="双栏同屏：左侧设定文件树，右侧词典条目。支持词典抽离、冲突处理与 mock 降级。"
        >
            <div style={LAYOUT_STYLE}>
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">设定文件树</span>
                        <span className="card-badge badge-green">mode: {modeTag.toUpperCase()}</span>
                    </div>
                    {loadingTree ? <p style={{ margin: 0 }}>文件树加载中...</p> : null}
                    {!loadingTree && fileNodes.length === 0 ? <p style={{ margin: 0 }}>未发现设定集文件。</p> : null}
                    <TreeNodeList nodes={fileNodes} selectedPath={selectedPath} onSelect={readFile} />
                    <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, color: '#8f7f5c', marginBottom: 6 }}>
                            当前文件: {selectedPath || '未选择'}
                        </div>
                        <div style={PREVIEW_STYLE}>
                            {loadingContent ? '文件读取中...' : selectedContent || '请选择文件进行预览。'}
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <span className="card-title">设定词典</span>
                        <span className="card-badge badge-blue">{dictionaryBadge}</span>
                    </div>
                    <div style={TOOLBAR_STYLE}>
                        <button type="button" style={BUTTON_STYLE} disabled={extracting} onClick={runExtract}>
                            {extracting ? '抽离中...' : '抽离词典（增量）'}
                        </button>
                        <button type="button" style={BUTTON_STYLE} disabled={loadingDictionary} onClick={refreshDictionary}>
                            刷新词典
                        </button>
                    </div>
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>term</th>
                                    <th>type</th>
                                    <th>status</th>
                                    <th>source</th>
                                    <th>span</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dictionaryItems.map(item => (
                                    <tr
                                        key={item.id}
                                        onContextMenu={event => openDictionaryMenu(event, item)}
                                        style={{ cursor: 'context-menu' }}
                                    >
                                        <td>{item.term}</td>
                                        <td>{item.type}</td>
                                        <td>{item.status}</td>
                                        <td>{item.source_file}</td>
                                        <td>{item.source_span}</td>
                                    </tr>
                                ))}
                                {!loadingDictionary && dictionaryItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} style={{ color: '#8f7f5c' }}>
                                            词典暂无数据，点击“抽离词典（增量）”开始构建。
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">协议回执</span>
                    <span className="card-badge badge-blue">sourceId: settings.dictionary.entry</span>
                </div>
                <p style={{ margin: 0 }}>最近动作: {lastAction}</p>
            </div>
        </PageScaffold>
    )
}
