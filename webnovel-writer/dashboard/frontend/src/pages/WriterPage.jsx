import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    fetchWriterCapabilities,
    fetchWriterDraft,
    fetchWriterSettings,
    fetchWriterUsage,
    fetchWriterWorkflow,
    finalizeWriterDraft,
    saveWriterDraft,
    saveWriterSettings,
    startWriterWorkflow,
    subscribeWriterEvents,
    testWriterSettings,
    writerWorkflowAction,
} from '../api.js'

const EMPTY_SETTINGS = {
    base_url: 'https://api.deepseek.com',
    fast_model: 'deepseek-v4-flash',
    deep_model: 'deepseek-v4-pro',
    timeout_seconds: 180,
    api_key: '',
}

const NOVEL_LABELS = {
    workspace_root: '保存位置', title: '书名', genre: '题材', protagonist_name: '主角姓名',
    protagonist_desire: '主角欲望', protagonist_flaw: '主角缺陷', target_chapters: '目标章节', target_words: '目标字数',
}

function Field({ label, children }) {
    return <label className="writer-field"><span>{label}</span>{children}</label>
}

function Notice({ kind = 'info', children }) {
    return children ? <div className={`writer-notice ${kind}`}>{children}</div> : null
}

export default function WriterPage() {
    const [tab, setTab] = useState('write')
    const [capabilities, setCapabilities] = useState(null)
    const [settings, setSettings] = useState(EMPTY_SETTINGS)
    const [chapter, setChapter] = useState(1)
    const [instruction, setInstruction] = useState('按照章纲完成本章，强化开篇钩子和章末悬念。')
    const [draft, setDraft] = useState(null)
    const [workflow, setWorkflow] = useState(null)
    const [streamed, setStreamed] = useState('')
    const [usage, setUsage] = useState(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [plan, setPlan] = useState({ volume: 1, start: 1, end: 10, instruction: '规划第一卷主线、爽点循环和章末钩子。' })
    const [novel, setNovel] = useState({ workspace_root: '', title: '', genre: '都市', protagonist_name: '', protagonist_desire: '', protagonist_flaw: '', target_chapters: 300, target_words: 900000 })

    const loadUsage = useCallback(() => fetchWriterUsage().then(setUsage).catch(() => {}), [])
    const loadDraft = useCallback(async value => {
        try { setDraft(await fetchWriterDraft(value)) } catch { setDraft(null) }
    }, [])

    useEffect(() => {
        fetchWriterCapabilities().then(value => {
            setCapabilities(value)
            setNovel(current => ({ ...current, workspace_root: current.workspace_root || value.workspace_root || '' }))
        }).catch(err => setError(err.message))
        fetchWriterSettings().then(value => setSettings({ ...EMPTY_SETTINGS, ...value, api_key: '' })).catch(err => setError(err.message))
        loadDraft(chapter)
        loadUsage()
    }, [])

    useEffect(() => subscribeWriterEvents(event => {
        if (event.type === 'text_delta' && event.workflow_id === workflow?.id) {
            setStreamed(current => current + event.delta)
        }
        if (event.type === 'workflow' && event.workflow?.id === workflow?.id) {
            setWorkflow(event.workflow)
            if (event.workflow.status === 'awaiting_user' || event.workflow.status === 'completed') {
                loadDraft(chapter)
                loadUsage()
            }
        }
    }), [workflow?.id, chapter, loadDraft, loadUsage])

    useEffect(() => {
        if (!workflow?.id || !['queued', 'running'].includes(workflow.status)) return undefined
        const timer = setInterval(() => fetchWriterWorkflow(workflow.id).then(setWorkflow).catch(() => {}), 1500)
        return () => clearInterval(timer)
    }, [workflow?.id, workflow?.status])

    const run = async body => {
        setBusy(true); setError(''); setMessage(''); setStreamed('')
        try { setWorkflow(await startWriterWorkflow(body)) }
        catch (err) { setError(err.message) }
        finally { setBusy(false) }
    }

    const saveDraft = async () => {
        if (!draft) return
        setBusy(true); setError('')
        try {
            const updated = await saveWriterDraft(chapter, draft.content, draft.revision)
            setDraft(updated); setMessage(`草稿已保存，版本 ${updated.revision}`)
        } catch (err) { setError(err.message) }
        finally { setBusy(false) }
    }

    const finalize = async () => {
        if (!draft) return
        setBusy(true); setError(''); setMessage('')
        try {
            const result = await finalizeWriterDraft(chapter, draft.revision)
            setMessage(`第 ${chapter} 章已定稿：${result.commit_status}；备份 ${result.backup_ok ? '完成' : '未完成'}`)
            loadUsage()
        } catch (err) { setError(err.message) }
        finally { setBusy(false) }
    }

    const approveWorkflow = async payload => {
        if (!workflow) return
        setBusy(true); setError('')
        try { setWorkflow(await writerWorkflowAction(workflow.id, 'confirm', payload)) }
        catch (err) { setError(err.message) }
        finally { setBusy(false) }
    }

    const cacheRate = useMemo(() => `${((usage?.recent_median_hit_rate || 0) * 100).toFixed(1)}%`, [usage])
    const review = draft?.review || workflow?.result?.review || {}

    return (
        <section className="dashboard-page writer-page">
            <header className="page-header">
                <div><div className="section-label">DEEPSEEK AUTHOR STUDIO</div><h2>创作工作台</h2></div>
                <div className="writer-cache-card"><span>近 20 次缓存命中中位数</span><strong>{cacheRate}</strong><small>目标 ≥ 60%</small></div>
            </header>

            <div className="writer-tabs">
                {['write', 'plan', 'new', 'settings'].map(name => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{({ write: '写作', plan: '大纲', new: '创建小说', settings: '模型设置' })[name]}</button>)}
            </div>
            <Notice kind="error">{error}</Notice><Notice kind="success">{message}</Notice>

            {tab === 'write' && <div className="writer-grid">
                <div className="writer-panel">
                    <h3>章节任务</h3>
                    <div className="writer-row">
                        <Field label="章节"><input type="number" min="1" value={chapter} onChange={event => { const value = Number(event.target.value); setChapter(value); loadDraft(value) }} /></Field>
                        <button disabled={busy} onClick={() => run({ type: 'write', chapter, instruction })}>生成正文</button>
                        <button disabled={busy || !draft} onClick={() => run({ type: 'review', chapter })}>深度审查</button>
                    </div>
                    <Field label="写作/改稿要求"><textarea rows="3" value={instruction} onChange={event => setInstruction(event.target.value)} /></Field>
                    <div className="writer-row"><button disabled={busy || !draft} onClick={() => run({ type: 'revise', chapter, instruction })}>按要求改稿</button><button disabled={busy || !draft} onClick={saveDraft}>保存草稿</button><button className="primary" disabled={busy || !draft} onClick={finalize}>人工确认并定稿</button></div>
                    {workflow && <div className="writer-progress"><div style={{ width: `${workflow.progress || 0}%` }} /><span>{workflow.stage} · {workflow.status}</span></div>}
                </div>
                <div className="writer-panel writer-editor-panel">
                    <h3>正文草稿 <small>{draft ? `revision ${draft.revision}` : '尚未生成'}</small></h3>
                    <textarea className="writer-editor" value={(workflow?.status === 'running' && streamed) ? streamed : (draft?.content ?? streamed)} onChange={event => setDraft(current => ({ ...(current || { revision: 0 }), content: event.target.value }))} placeholder="生成内容会流式显示在这里……" />
                </div>
                <div className="writer-panel">
                    <h3>审查结果</h3>
                    <p>{review.summary || '完成正文后运行“深度审查”。审查后再修改正文会自动要求重新审查。'}</p>
                    {(review.issues || []).map((issue, index) => <article className={`review-issue ${issue.blocking ? 'blocking' : ''}`} key={index}><strong>{issue.severity} · {issue.category}</strong><p>{issue.description}</p><small>{issue.location} {issue.fix_hint}</small></article>)}
                </div>
            </div>}

            {tab === 'plan' && <div className="writer-panel">
                <h3>卷纲与章纲</h3>
                <div className="writer-row"><Field label="卷"><input type="number" min="1" value={plan.volume} onChange={e => setPlan({ ...plan, volume: Number(e.target.value) })} /></Field><Field label="起始章"><input type="number" min="1" value={plan.start} onChange={e => setPlan({ ...plan, start: Number(e.target.value) })} /></Field><Field label="结束章"><input type="number" min="1" value={plan.end} onChange={e => setPlan({ ...plan, end: Number(e.target.value) })} /></Field></div>
                <Field label="规划要求"><textarea rows="5" value={plan.instruction} onChange={e => setPlan({ ...plan, instruction: e.target.value })} /></Field>
                <div className="writer-row"><button disabled={busy} onClick={() => run({ type: 'plan', volume: plan.volume, instruction: plan.instruction, payload: { start_chapter: plan.start, end_chapter: plan.end } })}>生成规划</button>{workflow?.type === 'plan' && workflow.status === 'awaiting_user' && <button className="primary" onClick={() => approveWorkflow({})}>确认并写入大纲</button>}</div>
                {workflow?.type === 'plan' && workflow.result?.volume_outline_markdown && <pre className="writer-preview">{workflow.result.volume_outline_markdown}</pre>}
            </div>}

            {tab === 'new' && <div className="writer-panel">
                <h3>创建小说</h3>
                <div className="writer-form-grid">{Object.entries(novel).map(([key, value]) => <Field key={key} label={NOVEL_LABELS[key] || key}><input type={typeof value === 'number' ? 'number' : 'text'} value={value} onChange={e => setNovel({ ...novel, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })} /></Field>)}</div>
                <div className="writer-row"><button disabled={busy} onClick={() => run({ type: 'init', project_root: novel.workspace_root, payload: novel })}>生成创意候选</button>{workflow?.type === 'init' && workflow.status === 'awaiting_user' && (workflow.result?.candidates || []).map((candidate, index) => <button key={index} onClick={() => approveWorkflow({ candidate_index: index })}>采用《{candidate.title}》</button>)}</div>
                {(workflow?.result?.candidates || []).map((candidate, index) => <article className="idea-card" key={index}><h4>{candidate.title}</h4><p>{candidate.one_liner}</p><small>{candidate.anti_trope}</small></article>)}
            </div>}

            {tab === 'settings' && <div className="writer-panel">
                <h3>DeepSeek 配置</h3>
                <div className="writer-form-grid"><Field label="Base URL"><input value={settings.base_url} onChange={e => setSettings({ ...settings, base_url: e.target.value })} /></Field><Field label="快速模型"><input value={settings.fast_model} onChange={e => setSettings({ ...settings, fast_model: e.target.value })} /></Field><Field label="深度模型"><input value={settings.deep_model} onChange={e => setSettings({ ...settings, deep_model: e.target.value })} /></Field><Field label="API Key"><input type="password" value={settings.api_key} placeholder={settings.api_key_present ? '已保存在系统凭据库' : '输入后保存'} onChange={e => setSettings({ ...settings, api_key: e.target.value })} /></Field></div>
                <div className="writer-row"><button onClick={async () => { try { const value = await saveWriterSettings(settings); setSettings({ ...EMPTY_SETTINGS, ...value, api_key: '' }); setMessage('配置已保存到本机') } catch (err) { setError(err.message) } }}>保存设置</button><button onClick={async () => { try { const value = await testWriterSettings(); setMessage(`连接成功，${value.latency_ms} ms`) } catch (err) { setError(err.message) } }}>测试连接</button></div>
                <p className="muted">项目：{capabilities?.project_root}</p>
            </div>}
        </section>
    )
}
