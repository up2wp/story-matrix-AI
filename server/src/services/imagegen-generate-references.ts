import busboy from 'busboy'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import type { ImageGenerationConfig, ImageGenerationModelConfig } from './image-generation-config.js'
import { MAX_IMAGE_BYTES, type ImageAssetVariant } from './image-generation-runner.js'
import { createImagegenReferenceAsset, readImagegenReferenceAsset, validateUploadedReferenceImage } from './imagegen-reference-assets.js'
import type { ProviderReferenceImage } from './image-providers.js'

const MAX_TEST_REFERENCE_IMAGES = 3

export type GenerateReferenceInput =
  | { readonly kind: 'asset'; readonly id: string }
  | { readonly kind: 'file'; readonly index: number }

export type UploadedGenerateReferenceFile = {
  readonly buffer: Buffer
  readonly mimeType: string
  readonly originalFilename?: string
}

export type ParsedGenerateRequest = {
  readonly body: Record<string, unknown>
  readonly files: readonly UploadedGenerateReferenceFile[]
}

export type ResolvedGenerateReferenceSlot =
  | { readonly kind: 'asset'; readonly id: string; readonly image: ProviderReferenceImage }
  | { readonly kind: 'file'; readonly file: UploadedGenerateReferenceFile; readonly image: ProviderReferenceImage }

export type ResolvedGenerateReferenceInput = {
  readonly value: unknown
  readonly files: readonly UploadedGenerateReferenceFile[]
  readonly ownerId: string
  readonly config: ImageGenerationConfig
  readonly model: ImageGenerationModelConfig
}

export type ResolvedGenerateReferenceResult =
  | { readonly ok: true; readonly ids: readonly string[]; readonly images: readonly ProviderReferenceImage[]; readonly slots: readonly ResolvedGenerateReferenceSlot[] }
  | { readonly ok: false; readonly statusCode: 400; readonly error: string }

export type PersistGenerateReferenceInput = {
  readonly ownerId: string
  readonly config: ImageGenerationConfig
  readonly publicAssetUrl: (assetId: string, variant?: ImageAssetVariant) => string
  readonly immichFilename: (mimeType: string) => string
  readonly immichDeviceAssetId: (mimeType: string) => string
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function parseJsonObject(value: string, fallbackError: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  const body = objectRecord(parsed)
  if (!body) throw new Error(fallbackError)
  return body
}

function parseGenerateMultipartRequest(request: AuthenticatedRequest): Promise<ParsedGenerateRequest> {
  return new Promise((resolve, reject) => {
    const parser = busboy({ headers: request.headers, limits: { files: MAX_TEST_REFERENCE_IMAGES, fields: 1, parts: MAX_TEST_REFERENCE_IMAGES + 1, fileSize: MAX_IMAGE_BYTES } })
    const files: UploadedGenerateReferenceFile[] = []
    let payload = ''
    let payloadCount = 0
    let invalidError: Error | undefined

    parser.on('file', (fieldName, file, info) => {
      if (fieldName !== 'referenceImages') invalidError = new Error('生成参考图字段必须是 referenceImages')
      const chunks: Buffer[] = []
      file.on('limit', () => {
        invalidError = new Error('参考图不能超过 12MB')
      })
      file.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      file.on('close', () => {
        if (invalidError) return
        try {
          const buffer = Buffer.concat(chunks)
          const mimeType = validateUploadedReferenceImage(buffer, info.mimeType)
          files.push({ buffer, mimeType, originalFilename: info.filename })
        } catch (error) {
          invalidError = error instanceof Error ? error : new Error('参考图解析失败')
        }
      })
    })
    parser.on('field', (fieldName, value) => {
      if (fieldName !== 'payload') invalidError = new Error('生成请求只接受 payload 字段')
      payloadCount += 1
      payload = value
    })
    parser.on('filesLimit', () => {
      invalidError = new Error(`当前测试台最多支持 ${MAX_TEST_REFERENCE_IMAGES} 张参考图`)
    })
    parser.on('fieldsLimit', () => {
      invalidError = new Error('生成请求只接受一个 payload 字段')
    })
    parser.on('partsLimit', () => {
      invalidError = new Error(`生成请求最多接受 ${MAX_TEST_REFERENCE_IMAGES} 张参考图`)
    })
    parser.on('error', reject)
    parser.on('close', () => {
      if (invalidError) {
        reject(invalidError)
        return
      }
      if (payloadCount !== 1) {
        reject(new Error('缺少生成请求 payload'))
        return
      }
      try {
        resolve({ body: parseJsonObject(payload, '生成请求 payload 必须是 JSON 对象'), files })
      } catch (error) {
        reject(error instanceof Error ? error : new Error('生成请求 payload 解析失败'))
      }
    })
    request.pipe(parser)
  })
}

export async function parseGenerateRequest(request: AuthenticatedRequest): Promise<ParsedGenerateRequest> {
  const contentType = request.headers['content-type'] || ''
  if (contentType.includes('multipart/form-data')) return parseGenerateMultipartRequest(request)
  return { body: objectRecord(request.body) || {}, files: [] }
}

function fallbackFileReferenceInputs(files: readonly UploadedGenerateReferenceFile[]): readonly GenerateReferenceInput[] {
  return files.map((_, index) => ({ kind: 'file', index }))
}

function parseGenerateReferenceInputs(value: unknown, files: readonly UploadedGenerateReferenceFile[]) {
  if (value === undefined) return { ok: true, inputs: fallbackFileReferenceInputs(files) } as const
  if (!Array.isArray(value)) return { ok: false, error: 'referenceInputs 必须是参考图输入数组' } as const
  const inputs: GenerateReferenceInput[] = []
  for (const item of value) {
    const input = objectRecord(item)
    if (!input) return { ok: false, error: 'referenceInputs 只能包含参考图输入对象' } as const
    if (input.kind === 'asset') {
      const id = typeof input.id === 'string' ? input.id.trim() : ''
      if (!id) return { ok: false, error: '参考图资产 ID 不能为空' } as const
      inputs.push({ kind: 'asset', id })
    } else if (input.kind === 'file') {
      if (typeof input.index !== 'number' || !Number.isInteger(input.index) || input.index < 0 || input.index >= files.length) return { ok: false, error: '参考图文件索引无效' } as const
      inputs.push({ kind: 'file', index: input.index })
    } else {
      return { ok: false, error: 'referenceInputs 只支持 asset 或 file' } as const
    }
  }
  return { ok: true, inputs } as const
}

function effectiveReferenceImageLimit(model: ImageGenerationModelConfig) {
  if (!model.capabilities.referenceImages) return 0
  return Math.min(MAX_TEST_REFERENCE_IMAGES, model.capabilities.maxReferenceImages || 0)
}

function validateGenerateReferenceInputs(model: ImageGenerationModelConfig, inputs: readonly GenerateReferenceInput[]) {
  if (inputs.length === 0) return { ok: true } as const
  const limit = effectiveReferenceImageLimit(model)
  if (limit === 0) return { ok: false, error: '当前模型不支持参考图' } as const
  if (inputs.length > limit) return { ok: false, error: `当前模型最多支持 ${limit} 张参考图` } as const
  const assetIds = inputs.filter(input => input.kind === 'asset').map(input => input.id)
  if (assetIds.length !== new Set(assetIds).size) return { ok: false, error: '不能重复选择同一张参考图' } as const
  const fileIndexes = inputs.filter(input => input.kind === 'file').map(input => input.index)
  if (fileIndexes.length !== new Set(fileIndexes).size) return { ok: false, error: '不能重复选择同一张参考图文件' } as const
  return { ok: true } as const
}

export async function resolveGenerateReferenceInputs(input: ResolvedGenerateReferenceInput): Promise<ResolvedGenerateReferenceResult> {
  const parsed = parseGenerateReferenceInputs(input.value, input.files)
  if (!parsed.ok) return { ok: false, statusCode: 400, error: parsed.error }
  const selection = validateGenerateReferenceInputs(input.model, parsed.inputs)
  if (!selection.ok) return { ok: false, statusCode: 400, error: selection.error }
  try {
    const slots = await Promise.all(parsed.inputs.map(async referenceInput => {
      if (referenceInput.kind === 'asset') {
        const image = await readImagegenReferenceAsset(input.ownerId, referenceInput.id, input.config, 'original')
        return { kind: 'asset', id: referenceInput.id, image } as const
      }
      const file = input.files[referenceInput.index]
      if (!file) throw new Error('参考图文件索引无效')
      return { kind: 'file', file, image: { buffer: file.buffer, mimeType: file.mimeType } } as const
    }))
    return { ok: true, ids: slots.flatMap(slot => slot.kind === 'asset' ? [slot.id] : []), images: slots.map(slot => slot.image), slots }
  } catch (error) {
    return { ok: false, statusCode: 400, error: error instanceof Error ? error.message : '参考图不可用' }
  }
}

export async function persistGenerateReferenceImages(slots: readonly ResolvedGenerateReferenceSlot[], input: PersistGenerateReferenceInput) {
  const ids: string[] = []
  for (const slot of slots) {
    if (slot.kind === 'asset') {
      ids.push(slot.id)
    } else {
      const record = await createImagegenReferenceAsset({
        ownerId: input.ownerId,
        buffer: slot.file.buffer,
        originalFilename: slot.file.originalFilename,
        config: input.config,
        publicAssetUrl: input.publicAssetUrl,
        immichFilename: input.immichFilename,
        immichDeviceAssetId: input.immichDeviceAssetId,
      })
      ids.push(record.id)
    }
  }
  return { ids } as const
}
