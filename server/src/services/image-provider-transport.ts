import type { ImageGenerationModelConfig, ImageGenerationProviderConfig } from './image-generation-config.js'
import { readUpstreamError, safeUpstreamFetch } from './safe-upstream-fetch.js'
import type { SafeUpstreamFetchOptions } from './safe-upstream-fetch.js'

export type ProviderFetchInput = {
  readonly url: string
  readonly operation: string
  readonly provider: ImageGenerationProviderConfig
  readonly model?: ImageGenerationModelConfig
  readonly options?: SafeUpstreamFetchOptions
  readonly streaming?: boolean
  readonly traceId?: string
}

export class ProviderGatewayTimeoutError extends Error {
  readonly name = 'ProviderGatewayTimeoutError'
  readonly status: number

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

function upstreamHost(url: string) {
  try {
    return new URL(url).host
  } catch (error) {
    if (error instanceof TypeError) return 'invalid-url'
    throw error
  }
}

export function isRetryableProviderTimeoutStatus(status: number) {
  return status === 408 || status === 504 || status === 524
}

function providerLogFields(input: ProviderFetchInput, startedAt: number) {
  return {
    providerId: input.provider.id,
    providerType: input.provider.type,
    providerProtocol: input.provider.protocol,
    modelId: input.model?.id,
    providerModel: input.model?.providerModel || input.model?.model,
    operation: input.operation,
    method: input.options?.method || 'GET',
    timeoutMs: input.options?.timeoutMs,
    upstreamHost: upstreamHost(input.url),
    streaming: input.streaming === true,
    traceId: input.traceId,
    durationMs: Date.now() - startedAt,
  }
}

export async function throwProviderResponseError(response: Response) {
  const message = await readUpstreamError(response)
  if (isRetryableProviderTimeoutStatus(response.status)) {
    throw new ProviderGatewayTimeoutError(response.status, message || response.statusText)
  }
  throw new Error(message)
}

export async function fetchProvider(input: ProviderFetchInput) {
  const startedAt = Date.now()
  console.info('[image-generation] provider request start', providerLogFields(input, startedAt))
  try {
    const response = await safeUpstreamFetch(input.url, input.options)
    const fields = { ...providerLogFields(input, startedAt), status: response.status }
    console.info('[image-generation] provider request complete', fields)
    if (isRetryableProviderTimeoutStatus(response.status)) {
      console.warn('[image-generation] provider gateway timeout response', fields)
    }
    return response
  } catch (error) {
    console.error('[image-generation] provider request failed', {
      ...providerLogFields(input, startedAt),
      error: error instanceof Error ? error.message : 'Provider request failed',
    })
    throw error
  }
}
