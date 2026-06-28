import { Router } from 'express'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSET_DIR = path.join(__dirname, '..', '..', 'data', 'image-assets')
const IMAGE_UPSTREAM_TIMEOUT_MS = 360000
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

interface AIConfigPayload {
  apiKey?: string
  baseUrl?: string
  model?: string
  maxTokens?: number
}

interface ImageModelConfig {
  id: string
  label: string
  provider: 'openai' | 'custom'
  baseUrl: string
  apiKey?: string
  model: string
  enabled: boolean
  capabilities?: { sizes?: string[]; qualities?: string[]; formats?: string[] }
}

interface ImageGenerationConfig {
  enabled: boolean
  defaultModelId: string
  models: ImageModelConfig[]
}

interface WorkRow {
  id: string
  ownerId: string
  shared: number
  data: string
}

function loadImageGenerationConfig(): ImageGenerationConfig {
  const row = db.prepare('SELECT imageGenerationConfig FROM systemConfig WHERE id = ?').get('singleton') as { imageGenerationConfig?: string } | undefined
  return row?.imageGenerationConfig ? JSON.parse(row.imageGenerationConfig) : { enabled: false, defaultModelId: '', models: [] }
}

function loadSystemAIConfig(): AIConfigPayload | null {
  const row = db.prepare('SELECT aiConfig FROM systemConfig WHERE id = ?').get('singleton') as { aiConfig?: string } | undefined
  return row?.aiConfig ? JSON.parse(row.aiConfig) : null
}

function loadFeaturePermissions() {
  const row = db.prepare('SELECT novelImportConfig FROM systemConfig WHERE id = ?').get('singleton') as { novelImportConfig?: string } | undefined
  const config = row?.novelImportConfig ? JSON.parse(row.novelImportConfig) : { enabled: false, featurePermissions: { userGrants: [] } }
  return Array.isArray(config?.featurePermissions?.userGrants) ? config.featurePermissions.userGrants as Array<{ userId: string; features: string[] }> : []
}

function canUseImageGeneration(req: AuthenticatedRequest, config: ImageGenerationConfig) {
  const user = req.currentUser
  if (!user || !config.enabled) return false
  if (user.role === 'owner' || user.role === 'admin') return true
  return loadFeaturePermissions().some(grant => grant.userId === user.id && grant.features?.includes('imageGeneration'))
}

function normalizeBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'https:') throw new Error('生图 Provider 地址必须使用 HTTPS')
  if (isUnsafeHostname(parsed.hostname)) throw new Error('生图 Provider 地址不能指向本机、内网或保留地址')
  return parsed.toString().replace(/\/+$/, '')
}

function isUnsafeHostname(hostname: string) {
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

function safeGenerationOptions(body: Record<string, unknown>, model: ImageModelConfig) {
  const options: Record<string, string | number> = {}
  const capabilities = model.capabilities || {}
  if (typeof body.size === 'string' && capabilities.sizes?.includes(body.size)) options.size = body.size
  if (typeof body.quality === 'string' && capabilities.qualities?.includes(body.quality)) options.quality = body.quality
  if (typeof body.format === 'string' && capabilities.formats?.includes(body.format)) options.output_format = body.format
  if (typeof body.n === 'number' && body.n > 0 && body.n <= 4) options.n = Math.floor(body.n)
  return options
}

async function readProviderError(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return response.statusText
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message || parsed.message || text
  } catch {
    return text
  }
}

function providerHeaders(apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

async function generateTextPrompt(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const aiConfig = loadSystemAIConfig()
  if (!aiConfig?.apiKey || !aiConfig.model) throw new Error('请先在系统管理中配置 AI')
  const response = await fetch(`${(aiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: providerHeaders(aiConfig.apiKey),
    body: JSON.stringify({ model: aiConfig.model, messages, stream: false, max_tokens: Math.min(aiConfig.maxTokens || 1200, 1200), temperature: 0.7 }),
  })
  if (!response.ok) throw new Error(await readProviderError(response))
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('AI 没有返回可用提示词')
  return text
}

function workAccess(req: AuthenticatedRequest, workId: string, requireOwner: boolean) {
  const row = db.prepare('SELECT * FROM works WHERE id = ?').get(workId) as WorkRow | undefined
  if (!row) return { status: 404, error: '作品不存在' } as const
  const user = req.currentUser
  const canAccess = row.ownerId === user.id || user.role === 'owner' || user.role === 'admin' || Boolean(row.shared)
  if (!canAccess) return { status: 403, error: '无权查看该作品' } as const
  if (requireOwner && row.ownerId !== user.id) return { status: 403, error: '无权修改该作品' } as const
  return { status: 200, row } as const
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function detectMime(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  throw new Error('Provider 返回的内容不是受支持的图片格式')
}

function saveImageAsset(workId: string, buffer: Buffer) {
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('图片为空或超过大小限制')
  const mimeType = detectMime(buffer)
  const id = randomUUID()
  const workDir = path.join(ASSET_DIR, workId)
  fs.mkdirSync(workDir, { recursive: true })
  const filePath = path.join(workDir, `${id}.${extensionForMime(mimeType)}`)
  fs.writeFileSync(filePath, buffer)
  return { id, mimeType, assetUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}` }
}

async function bufferFromUrl(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Provider 图片 URL 必须使用 HTTPS')
  if (isUnsafeHostname(parsed.hostname)) throw new Error('Provider 图片 URL 不能指向本机、内网或保留地址')
  const response = await fetch(parsed, { redirect: 'error' })
  if (!response.ok) throw new Error(await readProviderError(response))
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) throw new Error('Provider URL 返回的不是图片')
  const buffer = Buffer.from(await response.arrayBuffer())
  return buffer
}

async function normalizeProviderImage(item: { b64_json?: string; url?: string }) {
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64')
  if (item.url) return bufferFromUrl(item.url)
  throw new Error('Provider 未返回可用图片')
}

router.post('/generate', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const workId = String(body.workId || '')
  const prompt = String(body.prompt || '').trim()
  if (!workId || !prompt) return res.status(400).json({ error: '缺少作品或提示词' })
  if (prompt.length > 8000) return res.status(400).json({ error: '提示词过长' })

  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const access = workAccess(request, workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  const model = config.models.find(item => item.id === String(body.modelId || config.defaultModelId) && item.enabled)
  if (!model) return res.status(400).json({ error: '生图模型不可用' })
  if (!model.apiKey) return res.status(400).json({ error: '生图模型未配置 API Key' })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_UPSTREAM_TIMEOUT_MS)
  try {
    const response = await fetch(`${normalizeBaseUrl(model.baseUrl)}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify({ model: model.model, prompt, response_format: 'b64_json', ...safeGenerationOptions(body, model) }),
      signal: controller.signal,
    })
    if (!response.ok) return res.status(response.status).json({ error: await readProviderError(response) })
    const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
    const first = data.data?.[0]
    if (!first) return res.status(502).json({ error: 'Provider 未返回图片' })
    const buffer = await normalizeProviderImage(first)
    const saved = saveImageAsset(workId, buffer)
    res.json({ ...saved, modelId: model.id, modelName: model.model, provider: model.provider })
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? '生图上游请求超时' : error instanceof Error ? error.message : '生图请求失败'
    res.status(502).json({ error: message })
  } finally {
    clearTimeout(timeoutId)
  }
})

router.post('/prompt', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const workId = String(body.workId || '')
  const instruction = String(body.instruction || '').trim()
  const context = String(body.context || '').trim()
  if (!workId || !instruction || !context) return res.status(400).json({ error: '缺少作品、任务或上下文' })
  if (context.length > 5000 || instruction.length > 3000) return res.status(400).json({ error: '提示词上下文过长' })
  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const access = workAccess(request, workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  try {
    const prompt = await generateTextPrompt([
      { role: 'system', content: String(body.systemPrompt || '你是小说视觉设定提示词助手。') },
      { role: 'user', content: `${instruction}\n\n${context}` },
    ])
    res.json({ prompt })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : '视觉提示词生成失败' })
  }
})

router.get('/assets/:workId/:assetId', (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const access = workAccess(request, req.params.workId, false)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  if (!/^[a-f0-9-]{36}$/i.test(req.params.assetId)) return res.status(400).json({ error: '图片 ID 无效' })
  const workDir = path.join(ASSET_DIR, req.params.workId)
  const files = fs.existsSync(workDir) ? fs.readdirSync(workDir) : []
  const fileName = files.find(file => file.startsWith(`${req.params.assetId}.`))
  if (!fileName) return res.status(404).json({ error: '图片不存在' })
  const filePath = path.join(workDir, fileName)
  const buffer = fs.readFileSync(filePath)
  res.setHeader('Content-Type', detectMime(buffer))
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.end(buffer)
})

export default router
