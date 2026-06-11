import { Navigate } from 'react-router'
import { useAuthStore } from '@/core/auth-store'

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)

  if (!user || !['owner', 'admin'].includes(user.role)) {
    return <Navigate to="/works" replace />
  }

  return <>{children}</>
}
