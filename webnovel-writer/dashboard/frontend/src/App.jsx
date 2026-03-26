import { useEffect, useMemo, useState } from 'react'
import { ContextMenuProvider } from './components/ContextMenuProvider.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
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

// P2-E 修复：用内联 SVG 图标替换原来的字母占位符，提升商业产品专业感
const Icons = {
    dashboard: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
    ),
    entities: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    ),
    graph: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
    ),
    chapters: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
    ),
    files: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    ),
    reading: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
    ),
    skills: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    ),
    settings: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    ),
    outline: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
    ),
}

const ROUTES = [
    { id: 'dashboard', icon: Icons.dashboard, label: '数据总览', component: DashboardPage },
    { id: 'entities', icon: Icons.entities, label: '设定词典', component: EntitiesPage },
    { id: 'graph', icon: Icons.graph, label: '关系图谱', component: GraphPage },
    { id: 'chapters', icon: Icons.chapters, label: '章节一览', component: ChaptersPage },
    { id: 'files', icon: Icons.files, label: '文档浏览', component: FilesPage },
    { id: 'reading', icon: Icons.reading, label: '追读力', component: ReadingPowerPage },
    { id: 'skills', icon: Icons.skills, label: '技能管理', component: SkillsPage },
    { id: 'settings', icon: Icons.settings, label: '设定集', component: SettingsPage },
    { id: 'outline', icon: Icons.outline, label: '双纲工作台', component: OutlineWorkspacePage },
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
                    {/* P3-A 修复：sidebar 标题改为中文品牌名，去掉硬编码英文 */}
                    <div className="sidebar-header">
                        <h1>网文创作台</h1>
                        <div className="subtitle">Webnovel Dashboard</div>
                    </div>

                    <nav className="sidebar-nav" aria-label="主导航">
                        {ROUTES.map(item => (
                            <button
                                key={item.id}
                                className={`nav-item ${routeId === item.id ? 'active' : ''}`}
                                onClick={() => {
                                    setRouteId(item.id)
                                    writeRouteToHash(item.id)
                                }}
                                type="button"
                                aria-current={routeId === item.id ? 'page' : undefined}
                                title={item.label}
                            >
                                {/* P2-E 修复：使用 SVG 图标替换字母占位符 */}
                                <span className="icon" aria-hidden="true">{item.icon}</span>
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
                    {/* P1-G 修复：ErrorBoundary 包裹，防止页面组件崩溃导致整个 App 白屏 */}
                    <ErrorBoundary key={routeId}>
                        <ActivePage />
                    </ErrorBoundary>
                </main>
            </div>
        </ContextMenuProvider>
    )
}
