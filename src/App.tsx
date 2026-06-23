import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from '@/components/layout/AppLayout'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import AdminRoute from '@/components/auth/AdminRoute'
import LoginPage from '@/pages/login/LoginPage'
import RegisterPage from '@/pages/login/RegisterPage'
import WorksPage from '@/pages/works/WorksPage'
import AdminPage from '@/pages/admin/AdminPage'
import SeedPage from '@/pages/seed/SeedPage'
import WorldPage from '@/pages/world/WorldPage'
import OutlinePage from '@/pages/outline/OutlinePage'
import ConstraintsPage from '@/pages/constraints/ConstraintsPage'
import CharacterVoicesPage from '@/pages/character-voices/CharacterVoicesPage'
import ChaptersPage from '@/pages/chapters/ChaptersPage'
import PreviewPage from '@/pages/preview/PreviewPage'
import VoicesPage from '@/pages/voices/VoicesPage'
import FeedbackPage from '@/pages/feedback/FeedbackPage'
import { useAuthStore } from '@/core/auth-store'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'

export default function App() {
  const initSession = useAuthStore(s => s.initSession)
  const loadConfig = useSystemConfigStore(s => s.loadConfig)
  const loadLastWork = useStore(s => s.loadLastWork)

  useEffect(() => {
    initSession().then((authed) => {
      if (authed) {
        loadConfig()
        loadLastWork()
      }
    })
  }, [initSession, loadConfig, loadLastWork])

  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/works" element={<WorksPage />} />
            <Route path="/seed" element={<SeedPage />} />
            <Route path="/world" element={<WorldPage />} />
            <Route path="/outline" element={<OutlinePage />} />
            <Route path="/constraints" element={<ConstraintsPage />} />
            <Route path="/character-voices" element={<CharacterVoicesPage />} />
            <Route path="/chapters" element={<ChaptersPage />} />
            <Route path="/preview" element={<PreviewPage />} />
            <Route path="/voices" element={<VoicesPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
            <Route element={<AdminRoute><Outlet /></AdminRoute>}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="/" element={<Navigate to="/works" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}
