import type { ImagegenHistoryRecord, ImagegenReferenceAssetRecord } from '@/core/types'

export type ImagegenGenerateRequest = {
  readonly prompt: string
  readonly modelId: string
  readonly size?: string
  readonly quality?: string
  readonly format?: string
  readonly aspectRatio?: string
  readonly n?: number
  readonly referenceImageIds?: readonly string[]
}

export type ImagegenHistoryResponse = Omit<ImagegenHistoryRecord, 'ownerId'>
export type ImagegenReferenceAssetResponse = Omit<ImagegenReferenceAssetRecord, 'ownerId'>

export class ImagegenClientError extends Error {
  readonly name = 'ImagegenClientError'
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return undefined
  return typeof payload.error === 'string' ? payload.error : undefined
}

async function responseErrorMessage(response: Response): Promise<string> {
  const responseText = await response.text()
  if (!responseText) return response.statusText

  try {
    const payload: unknown = JSON.parse(responseText)
    return errorMessage(payload) || response.statusText
  } catch (error) {
    if (error instanceof SyntaxError) return response.statusText
    throw error
  }
}

function requestHeaders(json = true): Record<string, string> {
  return json ? { 'Content-Type': 'application/json' } : {}
}

async function request<T>(url: string, init?: RequestInit, json = true): Promise<T> {
  const response = await fetch(`/api/imagegen${url}`, {
    ...init,
    credentials: 'include',
    headers: { ...requestHeaders(json), ...(init?.headers || {}) },
  })
  if (!response.ok) {
    throw new ImagegenClientError(response.status, await responseErrorMessage(response))
  }
  return response.json()
}

export const imagegenClient = {
  generate: (payload: ImagegenGenerateRequest) => request<ImagegenHistoryResponse>('/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  history: () => request<ImagegenHistoryResponse[]>('/history'),
  referenceAssets: () => request<ImagegenReferenceAssetResponse[]>('/reference-assets'),
  uploadReferenceAsset: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<ImagegenReferenceAssetResponse>('/reference-assets', { method: 'POST', body: formData }, false)
  },
}

export function getImagegenReferenceAssetUrl(asset: Pick<ImagegenReferenceAssetResponse, 'thumbnailUrl' | 'originalUrl'>, variant: 'thumbnail' | 'original' = 'thumbnail') {
  return variant === 'original' ? asset.originalUrl : asset.thumbnailUrl
}
