import type { ImagegenHistoryRecord, ImagegenReferenceAssetRecord } from '@/core/types'

export type ImagegenGenerateRequest = {
  readonly prompt: string
  readonly modelId: string
  readonly size?: string
  readonly quality?: string
  readonly format?: string
  readonly aspectRatio?: string
  readonly n?: number
  readonly referenceInputs?: readonly ImagegenReferenceInput[]
  readonly referenceFiles?: readonly File[]
}

export type ImagegenReferenceInput =
  | { readonly kind: 'asset'; readonly id: string }
  | { readonly kind: 'file'; readonly index: number }

export type ImagegenHistoryResponse = Omit<ImagegenHistoryRecord, 'ownerId'>
export type ImagegenReferenceAssetResponse = Omit<ImagegenReferenceAssetRecord, 'ownerId'>
export type ImagegenDeleteHistoryResponse = { readonly deletedCount: number }

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

async function requestEmpty(url: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`/api/imagegen${url}`, {
    ...init,
    credentials: 'include',
    headers: { ...requestHeaders(), ...(init?.headers || {}) },
  })
  if (!response.ok) {
    throw new ImagegenClientError(response.status, await responseErrorMessage(response))
  }
}

function generateRequestInit(payload: ImagegenGenerateRequest): { readonly init: RequestInit; readonly json: boolean } {
  const { referenceFiles, ...body } = payload
  if (!referenceFiles?.length) {
    return { init: { method: 'POST', body: JSON.stringify(body) }, json: true }
  }

  const formData = new FormData()
  formData.append('payload', JSON.stringify(body))
  referenceFiles.forEach(file => formData.append('referenceImages', file))
  return { init: { method: 'POST', body: formData }, json: false }
}

export const imagegenClient = {
  generate: (payload: ImagegenGenerateRequest) => {
    const { init, json } = generateRequestInit(payload)
    return request<ImagegenHistoryResponse>('/generate', init, json)
  },
  history: () => request<ImagegenHistoryResponse[]>('/history'),
  deleteHistory: (id: string) => requestEmpty(`/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  deleteHistoryBatch: (ids: readonly string[]) => request<ImagegenDeleteHistoryResponse>('/history/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  }),
  rerunHistory: (id: string) => request<ImagegenHistoryResponse>(`/history/${encodeURIComponent(id)}/rerun`, {
    method: 'POST',
  }),
}

export function getImagegenReferenceAssetUrl(asset: Pick<ImagegenReferenceAssetResponse, 'thumbnailUrl' | 'originalUrl'>, variant: 'thumbnail' | 'original' = 'thumbnail') {
  return variant === 'original' ? asset.originalUrl : asset.thumbnailUrl
}
