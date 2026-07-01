import { Router } from 'express'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { ImmichClient } from '../services/immich-client.js'
import {
  defaultImageGenerationConfig,
  normalizeImageGenerationConfig,
  resolveEnabledImageModel,
  type ImageGenerationConfig,
  type ImageGenerationModelConfig,
  type ImageGenerationProviderConfig,
} from '../services/image-generation-config.js'
import { discoverProviderModels, generateProviderImages, type ProviderReferenceImage } from '../services/image-providers.js'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSET_DIR = path.join(__dirname, '..', '..', 'data', 'image-assets')
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const IMMICH_UPLOAD_RETRY_LIMIT = 3

interface AIConfigPayload {
  apiKey?: string
  baseUrl?: string
  model?: string
  maxTokens?: number
}

interface WorkRow {
  id: string
  ownerId: string
  shared: number
  data: string
}

interface ImageAssetRecord {
  id: string
  status?: string
  storageMode?: 'local' | 'immich'
  storageStatus?: string
  localAssetId?: string
  immichAssetId?: string
  immichFilename?: string
  assetUrl?: string
}

interface WorkData {
  seed?: { genre?: string; subGenre?: string }
  characters?: Array<{ id: string; name: string; tags?: string[] }>
  chapters?: Array<{ id: string; title: string; userDirection?: string; content?: string; scenes?: Array<{ title?: string; summary?: string; content?: string }> }>
  visualAssets?: { images?: Record<string, ImageAssetRecord> }
}

interface CandidateCharacterInput {
  name?: string
  evidence?: string
}

interface CandidateSubjectInput {
  label?: string
  description?: string
  characterName?: string
  evidence?: string
}

interface CandidateAIResponse {
  characters?: CandidateCharacterInput[]
  clothing?: CandidateSubjectInput[]
  props?: CandidateSubjectInput[]
}

type ImageViewDirection = 'front' | 'side' | 'back'

const CHAPTER_EXCERPT_LIMIT = 900
const VIEW_DIRECTION_SUFFIX: Record<ImageViewDirection, string> = {
  front: '生成角色设定用白色背景全身图，视角：正面。',
  side: '生成角色设定用白色背景全身图，视角：侧面。',
  back: '生成角色设定用白色背景全身图，视角：背面。',
}

function loadImageGenerationConfig(): ImageGenerationConfig {
  const row = db.prepare('SELECT imageGenerationConfig FROM systemConfig WHERE id = ?').get('singleton') as { imageGenerationConfig?: string } | undefined
  return normalizeImageGenerationConfig(row?.imageGenerationConfig ? JSON.parse(row.imageGenerationConfig) : defaultImageGenerationConfig())
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

function safeGenerationOptions(body: Record<string, unknown>, model: ImageGenerationModelConfig) {
  const options: Record<string, string | number> = {}
  const capabilities = model.capabilities || {}
  if (typeof body.size === 'string' && capabilities.sizes?.includes(body.size)) options.size = body.size
  if (typeof body.quality === 'string' && capabilities.qualities?.includes(body.quality)) options.quality = body.quality
  if (typeof body.format === 'string' && capabilities.formats?.includes(body.format)) options.format = body.format
  if (typeof body.aspectRatio === 'string' && capabilities.aspectRatios?.includes(body.aspectRatio)) options.aspect_ratio = body.aspectRatio
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
  return { id, mimeType, assetUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}`, thumbnailUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}`, originalUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}` }
}

function readLocalImageAsset(workId: string, assetId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(assetId)) throw new Error('图片 ID 无效')
  const workDir = path.join(ASSET_DIR, workId)
  const files = fs.existsSync(workDir) ? fs.readdirSync(workDir) : []
  const fileName = files.find(file => file.startsWith(`${assetId}.`))
  if (!fileName) throw new Error('图片不存在')
  const filePath = path.join(workDir, fileName)
  const buffer = fs.readFileSync(filePath)
  return { buffer, mimeType: detectMime(buffer), filePath }
}

function compact(value: string | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function buildChapterExcerpt(chapter: NonNullable<WorkData['chapters']>[number]) {
  const sceneText = (chapter.scenes || []).map(scene => compact(scene.summary || scene.content)).filter(Boolean).join('\n')
  if (sceneText) return sceneText.slice(0, CHAPTER_EXCERPT_LIMIT)
  const paragraphs = String(chapter.content || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map(compact).filter(Boolean)
  return paragraphs.slice(0, 3).join('\n').slice(0, CHAPTER_EXCERPT_LIMIT)
}

function buildChapterVisualCandidateContext(work: WorkData, chapterId: string) {
  const chapter = (work.chapters || []).find(item => item.id === chapterId)
  if (!chapter) throw new Error('章节不存在')
  const sceneSummary = (chapter.scenes || [])
    .map(scene => `${scene.title || '未命名'}：${compact(scene.summary || scene.content).slice(0, 180)}`)
    .filter(Boolean)
    .join(' / ')
  const characterIndex = (work.characters || []).map(character => `- id: ${character.id}; name: ${character.name}; tags: ${(character.tags || []).slice(0, 6).join('、') || '暂无'}`).join('\n') || '暂无'
  return [
    `作品类型：${work.seed?.genre || '暂无'}${work.seed?.subGenre ? ` / ${work.seed.subGenre}` : ''}`,
    `章节：${chapter.title}`,
    `用户方向：${compact(chapter.userDirection) || '暂无'}`,
    `场景摘要：${sceneSummary || '暂无'}`,
    `正文摘录：${buildChapterExcerpt(chapter) || '暂无'}`,
    `角色匹配索引（只包含 id、name、tags，不包含 bio 或整章正文）：\n${characterIndex}`,
  ].join('\n\n')
}

function buildChapterVisualCandidateInstruction(context: string) {
  return `任务：从当前章节小上下文中提取视觉候选，只输出严格 JSON，不要输出解释、Markdown 或额外文本。

JSON 结构必须完全符合：
{"characters":[{"name":"章节中出现的人名或称谓","evidence":"不超过40字的出现证据"}],"clothing":[{"label":"服饰名称","description":"可见材质、颜色、剪裁或状态","characterName":"关联角色名或空字符串","evidence":"不超过40字的章节证据"}],"props":[{"label":"道具名称","description":"可见材质、形状、尺寸或用途","characterName":"关联角色名或空字符串","evidence":"不超过40字的章节证据"}]}

要求：只使用上下文明确出现或场景摘要直接支持的视觉要素；不生成视觉提示词；不总结剧情；不返回章节正文或摘录；信息不足时返回空数组。

上下文：
${context}`
}

function parseCandidateJSON(text: string): CandidateAIResponse {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
  if (!candidate || candidate === trimmed.slice(0, 0)) throw new Error('候选提取结果格式无效')
  const parsed = JSON.parse(candidate) as CandidateAIResponse
  return {
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    clothing: Array.isArray(parsed.clothing) ? parsed.clothing : [],
    props: Array.isArray(parsed.props) ? parsed.props : [],
  }
}

function safeText(value: string | undefined, maxLength = 80) {
  return compact(value).slice(0, maxLength)
}

function mapCharacterName(work: WorkData, name: string | undefined) {
  const normalized = safeText(name).toLowerCase()
  if (!normalized) return undefined
  return (work.characters || []).find(character => {
    const names = [character.id, character.name, ...(character.tags || [])].map(item => String(item || '').trim().toLowerCase()).filter(Boolean)
    return names.includes(normalized) || names.some(item => normalized.includes(item) || item.includes(normalized))
  })
}

function candidateId(kind: 'clothing' | 'prop', label: string, index: number) {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36)
  return `${kind}:${slug || index + 1}`
}

function mapCandidateResponse(work: WorkData, response: CandidateAIResponse) {
  const seenCharacters = new Set<string>()
  const unmappedCharacters = new Set<string>()
  const characters = (response.characters || []).flatMap(item => {
    const matched = mapCharacterName(work, item.name)
    if (!matched) {
      const name = safeText(item.name, 40)
      if (name) unmappedCharacters.add(name)
      return []
    }
    if (seenCharacters.has(matched.id)) return []
    seenCharacters.add(matched.id)
    return [{ kind: 'character' as const, characterId: matched.id, name: matched.name, matchedName: safeText(item.name, 40) || matched.name, evidence: safeText(item.evidence, 60) }]
  })
  const mapSubjects = (items: CandidateSubjectInput[] | undefined, kind: 'clothing' | 'prop') => (items || []).map((item, index) => {
    const matched = mapCharacterName(work, item.characterName)
    const label = safeText(item.label, 60) || (kind === 'clothing' ? '未命名服饰' : '未命名道具')
    return { kind, id: candidateId(kind, label, index), label, description: safeText(item.description, 120), characterId: matched?.id, characterName: matched?.name, evidence: safeText(item.evidence, 60) }
  })
  return { characters, clothing: mapSubjects(response.clothing, 'clothing'), props: mapSubjects(response.props, 'prop'), unmappedCharacters: Array.from(unmappedCharacters) }
}

function normalizeReferenceImageIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 10)
}

function normalizeViewDirection(value: unknown) {
  return value === 'front' || value === 'side' || value === 'back' ? value : undefined
}

async function resolveReferenceImageBytes(workId: string, work: WorkData, imageId: string, config: ImageGenerationConfig) {
  const image = work.visualAssets?.images?.[imageId]
  if (!image) throw new Error('参考图不存在或不属于当前作品')
  if (image.status !== 'succeeded' || image.storageStatus !== 'succeeded') throw new Error('只能选择已成功生成并完成存储的参考图')
  if (image.storageMode === 'local') {
    const assetId = image.localAssetId || image.id
    return readLocalImageAsset(workId, assetId)
  }
  if (image.storageMode === 'immich') {
    if (!image.immichAssetId) throw new Error('参考图 Immich 定位信息不完整')
    const bytes = await immichClientFromConfig(config).fetchAssetBytes(image.immichAssetId, 'original')
    return { buffer: bytes.buffer, mimeType: bytes.contentType }
  }
  throw new Error('参考图定位信息不完整')
}

function deleteLocalStagedImageAsset(workId: string, assetId: string) {
  const local = readLocalImageAsset(workId, assetId)
  fs.unlinkSync(local.filePath)
}

function slugPart(value: string | undefined, fallback: string) {
  const normalized = String(value || fallback).trim().replace(/\s+/g, '-').replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '').slice(0, 48)
  return normalized || fallback
}

function promptTypeLabel(promptId: string) {
  const type = promptId.split(':')[0]
  if (type === 'chapterClothing') return 'chapter-clothing'
  if (type === 'chapterProp') return 'chapter-prop'
  if (type === 'characterFullBody') return 'character-full-body'
  if (type === 'chapterObject') return 'chapter-object-legacy'
  return 'character-face'
}

function buildImmichFilename(work: WorkRow, body: Record<string, unknown>, mimeType: string) {
  const data = JSON.parse(work.data) as { title?: string; chapters?: Array<{ id: string; title: string }>; characters?: Array<{ id: string; name: string }> }
  const promptId = String(body.promptId || '')
  const chapterId = String(body.chapterId || '')
  const characterId = String(body.characterId || '')
  const chapter = data.chapters?.find(item => item.id === chapterId)
  const character = data.characters?.find(item => item.id === characterId)
  const subject = chapter?.title || character?.name || 'visual'
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return [
    slugPart(String(body.immichProjectName || 'story-matrix'), 'story-matrix'),
    slugPart(work.ownerId, 'user'),
    slugPart(data.title || work.id, 'work'),
    slugPart(subject, 'asset'),
    promptTypeLabel(promptId),
    timestamp,
    randomUUID().slice(0, 8),
  ].join('-') + `.${extensionForMime(mimeType)}`
}

function immichClientFromConfig(config: ImageGenerationConfig) {
  const immich = config.immich
  if (!immich?.serviceUrl || !immich.apiKey || !immich.projectName) throw new Error('Immich 存储配置不完整')
  return new ImmichClient({ serviceUrl: immich.serviceUrl, apiKey: immich.apiKey, projectName: immich.projectName, allowPrivateNetwork: immich.allowPrivateNetwork })
}

async function uploadToImmichWithRetry(client: ImmichClient, buffer: Buffer, filename: string, mimeType: string, albumId: string) {
  let lastError: unknown
  for (let attempt = 0; attempt <= IMMICH_UPLOAD_RETRY_LIMIT; attempt += 1) {
    try {
      return await client.uploadImage({ buffer, filename, mimeType, albumId })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Immich 上传失败')
}

function providerFromDiscoveryDraft(body: Record<string, unknown>, existing: ImageGenerationConfig): ImageGenerationProviderConfig | null {
  const providerId = String(body.providerId || '').trim()
  const savedProvider = providerId ? existing.providers.find(provider => provider.id === providerId) : undefined
  const draft = typeof body.provider === 'object' && body.provider ? body.provider as Record<string, unknown> : undefined
  if (!draft) return savedProvider || null
  const normalized = normalizeImageGenerationConfig({ providers: [{ ...savedProvider, ...draft, id: providerId || draft.id || savedProvider?.id || 'draft-provider' }], models: [] })
  const provider = normalized.providers[0]
  if (provider.apiKey === '__server_configured__' && savedProvider?.apiKey) provider.apiKey = savedProvider.apiKey
  return provider
}

router.post('/providers/discover-models', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  if (!request.currentUser || !['owner', 'admin'].includes(request.currentUser.role)) return res.status(403).json({ error: '需要管理员权限' })
  try {
    const config = loadImageGenerationConfig()
    const provider = providerFromDiscoveryDraft(req.body as Record<string, unknown>, config)
    if (!provider) return res.status(400).json({ error: '缺少生图厂商配置' })
    const candidates = (await discoverProviderModels(provider)).map(candidate => ({
      providerModel: candidate.providerModel,
      label: candidate.label,
      capabilities: candidate.capabilities,
      source: candidate.source,
      requiresConfirmation: candidate.requiresConfirmation,
    }))
    res.json({ candidates })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '模型列表获取失败' })
  }
})

router.post('/extract-candidates', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const workId = String(body.workId || '')
  const chapterId = String(body.chapterId || '')
  if (!workId || !chapterId) return res.status(400).json({ error: '缺少作品或章节' })
  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const access = workAccess(request, workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  try {
    const work = JSON.parse(access.row.data) as WorkData
    const context = buildChapterVisualCandidateContext(work, chapterId)
    if (context.length > 5000) return res.status(400).json({ error: '候选提取上下文过长' })
    const rawText = await generateTextPrompt([
      { role: 'system', content: '你是小说章节视觉候选提取助手。你只输出严格 JSON。' },
      { role: 'user', content: buildChapterVisualCandidateInstruction(context) },
    ])
    res.json(mapCandidateResponse(work, parseCandidateJSON(rawText)))
  } catch {
    res.status(502).json({ characters: [], clothing: [], props: [], unmappedCharacters: [], error: '章节视觉候选提取失败，请稍后重试' })
  }
})

router.post('/generate', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const workId = String(body.workId || '')
  const prompt = String(body.prompt || '').trim()
  const referenceImageIds = normalizeReferenceImageIds(body.referenceImageIds)
  const viewDirection = normalizeViewDirection(body.viewDirection)
  if (!workId || !prompt) return res.status(400).json({ error: '缺少作品或提示词' })
  if (prompt.length > 8000) return res.status(400).json({ error: '提示词过长' })
  if (body.viewDirection !== undefined && !viewDirection) return res.status(400).json({ error: '视角方向无效' })

  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const access = workAccess(request, workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  const resolved = resolveEnabledImageModel(config, String(body.modelId || config.defaultModelId))
  if (!resolved) return res.status(400).json({ error: '生图模型不可用' })
  const { provider, model } = resolved
  if (!provider.apiKey) return res.status(400).json({ error: '生图厂商未配置 API Key' })

  try {
    const work = JSON.parse(access.row.data) as WorkData
    const maxReferenceImages = Math.min(3, model.capabilities.maxReferenceImages || 0)
    if (referenceImageIds.length > 0 && !model.capabilities.referenceImages) return res.status(400).json({ error: '该模型不支持参考图' })
    if (referenceImageIds.length > maxReferenceImages) return res.status(400).json({ error: `参考图最多选择 ${maxReferenceImages} 张` })
    const referenceImages: ProviderReferenceImage[] = []
    for (const imageId of referenceImageIds) referenceImages.push(await resolveReferenceImageBytes(workId, work, imageId, config))
    const generationPrompt = viewDirection ? `${prompt}\n${VIEW_DIRECTION_SUFFIX[viewDirection]}` : prompt
    const storageMode = config.storageMode === 'immich' ? 'immich' : 'local'
    const immichClient = storageMode === 'immich' ? immichClientFromConfig(config) : undefined
    if (immichClient) await immichClient.assertReadyForUpload()
    const generated = await generateProviderImages(provider, model, generationPrompt, { ...safeGenerationOptions(body, model), referenceImages })
    const buffer = generated[0].buffer
    const mimeType = detectMime(buffer)
    const snapshots = { basePromptSnapshot: prompt, generationPromptSnapshot: generationPrompt, viewDirection, referenceImageIds }
    if (storageMode === 'local') {
      const saved = saveImageAsset(workId, buffer)
      return res.json({ ...saved, localAssetId: saved.id, storageMode: 'local', storageStatus: 'succeeded', status: 'succeeded', modelId: model.id, modelName: model.model, provider: model.provider, ...snapshots })
    }
    const albumId = await immichClient!.ensureProjectAlbum()
    const filename = buildImmichFilename(access.row, { ...body, immichProjectName: config.immich?.projectName }, mimeType)
    try {
      const uploaded = await uploadToImmichWithRetry(immichClient!, buffer, filename, mimeType, albumId)
      const id = randomUUID()
      return res.json({
        id,
        mimeType,
        storageMode: 'immich',
        storageStatus: 'succeeded',
        status: 'succeeded',
        immichAssetId: uploaded.assetId,
        immichFilename: uploaded.filename,
        thumbnailUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}/thumbnail`,
        originalUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}/original`,
        modelId: model.id,
        modelName: model.model,
        provider: model.provider,
        ...snapshots,
      })
    } catch (uploadError) {
      const id = randomUUID()
      const fallback = saveImageAsset(workId, buffer)
      return res.status(202).json({
        id,
        mimeType,
        storageMode: 'immich',
        storageStatus: 'storageUploadFailed',
        status: 'storageUploadFailed',
        localAssetId: fallback.id,
        assetUrl: fallback.assetUrl,
        immichFilename: filename,
        thumbnailUrl: fallback.thumbnailUrl,
        originalUrl: fallback.originalUrl,
        modelId: model.id,
        modelName: model.model,
        provider: model.provider,
        ...snapshots,
        error: uploadError instanceof Error ? uploadError.message : 'Immich 上传失败，已保留可重试状态',
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '生图请求失败'
    res.status(502).json({ error: message })
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

router.post('/immich/health', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  if (!request.currentUser || !['owner', 'admin'].includes(request.currentUser.role)) return res.status(403).json({ error: '需要管理员权限' })
  try {
    const config = loadImageGenerationConfig()
    const client = immichClientFromConfig(config)
    await client.assertReadyForUpload()
    const albumId = await client.ensureProjectAlbum()
    res.json({ ok: true, albumId, projectName: config.immich?.projectName })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Immich 连接检查失败' })
  }
})

router.post('/assets/:workId/:assetId/retry-immich', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const access = workAccess(request, req.params.workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  const data = JSON.parse(access.row.data) as { visualAssets?: { images?: Record<string, ImageAssetRecord> } }
  const image = data.visualAssets?.images?.[req.params.assetId]
  if (!image || image.storageMode !== 'immich') return res.status(404).json({ error: 'Immich 图片记录不存在' })
  if (!image.localAssetId || !image.immichFilename) return res.status(400).json({ error: '图片缺少本地暂存引用，无法重传' })
  try {
    const config = loadImageGenerationConfig()
    const client = immichClientFromConfig(config)
    await client.assertReadyForUpload()
    const albumId = await client.ensureProjectAlbum()
    const local = readLocalImageAsset(req.params.workId, image.localAssetId)
    const uploaded = await uploadToImmichWithRetry(client, local.buffer, image.immichFilename, local.mimeType, albumId)
    deleteLocalStagedImageAsset(req.params.workId, image.localAssetId)
    res.json({
      storageMode: 'immich',
      storageStatus: 'succeeded',
      status: 'succeeded',
      immichAssetId: uploaded.assetId,
      immichFilename: uploaded.filename,
      localAssetId: undefined,
      assetUrl: undefined,
      thumbnailUrl: `/api/image-generation/assets/${encodeURIComponent(req.params.workId)}/${encodeURIComponent(req.params.assetId)}/thumbnail`,
      originalUrl: `/api/image-generation/assets/${encodeURIComponent(req.params.workId)}/${encodeURIComponent(req.params.assetId)}/original`,
      error: undefined,
    })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Immich 重传失败' })
  }
})

router.get('/assets/:workId/:assetId', (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const access = workAccess(request, req.params.workId, false)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  if (!/^[a-f0-9-]{36}$/i.test(req.params.assetId)) return res.status(400).json({ error: '图片 ID 无效' })
  const local = readLocalImageAsset(req.params.workId, req.params.assetId)
  res.setHeader('Content-Type', local.mimeType)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.end(local.buffer)
})

router.get('/assets/:workId/:assetId/:variant', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const access = workAccess(request, req.params.workId, false)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  const variant = req.params.variant === 'original' ? 'original' : 'thumbnail'
  const data = JSON.parse(access.row.data) as { visualAssets?: { images?: Record<string, ImageAssetRecord> } }
  const image = data.visualAssets?.images?.[req.params.assetId]
  if (!image) return res.status(404).json({ error: '图片记录不存在' })
  if (image.storageMode !== 'immich') return res.redirect(image.assetUrl || `/api/image-generation/assets/${encodeURIComponent(req.params.workId)}/${encodeURIComponent(image.localAssetId || image.id)}`)
  try {
    const config = loadImageGenerationConfig()
    const client = immichClientFromConfig(config)
    let assetId = image.immichAssetId
    if (!assetId && image.immichFilename) {
      const matches = (await client.searchByFilename(image.immichFilename)).filter(item => item.originalFileName === image.immichFilename || item.originalPath?.endsWith(image.immichFilename || ''))
      if (matches.length !== 1) return res.status(404).json({ error: 'Immich 文件名兜底未命中唯一资产' })
      assetId = matches[0].id
    }
    if (!assetId) return res.status(404).json({ error: 'Immich asset id 缺失' })
    const imageBytes = await client.fetchAssetBytes(assetId, variant)
    res.setHeader('Content-Type', imageBytes.contentType)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.end(imageBytes.buffer)
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Immich 图片读取失败' })
  }
})

export default router
