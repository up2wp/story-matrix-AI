import { getToken } from '@/core/api-client'

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

export const voiceboxClient = {
  health: () => request<unknown>('/health', { headers: requestHeaders(false) }),
  profiles: () => request<VoiceboxProfile[]>('/profiles', { headers: requestHeaders(false) }),
  createProfile: (body: { name: string; voice_type: 'cloned' | 'preset' | 'designed'; description?: string }) => request<VoiceboxProfile>('/profiles', {
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
  status: (generationId: string) => request<Record<string, unknown>>(`/generate/${encodeURIComponent(generationId)}/status`, { headers: requestHeaders(false) }),
  audioUrl: (generationId: string) => `/api/voicebox/audio/${encodeURIComponent(generationId)}`,
  sampleUrl: (sampleId: string) => `/api/voicebox/samples/${encodeURIComponent(sampleId)}`,
}
