import { randomUUID } from 'crypto'
import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest, CurrentUser } from '../middleware/auth.js'
import { createImagegenReferenceAssetRouter } from './imagegen-reference-assets.js'
import type { ImageGenerationConfig, ImageGenerationModelConfig, ImageGenerationProviderConfig } from '../services/image-generation-config.js'
import type { ImmichClient, ImmichSharedLinkMetadata, ImmichSharedLinkResult } from '../services/immich-client.js'
import { imagegenHistoryRecordTriggeredAutoDisable } from '../services/image-generation-failures.js'
import { canUseImageGeneration as sharedCanUseImageGeneration, isImageGenerationAutoDisabled, loadImageGenerationConfig, recordImageGenerationFailureAndMaybeDisable } from '../services/image-generation-access.js'
import { extensionForMime, immichClientFromConfig, readLocalImageAsset, resolveRunnableImageGenerationModel, runImageGeneration, type ImageAssetVariant, type ImageGenerationRunnerOutput } from '../services/image-generation-runner.js'
import { parseGenerateRequest, persistGenerateReferenceImages, resolveGenerateReferenceInputs, type ParsedGenerateRequest, type ResolvedGenerateReferenceResult } from '../services/imagegen-generate-references.js'
import { createImagegenHistoryRecord, deleteImagegenHistoryRecord, deleteImagegenHistoryRecords, getImagegenHistoryRecord, listImagegenHistory, updateImagegenHistoryRecord, updateImagegenHistoryShare, type ImagegenHistoryRecord, type ImagegenStorageMode, type UpdateImagegenHistoryRecordInput } from '../services/imagegen-history.js'
import { listImagegenReferenceAssetsByIds, type ImagegenReferenceAssetRecord } from '../services/imagegen-reference-assets.js'

const router = Router()
const MAX_TEST_PROMPT_LENGTH = 8000
const MAX_HISTORY_DELETE_BATCH = 100
const DEFAULT_HISTORY_PAGE_SIZE = 10
const MAX_HISTORY_PAGE_SIZE = 100
const ALLOWED_GENERATE_FIELDS = new Set(['prompt', 'modelId', 'size', 'quality', 'format', 'aspectRatio', 'n', 'referenceInputs'])
const shareLocks = new Map<string, Promise<unknown>>()

type ResolvedImagegenRun = {
  readonly ownerId: string
  readonly user: CurrentUser
  readonly prompt: string
  readonly referenceImageIds: readonly string[]
  readonly config: ImageGenerationConfig
  readonly provider: ImageGenerationProviderConfig
  readonly model: ImageGenerationModelConfig
}

type ImagegenFailureRecordInput = ResolvedImagegenRun & { readonly error: unknown }

type ImagegenSuccessRecordInput = ResolvedImagegenRun & { readonly image: ImageGenerationRunnerOutput['image'] }

type PersistedGenerateReferences = { readonly ids: readonly string[]; readonly error?: unknown }

type ReadyImagegenReferenceSelection = Extract<ResolvedGenerateReferenceResult, { readonly ok: true }>

type QueuedImagegenRun = {
  readonly record: ImagegenHistoryRecord
  readonly runContext: ResolvedImagegenRun
  readonly referenceSelection: ReadyImagegenReferenceSelection
  readonly requestBody: Record<string, unknown>
}

function canUseImageGeneration(request: AuthenticatedRequest, config: ImageGenerationConfig) {
  return sharedCanUseImageGeneration(request.currentUser, config)
}

async function withShareLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = shareLocks.get(key) || Promise.resolve()
  const next = previous.catch(() => undefined).then(work)
  shareLocks.set(key, next)
  try {
    return await next
  } finally {
    if (shareLocks.get(key) === next) shareLocks.delete(key)
  }
}

async function resolveImmichShare(client: ImmichClient, assetId: string, metadata: ImmichSharedLinkMetadata | undefined): Promise<ImmichSharedLinkResult> {
  const existing = metadata && metadata.assetId === assetId ? await client.validateSharedLink(metadata) : undefined
  return existing || client.createSharedLink(assetId)
}

function metadataFromShare(result: ImmichSharedLinkResult): ImmichSharedLinkMetadata {
  return { id: result.id, assetId: result.assetId, expiresAt: result.expiresAt }
}

function sameShareMetadata(left: ImmichSharedLinkMetadata | undefined, right: ImmichSharedLinkMetadata) {
  return Boolean(left && left.id === right.id && left.assetId === right.assetId && left.expiresAt === right.expiresAt)
}

function assertShareableHistory(record: ImagegenHistoryRecord | null): asserts record is ImagegenHistoryRecord & { readonly immichAssetId: string } {
  if (!record) throw new Error('测试历史不存在')
  if (record.storageMode !== 'immich') throw new Error('只有 Immich 存储图片可以创建分享链接')
  if (record.status !== 'succeeded' || record.storageStatus !== 'succeeded') throw new Error('只有已成功存储的图片可以创建分享链接')
  if (!record.immichAssetId) throw new Error('图片缺少 Immich asset id，无法创建分享链接')
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

function testImmichDeviceAssetId(ownerId: string, prompt: string, projectName: string | undefined, mimeType: string) {
  return [
    slugPart(projectName || 'story-matrix', 'story-matrix'),
    slugPart(ownerId, 'user'),
    'imagegen-test',
    slugPart(prompt, 'prompt'),
    randomUUID(),
  ].join(':') + `.${extensionForMime(mimeType)}`
}

function referenceImmichFilename(ownerId: string, projectName: string | undefined, mimeType: string) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return [
    slugPart(projectName || 'story-matrix', 'story-matrix'),
    slugPart(ownerId, 'user'),
    'imagegen-reference',
    timestamp,
    randomUUID().slice(0, 8),
  ].join('-') + `.${extensionForMime(mimeType)}`
}

function referenceImmichDeviceAssetId(ownerId: string, projectName: string | undefined, mimeType: string) {
  return [
    slugPart(projectName || 'story-matrix', 'story-matrix'),
    slugPart(ownerId, 'user'),
    'imagegen-reference',
    randomUUID(),
  ].join(':') + `.${extensionForMime(mimeType)}`
}

function imagegenAssetUrl(assetId: string, variant?: ImageAssetVariant) { const encoded = encodeURIComponent(assetId); return variant ? `/api/imagegen/assets/${encoded}/${variant}` : `/api/imagegen/assets/${encoded}` }

function imagegenReferenceAssetUrl(assetId: string, variant?: ImageAssetVariant) { const encoded = encodeURIComponent(assetId); return variant ? `/api/imagegen/reference-assets/${encoded}/${variant}` : `/api/imagegen/reference-assets/${encoded}` }

function storageMode(config: ImageGenerationConfig): ImagegenStorageMode { return config.storageMode === 'immich' ? 'immich' : 'local' }

function sensitiveValues(config: ImageGenerationConfig) {
  const providerValues = config.providers.flatMap(provider => [provider.apiKey, provider.baseUrl])
  return Array.from(new Set([...providerValues, config.immich.apiKey, config.immich.serviceUrl, config.immich.publicBaseUrl].filter((value): value is string => Boolean(value))))
}

function safeErrorMessage(error: unknown, fallback: string, config: ImageGenerationConfig) {
  const raw = error instanceof Error ? error.message : fallback
  const sanitized = sensitiveValues(config).reduce((message, value) => message.replaceAll(value, '[redacted]'), raw).trim()
  return (sanitized || fallback).slice(0, 500)
}

function createSuccessHistoryRecord(input: ImagegenSuccessRecordInput): UpdateImagegenHistoryRecordInput {
  const image = input.image
  return {
    mimeType: image.mimeType,
    storageStatus: image.storageStatus,
    status: image.status,
    localAssetId: image.localAssetId,
    immichAssetId: image.immichAssetId,
    immichFilename: image.immichFilename,
    thumbnailUrl: image.thumbnailUrl || image.assetUrl,
    originalUrl: image.originalUrl || image.assetUrl,
    referenceImageIds: input.referenceImageIds,
    error: image.error ? safeErrorMessage(image.error, '图片存储失败', input.config) : undefined,
  }
}

function createFailureHistoryRecord(input: ImagegenFailureRecordInput): UpdateImagegenHistoryRecordInput {
  return {
    referenceImageIds: input.referenceImageIds,
    storageStatus: 'failed',
    status: 'failed',
    error: safeErrorMessage(input.error, '测试生图失败', input.config),
  }
}

function imagegenRunLogFields(recordId: string, input: ResolvedImagegenRun) {
  return {
    historyId: recordId,
    ownerId: input.ownerId,
    providerId: input.provider.id,
    providerType: input.provider.type,
    providerProtocol: input.provider.protocol,
    modelId: input.model.id,
    providerModel: input.model.providerModel || input.model.model,
    storageMode: storageMode(input.config),
    referenceImageCount: input.referenceImageIds.length,
  }
}

function serializeReferenceImage(record: ImagegenReferenceAssetRecord) {
  return {
    id: record.id,
    thumbnailUrl: record.thumbnailUrl,
    originalUrl: record.originalUrl,
  }
}

function referenceImagesForHistory(ownerId: string, history: readonly ImagegenHistoryRecord[]) {
  const ids = history.flatMap(record => record.referenceImageIds)
  return new Map(listImagegenReferenceAssetsByIds(ownerId, ids).map(record => [record.id, serializeReferenceImage(record)]))
}

function imagegenHistoryAutoDisableSignal(record: ImagegenHistoryRecord) {
  return isImageGenerationAutoDisabled(record.ownerId) && imagegenHistoryRecordTriggeredAutoDisable(record)
}

function serializeHistory(record: ImagegenHistoryRecord, referenceImagesById: Map<string, ReturnType<typeof serializeReferenceImage>> = new Map()) {
  const imageGenerationPermissionAutoDisabled = imagegenHistoryAutoDisableSignal(record)
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
    referenceImages: record.referenceImageIds.map(id => referenceImagesById.get(id)).filter((image): image is ReturnType<typeof serializeReferenceImage> => Boolean(image)),
    error: record.error,
    ...(imageGenerationPermissionAutoDisabled ? { imageGenerationPermissionAutoDisabled: true } : {}),
    createdAt: record.createdAt,
  }
}

function imageVariant(value: string | undefined): ImageAssetVariant { return value === 'original' ? 'original' : 'thumbnail' }

function parseHistoryDeleteIds(body: unknown) {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('ids' in body)) return { ok: false, statusCode: 400, error: '缺少要删除的测试历史 ID' } as const
  const ids = body.ids
  if (!Array.isArray(ids)) return { ok: false, statusCode: 400, error: '测试历史 ID 必须是数组' } as const
  const uniqueIds = Array.from(new Set(ids.map(id => typeof id === 'string' ? id.trim() : '').filter(Boolean)))
  if (uniqueIds.length === 0) return { ok: false, statusCode: 400, error: '缺少要删除的测试历史 ID' } as const
  if (uniqueIds.length > MAX_HISTORY_DELETE_BATCH) return { ok: false, statusCode: 400, error: `单次最多删除 ${MAX_HISTORY_DELETE_BATCH} 条测试历史` } as const
  return { ok: true, ids: uniqueIds } as const
}

function positiveInteger(value: unknown): number {
  const num = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isInteger(num) && num > 0 ? num : 1
}

function historyPageSize(value: unknown): number {
  const num = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isInteger(num) || num <= 0) return DEFAULT_HISTORY_PAGE_SIZE
  return Math.min(num, MAX_HISTORY_PAGE_SIZE)
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function timestampQuery(value: unknown): number | undefined {
  const num = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(num) ? num : undefined
}

function parseHistoryQuery(query: { readonly [key: string]: unknown }) {
  return {
    page: positiveInteger(query.page),
    pageSize: historyPageSize(query.pageSize),
    prompt: stringQuery(query.prompt),
    createdFrom: timestampQuery(query.createdFrom),
    createdTo: timestampQuery(query.createdTo),
  }
}

async function queueImagegenRun(request: AuthenticatedRequest, parsedRequest: ParsedGenerateRequest) {
  const body = parsedRequest.body
  const unsupportedFields = unsupportedGenerateFields(body)
  if (unsupportedFields.length > 0) return { ok: false, statusCode: 400, error: '测试生图请求不支持作品上下文字段' } as const
  const parsedPrompt = testPrompt(body)
  if (!parsedPrompt.ok) return { ok: false, statusCode: parsedPrompt.statusCode, error: parsedPrompt.error } as const

  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return { ok: false, statusCode: 403, error: '未授权使用生图功能' } as const
  const modelId = typeof body.modelId === 'string' && body.modelId.trim() ? body.modelId.trim() : config.defaultModelId
  const resolved = resolveRunnableImageGenerationModel(config, modelId)
  if (!resolved.ok) return { ok: false, statusCode: resolved.statusCode, error: resolved.error } as const
  const referenceSelection = await resolveGenerateReferenceInputs({ value: body.referenceInputs, files: parsedRequest.files, ownerId: request.currentUser.id, config, model: resolved.model })
  if (!referenceSelection.ok) return { ok: false, statusCode: referenceSelection.statusCode, error: referenceSelection.error } as const
  const runContext: ResolvedImagegenRun = { ownerId: request.currentUser.id, user: request.currentUser, prompt: parsedPrompt.prompt, referenceImageIds: referenceSelection.ids, config, provider: resolved.provider, model: resolved.model }
  const record = createImagegenHistoryRecord({
    ownerId: runContext.ownerId,
    prompt: runContext.prompt,
    generationPromptSnapshot: runContext.prompt,
    referenceImageIds: runContext.referenceImageIds,
    provider: runContext.model.provider,
    providerLabel: runContext.provider.label,
    modelId: runContext.model.id,
    modelName: runContext.model.label,
    storageMode: storageMode(runContext.config),
    storageStatus: 'generating',
    status: 'generating',
  })
  const queued: QueuedImagegenRun = { record, runContext, referenceSelection, requestBody: generationOptions(body) }
  setImmediate(() => {
    void completeImagegenRun(queued)
  })
  return { ok: true, statusCode: 202, record } as const
}

async function completeImagegenRun(queued: QueuedImagegenRun) {
  const { record, runContext, referenceSelection, requestBody } = queued
  const recordId = record.id
  console.info('[image-generation] imagegen run start', imagegenRunLogFields(recordId, runContext))
  try {
    const result = await runImageGeneration({
      config: runContext.config,
      provider: runContext.provider,
      model: runContext.model,
      providerPrompt: runContext.prompt,
      requestBody,
      referenceImages: referenceSelection.images,
      promptSnapshot: { basePromptSnapshot: runContext.prompt, generationPromptSnapshot: runContext.prompt, referenceImageIds: referenceSelection.ids },
      traceId: recordId,
      storage: {
        localScopeId: runContext.ownerId,
        localAssetNamespace: 'imagegen',
        publicAssetUrl: (_assetId, variant) => imagegenAssetUrl(recordId, variant),
        immichFilename: mimeType => testImmichFilename(runContext.ownerId, runContext.prompt, runContext.config.immich?.projectName, mimeType),
        immichDeviceAssetId: mimeType => testImmichDeviceAssetId(runContext.ownerId, runContext.prompt, runContext.config.immich?.projectName, mimeType),
      },
    })
    const finalReferences: PersistedGenerateReferences = await persistGenerateReferenceImages(referenceSelection.slots, {
      ownerId: runContext.ownerId,
      config: runContext.config,
      publicAssetUrl: imagegenReferenceAssetUrl,
      immichFilename: mimeType => referenceImmichFilename(runContext.ownerId, runContext.config.immich?.projectName, mimeType),
      immichDeviceAssetId: mimeType => referenceImmichDeviceAssetId(runContext.ownerId, runContext.config.immich?.projectName, mimeType),
    }).catch(error => ({ ids: referenceSelection.ids, error } as const))
    const image = finalReferences.error
      ? { ...result.image, error: safeErrorMessage(finalReferences.error, '参考图持久化失败', runContext.config) }
      : result.image
    const terminalRecord = createSuccessHistoryRecord({ ...runContext, referenceImageIds: finalReferences.ids, image })
    console.info('[image-generation] imagegen run provider result persisted', {
      ...imagegenRunLogFields(recordId, runContext),
      storageStatus: image.storageStatus,
      status: image.status,
      referenceImageCount: finalReferences.ids.length,
    })
    if (image.storageStatus === 'storageUploadFailed') {
      db.transaction(() => {
        recordImageGenerationFailureAndMaybeDisable({
          id: recordId,
          surface: 'imagegen',
          ownerId: runContext.ownerId,
          prompt: runContext.prompt,
          generationPromptSnapshot: runContext.prompt,
          referenceImageIds: finalReferences.ids,
          provider: runContext.model.provider,
          providerLabel: runContext.provider.label,
          modelId: runContext.model.id,
          modelName: runContext.model.label,
          storageMode: 'immich',
          error: new Error(image.error || '图片存储失败'),
          config: runContext.config,
          user: runContext.user,
          countEligible: runContext.user.role === 'user',
          failureType: 'storage',
        }, db)
        updateImagegenHistoryRecord(runContext.ownerId, recordId, { ...terminalRecord }, db)
      })()
      console.warn('[image-generation] imagegen history finalized with storage failure', {
        ...imagegenRunLogFields(recordId, runContext),
        storageStatus: image.storageStatus,
        status: image.status,
      })
      return
    }
    updateImagegenHistoryRecord(runContext.ownerId, recordId, { ...terminalRecord })
    console.info('[image-generation] imagegen history finalized', {
      ...imagegenRunLogFields(recordId, runContext),
      storageStatus: image.storageStatus,
      status: image.status,
    })
  } catch (error) {
    const finalReferences: PersistedGenerateReferences = await persistGenerateReferenceImages(referenceSelection.slots, {
      ownerId: runContext.ownerId,
      config: runContext.config,
      publicAssetUrl: imagegenReferenceAssetUrl,
      immichFilename: mimeType => referenceImmichFilename(runContext.ownerId, runContext.config.immich?.projectName, mimeType),
      immichDeviceAssetId: mimeType => referenceImmichDeviceAssetId(runContext.ownerId, runContext.config.immich?.projectName, mimeType),
    }).catch(referenceError => ({ ids: referenceSelection.ids, error: referenceError } as const))
    const historyError = finalReferences.error
      ? new Error(`${safeErrorMessage(error, '测试生图失败', runContext.config)}；参考图保存失败：${safeErrorMessage(finalReferences.error, '参考图持久化失败', runContext.config)}`, { cause: error })
      : error
    const terminalRecord = createFailureHistoryRecord({ ...runContext, referenceImageIds: finalReferences.ids, error: historyError })
    console.error('[image-generation] imagegen run failed', {
      ...imagegenRunLogFields(recordId, runContext),
      error: safeErrorMessage(historyError, '测试生图失败', runContext.config),
      referenceImageCount: finalReferences.ids.length,
    })
    db.transaction(() => {
      recordImageGenerationFailureAndMaybeDisable({
        id: recordId,
        surface: 'imagegen',
        ownerId: runContext.ownerId,
        prompt: runContext.prompt,
        generationPromptSnapshot: runContext.prompt,
        referenceImageIds: finalReferences.ids,
        provider: runContext.model.provider,
        providerLabel: runContext.provider.label,
        modelId: runContext.model.id,
        modelName: runContext.model.label,
        storageMode: storageMode(runContext.config),
        error: historyError,
        config: runContext.config,
        user: runContext.user,
        countEligible: runContext.user.role === 'user',
        fallbackFailureType: 'provider',
      }, db)
      updateImagegenHistoryRecord(runContext.ownerId, recordId, { ...terminalRecord }, db)
    })()
  }
}

router.use('/reference-assets', createImagegenReferenceAssetRouter({ loadImageGenerationConfig, canUseImageGeneration, safeErrorMessage }))

router.get('/history', (req, res) => {
  const request = req as AuthenticatedRequest
  const query = parseHistoryQuery(req.query)
  const result = listImagegenHistory(request.currentUser.id, query)
  const referenceImagesById = referenceImagesForHistory(request.currentUser.id, result.items)
  res.json({
    items: result.items.map(record => serializeHistory(record, referenceImagesById)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  })
})

router.delete('/history/:recordId', (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const deleted = deleteImagegenHistoryRecord(request.currentUser.id, req.params.recordId)
  if (!deleted) return res.status(404).json({ error: '测试历史不存在' })
  return res.status(204).end()
})

router.post('/history/delete', (req, res) => {
  const request = req as AuthenticatedRequest
  const parsed = parseHistoryDeleteIds(request.body)
  if (!parsed.ok) return res.status(parsed.statusCode).json({ error: parsed.error })
  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const deletedCount = deleteImagegenHistoryRecords(request.currentUser.id, parsed.ids)
  return res.json({ deletedCount })
})

router.post('/history/:recordId/rerun', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const sourceRecord = getImagegenHistoryRecord(request.currentUser.id, req.params.recordId)
  if (!sourceRecord) return res.status(404).json({ error: '测试历史不存在' })
  const body = {
    prompt: sourceRecord.prompt,
    modelId: sourceRecord.modelId,
    referenceInputs: sourceRecord.referenceImageIds.map(id => ({ kind: 'asset', id })),
  }
  const result = await queueImagegenRun(request, { body, files: [] })
  if (!result.ok) return res.status(result.statusCode).json({ error: result.error })
  const referenceImagesById = referenceImagesForHistory(request.currentUser.id, [result.record])
  return res.status(result.statusCode).json(serializeHistory(result.record, referenceImagesById))
})

router.post('/history/:recordId/share', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  if (config.storageMode !== 'immich') return res.status(400).json({ error: '当前未启用 Immich 存储' })

  try {
    const result = await withShareLock(`imagegen:${request.currentUser.id}:${req.params.recordId}`, async () => {
      const record = getImagegenHistoryRecord(request.currentUser.id, req.params.recordId)
      assertShareableHistory(record)
      const shared = await resolveImmichShare(immichClientFromConfig(config), record.immichAssetId, record.immichShare)
      const metadata = metadataFromShare(shared)
      if (!sameShareMetadata(record.immichShare, metadata)) updateImagegenHistoryShare(request.currentUser.id, req.params.recordId, metadata)
      return { publicUrl: shared.publicUrl, expiresAt: shared.expiresAt }
    })
    return res.json(result)
  } catch (error) {
    return res.status(400).json({ error: safeErrorMessage(error, 'Immich 分享链接创建失败', config) })
  }
})

router.post('/generate', async (req, res) => {
  const request = req as AuthenticatedRequest
  let parsedRequest: ParsedGenerateRequest
  try {
    parsedRequest = await parseGenerateRequest(request)
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : '生成请求解析失败' })
  }

  const result = await queueImagegenRun(request, parsedRequest)
  if (!result.ok) return res.status(result.statusCode).json({ error: result.error })
  const referenceImagesById = referenceImagesForHistory(request.currentUser.id, [result.record])
  return res.status(result.statusCode).json(serializeHistory(result.record, referenceImagesById))
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
