export interface ImageGenerateRequest {
  workId: string
  modelId: string
  promptId: string
  characterId?: string
  chapterId?: string
  prompt: string
  size?: string
  quality?: string
  format?: string
}

export interface ImageGenerateResponse {
  id: string
  mimeType: string
  storageMode: 'local' | 'immich'
  storageStatus: 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
  assetUrl?: string
  localAssetId?: string
  immichAssetId?: string
  immichFilename?: string
  thumbnailUrl: string
  originalUrl: string
  modelId: string
  modelName: string
  provider: 'openai' | 'custom'
  status: 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
  error?: string
}

export interface ImagePromptRequest {
  workId: string
  systemPrompt: string
  instruction: string
  context: string
}

export interface ImageRetryUploadRequest {
  workId: string
  imageId: string
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
  retryImmichUpload: (payload: ImageRetryUploadRequest) => request<Partial<ImageGenerateResponse>>(`/assets/${encodeURIComponent(payload.workId)}/${encodeURIComponent(payload.imageId)}/retry-immich`, {
    method: 'POST',
  }),
}

export function getImageAssetDisplayUrl(image: { id: string; assetUrl?: string; thumbnailUrl?: string; originalUrl?: string }, variant: 'thumbnail' | 'original' = 'thumbnail') {
  return variant === 'original' ? (image.originalUrl || image.assetUrl || '') : (image.thumbnailUrl || image.assetUrl || '')
}
