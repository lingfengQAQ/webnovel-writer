import { startTransition, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import {
    activateProject,
    createProject,
    fetchCurrentUser,
    fetchProjectInfo,
    logoutUser,
    subscribeSSE,
} from './api.js'
import {
    BookmarkIcon,
    ChartBarIcon,
    FolderIcon,
    LogOutIcon,
    SlidersIcon,
    SparkIcon,
    TrendingUpIcon,
    UsersIcon,
    WifiIcon,
    WifiOffIcon,
} from './icons.jsx'
import LoginPage from './pages/LoginPage.jsx'

const NAV_ITEMS = [
    { to: '/writer', label: '创作台', icon: SparkIcon },
    { to: '/', label: '总览', icon: ChartBarIcon, end: true },
    { to: '/characters', label: '角色图鉴', icon: UsersIcon },
    { to: '/pacing', label: '节奏雷达', icon: TrendingUpIcon },
    { to: '/foreshadowing', label: '伏笔追踪', icon: BookmarkIcon },
    { to: '/files', label: '文档浏览', icon: FolderIcon },
    { to: '/system', label: '系统状态', icon: SlidersIcon },
]

export default function App() {
    const [projectInfo, setProjectInfo] = useState(null)
    const [auth, setAuth] = useState(null)
    const [authChecked, setAuthChecked] = useState(false)
    const [refreshToken, setRefreshToken] = useState(0)
    const [connected, setConnected] = useState(false)
    const [newProjectName, setNewProjectName] = useState('')

    const loadProjectInfo = useCallback(() => {
        fetchProjectInfo()
            .then(setProjectInfo)
            .catch(() => setProjectInfo(null))
    }, [])

    const loadAuth = useCallback(() => {
        fetchCurrentUser()
            .then(payload => {
                setAuth(payload)
                setAuthChecked(true)
            })
            .catch(() => {
                setAuth(null)
                setAuthChecked(true)
            })
    }, [])

    useEffect(() => {
        loadAuth()
    }, [loadAuth])

    useEffect(() => {
        if (auth?.user) {
            loadProjectInfo()
        }
    }, [auth?.user, loadProjectInfo, refreshToken])

    useEffect(() => {
        if (!auth?.user) return undefined
        if (!auth.current_project && !auth.projects?.length) return undefined
        const unsubscribe = subscribeSSE(
            () => {
                startTransition(() => {
                    setRefreshToken(current => current + 1)
                })
            },
            {
                onOpen: () => setConnected(true),
                onError: () => setConnected(false),
            },
        )

        return () => {
            unsubscribe()
            setConnected(false)
        }
    }, [auth?.user])

    const title = projectInfo?.project_info?.title || '未加载项目'

    if (!authChecked) {
        return (
            <div className="loading-screen">
                <div className="loading-card">
                    <div className="section-label">LOADING</div>
                    <p>正在读取登录状态...</p>
                </div>
            </div>
        )
    }

    if (!auth?.user) {
        return <LoginPage onSignedIn={payload => {
            setAuth(payload)
            setRefreshToken(current => current + 1)
        }} />
    }

    const projects = auth.projects || []
    const currentProject = auth.current_project || projects.find(project => project.is_active) || projects[0] || null

    async function handleProjectChange(projectId) {
        if (!projectId) return
        const payload = await activateProject(projectId)
        setAuth(current => ({
            ...current,
            projects: payload.projects,
            current_project: payload.project,
        }))
        setRefreshToken(current => current + 1)
    }

    async function handleCreateProject(event) {
        event.preventDefault()
        const name = newProjectName.trim()
        if (!name) return
        const payload = await createProject({ name })
        setAuth(current => ({
            ...current,
            projects: payload.projects,
            current_project: payload.project,
        }))
        setNewProjectName('')
        setRefreshToken(current => current + 1)
    }

    async function handleLogout() {
        await logoutUser()
        setAuth(null)
        setProjectInfo(null)
    }

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <h1>PIXEL WRITER HUB</h1>
                    <div className="subtitle" title={title}>{title}</div>
                </div>
                <div className="project-switcher">
                    <div className="mini-label">ACCOUNT</div>
                    <div className="account-row">
                        <span title={auth.user.username}>{auth.user.username}</span>
                        <button type="button" className="icon-btn" onClick={handleLogout} title="退出登录">
                            <LogOutIcon />
                        </button>
                    </div>
                    <div className="mini-label">PROJECT</div>
                    <select
                        value={currentProject?.id || ''}
                        onChange={event => handleProjectChange(event.target.value)}
                    >
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                    </select>
                    <form className="new-project-form" onSubmit={handleCreateProject}>
                        <input
                            value={newProjectName}
                            onChange={event => setNewProjectName(event.target.value)}
                            placeholder="新项目名"
                        />
                        <button type="submit">+</button>
                    </form>
                </div>
                <nav className="sidebar-nav">
                    {NAV_ITEMS.map(item => {
                        const Icon = item.icon
                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.end}
                                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
                            >
                                <span className="icon">
                                    <Icon />
                                </span>
                                <span>{item.label}</span>
                            </NavLink>
                        )
                    })}
                </nav>
                <div className="live-indicator">
                    <span className="icon">
                        {connected ? <WifiIcon /> : <WifiOffIcon />}
                    </span>
                    {connected ? '实时同步中' : '实时连接断开'}
                </div>
            </aside>

            <main className="main-content">
                <Outlet context={{
                    auth,
                    setAuth,
                    projectInfo,
                    refreshToken,
                    connected,
                    reloadProjectInfo: loadProjectInfo,
                    reloadAuth: loadAuth,
                }} />
            </main>
        </div>
    )
}

export function useDashboardContext() {
    return useOutletContext()
}
