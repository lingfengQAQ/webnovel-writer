/**
 * API 请求工具函数
 */

const BASE = '';  // 开发时由 vite proxy 代理到 FastAPI

export async function fetchJSON(path, params = {}) {
    const url = new URL(path, window.location.origin);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}

/**
 * 保存文件内容
 * @param {string} path - 文件路径
 * @param {string} content - 文件内容
 * @returns {Promise<object>} - 保存结果
 */
export async function saveFile(path, content) {
    const url = new URL('/api/files/save', window.location.origin);
    const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path, content }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '保存失败' }));
        throw new Error(err.detail || `${res.status} ${res.statusText}`);
    }
    return res.json();
}

/**
 * 创建新文件
 * @param {string} path - 文件路径
 * @param {string} content - 文件内容
 * @returns {Promise<object>} - 创建结果
 */
export async function createFile(path, content = '') {
    const url = new URL('/api/files/create', window.location.origin);
    const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path, content }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '创建失败' }));
        throw new Error(err.detail || `${res.status} ${res.statusText}`);
    }
    return res.json();
}

/**
 * 订阅 SSE 实时事件流
 * @param {function} onMessage  收到 data 时回调
 * @param {{onOpen?: function, onError?: function}} handlers 连接状态回调
 * @returns {function} 取消订阅函数
 */
export function subscribeSSE(onMessage, handlers = {}) {
    const { onOpen, onError } = handlers
    const es = new EventSource(`${BASE}/api/events`);
    es.onopen = () => {
        if (onOpen) onOpen()
    };
    es.onmessage = (e) => {
        try {
            onMessage(JSON.parse(e.data));
        } catch { /* ignore parse errors */ }
    };
    es.onerror = (e) => {
        // EventSource 会自动重连，这里只更新连接状态
        if (onError) onError(e)
    };
    return () => es.close();
}
