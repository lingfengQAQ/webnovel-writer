import { useEffect, useMemo, useState } from 'react'
import { useDashboardContext } from '../App.jsx'
import {
    fetchSubrouterModels,
    saveSubrouterSettings,
    sendSubrouterChat,
} from '../api.js'
import Badge from '../components/Badge.jsx'

const SYSTEM_PROMPT = `你是严谨的中文长篇网文创作助手。输出要服务于连载写作，优先保持人物动机、世界规则、伏笔和章节节奏一致。`

export default function WriterPage() {
    const { auth, setAuth, refreshToken } = useDashboardContext()
    const [models, setModels] = useState([])
    const [model, setModel] = useState(auth?.user?.subrouter?.default_model || '')
    const [baseUrl, setBaseUrl] = useState(auth?.user?.subrouter?.base_url || '')
    const [apiKey, setApiKey] = useState('')
    const [prompt, setPrompt] = useState('')
    const [temperature, setTemperature] = useState(0.7)
    const [maxTokens, setMaxTokens] = useState(1800)
    const [output, setOutput] = useState('')
    const [loadingModels, setLoadingModels] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')

    const configured = Boolean(auth?.user?.subrouter?.configured)

    useEffect(() => {
        if (!configured) return
        let cancelled = false
        setLoadingModels(true)
        setError('')
        fetchSubrouterModels()
            .then(payload => {
                if (cancelled) return
                const nextModels = payload.models || []
                setModels(nextModels)
                if (!model && (payload.default_model || nextModels[0]?.id)) {
                    setModel(payload.default_model || nextModels[0].id)
                }
            })
            .catch(err => {
                if (!cancelled) setError(err.message || '模型列表读取失败')
            })
            .finally(() => {
                if (!cancelled) setLoadingModels(false)
            })
        return () => {
            cancelled = true
        }
    }, [configured, refreshToken])

    const modelOptions = useMemo(() => {
        if (model && !models.some(item => item.id === model)) {
            return [{ id: model }, ...models]
        }
        return models
    }, [model, models])

    async function saveSettings(event) {
        event.preventDefault()
        setSaving(true)
        setError('')
        try {
            const payload = await saveSubrouterSettings({
                ...(apiKey.trim() ? { apiKey } : {}),
                baseUrl,
                defaultModel: model,
            })
            setAuth(current => ({ ...current, user: payload.user }))
            setApiKey('')
        } catch (err) {
            setError(err.message || '保存失败')
        } finally {
            setSaving(false)
        }
    }

    async function generate() {
        if (!prompt.trim()) {
            setError('请输入写作要求')
            return
        }
        setGenerating(true)
        setError('')
        setOutput('')
        try {
            const payload = await sendSubrouterChat({
                model,
                temperature: Number(temperature),
                max_tokens: Number(maxTokens),
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: prompt },
                ],
            })
            const text = payload?.choices?.[0]?.message?.content || JSON.stringify(payload, null, 2)
            setOutput(text)
        } catch (err) {
            setError(err.message || '生成失败')
        } finally {
            setGenerating(false)
        }
    }

    return (
        <section className="dashboard-page writer-page">
            <header className="page-header">
                <h2>创作台</h2>
                <div className="header-badges">
                    <Badge tone={configured ? 'green' : 'amber'}>
                        {configured ? 'SubRouter 已连接' : '需要配置 SubRouter'}
                    </Badge>
                    {auth?.user?.subrouter?.account_type ? (
                        <Badge tone="purple">
                            {auth.user.subrouter.account_type === 'dist' ? '分站账号' : '主站账号'}
                        </Badge>
                    ) : null}
                    {model ? <Badge tone="blue">{model}</Badge> : null}
                </div>
            </header>

            <div className="content-grid writer-grid">
                <article className="card writer-main">
                    <div className="card-header">
                        <div>
                            <div className="section-label">PROMPT</div>
                            <div className="card-title">写作请求</div>
                        </div>
                        <button type="button" className="page-btn" disabled={generating || !configured} onClick={generate}>
                            {generating ? '生成中...' : '生成'}
                        </button>
                    </div>
                    <textarea
                        className="writer-prompt"
                        value={prompt}
                        onChange={event => setPrompt(event.target.value)}
                        placeholder="例如：根据当前设定写第 1 章开头，主角在雨夜发现第一个异常伏笔，要求 1800 字，节奏偏强钩子。"
                    />
                    {error ? <div className="form-error">{error}</div> : null}
                    <div className="writer-output">
                        {output ? <pre>{output}</pre> : <div className="empty-state compact">生成结果会显示在这里</div>}
                    </div>
                </article>

                <aside className="card writer-settings">
                    <div className="section-label">MODEL</div>
                    <div className="card-title">SubRouter 模型</div>
                    <label className="form-field">
                        <span>模型</span>
                        <select value={model} onChange={event => setModel(event.target.value)} disabled={loadingModels}>
                            <option value="">{loadingModels ? '读取中...' : '请选择模型'}</option>
                            {modelOptions.map(item => (
                                <option key={item.id} value={item.id}>{item.id}</option>
                            ))}
                        </select>
                    </label>
                    <label className="form-field">
                        <span>Temperature</span>
                        <input
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            value={temperature}
                            onChange={event => setTemperature(event.target.value)}
                        />
                    </label>
                    <label className="form-field">
                        <span>Max Tokens</span>
                        <input
                            type="number"
                            min="256"
                            max="20000"
                            step="128"
                            value={maxTokens}
                            onChange={event => setMaxTokens(event.target.value)}
                        />
                    </label>

                    <form className="settings-form" onSubmit={saveSettings}>
                        <div className="detail-divider" />
                        <div className="mini-label">ACCOUNT</div>
                        <div className="selected-path">
                            {auth?.user?.subrouter?.distributor_name || auth?.user?.subrouter?.distributor_slug
                                ? `分站：${auth.user.subrouter.distributor_name || auth.user.subrouter.distributor_slug}`
                                : 'SubRouter 主站账号'}
                            <br />
                            网关：{auth?.user?.subrouter?.gateway_base_url || baseUrl}
                        </div>
                        <label className="form-field">
                            <span>手动 API Key 覆盖</span>
                            <input
                                type="password"
                                value={apiKey}
                                onChange={event => setApiKey(event.target.value)}
                                placeholder={auth?.user?.subrouter?.key_preview || '通常无需填写'}
                            />
                        </label>
                        <label className="form-field">
                            <span>SubRouter 管理地址</span>
                            <input
                                value={baseUrl}
                                onChange={event => setBaseUrl(event.target.value)}
                                placeholder="http://subrouter.railway.internal:8080"
                            />
                        </label>
                        <button type="submit" className="page-btn" disabled={saving}>
                            {saving ? '保存中...' : '保存配置'}
                        </button>
                    </form>
                </aside>
            </div>
        </section>
    )
}
