import { Router } from 'express'
import type { Request, Response as ExpressResponse } from 'express'
import db from '../db.js'

const router = Router()

interface VoiceboxConfigPayload {
  serviceUrl?: string
  authType?: 'none' | 'bearer' | 'api-key' | 'custom-header'
  bearerToken?: string
  apiKey?: string
  customHeaderName?: string
  customHeaderValue?: string
}

function defaultVoiceboxConfig() {
  return { serviceUrl: 'http://127.0.0.1:17493', authType: 'none' as const }
}

function loadVoiceboxConfig(): VoiceboxConfigPayload {
  const row = db.prepare('SELECT voiceboxConfig FROM systemConfig WHERE id = ?').get('singleton') as { voiceboxConfig?: string } | undefined
  if (!row?.voiceboxConfig) return defaultVoiceboxConfig()
  return JSON.parse(row.voiceboxConfig) as VoiceboxConfigPayload
}

function baseUrl() {
  const url = (loadVoiceboxConfig().serviceUrl || defaultVoiceboxConfig().serviceUrl).replace(/\/+$/, '')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Voicebox 服务地址必须使用 http 或 https')
  return parsed.toString().replace(/\/+$/, '')
}

function upstreamHeaders(extra?: Record<string, string>) {
  const config = loadVoiceboxConfig()
  const headers: Record<string, string> = { ...(extra || {}) }
  if (config.authType === 'bearer' && config.bearerToken && config.bearerToken !== '__server_configured__') {
    headers.Authorization = `Bearer ${config.bearerToken}`
  }
  if (config.authType === 'api-key' && config.apiKey && config.apiKey !== '__server_configured__') {
    headers['X-API-Key'] = config.apiKey
  }
  if (config.authType === 'custom-header' && config.customHeaderName && config.customHeaderValue && config.customHeaderValue !== '__server_configured__') {
    if (!/^[A-Za-z0-9-]+$/.test(config.customHeaderName)) throw new Error('自定义鉴权 Header 名称不合法')
    headers[config.customHeaderName] = config.customHeaderValue
  }
  return headers
}

function assertSafeId(id: string) {
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) throw new Error('ID 包含不安全字符')
}

async function readVoiceboxError(response: globalThis.Response) {
  const text = await response.text().catch(() => '')
  if (!text) return response.statusText
  try {
    const parsed = JSON.parse(text) as { detail?: string; error?: string; message?: string }
    return parsed.detail || parsed.error || parsed.message || text
  } catch {
    return text
  }
}

async function proxyJson(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: upstreamHeaders(init?.headers as Record<string, string> | undefined) })
  if (!response.ok) {
    return { ok: false as const, status: response.status, error: await readVoiceboxError(response) }
  }
  return { ok: true as const, status: response.status, data: await response.json() }
}

async function collectRequestBody(req: Request) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function sendProxyResult(res: ExpressResponse, result: Awaited<ReturnType<typeof proxyJson>>) {
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  return res.status(result.status).json(result.data)
}

router.get('/health', async (_req, res) => {
  try {
    sendProxyResult(res, await proxyJson('/health'))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 连接失败'
    res.status(502).json({ error: message })
  }
})

router.get('/profiles', async (_req, res) => {
  try {
    sendProxyResult(res, await proxyJson('/profiles'))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox profiles 获取失败'
    res.status(502).json({ error: message })
  }
})

router.post('/profiles', async (req, res) => {
  try {
    sendProxyResult(res, await proxyJson('/profiles', {
      method: 'POST',
      headers: upstreamHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req.body),
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox profile 创建失败'
    res.status(502).json({ error: message })
  }
})

router.get('/profiles/presets/:engine', async (req, res) => {
  try {
    assertSafeId(req.params.engine)
    sendProxyResult(res, await proxyJson(`/profiles/presets/${encodeURIComponent(req.params.engine)}`))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox presets 获取失败'
    res.status(400).json({ error: message })
  }
})

router.get('/profiles/:profileId/samples', async (req, res) => {
  try {
    assertSafeId(req.params.profileId)
    sendProxyResult(res, await proxyJson(`/profiles/${encodeURIComponent(req.params.profileId)}/samples`))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox samples 获取失败'
    res.status(400).json({ error: message })
  }
})

router.post('/profiles/:profileId/samples', async (req, res) => {
  try {
    assertSafeId(req.params.profileId)
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) return res.status(400).json({ error: '需要 multipart/form-data' })
    const response = await fetch(`${baseUrl()}/profiles/${encodeURIComponent(req.params.profileId)}/samples`, {
      method: 'POST',
      headers: upstreamHeaders({ 'Content-Type': contentType }),
      body: await collectRequestBody(req),
    })
    if (!response.ok) return res.status(response.status).json({ error: await readVoiceboxError(response) })
    res.status(response.status).json(await response.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox sample 上传失败'
    res.status(502).json({ error: message })
  }
})

router.post('/generate', async (req, res) => {
  try {
    sendProxyResult(res, await proxyJson('/generate', {
      method: 'POST',
      headers: upstreamHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req.body),
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 生成请求失败'
    res.status(502).json({ error: message })
  }
})

router.get('/generate/:generationId/status', async (req, res) => {
  try {
    assertSafeId(req.params.generationId)
    sendProxyResult(res, await proxyJson(`/generate/${encodeURIComponent(req.params.generationId)}/status`))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 状态获取失败'
    res.status(400).json({ error: message })
  }
})

async function streamAudio(res: ExpressResponse, path: string, range?: string) {
  const headers: Record<string, string> = {}
  if (range) headers.Range = range
  const response = await fetch(`${baseUrl()}${path}`, { headers: upstreamHeaders(headers) })
  if (!response.ok) return res.status(response.status).json({ error: await readVoiceboxError(response) })
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(header)
    if (value) res.setHeader(header, value)
  }
  res.status(response.status)
  if (!response.body) return res.end()
  for await (const chunk of response.body) res.write(chunk)
  return res.end()
}

router.get('/audio/:generationId', async (req, res) => {
  try {
    assertSafeId(req.params.generationId)
    await streamAudio(res, `/audio/${encodeURIComponent(req.params.generationId)}`, req.headers.range)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 音频获取失败'
    res.status(400).json({ error: message })
  }
})

router.get('/samples/:sampleId', async (req, res) => {
  try {
    assertSafeId(req.params.sampleId)
    await streamAudio(res, `/samples/${encodeURIComponent(req.params.sampleId)}`, req.headers.range)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 样本音频获取失败'
    res.status(400).json({ error: message })
  }
})

export default router
