import { Navigate, useLocation } from 'react-router'
import { Spin } from 'antd'
import { useAuthStore } from '@/core/auth-store'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const isLoading = useAuthStore(s => s.isLoading)
  const workLoaded = useStore(s => s.workLoaded)
  const configLoading = useSystemConfigStore(s => s.isLoading)
  const location = useLocation()

  if (!isAuthenticated && !isLoading) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (isLoading || !workLoaded || configLoading) {
    return (
      <Spin
        size="large"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
        }}
      />
    )
  }

  return <>{children}</>
}
