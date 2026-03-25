import { useCallback, useEffect, useMemo, useState } from 'react'
import PageScaffold from '../components/PageScaffold.jsx'
import { createSkill, deleteSkill, listSkills, toggleSkill } from '../api/skills.js'

const FORM_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
}

const FIELD_STYLE = {
    width: '100%',
    border: '2px solid var(--border-main)',
    background: '#fff',
    color: 'var(--text-main)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    borderRadius: 4,
    padding: '8px 10px',
}

function getErrorMessage(error, fallback = '请求失败') {
    if (!error) return fallback
    const code = error.errorCode ? ` (${error.errorCode})` : ''
    return `${error.message || fallback}${code}`
}

function formatDateTime(value) {
    if (!value) return '-'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return String(value)
    return parsed.toLocaleString()
}

export default function SkillsPage() {
    const [skills, setSkills] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busyId, setBusyId] = useState('')

    const [id, setId] = useState('')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [enabled, setEnabled] = useState(true)
    const [creating, setCreating] = useState(false)

    const refresh = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            const response = await listSkills()
            setSkills(response.items)
        } catch (err) {
            setError(getErrorMessage(err, '加载技能列表失败'))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    const enabledCount = useMemo(
        () => skills.filter(skill => skill.enabled).length,
        [skills],
    )

    const onCreate = async event => {
        event.preventDefault()
        if (!id.trim() || !name.trim()) {
            setError('技能 ID 和名称不能为空')
            return
        }

        setCreating(true)
        setError('')
        setNotice('')
        try {
            await createSkill({
                id: id.trim(),
                name: name.trim(),
                description: description.trim(),
                enabled,
            })
            setNotice(`已新增技能: ${id.trim()}`)
            setId('')
            setName('')
            setDescription('')
            setEnabled(true)
            await refresh()
        } catch (err) {
            setError(getErrorMessage(err, '新增技能失败'))
        } finally {
            setCreating(false)
        }
    }

    const onToggle = async skill => {
        setBusyId(skill.id)
        setError('')
        setNotice('')
        try {
            const response = await toggleSkill({
                skillId: skill.id,
                enabled: !skill.enabled,
                reason: 'toggle-by-ui',
            })
            setSkills(current =>
                current.map(item =>
                    item.id === skill.id ? { ...item, enabled: response.enabled } : item,
                ),
            )
            setNotice(`${response.enabled ? '已启用' : '已禁用'}技能: ${skill.id}`)
        } catch (err) {
            setError(getErrorMessage(err, '切换技能状态失败'))
        } finally {
            setBusyId('')
        }
    }

    const onDelete = async skill => {
        if (!window.confirm(`确定删除技能 ${skill.id} 吗？`)) {
            return
        }

        setBusyId(skill.id)
        setError('')
        setNotice('')
        try {
            await deleteSkill({
                skillId: skill.id,
                hardDelete: true,
            })
            setSkills(current => current.filter(item => item.id !== skill.id))
            setNotice(`已删除技能: ${skill.id}`)
        } catch (err) {
            setError(getErrorMessage(err, '删除技能失败'))
        } finally {
            setBusyId('')
        }
    }

    return (
        <PageScaffold
            title="技能管理"
            badge={`${enabledCount}/${skills.length} 已启用`}
            description="技能列表/启停/新增/删除最小闭环。"
        >
            {error ? (
                <div className="card" role="alert">
                    <div className="card-header">
                        <span className="card-title">错误反馈</span>
                        <span className="card-badge badge-red">API Error</span>
                    </div>
                    <p style={{ margin: 0 }}>{error}</p>
                </div>
            ) : null}

            {notice ? (
                <div className="card" role="status">
                    <div className="card-header">
                        <span className="card-title">操作成功</span>
                        <span className="card-badge badge-green">Success</span>
                    </div>
                    <p style={{ margin: 0 }}>{notice}</p>
                </div>
            ) : null}

            <form className="card" onSubmit={onCreate}>
                <div className="card-header">
                    <span className="card-title">新增技能</span>
                    <button className="page-btn" type="submit" disabled={creating}>
                        {creating ? '提交中...' : '新增'}
                    </button>
                </div>
                <div style={FORM_GRID_STYLE}>
                    <label>
                        <span>ID</span>
                        <input
                            style={FIELD_STYLE}
                            value={id}
                            onChange={event => setId(event.target.value)}
                            placeholder="outline.splitter"
                            required
                        />
                    </label>
                    <label>
                        <span>名称</span>
                        <input
                            style={FIELD_STYLE}
                            value={name}
                            onChange={event => setName(event.target.value)}
                            placeholder="Outline Splitter"
                            required
                        />
                    </label>
                    <label>
                        <span>描述</span>
                        <input
                            style={FIELD_STYLE}
                            value={description}
                            onChange={event => setDescription(event.target.value)}
                            placeholder="可选"
                        />
                    </label>
                    <label>
                        <span>默认状态</span>
                        <select
                            style={FIELD_STYLE}
                            value={enabled ? 'enabled' : 'disabled'}
                            onChange={event => setEnabled(event.target.value === 'enabled')}
                        >
                            <option value="enabled">enabled</option>
                            <option value="disabled">disabled</option>
                        </select>
                    </label>
                </div>
            </form>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">Skills Registry</span>
                    <button className="page-btn" onClick={() => void refresh()} disabled={loading}>
                        {loading ? '加载中...' : '刷新'}
                    </button>
                </div>
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>名称</th>
                                <th>描述</th>
                                <th>状态</th>
                                <th>作用域</th>
                                <th>更新时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7}>加载中...</td>
                                </tr>
                            ) : null}
                            {!loading && skills.length === 0 ? (
                                <tr>
                                    <td colSpan={7}>暂无技能，先创建一个。</td>
                                </tr>
                            ) : null}
                            {!loading
                                ? skills.map(skill => (
                                      <tr key={skill.id}>
                                          <td>{skill.id}</td>
                                          <td>{skill.name}</td>
                                          <td>{skill.description || '-'}</td>
                                          <td>{skill.enabled ? 'enabled' : 'disabled'}</td>
                                          <td>{skill.scope || 'workspace'}</td>
                                          <td>{formatDateTime(skill.updated_at)}</td>
                                          <td>
                                              <div className="filter-group" style={{ marginBottom: 0 }}>
                                                  <button
                                                      type="button"
                                                      className="page-btn"
                                                      disabled={busyId === skill.id}
                                                      onClick={() => void onToggle(skill)}
                                                  >
                                                      {skill.enabled ? '禁用' : '启用'}
                                                  </button>
                                                  <button
                                                      type="button"
                                                      className="page-btn"
                                                      disabled={busyId === skill.id}
                                                      onClick={() => void onDelete(skill)}
                                                  >
                                                      删除
                                                  </button>
                                              </div>
                                          </td>
                                      </tr>
                                  ))
                                : null}
                        </tbody>
                    </table>
                </div>
            </div>
        </PageScaffold>
    )
}
