import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ImmichClient } from './immich-client.js'
import { resolveEnabledImageModel, type ImageGenerationConfig, type ImageGenerationModelConfig, type ImageGenerationProviderConfig } from './image-generation-config.js'
import { generateProviderImages, type ProviderReferenceImage } from './image-providers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORK_ASSET_DIR = path.join(__dirname, '..', '..', 'data', 'image-assets')
const IMAGEGEN_ASSET_DIR = path.join(__dirname, '..', '..', 'data', 'imagegen-assets')
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const IMMICH_UPLOAD_RETRY_LIMIT = 3
const IMMICH_THUMBNAIL_READY_ATTEMPTS = 20
const IMMICH_THUMBNAIL_READY_DELAY_MS = 1500

export type ImageAssetVariant = 'thumbnail' | 'original'
export type ImageAssetNamespace = 'work' | 'imagegen'

export type ImageGenerationPromptSnapshot = {
  readonly basePromptSnapshot: string
  readonly generationPromptSnapshot: string
  readonly viewDirection?: string
  readonly referenceImageIds: readonly string[]
}

export type ImageGenerationStorageTarget = {
  readonly localScopeId: string
  readonly localAssetNamespace?: ImageAssetNamespace
  readonly publicAssetUrl: (assetId: string, variant?: ImageAssetVariant) => string
  readonly immichFilename: (mimeType: string) => string
  readonly immichDeviceAssetId: (mimeType: string) => string
}

export type RunnableImageGenerationModelResult =
  | { readonly ok: true; readonly provider: ImageGenerationProviderConfig; readonly model: ImageGenerationModelConfig }
  | { readonly ok: false; readonly statusCode: 400; readonly error: string }

export type ImageGenerationRunnerInput = {
  readonly config: ImageGenerationConfig
  readonly provider: ImageGenerationProviderConfig
  readonly model: ImageGenerationModelConfig
  readonly providerPrompt: string
  readonly requestBody: Record<string, unknown>
  readonly referenceImages: readonly ProviderReferenceImage[]
  readonly promptSnapshot: ImageGenerationPromptSnapshot
  readonly storage: ImageGenerationStorageTarget
}

export type ImageGenerationRunnerOutput = {
  readonly httpStatus: 200 | 202
  readonly image: {
    readonly id: string
    readonly mimeType: string
    readonly storageMode: 'local' | 'immich'
    readonly storageStatus: 'succeeded' | 'storageUploadFailed'
    readonly status: 'succeeded' | 'storageUploadFailed'
    readonly modelId: string
    readonly modelName: string
    readonly provider: ImageGenerationModelConfig['provider']
    readonly basePromptSnapshot: string
    readonly generationPromptSnapshot: string
    readonly viewDirection?: string
    readonly referenceImageIds: readonly string[]
    readonly localAssetId?: string
    readonly immichAssetId?: string
    readonly immichFilename?: string
    readonly assetUrl?: string
    readonly thumbnailUrl?: string
    readonly originalUrl?: string
    readonly error?: string
  }
}

export type ImmichUploadRetryInput = {
  readonly client: ImmichClient
  readonly buffer: Buffer
  readonly filename: string
  readonly mimeType: string
  readonly deviceAssetId: string
  readonly albumId: string
}

export class ImageGenerationStorageError extends Error {
  readonly name = 'ImageGenerationStorageError'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export function resolveRunnableImageGenerationModel(config: ImageGenerationConfig, modelId: string): RunnableImageGenerationModelResult {
  const resolved = resolveEnabledImageModel(config, modelId)
  if (!resolved) return { ok: false, statusCode: 400, error: '生图模型不可用' }
  if (!resolved.provider.apiKey) return { ok: false, statusCode: 400, error: '生图厂商未配置 API Key' }
  return { ok: true, provider: resolved.provider, model: resolved.model }
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

export function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

export function detectImageMime(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  throw new Error('Provider 返回的内容不是受支持的图片格式')
}

function assetDirectory(namespace: ImageAssetNamespace | undefined) {
  return namespace === 'imagegen' ? IMAGEGEN_ASSET_DIR : WORK_ASSET_DIR
}

export function saveImageAsset(namespace: ImageAssetNamespace | undefined, scopeId: string, buffer: Buffer, publicAssetUrl: ImageGenerationStorageTarget['publicAssetUrl']) {
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('图片为空或超过大小限制')
  const mimeType = detectImageMime(buffer)
  const id = randomUUID()
  const scopeDir = path.join(assetDirectory(namespace), scopeId)
  fs.mkdirSync(scopeDir, { recursive: true })
  const filePath = path.join(scopeDir, `${id}.${extensionForMime(mimeType)}`)
  fs.writeFileSync(filePath, buffer)
  const assetUrl = publicAssetUrl(id)
  return { id, mimeType, assetUrl, thumbnailUrl: assetUrl, originalUrl: assetUrl }
}

export function readLocalImageAsset(scopeId: string, assetId: string, namespace?: ImageAssetNamespace) {
  if (!/^[a-f0-9-]{36}$/i.test(assetId)) throw new Error('图片 ID 无效')
  const scopeDir = path.join(assetDirectory(namespace), scopeId)
  const files = fs.existsSync(scopeDir) ? fs.readdirSync(scopeDir) : []
  const fileName = files.find(file => file.startsWith(`${assetId}.`))
  if (!fileName) throw new Error('图片不存在')
  const filePath = path.join(scopeDir, fileName)
  const buffer = fs.readFileSync(filePath)
  return { buffer, mimeType: detectImageMime(buffer), filePath }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function immichClientFromConfig(config: ImageGenerationConfig) {
  const immich = config.immich
  if (!immich?.serviceUrl || !immich.apiKey || !immich.projectName) throw new Error('Immich 存储配置不完整')
  return new ImmichClient({ serviceUrl: immich.serviceUrl, apiKey: immich.apiKey, projectName: immich.projectName, allowPrivateNetwork: immich.allowPrivateNetwork })
}

export async function uploadToImmichWithRetry(input: ImmichUploadRetryInput) {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= IMMICH_UPLOAD_RETRY_LIMIT; attempt += 1) {
    try {
      return await input.client.uploadImage({ buffer: input.buffer, filename: input.filename, mimeType: input.mimeType, albumId: input.albumId, deviceAssetId: input.deviceAssetId })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      lastError = error
    }
  }
  throw lastError || new Error('Immich 上传失败')
}

export async function waitForImmichThumbnail(client: ImmichClient, assetId: string) {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < IMMICH_THUMBNAIL_READY_ATTEMPTS; attempt += 1) {
    try {
      await client.fetchAssetBytes(assetId, 'thumbnail')
      return
    } catch (error) {
      if (!(error instanceof Error)) throw error
      lastError = error
      if (attempt < IMMICH_THUMBNAIL_READY_ATTEMPTS - 1) await sleep(IMMICH_THUMBNAIL_READY_DELAY_MS)
    }
  }
  throw lastError || new Error('Immich 缩略图尚未生成')
}

async function discardImmichAsset(client: ImmichClient, assetId: string) {
  try {
    await client.deleteAsset(assetId)
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
}

function imageModelSnapshot(model: ImageGenerationModelConfig) {
  return { modelId: model.id, modelName: model.label, provider: model.provider }
}

export async function runImageGeneration(input: ImageGenerationRunnerInput): Promise<ImageGenerationRunnerOutput> {
  const { config, provider, model, providerPrompt, requestBody, referenceImages, promptSnapshot, storage } = input
  const storageMode = config.storageMode === 'immich' ? 'immich' : 'local'
  const immichClient = storageMode === 'immich' ? immichClientFromConfig(config) : undefined
  if (immichClient) {
    try {
      await immichClient.assertReadyForUpload()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Immich 存储预检失败'
      throw new ImageGenerationStorageError(message, { cause: error })
    }
  }
  const normalizedReferenceImages = Array.from(referenceImages)
  const generated = await generateProviderImages(provider, model, providerPrompt, { ...safeGenerationOptions(requestBody, model), referenceImages: normalizedReferenceImages })
  const firstImage = generated[0]
  if (!firstImage) throw new Error('Provider 未返回图片')
  const buffer = firstImage.buffer
  const mimeType = detectImageMime(buffer)
  const modelSnapshot = imageModelSnapshot(model)
  if (storageMode === 'local') {
    const saved = saveImageAsset(storage.localAssetNamespace, storage.localScopeId, buffer, storage.publicAssetUrl)
    return { httpStatus: 200, image: { ...saved, localAssetId: saved.id, storageMode: 'local', storageStatus: 'succeeded', status: 'succeeded', ...modelSnapshot, ...promptSnapshot } }
  }

  if (!immichClient) throw new Error('Immich 存储配置不完整')
  const client = immichClient
  let albumId: string
  try {
    albumId = await client.ensureProjectAlbum()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Immich 项目相册准备失败'
    throw new ImageGenerationStorageError(message, { cause: error })
  }
  const filename = storage.immichFilename(mimeType)
  const deviceAssetId = storage.immichDeviceAssetId(mimeType)
  try {
    const uploaded = await uploadToImmichWithRetry({ client, buffer, filename, mimeType, albumId, deviceAssetId })
    try {
      await waitForImmichThumbnail(client, uploaded.assetId)
    } catch (thumbnailError) {
      await discardImmichAsset(client, uploaded.assetId)
      throw thumbnailError
    }
    const id = randomUUID()
    return {
      httpStatus: 200,
      image: {
        id,
        mimeType,
        storageMode: 'immich',
        storageStatus: 'succeeded',
        status: 'succeeded',
        immichAssetId: uploaded.assetId,
        immichFilename: uploaded.filename,
        thumbnailUrl: storage.publicAssetUrl(id, 'thumbnail'),
        originalUrl: storage.publicAssetUrl(id, 'original'),
        ...modelSnapshot,
        ...promptSnapshot,
      },
    }
  } catch (uploadError) {
    const id = randomUUID()
    const fallback = saveImageAsset(storage.localAssetNamespace, storage.localScopeId, buffer, storage.publicAssetUrl)
    return {
      httpStatus: 202,
      image: {
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
        ...modelSnapshot,
        ...promptSnapshot,
        error: uploadError instanceof Error ? uploadError.message : 'Immich 上传失败，已保留可重试状态',
      },
    }
  }
}
