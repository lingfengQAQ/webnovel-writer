import { useCallback, useEffect, useMemo, useState } from 'react'

const OVERLAY_STYLE = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(18, 16, 12, 0.52)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 40,
}

const DIALOG_STYLE = {
    width: 'min(760px, 100%)',
    maxHeight: '85vh',
    overflow: 'auto',
    borderRadius: 14,
    border: '2px solid #2a220f',
    background: '#fff8e6',
    color: '#2a220f',
    padding: 16,
    boxShadow: '0 16px 40px rgba(42, 34, 15, 0.22)',
}

const BUTTON_STYLE = {
    border: '2px solid #2a220f',
    background: '#fff',
    color: '#2a220f',
    fontSize: 13,
    fontWeight: 600,
    padding: '6px 12px',
    cursor: 'pointer',
}

const PRIMARY_BUTTON_STYLE = {
    ...BUTTON_STYLE,
    background: '#f8d58a',
}

const TAG_STYLE = {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    border: '1px solid #8f7f5c',
    padding: '2px 10px',
    fontSize: 12,
    fontWeight: 600,
    background: '#fff',
}

const LIST_STYLE = {
    margin: 0,
    paddingLeft: 18,
    lineHeight: 1.7,
    fontSize: 13,
}

function normalizeWorkspace(workspace) {
    if (!workspace || typeof workspace !== 'object') {
        return {
            workspace_id: 'workspace-default',
            project_root: '',
        }
    }

    return {
        workspace_id: workspace.workspace_id || workspace.workspaceId || 'workspace-default',
        project_root: workspace.project_root || workspace.projectRoot || '',
    }
}

function strategyLabel(strategy) {
    if (strategy === 'larger_selection') {
        return '大选区：回退全覆盖片段'
    }
    return '小选区：回退整段'
}

function buildIdempotencyKey(rollbackPlan) {
    if (!rollbackPlan) {
        return 'resplit-empty'
    }
    return [
        'resplit',
        rollbackPlan.rollback_strategy || 'smaller_selection',
        rollbackPlan.rollback_start || 0,
        rollbackPlan.rollback_end || 0,
    ].join('-')
}

async function requestJSON(pathname, payload, signal) {
    const response = await fetch(pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
    })

    const rawText = await response.text()
    let body = {}
    if (rawText) {
        try {
            body = JSON.parse(rawText)
        } catch {
            body = { message: rawText }
        }
    }

    if (!response.ok) {
        const detail = body?.detail || body
        const error = new Error(detail?.message || `${response.status} ${response.statusText}`)
        error.errorCode = detail?.error_code || 'api_request_failed'
        error.details = detail?.details || null
        throw error
    }

    return body
}

export default function ResplitDialog({
    isOpen = false,
    workspace,
    selectionStart = 0,
    selectionEnd = 0,
    onClose,
    onApplied,
}) {
    const normalizedWorkspace = useMemo(
        () => normalizeWorkspace(workspace),
        [workspace],
    )
    const [loadingPreview, setLoadingPreview] = useState(false)
    const [applying, setApplying] = useState(false)
    const [error, setError] = useState('')
    const [applyMessage, setApplyMessage] = useState('')
    const [preview, setPreview] = useState(null)

    const refreshPreview = useCallback(async signal => {
        if (selectionEnd <= selectionStart) {
            setPreview(null)
            setError('重拆预览失败：请先在总纲中选中有效区间。')
            return
        }

        setLoadingPreview(true)
        setError('')
        setApplyMessage('')

        try {
            const result = await requestJSON(
                '/api/outlines/resplit/preview',
                {
                    workspace: normalizedWorkspace,
                    selection_start: Math.max(0, selectionStart),
                    selection_end: Math.max(0, selectionEnd),
                },
                signal,
            )
            setPreview(result)
        } catch (previewError) {
            setPreview(null)
            setError(`${previewError.errorCode || 'preview_failed'}: ${previewError.message}`)
        } finally {
            setLoadingPreview(false)
        }
    }, [normalizedWorkspace, selectionEnd, selectionStart])

    useEffect(() => {
        if (!isOpen) {
            setPreview(null)
            setError('')
            setApplyMessage('')
            return
        }

        const controller = new AbortController()
        void refreshPreview(controller.signal)
        return () => {
            controller.abort()
        }
    }, [isOpen, refreshPreview])

    const handleApply = useCallback(async () => {
        if (!preview?.rollback_plan) {
            return
        }

        setApplying(true)
        setError('')
        try {
            const result = await requestJSON(
                '/api/outlines/resplit/apply',
                {
                    workspace: normalizedWorkspace,
                    rollback_plan: preview.rollback_plan,
                    idempotency_key: buildIdempotencyKey(preview.rollback_plan),
                },
            )
            setApplyMessage(`已完成重拆落盘: ${result?.record?.id || 'unknown-record'}`)
            if (typeof onApplied === 'function') {
                onApplied(result)
            }
        } catch (applyError) {
            setError(`${applyError.errorCode || 'apply_failed'}: ${applyError.message}`)
        } finally {
            setApplying(false)
        }
    }, [normalizedWorkspace, onApplied, preview])

    if (!isOpen) {
        return null
    }

    const rollbackPlan = preview?.rollback_plan
    const previewSegments = Array.isArray(preview?.segments) ? preview.segments : []

    return (
        <div role="dialog" aria-modal="true" style={OVERLAY_STYLE}>
            <div style={DIALOG_STYLE}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                        <h3 style={{ margin: 0 }}>重拆回退预览</h3>
                        <p style={{ margin: '6px 0 0 0', fontSize: 13, color: '#5d5035' }}>
                            先计算回退策略，再确认重拆落盘。
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" style={BUTTON_STYLE} onClick={onClose}>
                            关闭
                        </button>
                        <button
                            type="button"
                            style={PRIMARY_BUTTON_STYLE}
                            disabled={!rollbackPlan || applying || loadingPreview}
                            onClick={() => {
                                void handleApply()
                            }}
                        >
                            {applying ? '应用中...' : '应用重拆'}
                        </button>
                    </div>
                </div>

                <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                    {loadingPreview ? <p style={{ margin: 0 }}>正在计算回退策略...</p> : null}
                    {rollbackPlan ? (
                        <div style={{ display: 'grid', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <span style={TAG_STYLE}>{strategyLabel(rollbackPlan.rollback_strategy)}</span>
                                <span style={TAG_STYLE}>
                                    回退区间: [{rollbackPlan.rollback_start}, {rollbackPlan.rollback_end})
                                </span>
                            </div>
                            <p style={{ margin: 0, fontSize: 13, color: '#5d5035' }}>{rollbackPlan.notes || ''}</p>
                        </div>
                    ) : null}

                    <div>
                        <h4 style={{ margin: '4px 0 8px 0' }}>重拆片段预览</h4>
                        {previewSegments.length === 0 ? (
                            <p style={{ margin: 0, fontSize: 13, color: '#8f7f5c' }}>暂无可展示片段。</p>
                        ) : (
                            <ol style={LIST_STYLE}>
                                {previewSegments.map(segment => (
                                    <li key={segment.id}>
                                        <strong>{segment.title}</strong> - {segment.content}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>

                    {applyMessage ? <p style={{ margin: 0, color: '#1f6b2d' }}>{applyMessage}</p> : null}
                    {error ? <p style={{ margin: 0, color: '#9a2a1a' }}>{error}</p> : null}
                </div>
            </div>
        </div>
    )
}

