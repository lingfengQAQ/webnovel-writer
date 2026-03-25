import { useEffect, useMemo, useState } from 'react'
import { ContextMenuProvider } from './components/ContextMenuProvider.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import EntitiesPage from './pages/EntitiesPage.jsx'
import GraphPage from './pages/GraphPage.jsx'
import ChaptersPage from './pages/ChaptersPage.jsx'
import FilesPage from './pages/FilesPage.jsx'
import ReadingPowerPage from './pages/ReadingPowerPage.jsx'
import SkillsPage from './pages/SkillsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import OutlineWorkspacePage from './pages/OutlineWorkspacePage.jsx'

const DEFAULT_ROUTE = 'dashboard'

const ROUTES = [
    { id: 'dashboard', icon: 'D', label: '数据总览', component: DashboardPage },
    { id: 'entities', icon: 'E', label: '设定词典', component: EntitiesPage },
    { id: 'graph', icon: 'G', label: '关系图谱', component: GraphPage },
    { id: 'chapters', icon: 'C', label: '章节一览', component: ChaptersPage },
    { id: 'files', icon: 'F', label: '文档浏览', component: FilesPage },
    { id: 'reading', icon: 'R', label: '追读力', component: ReadingPowerPage },
    { id: 'skills', icon: 'S', label: '技能管理', component: SkillsPage },
    { id: 'settings', icon: 'T', label: '设定集', component: SettingsPage },
    { id: 'outline', icon: 'O', label: '双纲工作台', component: OutlineWorkspacePage },
]

const ROUTE_MAP = new Map(ROUTES.map(route => [route.id, route]))

function normalizeRoute(routeId) {
    const safeId = (routeId || '').trim().toLowerCase()
    return ROUTE_MAP.has(safeId) ? safeId : DEFAULT_ROUTE
}

function readRouteFromHash() {
    if (typeof window === 'undefined') return DEFAULT_ROUTE
    const route = window.location.hash.replace(/^#\/?/, '')
    return normalizeRoute(route)
}

function writeRouteToHash(routeId) {
    if (typeof window === 'undefined') return
    const nextHash = `#/${normalizeRoute(routeId)}`
    if (window.location.hash !== nextHash) {
        window.location.hash = nextHash
    }
}

export default function App() {
    const [routeId, setRouteId] = useState(() => readRouteFromHash())

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        if (!window.location.hash) {
            writeRouteToHash(routeId)
        }

        const handleHashChange = () => {
            setRouteId(readRouteFromHash())
        }

        window.addEventListener('hashchange', handleHashChange)
        return () => {
            window.removeEventListener('hashchange', handleHashChange)
        }
    }, [routeId])

    const activeRoute = useMemo(
        () => ROUTE_MAP.get(routeId) || ROUTE_MAP.get(DEFAULT_ROUTE),
        [routeId],
    )
    const ActivePage = activeRoute.component

    return (
        <ContextMenuProvider>
            <div className="app-layout">
                <aside className="sidebar">
                    <div className="sidebar-header">
                        <h1>PIXEL WRITER HUB</h1>
                        <div className="subtitle">Frontend Core Skeleton</div>
                    </div>

                    <nav className="sidebar-nav">
                        {ROUTES.map(item => (
                            <button
                                key={item.id}
                                className={`nav-item ${routeId === item.id ? 'active' : ''}`}
                                onClick={() => {
                                    setRouteId(item.id)
                                    writeRouteToHash(item.id)
                                }}
                                type="button"
                            >
                                <span className="icon">{item.icon}</span>
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </nav>

                    <div className="live-indicator">
                        <span className="live-dot" />
                        路由已启用
                    </div>
                </aside>

                <main className="main-content">
                    <ActivePage />
                </main>
            </div>
        </ContextMenuProvider>
    )
}
