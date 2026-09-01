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
export type ImagegenHistoryQuery = {
  readonly page?: number
  readonly pageSize?: number
  readonly prompt?: string
  readonly createdFrom?: number
  readonly createdTo?: number
}

export type ImagegenHistoryPageResponse = {
  readonly items: readonly ImagegenHistoryResponse[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

export type ImagegenReferenceAssetResponse = Omit<ImagegenReferenceAssetRecord, 'ownerId'>
export type ImagegenDeleteHistoryResponse = { readonly deletedCount: number }
export type ImagegenShareResponse = { readonly publicUrl: string; readonly expiresAt: string }

export class ImagegenClientError extends Error {
  readonly name = 'ImagegenClientError'
  readonly status: number
  readonly imageGenerationPermissionAutoDisabled: boolean

  constructor(status: number, message: string, imageGenerationPermissionAutoDisabled = false) {
    super(message)
    this.status = status
    this.imageGenerationPermissionAutoDisabled = imageGenerationPermissionAutoDisabled
  }
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return undefined
  return typeof payload.error === 'string' ? payload.error : undefined
}

function autoDisabled(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'imageGenerationPermissionAutoDisabled' in payload && payload.imageGenerationPermissionAutoDisabled === true
}

async function responseError(response: Response): Promise<ImagegenClientError> {
  const responseText = await response.text()
  if (!responseText) return new ImagegenClientError(response.status, response.statusText)

  try {
    const payload: unknown = JSON.parse(responseText)
    return new ImagegenClientError(response.status, errorMessage(payload) || response.statusText, autoDisabled(payload))
  } catch (error) {
    if (error instanceof SyntaxError) return new ImagegenClientError(response.status, response.statusText)
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
    throw await responseError(response)
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
    throw await responseError(response)
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
  history: (query?: ImagegenHistoryQuery) => request<ImagegenHistoryPageResponse>(historyUrl(query)),
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
  shareHistory: (id: string) => request<ImagegenShareResponse>(`/history/${encodeURIComponent(id)}/share`, {
    method: 'POST',
  }),
}

export function getImagegenReferenceAssetUrl(asset: Pick<ImagegenReferenceAssetResponse, 'thumbnailUrl' | 'originalUrl'>, variant: 'thumbnail' | 'original' = 'thumbnail') {
  return variant === 'original' ? asset.originalUrl : asset.thumbnailUrl
}

function appendNumberParam(params: URLSearchParams, key: string, value: number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    params.append(key, String(value))
  }
}

function appendStringParam(params: URLSearchParams, key: string, value: string | undefined) {
  if (typeof value === 'string' && value.trim()) {
    params.append(key, value.trim())
  }
}

function historyUrl(query: ImagegenHistoryQuery = {}): string {
  const params = new URLSearchParams()
  appendNumberParam(params, 'page', query.page)
  appendNumberParam(params, 'pageSize', query.pageSize)
  appendStringParam(params, 'prompt', query.prompt)
  appendNumberParam(params, 'createdFrom', query.createdFrom)
  appendNumberParam(params, 'createdTo', query.createdTo)
  const queryString = params.toString()
  return queryString ? `/history?${queryString}` : '/history'
}
