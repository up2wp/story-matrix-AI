const DEFAULT_TIMEOUT_MS = 360000
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024

export class SafeUpstreamTimeoutError extends Error {
  readonly name = 'SafeUpstreamTimeoutError'
  readonly timeoutMs: number

  constructor(timeoutMs: number, options?: ErrorOptions) {
    super('上游请求超时', options)
    this.timeoutMs = timeoutMs
  }
}

export interface SafeUpstreamFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: BodyInit
  timeoutMs?: number
  maxBytes?: number
}

export function assertSafeHttpsUrl(url: string, label = '上游地址') {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`${label}必须使用 HTTPS`)
  if (isUnsafeHostname(parsed.hostname)) throw new Error(`${label}不能指向本机、内网或保留地址`)
  return parsed
}

export function normalizeSafeBaseUrl(baseUrl: string) {
  return assertSafeHttpsUrl(baseUrl, '生图 Provider 地址').toString().replace(/\/+$/, '')
}

export function isUnsafeHostname(hostname: string) {
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true
  if (lower === 'metadata.google.internal') return true
  if (/^(127|10|0)\./.test(lower)) return true
  if (/^169\.254\./.test(lower)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true
  if (/^192\.168\./.test(lower)) return true
  if (lower === '::1' || lower === '[::1]') return true
  return false
}

export async function readUpstreamError(response: Response) {
  const text = (await response.text().catch(() => '')).slice(0, 600)
  if (!text) return response.statusText
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string; base_resp?: { status_msg?: string } }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message || parsed.message || parsed.base_resp?.status_msg || text
  } catch {
    return text
  }
}

export async function safeUpstreamFetch(url: string, options: SafeUpstreamFetchOptions = {}) {
  const parsed = assertSafeHttpsUrl(url, '上游地址')
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.headers || {})) {
    const lower = key.toLowerCase()
    if (lower === 'content-type' || lower === 'authorization' || lower === 'accept') headers[key] = value
  }
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(parsed, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      redirect: 'error',
      signal: controller.signal,
    })
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > (options.maxBytes || DEFAULT_MAX_BYTES)) throw new Error('上游响应超过大小限制')
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new SafeUpstreamTimeoutError(timeoutMs, { cause: error })
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function readSafeImageBuffer(response: Response, maxBytes = DEFAULT_MAX_BYTES) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) throw new Error('Provider URL 返回的不是图片')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error('图片为空或超过大小限制')
  return buffer
}
