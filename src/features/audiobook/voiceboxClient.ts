import { getToken } from '@/core/api-client'
import type { UserVoiceAsset } from '@/core/types'

function requestHeaders(json = true) {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function request<T>(url: string, options?: RequestInit) {
  const response = await fetch(`/api/voicebox${url}`, options)
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
    throw new Error(data.error || `Voicebox 请求失败: ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function apiRequest<T>(url: string, options?: RequestInit) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
    throw new Error(data.error || `请求失败: ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export interface VoiceboxProfile {
  id?: string
  profile_id?: string
  name?: string
  display_name?: string
  voice_type?: string
}

export interface VoiceboxGenerationResponse {
  generation_id?: string
  id?: string
  status?: string
}

export interface VoiceboxGenerationStatus {
  status?: string
  error?: string
}

export const voiceboxClient = {
  health: () => request<unknown>('/health', { headers: requestHeaders(false) }),
  profiles: () => request<VoiceboxProfile[]>('/profiles', { headers: requestHeaders(false) }),
  createProfile: (body: { name: string; voice_type: 'cloned' | 'preset' | 'designed'; description?: string; language?: string }) => request<VoiceboxProfile>('/profiles', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(body),
  }),
  uploadSample: (profileId: string, file: File, referenceText: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('reference_text', referenceText)
    return request<{ id?: string; sample_id?: string }>(`/profiles/${encodeURIComponent(profileId)}/samples`, {
      method: 'POST',
      headers: requestHeaders(false),
      body: formData,
    })
  },
  generate: (body: Record<string, unknown>) => request<VoiceboxGenerationResponse>('/generate', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(body),
  }),
  status: (generationId: string) => request<VoiceboxGenerationStatus>(`/generate/${encodeURIComponent(generationId)}/status`, { headers: requestHeaders(false) }),
  audioUrl: (generationId: string) => `/api/voicebox/audio/${encodeURIComponent(generationId)}`,
  sampleUrl: (sampleId: string) => `/api/voicebox/samples/${encodeURIComponent(sampleId)}`,
  fetchMediaUrl: async (url: string) => {
    const response = await fetch(url, { headers: requestHeaders(false) })
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
      throw new Error(data.error || `音频获取失败: ${response.status}`)
    }
    return URL.createObjectURL(await response.blob())
  },
}

export const userVoicesClient = {
  list: () => apiRequest<UserVoiceAsset[]>('/api/user-voices', { headers: requestHeaders(false) }),
  create: (body: {
    displayName: string
    profileId: string
    profileName?: string
    sampleId?: string
    referenceText: string
    consentConfirmed: boolean
  }) => apiRequest<UserVoiceAsset>('/api/user-voices', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(body),
  }),
  rename: (id: string, displayName: string) => apiRequest<UserVoiceAsset>(`/api/user-voices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: requestHeaders(),
    body: JSON.stringify({ displayName }),
  }),
  remove: (id: string) => apiRequest<void>(`/api/user-voices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: requestHeaders(false),
  }),
}
