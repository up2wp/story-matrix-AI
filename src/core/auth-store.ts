import { create } from 'zustand'
import type { User } from './types'

// ============================================================
// 密码哈希（SHA-256，与服务端一致）
// ============================================================

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================
// 认证状态管理 — httpOnly Cookie 会话认证
// ============================================================

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  register: (username: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string }>
  changePassword: (_oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  updateProfile: (displayName: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  initSession: () => Promise<boolean>
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  initSession: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        const user = await res.json()
        set({ user, isAuthenticated: true, isLoading: false })
        return true
      } else {
        set({ isLoading: false })
        return false
      }
    } catch {
      set({ isLoading: false })
      return false
    }
  },

  login: async (username, password) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) return false
      const { user } = await res.json()
      set({ user, isAuthenticated: true })
      return true
    } catch {
      return false
    }
  },

  register: async (username, password, displayName) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, displayName }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '注册失败' }))
        return { success: false, error: err.error || '注册失败' }
      }
      const { user } = await res.json()
      set({ user, isAuthenticated: true })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err, '注册失败') }
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ oldPassword, newPassword }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '修改密码失败' }))
        return { success: false, error: err.error || '修改密码失败' }
      }
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err, '修改密码失败') }
    }
  },

  updateProfile: async (displayName) => {
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '修改资料失败' }))
        return { success: false, error: err.error || '修改资料失败' }
      }
      const user = await res.json()
      set({ user })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err, '修改资料失败') }
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch { /* 忽略错误 */ }
    set({ user: null, isAuthenticated: false })
  },
}))
