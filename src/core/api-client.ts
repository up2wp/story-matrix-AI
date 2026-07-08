// ============================================================
// API 客户端 — 替代 Dexie，通过 REST API 访问后端 SQLite
// 认证通过 httpOnly Cookie 自动携带
// ============================================================

const API_BASE = '/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  const res = await fetch(`${API_BASE}${url}`, {
    headers,
    credentials: 'include',
    cache: 'no-store',
    ...options,
  })
  if (res.status === 404) return undefined as T
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('登录已过期，请重新登录')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `请求失败: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// 通用表操作工厂
function createTable<T extends { id: string }>(resource: string) {
  const table = {
    get: (id: string) => request<T | undefined>(`/${resource}/${id}`),

    put: (obj: T) => request<T>(`/${resource}/${obj.id}`, {
      method: 'PUT',
      body: JSON.stringify(obj),
    }),

    add: (obj: T) => request<T>(`/${resource}`, {
      method: 'POST',
      body: JSON.stringify(obj),
    }),

    update: (id: string, changes: Partial<T>) => request<T>(`/${resource}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

    delete: (id: string) => request<void>(`/${resource}/${id}`, {
      method: 'DELETE',
    }),

    toArray: () => request<T[]>(`/${resource}`),

    // where(field).equals(val).first() / .count()
    where: (_field: string) => ({
      equals: (val: string) => ({
        first: () => {
          if (resource === 'users') return request<T | undefined>(`/${resource}/by-username?username=${encodeURIComponent(val)}`)
          return request<T | undefined>(`/${resource}/${val}`)
        },
        count: () => request<{ count: number }>(`/${resource}/count?${_field}=${encodeURIComponent(val)}`).then(r => r.count),
      }),
    }),
  }
  return table
}

// 兼容旧代码中对 getToken/setToken 的引用（已无实际作用）
export function getToken(): string | null { return null }
export function setToken(_token: string | null) { /* no-op, 认证通过 cookie */ }

export const db = {
  open: async () => { /* 无操作，后端自动初始化 */ },
  delete: async () => { /* 无操作 */ },

  users: createTable<any>('users'),
  works: {
    ...createTable<any>('works'),
    updateAudiobook: (id: string, audiobookChanges: any) => request<any>(`/works/${id}/audiobook`, {
      method: 'PATCH',
      body: JSON.stringify(audiobookChanges),
    }),
    patchAudiobookSegment: (id: string, segmentPatch: any) => request<any>(`/works/${id}/audiobook`, {
      method: 'PATCH',
      body: JSON.stringify({ segmentPatch }),
    }),
    updateVisualAssets: (id: string, visualAssetChanges: any) => request<any>(`/works/${id}/visual-assets`, {
      method: 'PATCH',
      body: JSON.stringify(visualAssetChanges),
    }),
  },

  systemConfig: {
    get: (_id: string) => request<any>('/system-config'),
    add: (config: any) => request<any>('/system-config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
    update: (_id: string, changes: any) => request<any>('/system-config', {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  },
}
