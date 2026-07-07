import type { ChapterVisualCandidateResult, ImagePromptType, ImageViewDirection, VisualCandidateKind, WorkVisualAssetsConfig } from '@/core/types'

export interface ImageGenerateRequest {
  workId: string
  modelId: string
  promptId: string
  characterId?: string
  chapterId?: string
  prompt: string
  referenceImageIds?: string[]
  viewDirection?: ImageViewDirection
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
  provider: 'openai' | 'openai-compatible' | 'custom' | 'minimax'
  status: 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
  basePromptSnapshot?: string
  generationPromptSnapshot?: string
  viewDirection?: ImageViewDirection
  referenceImageIds?: string[]
  error?: string
}

export interface ImageCandidateRequest {
  workId: string
  chapterId: string
}

export interface ImageProviderDiscoveryRequest {
  providerId?: string
  provider?: Record<string, unknown>
}

export interface ImageProviderModelCandidate {
  providerModel: string
  label: string
  capabilities: { sizes: string[]; qualities: string[]; formats: string[]; aspectRatios?: string[]; referenceImages?: boolean; maxReferenceImages?: number }
  source: 'provider' | 'preset' | 'manual'
  requiresConfirmation: boolean
}

export interface ImagePromptRequest {
  workId: string
  type: ImagePromptType
  characterId?: string
  chapterId?: string
  visualSubjectId?: string
  candidateKind?: VisualCandidateKind
}

export interface ImageRetryUploadRequest {
  workId: string
  imageId: string
}

export interface ImageDeleteRequest {
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
  extractCandidates: (payload: ImageCandidateRequest) => request<ChapterVisualCandidateResult>('/extract-candidates', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  retryImmichUpload: (payload: ImageRetryUploadRequest) => request<Partial<ImageGenerateResponse>>(`/assets/${encodeURIComponent(payload.workId)}/${encodeURIComponent(payload.imageId)}/retry-immich`, {
    method: 'POST',
  }),
  deleteAsset: (payload: ImageDeleteRequest) => request<{ visualAssets: WorkVisualAssetsConfig; updatedAt: number }>(`/assets/${encodeURIComponent(payload.workId)}/${encodeURIComponent(payload.imageId)}`, {
    method: 'DELETE',
  }),
  discoverProviderModels: (payload: ImageProviderDiscoveryRequest) => request<{ candidates: ImageProviderModelCandidate[] }>('/providers/discover-models', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
}

export function getImageAssetDisplayUrl(image: { id: string; assetUrl?: string; thumbnailUrl?: string; originalUrl?: string }, variant: 'thumbnail' | 'original' = 'thumbnail') {
  return variant === 'original' ? (image.originalUrl || image.assetUrl || '') : (image.thumbnailUrl || image.assetUrl || '')
}
