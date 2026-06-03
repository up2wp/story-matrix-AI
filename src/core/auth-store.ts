import { create } from 'zustand'
import { db } from './db'
import { getToken, setToken } from './api-client'
import { generateId } from '@/utils/id'
import type { User } from './types'

// ============================================================
// 认证状态管理 — 使用服务端会话认证
// ============================================================

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  register: (username: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string }>
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  initSession: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  initSession: async () => {
    const token = getToken()
    if (!token) {
      set({ isLoading: false })
      return
    }
    try {
      // 通过 token 获取当前用户信息
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const user = await res.json()
        set({ user, isAuthenticated: true, isLoading: false })
      } else {
        // token 无效，清除
        setToken(null)
        set({ isLoading: false })
      }
    } catch {
      setToken(null)
      set({ isLoading: false })
    }
  },

  login: async (username, password) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) return false
      const { token, user } = await res.json()
      setToken(token)
      set({ user, isAuthenticated: true })
      return true
    } catch {
      return false
    }
  },

  register: async (username, password, displayName) => {
    try {
      // 先检查用户名是否已存在
      const existing = await db.users.where('username').equals(username).first()
      if (existing) return { success: false, error: '用户名已存在' }

      // 生成密码哈希（与服务端一致的 SHA-256）
      const encoder = new TextEncoder()
      const data = encoder.encode(password)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const passwordHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      const newUser = {
        id: generateId(),
        username,
        passwordHash,
        displayName,
        role: 'user' as const,
        createdAt: Date.now(),
      }
      await db.users.add(newUser)

      // 注册成功后自动登录
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (loginRes.ok) {
        const { token, user } = await loginRes.json()
        setToken(token)
        set({ user, isAuthenticated: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || '注册失败' }
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    const { user } = useAuthStore.getState()
    if (!user) return { success: false, error: '未登录' }

    try {
      const encoder = new TextEncoder()
      const hash = async (pwd: string) => {
        const data = encoder.encode(pwd)
        const buf = await crypto.subtle.digest('SHA-256', data)
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
      }

      const oldHash = await hash(oldPassword)
      const newHash = await hash(newPassword)
      await db.users.update(user.id, { passwordHash: newHash })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || '修改密码失败' }
    }
  },

  logout: async () => {
    const token = getToken()
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch { /* 忽略错误 */ }
    }
    setToken(null)
    set({ user: null, isAuthenticated: false })
  },
}))
