import { useEffect, type CSSProperties } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router'
import { ConfigProvider, theme } from 'antd'
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
import ProofreadPage from '@/pages/proofread/ProofreadPage'
import VoicesPage from '@/pages/voices/VoicesPage'
import ImportBackfillPage from '@/pages/backfill/ImportBackfillPage'
import ImageGenerationPage from '@/pages/image-generation/ImageGenerationPage'
import ImagegenPage from '@/pages/imagegen/ImagegenPage'
import { useAuthStore } from '@/core/auth-store'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { useThemeStore } from '@/core/theme-store'

const { defaultAlgorithm, darkAlgorithm } = theme

type AppThemeStyle = CSSProperties & Record<
  '--app-background' |
  '--app-surface' |
  '--app-sider-background' |
  '--app-border' |
  '--app-text-tertiary' |
  '--app-code-background' |
  '--app-code-inline-background',
  string
>

export default function App() {
  const initSession = useAuthStore(s => s.initSession)
  const loadConfig = useSystemConfigStore(s => s.loadConfig)
  const loadLastWork = useStore(s => s.loadLastWork)
  const resolvedTheme = useThemeStore(s => s.resolvedTheme)
  const syncSystemTheme = useThemeStore(s => s.syncSystemTheme)
  const themeAlgorithm = resolvedTheme === 'dark' ? darkAlgorithm : defaultAlgorithm
  const appTokens = theme.getDesignToken({ algorithm: themeAlgorithm })
  const appThemeStyle: AppThemeStyle = {
    '--app-background': appTokens.colorBgLayout,
    '--app-surface': appTokens.colorBgContainer,
    '--app-sider-background': appTokens.colorBgContainer,
    '--app-border': appTokens.colorBorderSecondary,
    '--app-text-tertiary': appTokens.colorTextTertiary,
    '--app-code-background': appTokens.colorFillTertiary,
    '--app-code-inline-background': appTokens.colorFillQuaternary,
  }

  useEffect(() => syncSystemTheme(), [syncSystemTheme])

  useEffect(() => {
    initSession().then((authed) => {
      if (authed) {
        loadConfig()
        loadLastWork()
      }
    })
  }, [initSession, loadConfig, loadLastWork])

  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm: themeAlgorithm, cssVar: { prefix: 'ant' } }}>
      <div data-theme={resolvedTheme} style={appThemeStyle}>
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
              <Route path="/backfill" element={<ImportBackfillPage />} />
              <Route path="/image-generation" element={<ImageGenerationPage />} />
              <Route path="/imagegen" element={<ImagegenPage />} />
              <Route path="/character-voices" element={<CharacterVoicesPage />} />
              <Route path="/chapters" element={<ChaptersPage />} />
              <Route path="/preview" element={<PreviewPage />} />
              <Route path="/proofread" element={<ProofreadPage />} />
              <Route path="/voices" element={<VoicesPage />} />
              <Route element={<AdminRoute><Outlet /></AdminRoute>}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
              <Route path="/" element={<Navigate to="/works" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </div>
    </ConfigProvider>
  )
}
