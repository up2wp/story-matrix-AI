import { randomUUID } from 'crypto'
import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { createImagegenReferenceAssetRouter } from './imagegen-reference-assets.js'
import { defaultImageGenerationConfig, normalizeImageGenerationConfig, type ImageGenerationConfig, type ImageGenerationModelConfig, type ImageGenerationProviderConfig } from '../services/image-generation-config.js'
import { createImageGenerationFailureRecord } from '../services/image-generation-failures.js'
import { extensionForMime, immichClientFromConfig, readLocalImageAsset, resolveRunnableImageGenerationModel, runImageGeneration, type ImageAssetVariant, type ImageGenerationRunnerOutput } from '../services/image-generation-runner.js'
import { resolveImagegenReferenceSelection } from '../services/imagegen-reference-selection.js'
import { createImagegenHistoryRecord, getImagegenHistoryRecord, listImagegenHistory, type ImagegenHistoryRecord, type ImagegenStorageMode } from '../services/imagegen-history.js'

const router = Router()
const MAX_TEST_PROMPT_LENGTH = 8000
const ALLOWED_GENERATE_FIELDS = new Set(['prompt', 'modelId', 'size', 'quality', 'format', 'aspectRatio', 'n', 'referenceImageIds'])

type FeatureGrant = { readonly userId: string; readonly features?: readonly string[] }

type ResolvedImagegenRun = {
  readonly ownerId: string
  readonly prompt: string
  readonly referenceImageIds: readonly string[]
  readonly config: ImageGenerationConfig
  readonly provider: ImageGenerationProviderConfig
  readonly model: ImageGenerationModelConfig
}

type ImagegenFailureRecordInput = ResolvedImagegenRun & { readonly error: unknown }

type ImagegenSuccessRecordInput = ResolvedImagegenRun & { readonly image: ImageGenerationRunnerOutput['image'] }

function loadImageGenerationConfig(): ImageGenerationConfig {
  const row = db.prepare('SELECT imageGenerationConfig FROM systemConfig WHERE id = ?').get('singleton') as { imageGenerationConfig?: string } | undefined
  return normalizeImageGenerationConfig(row?.imageGenerationConfig ? JSON.parse(row.imageGenerationConfig) : defaultImageGenerationConfig())
}

function isFeatureGrant(value: unknown): value is FeatureGrant {
  return typeof value === 'object'
    && value !== null
    && 'userId' in value
    && typeof value.userId === 'string'
    && (!('features' in value) || Array.isArray(value.features))
}

function loadFeaturePermissions(): readonly FeatureGrant[] {
  const row = db.prepare('SELECT novelImportConfig FROM systemConfig WHERE id = ?').get('singleton') as { novelImportConfig?: string } | undefined
  const parsed: unknown = row?.novelImportConfig ? JSON.parse(row.novelImportConfig) : undefined
  if (typeof parsed !== 'object' || parsed === null || !('featurePermissions' in parsed)) return []
  const featurePermissions = parsed.featurePermissions
  if (typeof featurePermissions !== 'object' || featurePermissions === null || !('userGrants' in featurePermissions)) return []
  return Array.isArray(featurePermissions.userGrants) ? featurePermissions.userGrants.filter(isFeatureGrant) : []
}

function canUseImageGeneration(request: AuthenticatedRequest, config: ImageGenerationConfig) {
  const user = request.currentUser
  if (!user || !config.enabled) return false
  if (user.role === 'owner' || user.role === 'admin') return true
  return loadFeaturePermissions().some(grant => grant.userId === user.id && grant.features?.includes('imageGeneration'))
}

function unsupportedGenerateFields(body: Record<string, unknown>) {
  return Object.keys(body).filter(key => !ALLOWED_GENERATE_FIELDS.has(key))
}

function testPrompt(body: Record<string, unknown>) {
  if (typeof body.prompt !== 'string') return { ok: false, statusCode: 400, error: '缺少测试提示词' } as const
  const prompt = body.prompt.trim()
  if (!prompt) return { ok: false, statusCode: 400, error: '缺少测试提示词' } as const
  if (prompt.length > MAX_TEST_PROMPT_LENGTH) return { ok: false, statusCode: 400, error: '测试提示词过长' } as const
  return { ok: true, prompt } as const
}

function generationOptions(body: Record<string, unknown>): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  for (const key of ['size', 'quality', 'format', 'aspectRatio', 'n']) {
    if (body[key] !== undefined) options[key] = body[key]
  }
  return options
}

function slugPart(value: string | undefined, fallback: string) {
  const normalized = String(value || fallback).trim().replace(/\s+/g, '-').replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '').slice(0, 48)
  return normalized || fallback
}

function testImmichFilename(ownerId: string, prompt: string, projectName: string | undefined, mimeType: string) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return [
    slugPart(projectName || 'story-matrix', 'story-matrix'),
    slugPart(ownerId, 'user'),
    'imagegen-test',
    slugPart(prompt, 'prompt'),
    timestamp,
    randomUUID().slice(0, 8),
  ].join('-') + `.${extensionForMime(mimeType)}`
}

function imagegenAssetUrl(assetId: string, variant?: ImageAssetVariant) { const encoded = encodeURIComponent(assetId); return variant ? `/api/imagegen/assets/${encoded}/${variant}` : `/api/imagegen/assets/${encoded}` }

function storageMode(config: ImageGenerationConfig): ImagegenStorageMode { return config.storageMode === 'immich' ? 'immich' : 'local' }

function sensitiveValues(config: ImageGenerationConfig) {
  const providerValues = config.providers.flatMap(provider => [provider.apiKey, provider.baseUrl])
  return Array.from(new Set([...providerValues, config.immich.apiKey, config.immich.serviceUrl].filter((value): value is string => Boolean(value))))
}

function safeErrorMessage(error: unknown, fallback: string, config: ImageGenerationConfig) {
  const raw = error instanceof Error ? error.message : fallback
  const sanitized = sensitiveValues(config).reduce((message, value) => message.replaceAll(value, '[redacted]'), raw).trim()
  return (sanitized || fallback).slice(0, 500)
}

function createSuccessHistoryRecord(input: ImagegenSuccessRecordInput) {
  const image = input.image
  const recordId = image.localAssetId || image.id
  return createImagegenHistoryRecord({
    id: recordId,
    ownerId: input.ownerId,
    prompt: input.prompt,
    generationPromptSnapshot: input.prompt,
    referenceImageIds: input.referenceImageIds,
    provider: image.provider,
    providerLabel: input.provider.label,
    modelId: image.modelId,
    modelName: image.modelName,
    mimeType: image.mimeType,
    storageMode: image.storageMode,
    storageStatus: image.storageStatus,
    status: image.status,
    localAssetId: image.localAssetId,
    immichAssetId: image.immichAssetId,
    immichFilename: image.immichFilename,
    thumbnailUrl: image.thumbnailUrl || image.assetUrl,
    originalUrl: image.originalUrl || image.assetUrl,
    error: image.error ? safeErrorMessage(image.error, '图片存储失败', input.config) : undefined,
  })
}

function createFailureHistoryRecord(input: ImagegenFailureRecordInput) {
  return createImagegenHistoryRecord({
    ownerId: input.ownerId,
    prompt: input.prompt,
    generationPromptSnapshot: input.prompt,
    referenceImageIds: input.referenceImageIds,
    provider: input.model.provider,
    providerLabel: input.provider.label,
    modelId: input.model.id,
    modelName: input.model.label,
    storageMode: storageMode(input.config),
    storageStatus: 'failed',
    status: 'failed',
    error: safeErrorMessage(input.error, '测试生图失败', input.config),
  })
}

function serializeHistory(record: ImagegenHistoryRecord) {
  return {
    id: record.id,
    prompt: record.prompt,
    generationPromptSnapshot: record.generationPromptSnapshot,
    provider: record.provider,
    providerLabel: record.providerLabel,
    modelId: record.modelId,
    modelName: record.modelName,
    mimeType: record.mimeType,
    storageMode: record.storageMode,
    storageStatus: record.storageStatus,
    status: record.status,
    localAssetId: record.localAssetId,
    immichAssetId: record.immichAssetId,
    immichFilename: record.immichFilename,
    thumbnailUrl: record.thumbnailUrl,
    originalUrl: record.originalUrl,
    referenceImageIds: record.referenceImageIds,
    error: record.error,
    createdAt: record.createdAt,
  }
}

function imageVariant(value: string | undefined): ImageAssetVariant { return value === 'original' ? 'original' : 'thumbnail' }

router.use('/reference-assets', createImagegenReferenceAssetRouter({ loadImageGenerationConfig, canUseImageGeneration, safeErrorMessage }))

router.get('/history', (req, res) => {
  const request = req as AuthenticatedRequest
  res.json(listImagegenHistory(request.currentUser.id).map(serializeHistory))
})

router.post('/generate', async (req, res) => {
  const request = req as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const unsupportedFields = unsupportedGenerateFields(body)
  if (unsupportedFields.length > 0) return res.status(400).json({ error: '测试生图请求不支持作品上下文字段' })
  const parsedPrompt = testPrompt(body)
  if (!parsedPrompt.ok) return res.status(parsedPrompt.statusCode).json({ error: parsedPrompt.error })

  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const modelId = typeof body.modelId === 'string' && body.modelId.trim() ? body.modelId.trim() : config.defaultModelId
  const resolved = resolveRunnableImageGenerationModel(config, modelId)
  if (!resolved.ok) return res.status(resolved.statusCode).json({ error: resolved.error })
  const referenceSelection = await resolveImagegenReferenceSelection({ value: body.referenceImageIds, ownerId: request.currentUser.id, config, model: resolved.model })
  if (!referenceSelection.ok) return res.status(referenceSelection.statusCode).json({ error: referenceSelection.error })
  const runContext: ResolvedImagegenRun = { ownerId: request.currentUser.id, prompt: parsedPrompt.prompt, referenceImageIds: referenceSelection.ids, config, provider: resolved.provider, model: resolved.model }

  try {
    const result = await runImageGeneration({
      config,
      provider: resolved.provider,
      model: resolved.model,
      providerPrompt: parsedPrompt.prompt,
      requestBody: generationOptions(body),
      referenceImages: referenceSelection.images,
      promptSnapshot: { basePromptSnapshot: parsedPrompt.prompt, generationPromptSnapshot: parsedPrompt.prompt, referenceImageIds: referenceSelection.ids },
      storage: {
        localScopeId: request.currentUser.id,
        localAssetNamespace: 'imagegen',
        publicAssetUrl: imagegenAssetUrl,
        immichFilename: mimeType => testImmichFilename(request.currentUser.id, parsedPrompt.prompt, config.immich?.projectName, mimeType),
      },
    })
    const record = createSuccessHistoryRecord({ ...runContext, image: result.image })
    return res.status(result.httpStatus).json(serializeHistory(record))
  } catch (error) {
    createImageGenerationFailureRecord({
      surface: 'imagegen',
      ownerId: runContext.ownerId,
      prompt: runContext.prompt,
      generationPromptSnapshot: runContext.prompt,
      referenceImageIds: runContext.referenceImageIds,
      provider: runContext.model.provider,
      providerLabel: runContext.provider.label,
      modelId: runContext.model.id,
      modelName: runContext.model.label,
      storageMode: storageMode(runContext.config),
      error,
      config: runContext.config,
    })
    const record = createFailureHistoryRecord({ ...runContext, error })
    return res.status(502).json(serializeHistory(record))
  }
})

router.get('/assets/:recordId', (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const record = getImagegenHistoryRecord(request.currentUser.id, req.params.recordId)
  if (!record) return res.status(404).json({ error: '图片记录不存在' })
  const assetId = record.localAssetId || (record.storageMode === 'local' ? record.id : undefined)
  if (!assetId) return res.status(404).json({ error: '本地图片定位信息不存在' })
  try {
    const local = readLocalImageAsset(request.currentUser.id, assetId, 'imagegen')
    res.setHeader('Content-Type', local.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.end(local.buffer)
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : '图片不存在' })
  }
})

router.get('/assets/:recordId/:variant', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const record = getImagegenHistoryRecord(request.currentUser.id, req.params.recordId)
  if (!record) return res.status(404).json({ error: '图片记录不存在' })
  const localAssetId = record.localAssetId || (record.storageMode === 'local' ? record.id : undefined)
  if (localAssetId) {
    try {
      const local = readLocalImageAsset(request.currentUser.id, localAssetId, 'imagegen')
      res.setHeader('Content-Type', local.mimeType)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      return res.end(local.buffer)
    } catch (error) {
      return res.status(404).json({ error: error instanceof Error ? error.message : '图片不存在' })
    }
  }

  const config = loadImageGenerationConfig()
  try {
    const client = immichClientFromConfig(config)
    let assetId = record.immichAssetId
    if (!assetId && record.immichFilename) {
      const matches = (await client.searchByFilename(record.immichFilename)).filter(item => item.originalFileName === record.immichFilename || item.originalPath?.endsWith(record.immichFilename || ''))
      if (matches.length !== 1) return res.status(404).json({ error: 'Immich 文件名兜底未命中唯一资产' })
      assetId = matches[0]?.id
    }
    if (!assetId) return res.status(404).json({ error: 'Immich asset id 缺失' })
    const bytes = await client.fetchAssetBytes(assetId, imageVariant(req.params.variant))
    res.setHeader('Content-Type', bytes.contentType)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.end(bytes.buffer)
  } catch (error) {
    return res.status(502).json({ error: safeErrorMessage(error, 'Immich 图片读取失败', config) })
  }
})

export default router
