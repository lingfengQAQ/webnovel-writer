const DEFAULT_WORKSPACE_ID = 'workspace-default'

const MOCK_FILE_TREE = [
    {
        name: '设定集',
        path: '设定集',
        type: 'dir',
        children: [
            { name: '角色.md', path: '设定集/角色.md', type: 'file', children: [] },
            { name: '地域.md', path: '设定集/地域.md', type: 'file', children: [] },
            { name: '势力.md', path: '设定集/势力.md', type: 'file', children: [] },
            { name: '法术体系.md', path: '设定集/法术体系.md', type: 'file', children: [] },
        ],
    },
]

const MOCK_FILE_CONTENTS = {
    '设定集/角色.md': '林昭(角色): 阵营=游侠; 目标=追查星图',
    '设定集/地域.md': '玄星城(地点): region=东陆; ruler=城主顾衡',
    '设定集/势力.md': '白莲宗(势力): 立场=敌对; 资源=情报网',
    '设定集/法术体系.md': '灵核(概念): 属性=火; 阶位=三阶',
}

const INITIAL_MOCK_DICTIONARY = [
    {
        id: 'dict-001',
        term: '灵核',
        type: '概念',
        attrs: { 属性: '火', 阶位: '三阶' },
        source_file: '设定集/法术体系.md',
        source_span: '0-22',
        status: 'confirmed',
        fingerprint: 'mock-fp-001',
    },
    {
        id: 'dict-002',
        term: '白莲宗',
        type: '势力',
        attrs: { 立场: '敌对' },
        source_file: '设定集/势力.md',
        source_span: '0-23',
        status: 'conflict',
        fingerprint: 'mock-fp-002',
        conflict_id: 'conf-002',
    },
    {
        id: 'dict-003',
        term: '玄星城',
        type: '地点',
        attrs: { region: '东陆' },
        source_file: '设定集/地域.md',
        source_span: '0-27',
        status: 'pending',
        fingerprint: 'mock-fp-003',
    },
]

const mockState = {
    dictionary: INITIAL_MOCK_DICTIONARY.map(item => ({ ...item })),
    hasExtracted: false,
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

function buildWorkspace({ workspaceId, projectRoot } = {}) {
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
        const errorCode = details?.error_code || 'api_request_failed'
        const message = details?.message || `${response.status} ${response.statusText}`
        const error = new Error(message)
        error.status = response.status
        error.errorCode = errorCode
        error.details = details?.details || null
        throw error
    }

    return payload
}

function normalizeDictionaryItem(item) {
    return {
        id: item?.id || '',
        term: item?.term || '',
        type: item?.type || 'concept',
        attrs: item?.attrs && typeof item.attrs === 'object' ? item.attrs : {},
        source_file: item?.source_file || item?.sourceFile || '',
        source_span: item?.source_span || item?.sourceSpan || '0-0',
        status: item?.status || 'pending',
        fingerprint: item?.fingerprint || '',
        conflict_id: item?.conflict_id || item?.conflictId || '',
    }
}

function flattenFilePaths(nodes) {
    const files = []
    const stack = Array.isArray(nodes) ? [...nodes] : []
    while (stack.length > 0) {
        const node = stack.pop()
        if (!node) continue
        if (node.type === 'file') {
            files.push(node.path)
            continue
        }
        if (Array.isArray(node.children)) {
            for (let index = node.children.length - 1; index >= 0; index -= 1) {
                stack.push(node.children[index])
            }
        }
    }
    return files
}

function listMockDictionary({ term, type, status, limit = 100, offset = 0 } = {}) {
    let items = mockState.dictionary.map(normalizeDictionaryItem)
    if (term) {
        const needle = term.trim().toLowerCase()
        items = items.filter(item => item.term.toLowerCase().includes(needle))
    }
    if (type) {
        items = items.filter(item => item.type === type)
    }
    if (status) {
        items = items.filter(item => item.status === status)
    }
    const total = items.length
    const start = Math.max(0, offset)
    const end = Math.min(total, start + Math.max(1, limit))
    return { items: items.slice(start, end), total }
}

export function isMockResponse(response) {
    return Boolean(response?.isMock)
}

export function getConflictIdFromEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return ''
    }
    if (typeof entry.conflict_id === 'string' && entry.conflict_id.trim()) {
        return entry.conflict_id.trim()
    }
    if (typeof entry.id === 'string' && entry.id.startsWith('conf-')) {
        return entry.id
    }
    return ''
}

export async function fetchSettingsFileTree(options = {}) {
    const workspace = buildWorkspace(options)
    try {
        const payload = await requestJSON('/api/settings/files/tree', {
            query: {
                workspace_id: workspace.workspace_id,
                project_root: workspace.project_root,
            },
            signal: options.signal,
        })
        return {
            status: payload?.status || 'ok',
            nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
            isMock: false,
        }
    } catch (error) {
        return {
            status: 'mock',
            nodes: MOCK_FILE_TREE,
            isMock: true,
            error,
        }
    }
}

export async function readSettingsFile(options = {}) {
    const workspace = buildWorkspace(options)
    const filePath = typeof options.path === 'string' ? options.path.trim() : ''
    if (!filePath) {
        return { status: 'invalid', path: '', content: '', isMock: true }
    }
    try {
        const payload = await requestJSON('/api/settings/files/read', {
            query: {
                workspace_id: workspace.workspace_id,
                project_root: workspace.project_root,
                path: filePath,
            },
            signal: options.signal,
        })
        return {
            status: payload?.status || 'ok',
            path: payload?.path || filePath,
            content: payload?.content || '',
            isMock: false,
        }
    } catch (error) {
        return {
            status: 'mock',
            path: filePath,
            content: MOCK_FILE_CONTENTS[filePath] || '',
            isMock: true,
            error,
        }
    }
}

export async function extractSettingDictionary(options = {}) {
    const workspace = buildWorkspace(options)
    const incremental = options.incremental !== false
    try {
        const payload = await requestJSON('/api/settings/dictionary/extract', {
            method: 'POST',
            body: {
                workspace,
                incremental,
            },
            signal: options.signal,
        })
        return {
            status: payload?.status || 'ok',
            extracted: Number.isFinite(payload?.extracted) ? payload.extracted : 0,
            conflicts: Number.isFinite(payload?.conflicts) ? payload.conflicts : 0,
            isMock: false,
        }
    } catch (error) {
        const files = flattenFilePaths(MOCK_FILE_TREE)
        const extracted = mockState.hasExtracted ? 0 : files.length
        mockState.hasExtracted = true
        return {
            status: 'mock',
            extracted,
            conflicts: mockState.dictionary.filter(item => item.status === 'conflict').length,
            isMock: true,
            error,
        }
    }
}

export async function listSettingDictionary(options = {}) {
    const workspace = buildWorkspace(options)
    const query = {
        workspace_id: workspace.workspace_id,
        project_root: workspace.project_root,
        term: options.term,
        type: options.type,
        status: options.status,
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
    }
    try {
        const payload = await requestJSON('/api/settings/dictionary', {
            query,
            signal: options.signal,
        })
        const items = Array.isArray(payload?.items) ? payload.items.map(normalizeDictionaryItem) : []
        return {
            status: payload?.status || 'ok',
            items,
            total: Number.isFinite(payload?.total) ? payload.total : items.length,
            isMock: false,
        }
    } catch (error) {
        const fallback = listMockDictionary(query)
        return {
            status: 'mock',
            items: fallback.items,
            total: fallback.total,
            isMock: true,
            error,
        }
    }
}

export async function resolveDictionaryConflict(options = {}) {
    const workspace = buildWorkspace(options)
    const conflictId = typeof options.id === 'string' ? options.id.trim() : ''
    if (!conflictId) {
        const error = new Error('conflict id is required')
        error.errorCode = 'conflict_id_required'
        throw error
    }
    const body = {
        workspace,
        decision: options.decision || 'confirm',
        attrs: options.attrs && typeof options.attrs === 'object' ? options.attrs : {},
    }
    try {
        const payload = await requestJSON(`/api/settings/dictionary/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
            method: 'POST',
            body,
            signal: options.signal,
        })
        return {
            status: payload?.status || 'ok',
            conflict: payload?.conflict || null,
            isMock: false,
        }
    } catch (error) {
        const target = mockState.dictionary.find(item => item.id === conflictId || item.conflict_id === conflictId)
        if (target) {
            if (body.decision === 'confirm') {
                target.status = 'confirmed'
            } else if (body.decision === 'reject') {
                target.status = 'rejected'
            } else {
                target.status = 'conflict'
            }
        }
        return {
            status: 'mock',
            conflict: target
                ? {
                    id: target.conflict_id || target.id,
                    term: target.term,
                    type: target.type,
                    candidates: [normalizeDictionaryItem(target)],
                    status: body.decision === 'confirm' ? 'resolved' : target.status,
                }
                : null,
            isMock: true,
            error,
        }
    }
}
