import { useEffect, useState } from 'react'
import {
    fetchPlatformStatus,
    loginUser,
    loginWithSubrouter,
    registerUser,
} from '../api.js'

export default function LoginPage({ onSignedIn }) {
    const [mode, setMode] = useState('subrouter')
    const [status, setStatus] = useState(null)
    const [form, setForm] = useState({
        username: '',
        password: '',
        email: '',
        baseUrl: '',
    })
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        fetchPlatformStatus()
            .then(setStatus)
            .catch(() => setStatus(null))
    }, [])

    const defaultBaseUrl = status?.default_subrouter_base_url || 'http://subrouter.railway.internal:8080'

    function updateField(key, value) {
        setForm(current => ({ ...current, [key]: value }))
    }

    async function submit(event) {
        event.preventDefault()
        setBusy(true)
        setError('')
        try {
            let payload
            if (mode === 'subrouter') {
                payload = await loginWithSubrouter({
                    username: form.username,
                    password: form.password,
                    baseUrl: form.baseUrl || defaultBaseUrl,
                })
            } else if (mode === 'register') {
                payload = await registerUser({
                    username: form.username,
                    password: form.password,
                    email: form.email,
                    subrouterBaseUrl: form.baseUrl || defaultBaseUrl,
                })
            } else {
                payload = await loginUser({
                    username: form.username,
                    password: form.password,
                })
            }
            onSignedIn(payload)
        } catch (err) {
            setError(err.message || '登录失败')
        } finally {
            setBusy(false)
        }
    }

    return (
        <main className="auth-page">
            <section className="auth-panel">
                <div className="auth-copy">
                    <div className="section-label">WEBNOVEL PLATFORM</div>
                    <h1>Webnovel Writer</h1>
                    <p>使用 SubRouter 主站或分站账号密码登录。后端会复用 SubRouter 原有会话，自动准备调用密钥，模型列表和生成请求都从后端代理。</p>
                    <div className="auth-endpoint">
                        <span>SubRouter 管理地址</span>
                        <code>{defaultBaseUrl}</code>
                    </div>
                </div>

                <form className="auth-card" onSubmit={submit}>
                    <div className="segmented-control">
                        <button type="button" className={mode === 'subrouter' ? 'active' : ''} onClick={() => setMode('subrouter')}>
                            SubRouter
                        </button>
                        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
                            登录
                        </button>
                        <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
                            注册
                        </button>
                    </div>

                    {mode === 'subrouter' ? (
                        <>
                            <label className="form-field">
                                <span>用户名</span>
                                <input
                                    autoComplete="username"
                                    value={form.username}
                                    onChange={event => updateField('username', event.target.value)}
                                />
                            </label>
                            <label className="form-field">
                                <span>密码</span>
                                <input
                                    type="password"
                                    autoComplete="current-password"
                                    value={form.password}
                                    onChange={event => updateField('password', event.target.value)}
                                />
                            </label>
                            <label className="form-field">
                                <span>SubRouter 管理地址</span>
                                <input
                                    value={form.baseUrl}
                                    onChange={event => updateField('baseUrl', event.target.value)}
                                    placeholder={defaultBaseUrl}
                                />
                            </label>
                        </>
                    ) : (
                        <>
                            <label className="form-field">
                                <span>用户名</span>
                                <input
                                    autoComplete="username"
                                    value={form.username}
                                    onChange={event => updateField('username', event.target.value)}
                                />
                            </label>
                            <label className="form-field">
                                <span>密码</span>
                                <input
                                    type="password"
                                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                                    value={form.password}
                                    onChange={event => updateField('password', event.target.value)}
                                />
                            </label>
                            {mode === 'register' ? (
                                <>
                                    <label className="form-field">
                                        <span>邮箱</span>
                                        <input
                                            type="email"
                                            value={form.email}
                                            onChange={event => updateField('email', event.target.value)}
                                            placeholder="可选"
                                        />
                                    </label>
                                    <label className="form-field">
                                        <span>SubRouter 管理地址</span>
                                        <input
                                            value={form.baseUrl}
                                            onChange={event => updateField('baseUrl', event.target.value)}
                                            placeholder={defaultBaseUrl}
                                        />
                                    </label>
                                </>
                            ) : null}
                        </>
                    )}

                    {error ? <div className="form-error">{error}</div> : null}
                    <button type="submit" className="primary-btn" disabled={busy}>
                        {busy ? '处理中...' : mode === 'register' ? '创建账户' : '进入平台'}
                    </button>
                </form>
            </section>
        </main>
    )
}
