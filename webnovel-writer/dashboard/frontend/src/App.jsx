import { startTransition, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { fetchProjectInfo, subscribeSSE } from './api.js'
import {
    BookmarkIcon,
    ChartBarIcon,
    FolderIcon,
    SlidersIcon,
    TrendingUpIcon,
    UsersIcon,
    WifiIcon,
    WifiOffIcon,
} from './icons.jsx'

const NAV_ITEMS = [
    { to: '/', label: '总览', icon: ChartBarIcon, end: true },
    { to: '/characters', label: '角色图鉴', icon: UsersIcon },
    { to: '/pacing', label: '节奏雷达', icon: TrendingUpIcon },
    { to: '/foreshadowing', label: '伏笔追踪', icon: BookmarkIcon },
    { to: '/files', label: '文档浏览', icon: FolderIcon },
    { to: '/system', label: '系统状态', icon: SlidersIcon },
]

export default function App() {
    const [projectInfo, setProjectInfo] = useState(null)
    const [refreshToken, setRefreshToken] = useState(0)
    const [connected, setConnected] = useState(false)

    const loadProjectInfo = useCallback(() => {
        fetchProjectInfo()
            .then(setProjectInfo)
            .catch(() => setProjectInfo(null))
    }, [])

    useEffect(() => {
        loadProjectInfo()
    }, [loadProjectInfo, refreshToken])

    useEffect(() => {
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
    }, [])

    const title = projectInfo?.project_info?.title || '未加载项目'

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <h1>PIXEL WRITER HUB</h1>
                    <div className="subtitle" title={title}>{title}</div>
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
                <Outlet context={{ projectInfo, refreshToken, connected, reloadProjectInfo: loadProjectInfo }} />
            </main>
        </div>
    )
}

export function useDashboardContext() {
    return useOutletContext()
}
