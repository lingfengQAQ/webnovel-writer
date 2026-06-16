const BASE = ''

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

export async function sendJSON(path, payload = {}, options = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method: options.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
    })

    const text = await response.text()
    let data = null
    if (text) {
        try {
            data = JSON.parse(text)
        } catch {
            data = { detail: text }
        }
    }

    if (!response.ok) {
        const detail = data?.detail || data?.error || `${response.status} ${response.statusText}`
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    }
    return data
}

export function fetchPlatformStatus() {
    return fetchJSON('/api/platform/status')
}

export function fetchCurrentUser() {
    return fetchJSON('/api/auth/me')
}

export function loginUser(payload) {
    return sendJSON('/api/auth/login', payload)
}

export function registerUser(payload) {
    return sendJSON('/api/auth/register', payload)
}

export function loginWithSubrouter(payload) {
    return sendJSON('/api/auth/subrouter-login', payload)
}

export function loginWithSubrouterKey(payload) {
    return sendJSON('/api/auth/subrouter-key-login', payload)
}

export function logoutUser() {
    return sendJSON('/api/auth/logout')
}

export function saveSubrouterSettings(payload) {
    return sendJSON('/api/user/subrouter', payload, { method: 'PUT' })
}

export function fetchProjects() {
    return fetchJSON('/api/projects')
}

export function createProject(payload) {
    return sendJSON('/api/projects', payload)
}

export function activateProject(projectId) {
    return sendJSON(`/api/projects/${encodeURIComponent(projectId)}/activate`)
}

export function fetchSubrouterModels() {
    return fetchJSON('/api/subrouter/models')
}

export function sendSubrouterChat(payload) {
    return sendJSON('/api/subrouter/chat', payload)
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
