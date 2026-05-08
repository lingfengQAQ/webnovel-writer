import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx'))
const CharactersPage = lazy(() => import('./pages/CharactersPage.jsx'))
const PacingPage = lazy(() => import('./pages/PacingPage.jsx'))
const ForeshadowingPage = lazy(() => import('./pages/ForeshadowingPage.jsx'))
const FilesPage = lazy(() => import('./pages/FilesPage.jsx'))
const SystemPage = lazy(() => import('./pages/SystemPage.jsx'))

function LoadingScreen() {
    return (
        <div className="loading-screen">
            <div className="loading-card">
                <div className="section-label">LOADING</div>
                <p>正在加载 Dashboard…</p>
            </div>
        </div>
    )
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter>
            <Suspense fallback={<LoadingScreen />}>
                <Routes>
                    <Route path="/" element={<App />}>
                        <Route index element={<OverviewPage />} />
                        <Route path="characters" element={<CharactersPage />} />
                        <Route path="pacing" element={<PacingPage />} />
                        <Route path="foreshadowing" element={<ForeshadowingPage />} />
                        <Route path="files" element={<FilesPage />} />
                        <Route path="system" element={<SystemPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                </Routes>
            </Suspense>
        </BrowserRouter>
    </React.StrictMode>,
)
