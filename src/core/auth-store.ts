import { create } from 'zustand'
import type { AuthenticatedUser, ThemePreference } from './types'
import { useThemeStore } from './theme-store'

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
  user: AuthenticatedUser | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  register: (username: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string }>
  changePassword: (_oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  updateProfile: (displayName: string) => Promise<{ success: boolean; error?: string }>
  saveCurrentUserThemePreference: (themePreference: ThemePreference) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  initSession: () => Promise<boolean>
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

let themePreferenceRequestId = 0
let themePreferenceSaveQueue: Promise<void> = Promise.resolve()

function nextThemePreferenceRequestId() {
  themePreferenceRequestId += 1
  return themePreferenceRequestId
}

function invalidateThemePreferenceRequests() {
  themePreferenceRequestId += 1
}

function enqueueThemePreferenceSave<T>(task: () => Promise<T>) {
  const run = themePreferenceSaveQueue.then(task, task)
  themePreferenceSaveQueue = run.then(() => undefined, () => undefined)
  return run
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  initSession: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        const user: AuthenticatedUser = await res.json()
        invalidateThemePreferenceRequests()
        set({ user, isAuthenticated: true, isLoading: false })
        useThemeStore.getState().syncUserThemePreference(user.themePreference)
        return true
      } else {
        invalidateThemePreferenceRequests()
        set({ user: null, isAuthenticated: false, isLoading: false })
        useThemeStore.getState().resetToSystem()
        return false
      }
    } catch {
      invalidateThemePreferenceRequests()
      set({ user: null, isAuthenticated: false, isLoading: false })
      useThemeStore.getState().resetToSystem()
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
      const { user }: { readonly user: AuthenticatedUser } = await res.json()
      invalidateThemePreferenceRequests()
      set({ user, isAuthenticated: true })
      useThemeStore.getState().syncUserThemePreference(user.themePreference)
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
      const { user }: { readonly user: AuthenticatedUser } = await res.json()
      invalidateThemePreferenceRequests()
      set({ user, isAuthenticated: true })
      useThemeStore.getState().syncUserThemePreference(user.themePreference)
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
      const user: AuthenticatedUser = await res.json()
      const currentThemePreference = useThemeStore.getState().themePreference
      set({ user: { ...user, themePreference: currentThemePreference } })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err, '修改资料失败') }
    }
  },

  saveCurrentUserThemePreference: async (themePreference) => {
    const requestId = nextThemePreferenceRequestId()
    return enqueueThemePreferenceSave(async () => {
      if (requestId !== themePreferenceRequestId) {
        return { success: false, error: '主题偏好保存已取消' }
      }
      const res = await fetch('/api/auth/theme-preference', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ themePreference }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '保存主题偏好失败' }))
        return { success: false, error: err.error || '保存主题偏好失败' }
      }
      const user: AuthenticatedUser = await res.json()
      if (requestId === themePreferenceRequestId) {
        set((state) => ({ user: state.user ? { ...state.user, themePreference: user.themePreference } : user }))
        useThemeStore.getState().syncUserThemePreference(user.themePreference)
      }
      return { success: true }
    }).catch((err: unknown) => {
      return { success: false, error: errorMessage(err, '保存主题偏好失败') }
    })
  },

  logout: async () => {
    invalidateThemePreferenceRequests()
    set({ user: null, isAuthenticated: false })
    useThemeStore.getState().resetToSystem()
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch (err: unknown) {
      if (!(err instanceof Error)) throw err
    }
  },
}))
