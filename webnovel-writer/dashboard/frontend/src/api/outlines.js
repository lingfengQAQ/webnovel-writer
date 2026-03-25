const DEFAULT_WORKSPACE_ID = 'workspace-default'

const MOCK_TOTAL_OUTLINE = `第1卷：星门余烬
1. 林昭在星门废墟发现残缺星图。
2. 白莲宗派人追查星图去向。

3. 主角决定潜入玄星城黑市。`

const mockState = {
    totalOutline: MOCK_TOTAL_OUTLINE,
    detailedSegments: [],
    splits: [],
    idempotencyMap: new Map(),
    nextSegmentIndex: 0,
}

function resolveProjectRoot(explicitProjectRoot) {
    if (typeof explicitProjectRoot === 'string' && explicitProjectRoot.trim()) {
        return explicitProjectRoot.trim()
    }
    if (typeof window === 'undefined') {
        return ''
    }
    const fromGlobal = typeof window.__WEBNOVEL_PROJECT_ROOT === 'string'
        ? window.__WEBNOVEL_PROJECT_ROOT.trim()
        : ''
    if (fromGlobal) {
        return fromGlobal
    }
    const fromQuery = new URLSearchParams(window.location.search).get('project_root')
    return typeof fromQuery === 'string' ? fromQuery.trim() : ''
}

function createWorkspace({ workspaceId, projectRoot } = {}) {
    return {
        workspace_id: workspaceId || DEFAULT_WORKSPACE_ID,
        project_root: resolveProjectRoot(projectRoot),
    }
}

function createRequestUrl(pathname, query = {}) {
    const url = new URL(pathname, window.location.origin)
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && `${value}`.trim() !== '') {
            url.searchParams.set(key, value)
        }
    })
    return url.toString()
}

async function requestJSON(pathname, { method = 'GET', query, body, signal } = {}) {
    const response = await fetch(createRequestUrl(pathname, query), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal,
    })

    const rawText = await response.text()
    let payload = {}
    if (rawText) {
        try {
            payload = JSON.parse(rawText)
        } catch {
            payload = { message: rawText }
        }
    }

    if (!response.ok) {
        const details = payload?.detail || payload
        const message = details?.message || `${response.status} ${response.statusText}`
        const error = new Error(message)
        error.status = response.status
        error.errorCode = details?.error_code || 'api_request_failed'
        error.details = details?.details || null
        throw error
    }

    return payload
}

function normalizeParagraphLine(line) {
    return line.replace(/^\s*(?:[-*+]|[0-9]+[.)、])\s*/, '').trim()
}

function normalizeParagraphs(text) {
    const normalizedText = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const blocks = normalizedText.split(/\n\s*\n/g)
    const paragraphs = blocks
        .map(block => {
            const merged = block
                .split('\n')
                .map(normalizeParagraphLine)
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
            return merged
        })
        .filter(Boolean)
    return paragraphs
}

function buildAnchors(selectionStart, selectionEnd, count) {
    if (count <= 0) {
        return []
    }
    const span = Math.max(1, selectionEnd - selectionStart)
    return Array.from({ length: count }, (_, index) => {
        const start = selectionStart + Math.floor((span * index) / count)
        const end = index === count - 1
            ? selectionEnd
            : selectionStart + Math.floor((span * (index + 1)) / count)
        return {
            source_start: start,
            source_end: Math.max(start, end),
            paragraph_index: index,
        }
    })
}

function renderDetailedOutline(segments) {
    return segments
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map(segment => `### [${`${segment.order_index}`.padStart(4, '0')}] ${segment.title}\n${segment.content}`)
        .join('\n\n')
}

function buildMockSegments(paragraphs) {
    return paragraphs.map((paragraph, index) => {
        const orderIndex = mockState.nextSegmentIndex + index
        return {
            id: `mock-seg-${orderIndex.toString().padStart(4, '0')}`,
            title: `Scene ${orderIndex + 1}`,
            content: paragraph,
            order_index: orderIndex,
        }
    })
}

function previewSplitWithMock({
    selectionStart,
    selectionEnd,
    selectionText,
}) {
    const safeStart = Math.max(0, selectionStart)
    const safeEnd = Math.max(safeStart + 1, selectionEnd)
    const pickedText = typeof selectionText === 'string' && selectionText.trim()
        ? selectionText
        : mockState.totalOutline.slice(safeStart, safeEnd)
    const paragraphs = normalizeParagraphs(pickedText)
    if (paragraphs.length === 0) {
        return {
            status: 'mock',
            segments: [],
            anchors: [],
            isMock: true,
        }
    }
    const segments = buildMockSegments(paragraphs)
    const anchors = buildAnchors(safeStart, safeEnd, segments.length)
    return {
        status: 'mock',
        segments,
        anchors,
        isMock: true,
    }
}

function applySplitWithMock({
    selectionStart,
    selectionEnd,
    selectionText,
    idempotencyKey,
}) {
    const key = (idempotencyKey || '').trim()
    if (key && mockState.idempotencyMap.has(key)) {
        const found = mockState.splits.find(item => item.id === mockState.idempotencyMap.get(key))
        if (found) {
            return {
                status: 'mock',
                record: found,
                isMock: true,
            }
        }
    }

    const preview = previewSplitWithMock({
        selectionStart,
        selectionEnd,
        selectionText,
    })
    if (!preview.segments.length) {
        const error = new Error('selection text is empty after normalization')
        error.errorCode = 'OUTLINE_EMPTY_SELECTION'
        throw error
    }

    const now = new Date().toISOString()
    const record = {
        id: `mock-split-${mockState.splits.length + 1}`,
        source_start: Math.max(0, selectionStart),
        source_end: Math.max(selectionEnd, selectionStart + 1),
        created_at: now,
        segments: preview.segments.map(item => ({ ...item })),
        anchors: preview.anchors.map(item => ({ ...item })),
    }

    mockState.detailedSegments = [...mockState.detailedSegments, ...record.segments]
        .sort((a, b) => a.order_index - b.order_index)
    mockState.nextSegmentIndex = mockState.detailedSegments.length
    mockState.splits = [...mockState.splits, record]
    if (key) {
        mockState.idempotencyMap.set(key, record.id)
    }

    return {
        status: 'mock',
        record,
        isMock: true,
    }
}

function buildMockBundle() {
    return {
        status: 'mock',
        total_outline: mockState.totalOutline,
        detailed_outline: renderDetailedOutline(mockState.detailedSegments),
        splits: mockState.splits.map(item => ({ ...item })),
        isMock: true,
    }
}

export async function fetchOutlineBundle(options = {}) {
    const workspace = createWorkspace(options)
    try {
        const payload = await requestJSON('/api/outlines', {
            query: {
                workspace_id: workspace.workspace_id,
                project_root: workspace.project_root,
            },
            signal: options.signal,
        })
        return {
            status: payload?.status || 'ok',
            total_outline: payload?.total_outline || '',
            detailed_outline: payload?.detailed_outline || '',
            splits: Array.isArray(payload?.splits) ? payload.splits : [],
            isMock: false,
        }
    } catch (error) {
        const fallback = buildMockBundle()
        return {
            ...fallback,
            error,
        }
    }
}

export async function previewOutlineSplit(options = {}) {
    const workspace = createWorkspace(options)
    const payload = {
        workspace,
        selection_start: Math.max(0, options.selectionStart ?? 0),
        selection_end: Math.max(0, options.selectionEnd ?? 0),
        selection_text: options.selectionText || '',
    }
    try {
        const result = await requestJSON('/api/outlines/split/preview', {
            method: 'POST',
            body: payload,
            signal: options.signal,
        })
        return {
            status: result?.status || 'ok',
            segments: Array.isArray(result?.segments) ? result.segments : [],
            anchors: Array.isArray(result?.anchors) ? result.anchors : [],
            isMock: false,
        }
    } catch (error) {
        return {
            ...previewSplitWithMock({
                selectionStart: payload.selection_start,
                selectionEnd: payload.selection_end,
                selectionText: payload.selection_text,
            }),
            error,
        }
    }
}

export async function applyOutlineSplit(options = {}) {
    const workspace = createWorkspace(options)
    const payload = {
        workspace,
        selection_start: Math.max(0, options.selectionStart ?? 0),
        selection_end: Math.max(0, options.selectionEnd ?? 0),
        idempotency_key: options.idempotencyKey || '',
    }
    try {
        const result = await requestJSON('/api/outlines/split/apply', {
            method: 'POST',
            body: payload,
            signal: options.signal,
        })
        return {
            status: result?.status || 'ok',
            record: result?.record || null,
            isMock: false,
        }
    } catch (error) {
        try {
            return {
                ...applySplitWithMock({
                    selectionStart: payload.selection_start,
                    selectionEnd: payload.selection_end,
                    selectionText: options.selectionText || '',
                    idempotencyKey: payload.idempotency_key,
                }),
                error,
            }
        } catch (mockError) {
            mockError.cause = error
            throw mockError
        }
    }
}

export async function fetchOutlineSplitHistory(options = {}) {
    const workspace = createWorkspace(options)
    try {
        const payload = await requestJSON('/api/outlines/splits', {
            query: {
                workspace_id: workspace.workspace_id,
                project_root: workspace.project_root,
                limit: options.limit ?? 100,
                offset: options.offset ?? 0,
            },
            signal: options.signal,
        })
        return {
            status: payload?.status || 'ok',
            items: Array.isArray(payload?.items) ? payload.items : [],
            total: Number.isFinite(payload?.total) ? payload.total : 0,
            isMock: false,
        }
    } catch (error) {
        return {
            status: 'mock',
            items: mockState.splits.map(item => ({ ...item })),
            total: mockState.splits.length,
            isMock: true,
            error,
        }
    }
}
