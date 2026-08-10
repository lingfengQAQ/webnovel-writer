const BASE = ''
let writerCsrfToken = ''
let writerCapabilitiesPromise = null

export async function fetchJSON(path, params = {}) {
    const url = new URL(`${BASE}${path}`, window.location.origin)
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value)
        }
    }

    const response = await fetch(url.toString())
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
    }
    return response.json()
}

export function fetchProjectInfo() {
    return fetchJSON('/api/project/info')
}

export function fetchStoryRuntimeHealth() {
    return fetchJSON('/api/story-runtime/health')
}

export function fetchChapterTrend(params = {}) {
    return fetchJSON('/api/stats/chapter-trend', params)
}

export function fetchChapters() {
    return fetchJSON('/api/chapters')
}

export function fetchEntities(params = {}) {
    return fetchJSON('/api/entities', params)
}

export function fetchStateChanges(params = {}) {
    return fetchJSON('/api/state-changes', params)
}

export function fetchRelationships(params = {}) {
    return fetchJSON('/api/relationships', params)
}

export function fetchRelationshipEvents(params = {}) {
    return fetchJSON('/api/relationship-events', params)
}

export function fetchCommits(params = {}) {
    return fetchJSON('/api/commits', params)
}

export function fetchContractsSummary() {
    return fetchJSON('/api/contracts/summary')
}

export function fetchEnvStatus() {
    return fetchJSON('/api/env-status')
}

export function probeEnvStatus() {
    return fetchJSON('/api/env-status/probe')
}

export function fetchFilesTree() {
    return fetchJSON('/api/files/tree')
}

export function fetchFileContent(path) {
    return fetchJSON('/api/files/read', { path })
}

export function subscribeSSE(onMessage, handlers = {}) {
    const { onOpen, onError } = handlers
    const eventSource = new EventSource(`${BASE}/api/events`)

    eventSource.onopen = () => {
        if (onOpen) onOpen()
    }

    eventSource.onmessage = event => {
        try {
            onMessage(JSON.parse(event.data))
        } catch { /* ignore non-JSON messages */ }
    }

    eventSource.onerror = error => {
        if (onError) onError(error)
    }

    return () => eventSource.close()
}

export async function fetchWriterCapabilities() {
    if (!writerCapabilitiesPromise) {
        writerCapabilitiesPromise = fetchJSON('/api/writer/capabilities').then(data => {
            writerCsrfToken = data.csrf_token || ''
            return data
        })
    }
    return writerCapabilitiesPromise
}

async function writerJSON(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(writerCsrfToken ? { 'X-CSRF-Token': writerCsrfToken } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`
        try {
            const payload = await response.json()
            detail = payload.detail || detail
        } catch { /* keep HTTP status */ }
        throw new Error(detail)
    }
    return response.json()
}

export const fetchWriterSettings = () => writerJSON('/api/writer/settings')
export const saveWriterSettings = body => writerJSON('/api/writer/settings', { method: 'PUT', body })
export const testWriterSettings = () => writerJSON('/api/writer/settings/test', { method: 'POST', body: {} })
export const startWriterWorkflow = body => writerJSON('/api/writer/workflows', { method: 'POST', body })
export const fetchWriterWorkflow = id => writerJSON(`/api/writer/workflows/${id}`)
export const writerWorkflowAction = (id, action, payload = {}) => writerJSON(`/api/writer/workflows/${id}/actions`, { method: 'POST', body: { action, payload } })
export const fetchWriterDraft = chapter => writerJSON(`/api/writer/drafts/${chapter}`)
export const saveWriterDraft = (chapter, content, baseRevision) => writerJSON(`/api/writer/drafts/${chapter}`, { method: 'PUT', body: { content, base_revision: baseRevision } })
export const finalizeWriterDraft = (chapter, expectedRevision) => writerJSON(`/api/writer/drafts/${chapter}/finalize`, { method: 'POST', body: { expected_revision: expectedRevision } })
export const fetchWriterUsage = () => writerJSON('/api/writer/usage')

export function subscribeWriterEvents(onMessage) {
    const source = new EventSource(`${BASE}/api/writer/events`)
    source.onmessage = event => {
        try { onMessage(JSON.parse(event.data)) } catch { /* ignore */ }
    }
    return () => source.close()
}
