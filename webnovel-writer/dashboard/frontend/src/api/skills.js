const API_ROOT = '/api/skills'
const DEFAULT_WORKSPACE_ID = 'workspace-default'
const WORKSPACE_ID_STORAGE_KEY = 'webnovel.workspace_id'
const PROJECT_ROOT_STORAGE_KEY = 'webnovel.project_root'

export class SkillsApiError extends Error {
    constructor(
        message,
        { status = 0, errorCode = 'skills_api_error', details = null } = {},
    ) {
        super(message)
        this.name = 'SkillsApiError'
        this.status = status
        this.errorCode = errorCode
        this.details = details
    }
}

function normalizeWorkspaceContext(options = {}) {
    const fromStorageWorkspaceId =
        typeof window !== 'undefined'
            ? window.localStorage.getItem(WORKSPACE_ID_STORAGE_KEY)
            : null
    const fromStorageProjectRoot =
        typeof window !== 'undefined'
            ? window.localStorage.getItem(PROJECT_ROOT_STORAGE_KEY)
            : null

    const workspaceId = (
        options.workspaceId ||
        fromStorageWorkspaceId ||
        DEFAULT_WORKSPACE_ID
    ).trim()

    return {
        workspace_id: workspaceId || DEFAULT_WORKSPACE_ID,
        project_root: options.projectRoot ?? fromStorageProjectRoot ?? '',
    }
}

function buildURL(path, query) {
    const url = new URL(path, window.location.origin)

    if (query) {
        Object.entries(query).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') {
                return
            }
            if (typeof value === 'boolean') {
                url.searchParams.set(key, value ? 'true' : 'false')
                return
            }
            url.searchParams.set(key, String(value))
        })
    }

    return url.toString()
}

async function requestJSON(path, { method = 'GET', query, body } = {}) {
    const requestInit = {
        method,
        headers: {},
    }

    if (body !== undefined) {
        requestInit.headers['Content-Type'] = 'application/json'
        requestInit.body = JSON.stringify(body)
    }

    let response
    try {
        response = await fetch(buildURL(path, query), requestInit)
    } catch (error) {
        throw new SkillsApiError('Failed to connect to skills service.', {
            status: 0,
            errorCode: 'skills_network_error',
            details: { error: String(error) },
        })
    }

    const rawText = await response.text()
    let payload = null
    if (rawText) {
        try {
            payload = JSON.parse(rawText)
        } catch {
            payload = null
        }
    }

    if (!response.ok) {
        const fallbackMessage = `${response.status} ${response.statusText}`
        throw new SkillsApiError(payload?.message || fallbackMessage, {
            status: response.status,
            errorCode: payload?.error_code || 'skills_api_error',
            details: payload?.details ?? payload ?? null,
        })
    }

    return payload ?? {}
}

export function getWorkspaceContext(options = {}) {
    return normalizeWorkspaceContext(options)
}

export async function listSkills(options = {}) {
    const workspace = normalizeWorkspaceContext(options)
    const payload = await requestJSON(API_ROOT, {
        query: {
            workspace_id: workspace.workspace_id,
            project_root: workspace.project_root,
            enabled: options.enabled,
            limit: options.limit ?? 100,
            offset: options.offset ?? 0,
        },
    })

    return {
        status: payload.status || 'ok',
        items: Array.isArray(payload.items) ? payload.items : [],
        total: Number.isFinite(payload.total) ? payload.total : 0,
    }
}

export async function createSkill(input) {
    const workspace = normalizeWorkspaceContext(input)
    return requestJSON(API_ROOT, {
        method: 'POST',
        body: {
            workspace,
            id: input.id,
            name: input.name,
            description: input.description || '',
            enabled: Boolean(input.enabled),
        },
    })
}

export async function toggleSkill(input) {
    const workspace = normalizeWorkspaceContext(input)
    const path = `${API_ROOT}/${encodeURIComponent(input.skillId)}/${input.enabled ? 'enable' : 'disable'}`
    return requestJSON(path, {
        method: 'POST',
        body: {
            workspace,
            reason: input.reason || null,
        },
    })
}

export async function deleteSkill(input) {
    const workspace = normalizeWorkspaceContext(input)
    const path = `${API_ROOT}/${encodeURIComponent(input.skillId)}`
    return requestJSON(path, {
        method: 'DELETE',
        body: {
            workspace,
            hard_delete: input.hardDelete ?? true,
        },
    })
}
