import type { ImagegenHistoryRecord } from '@/core/types'

export type ImagegenGenerateRequest = {
  readonly prompt: string
  readonly modelId: string
  readonly size?: string
  readonly quality?: string
  readonly format?: string
  readonly aspectRatio?: string
  readonly n?: number
}

export type ImagegenHistoryResponse = Omit<ImagegenHistoryRecord, 'ownerId'>

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/imagegen${url}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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
}
