export interface ImageGenerateRequest {
  workId: string
  modelId: string
  prompt: string
  size?: string
  quality?: string
  format?: string
}

export interface ImageGenerateResponse {
  id: string
  mimeType: string
  assetUrl: string
  modelId: string
  modelName: string
  provider: 'openai' | 'custom'
}

export interface ImagePromptRequest {
  workId: string
  systemPrompt: string
  instruction: string
  context: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/image-generation${url}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || response.statusText)
  }
  return response.json()
}

export const imageGenerationClient = {
  generate: (payload: ImageGenerateRequest) => request<ImageGenerateResponse>('/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  prompt: (payload: ImagePromptRequest) => request<{ prompt: string }>('/prompt', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
}
