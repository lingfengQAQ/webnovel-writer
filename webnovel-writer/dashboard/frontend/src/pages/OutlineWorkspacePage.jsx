import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageScaffold from '../components/PageScaffold.jsx'
import { useContextMenu } from '../components/ContextMenuProvider.jsx'
import {
    applyOutlineSplit,
    fetchOutlineBundle,
    fetchOutlineSplitHistory,
    previewOutlineSplit,
} from '../api/outlines.js'

const DUAL_LAYOUT_STYLE = {
    display: 'grid',
    gap: 14,
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
}

const TEXTAREA_STYLE = {
    width: '100%',
    minHeight: 260,
    borderRadius: 8,
    border: '2px solid #8f7f5c',
    background: '#fff',
    color: '#2a220f',
    fontSize: 13,
    lineHeight: 1.6,
    padding: 10,
    resize: 'vertical',
    fontFamily: 'inherit',
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

const PREVIEW_LIST_STYLE = {
    margin: 0,
    paddingLeft: 18,
    lineHeight: 1.7,
    fontSize: 13,
    color: '#5d5035',
}

function buildSelectionPayload(textareaRef) {
    const element = textareaRef.current
    if (!element) {
        return { selectionStart: 0, selectionEnd: 0, selectionText: '' }
    }

    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    const text = element.value?.slice(start, end) || ''
    return {
        selectionStart: start,
        selectionEnd: end,
        selectionText: text,
    }
}

function buildIdempotencyKey(selectionStart, selectionEnd, selectionText) {
    const textHash = Array.from(selectionText || '')
        .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 1000000007, 7)
    return `fe-${selectionStart}-${selectionEnd}-${textHash}`
}

export default function OutlineWorkspacePage() {
    const { openForEvent } = useContextMenu()
    const masterRef = useRef(null)

    const [lastAction, setLastAction] = useState('尚未触发')
    const [totalOutline, setTotalOutline] = useState('')
    const [detailedOutline, setDetailedOutline] = useState('')
    const [previewSegments, setPreviewSegments] = useState([])
    const [splitHistory, setSplitHistory] = useState([])
    const [loadingBundle, setLoadingBundle] = useState(true)
    const [splitting, setSplitting] = useState(false)
    const [modeTag, setModeTag] = useState('api')

    const refreshBundle = useCallback(async () => {
        setLoadingBundle(true)
        const bundle = await fetchOutlineBundle()
        setTotalOutline(bundle.total_outline || '')
        setDetailedOutline(bundle.detailed_outline || '')
        if (bundle.isMock) {
            setModeTag('mock')
        }

        const history = await fetchOutlineSplitHistory({ limit: 20, offset: 0 })
        setSplitHistory(Array.isArray(history.items) ? history.items : [])
        if (history.isMock) {
            setModeTag('mock')
        }
        setLoadingBundle(false)
    }, [])

    useEffect(() => {
        void refreshBundle()
    }, [refreshBundle])

    const runSplitPreview = useCallback(async selection => {
        if (!selection.selectionText || selection.selectionEnd <= selection.selectionStart) {
            setLastAction('split-preview -> 未检测到有效选区')
            return
        }
        setSplitting(true)
        const result = await previewOutlineSplit(selection)
        if (result.isMock) {
            setModeTag('mock')
        }
        setPreviewSegments(Array.isArray(result.segments) ? result.segments : [])
        setLastAction(`split-preview -> ${result.segments?.length || 0} 段`)
        setSplitting(false)
    }, [])

    const runSplitApply = useCallback(async selection => {
        if (!selection.selectionText || selection.selectionEnd <= selection.selectionStart) {
            setLastAction('split-apply -> 未检测到有效选区')
            return
        }

        setSplitting(true)
        const idempotencyKey = buildIdempotencyKey(
            selection.selectionStart,
            selection.selectionEnd,
            selection.selectionText,
        )
        const result = await applyOutlineSplit({
            ...selection,
            idempotencyKey,
        })
        if (result.isMock) {
            setModeTag('mock')
        }
        const count = result.record?.segments?.length || 0
        setLastAction(`split-apply -> ${count} 段, key=${idempotencyKey}`)
        await refreshBundle()
        setSplitting(false)
    }, [refreshBundle])

    const handleMenuAction = useCallback(async payload => {
        const actionId = payload.actionId
        const selection = payload.meta?.selection || {
            selectionStart: 0,
            selectionEnd: 0,
            selectionText: '',
        }

        if (actionId === 'split-preview') {
            await runSplitPreview(selection)
            return
        }
        if (actionId === 'split-apply') {
            await runSplitApply(selection)
            return
        }

        if (actionId === 'resplit-preview') {
            setLastAction('resplit-preview -> T10 对接点（当前仅占位）')
            return
        }
        if (actionId === 'assist-edit') {
            setLastAction('assist-edit -> T07/T10 对接点（当前仅占位）')
            return
        }
        setLastAction(`${actionId} -> no-op`)
    }, [runSplitApply, runSplitPreview])

    const openOutlineMenu = useCallback((event, panel) => {
        const selection = panel === 'master'
            ? buildSelectionPayload(masterRef)
            : { selectionStart: 0, selectionEnd: 0, selectionText: '' }

        openForEvent(event, {
            sourceId: `outline.${panel}.editor`,
            meta: {
                panel,
                selection,
            },
            onAction: payload => {
                void handleMenuAction(payload)
            },
            items: [
                {
                    id: 'split-preview',
                    actionId: 'split-preview',
                    label: '拆分预览',
                    shortcut: 'P',
                    disabled: panel !== 'master',
                },
                {
                    id: 'split-apply',
                    actionId: 'split-apply',
                    label: '应用拆分',
                    shortcut: 'A',
                    disabled: panel !== 'master',
                },
                {
                    id: 'resplit-preview',
                    actionId: 'resplit-preview',
                    label: '重拆预览',
                    shortcut: 'R',
                    disabled: panel !== 'detail',
                },
                {
                    id: 'assist-edit',
                    actionId: 'assist-edit',
                    label: '协助修改',
                    shortcut: 'G',
                },
            ],
        })
    }, [handleMenuAction, openForEvent])

    const splitCountBadge = useMemo(() => {
        if (loadingBundle) {
            return '加载中'
        }
        return `${splitHistory.length} 条拆分记录`
    }, [loadingBundle, splitHistory.length])

    return (
        <PageScaffold
            title="双纲工作台"
            badge="Outline Workspace"
            description="双栏同屏：在总纲区选中文本并右键即可拆分预览/应用，细纲区实时刷新。"
        >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={BUTTON_STYLE} disabled={loadingBundle} onClick={refreshBundle}>
                    刷新双纲数据
                </button>
                <span className="card-badge badge-green">mode: {modeTag.toUpperCase()}</span>
                <span className="card-badge badge-blue">{splitCountBadge}</span>
            </div>

            <div style={DUAL_LAYOUT_STYLE}>
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">总纲区</span>
                        <span className="card-badge badge-green">sourceId: outline.master.editor</span>
                    </div>
                    <textarea
                        ref={masterRef}
                        value={totalOutline}
                        readOnly
                        style={TEXTAREA_STYLE}
                        onContextMenu={event => openOutlineMenu(event, 'master')}
                    />
                    <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#8f7f5c' }}>
                        操作提示: 先在总纲中选中文本，再右键执行“拆分预览/应用拆分”。
                    </p>
                </div>

                <div className="card">
                    <div className="card-header">
                        <span className="card-title">细纲区</span>
                        <span className="card-badge badge-blue">sourceId: outline.detail.editor</span>
                    </div>
                    <textarea
                        value={detailedOutline}
                        readOnly
                        style={TEXTAREA_STYLE}
                        onContextMenu={event => openOutlineMenu(event, 'detail')}
                    />
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">拆分预览</span>
                    <span className="card-badge badge-amber">{splitting ? '处理中' : `${previewSegments.length} 段`}</span>
                </div>
                {previewSegments.length === 0 ? (
                    <p style={{ margin: 0, color: '#8f7f5c' }}>暂无预览结果。</p>
                ) : (
                    <ol style={PREVIEW_LIST_STYLE}>
                        {previewSegments.map(segment => (
                            <li key={segment.id}>
                                <strong>{segment.title}</strong> - {segment.content}
                            </li>
                        ))}
                    </ol>
                )}
            </div>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">协议回执</span>
                    <span className="card-badge badge-purple">Context Menu Contract Reusable</span>
                </div>
                <p style={{ margin: 0 }}>最近动作: {lastAction}</p>
            </div>
        </PageScaffold>
    )
}
