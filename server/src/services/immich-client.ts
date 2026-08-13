const IMMICH_TIMEOUT_MS = 20000
const IMMICH_MAX_RESPONSE_BYTES = 12 * 1024 * 1024

export interface ImmichClientConfig {
  serviceUrl: string
  apiKey: string
  projectName: string
  allowPrivateNetwork?: boolean
}

export interface ImmichUploadInput {
  buffer: Buffer
  filename: string
  mimeType: string
  deviceAssetId: string
  albumId?: string
}

export interface ImmichUploadResult {
  assetId: string
  filename: string
}

export interface ImmichSearchCandidate {
  id: string
  originalFileName?: string
  originalPath?: string
}

export function normalizeImmichBaseUrl(serviceUrl: string, allowPrivateNetwork = false) {
  const parsed = new URL(serviceUrl)
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Immich 服务地址必须使用 HTTP 或 HTTPS')
  if (!allowPrivateNetwork && isUnsafeImmichHostname(parsed.hostname)) throw new Error('Immich 服务地址不能指向本机、内网或保留地址')
  const withoutTrailingSlash = parsed.toString().replace(/\/+$/, '')
  return parsed.pathname === '/' ? `${withoutTrailingSlash}/api` : withoutTrailingSlash
}

export function isUnsafeImmichHostname(hostname: string) {
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

function readError(response: Response) {
  return response.text().then(text => {
    if (!text) return response.statusText
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string | { message?: string } }
      if (typeof parsed.error === 'string') return parsed.error
      return parsed.error?.message || parsed.message || text
    } catch {
      return text
    }
  })
}

export class ImmichClient {
  private baseUrl: string
  private apiKey: string
  private projectName: string

  constructor(config: ImmichClientConfig) {
    this.baseUrl = normalizeImmichBaseUrl(config.serviceUrl, config.allowPrivateNetwork)
    this.apiKey = config.apiKey
    this.projectName = config.projectName
  }

  private headers(extra: Record<string, string> = {}) {
    return { 'x-api-key': this.apiKey, ...extra }
  }

  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), IMMICH_TIMEOUT_MS)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers || {}) },
        redirect: 'error',
        signal: controller.signal,
      })
      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async assertReadyForUpload() {
    const ping = await this.request('/server/ping')
    if (!ping.ok) throw new Error(`Immich ping 失败：${await readError(ping)}`)
    const auth = await this.request('/users/me')
    if (!auth.ok) throw new Error(`Immich 认证失败：${await readError(auth)}`)
    const uploadCheck = await this.request('/assets/bulk-upload-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets: [{ id: 'story-matrix-readiness-check', checksum: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' }] }),
    })
    if (!uploadCheck.ok) throw new Error(`Immich 上传预检失败：${await readError(uploadCheck)}`)
  }

  async ensureProjectAlbum() {
    const albums = await this.request('/albums')
    if (!albums.ok) throw new Error(`Immich 相册读取失败：${await readError(albums)}`)
    const list = await albums.json() as Array<{ id?: string; albumName?: string }>
    const existing = list.find(album => album.albumName === this.projectName)
    if (existing?.id) return existing.id
    const created = await this.request('/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumName: this.projectName }),
    })
    if (!created.ok) throw new Error(`Immich 相册创建失败：${await readError(created)}`)
    const data = await created.json() as { id?: string }
    if (!data.id) throw new Error('Immich 相册创建响应缺少 ID')
    return data.id
  }

  async uploadImage(input: ImmichUploadInput): Promise<ImmichUploadResult> {
    const form = new FormData()
    const now = new Date().toISOString()
    const arrayBuffer = input.buffer.buffer.slice(input.buffer.byteOffset, input.buffer.byteOffset + input.buffer.byteLength) as ArrayBuffer
    form.append('assetData', new Blob([arrayBuffer], { type: input.mimeType }), input.filename)
    form.append('deviceAssetId', input.deviceAssetId)
    form.append('deviceId', 'story-matrix-ai')
    form.append('fileCreatedAt', now)
    form.append('fileModifiedAt', now)
    form.append('isFavorite', 'false')
    const response = await this.request('/assets', { method: 'POST', body: form })
    if (!response.ok) throw new Error(`Immich 上传失败：${await readError(response)}`)
    const data = await response.json() as { id?: string; assetId?: string }
    const assetId = data.id || data.assetId
    if (!assetId) throw new Error('Immich 上传响应缺少 asset id')
    if (input.albumId) await this.addAssetToAlbum(input.albumId, assetId)
    return { assetId, filename: input.filename }
  }

  async addAssetToAlbum(albumId: string, assetId: string) {
    const response = await this.request(`/albums/${encodeURIComponent(albumId)}/assets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [assetId] }),
    })
    if (!response.ok) throw new Error(`Immich 相册写入失败：${await readError(response)}`)
  }

  async searchByFilename(filename: string) {
    const response = await this.request('/search/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalFileName: filename }),
    })
    if (!response.ok) throw new Error(`Immich 文件名搜索失败：${await readError(response)}`)
    const data = await response.json() as { assets?: { items?: ImmichSearchCandidate[] } }
    return data.assets?.items || []
  }

  async fetchAssetBytes(assetId: string, variant: 'thumbnail' | 'original') {
    const path = variant === 'thumbnail' ? `/assets/${encodeURIComponent(assetId)}/thumbnail` : `/assets/${encodeURIComponent(assetId)}/original`
    const response = await this.request(path)
    if (!response.ok) throw new Error(await readError(response))
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    if (!contentType.startsWith('image/')) throw new Error('Immich 返回的不是图片')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > IMMICH_MAX_RESPONSE_BYTES) throw new Error('Immich 图片超过大小限制')
    return { buffer, contentType }
  }

  async deleteAsset(assetId: string) {
    const response = await this.request('/assets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [assetId], force: true }),
    })
    if (!response.ok) throw new Error(`Immich 图片删除失败：${await readError(response)}`)
  }
}
