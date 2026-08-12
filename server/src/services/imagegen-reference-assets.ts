import { randomUUID } from 'crypto'
import type { Database as DatabaseInstance } from 'better-sqlite3'
import db from '../db.js'
import type { ImageGenerationConfig } from './image-generation-config.js'
import { detectImageMime, immichClientFromConfig, readLocalImageAsset, saveImageAsset, uploadToImmichWithRetry, waitForImmichThumbnail, type ImageAssetVariant } from './image-generation-runner.js'
import type { ProviderReferenceImage } from './image-providers.js'

export type ImagegenReferenceAssetRecord = {
  readonly id: string
  readonly ownerId: string
  readonly originalFilename?: string
  readonly mimeType: string
  readonly byteSize: number
  readonly storageMode: 'local' | 'immich'
  readonly storageStatus: 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
  readonly localAssetId?: string
  readonly immichAssetId?: string
  readonly immichFilename?: string
  readonly thumbnailUrl: string
  readonly originalUrl: string
  readonly createdAt: number
}

export type CreateImagegenReferenceAssetInput = {
  readonly ownerId: string
  readonly buffer: Buffer
  readonly originalFilename?: string
  readonly config: ImageGenerationConfig
  readonly publicAssetUrl: (assetId: string, variant?: ImageAssetVariant) => string
  readonly immichFilename: (mimeType: string) => string
}

type ImagegenReferenceAssetRow = {
  readonly id: string
  readonly ownerId: string
  readonly originalFilename: string | null
  readonly mimeType: string
  readonly byteSize: number
  readonly storageMode: 'local' | 'immich'
  readonly storageStatus: 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
  readonly localAssetId: string | null
  readonly immichAssetId: string | null
  readonly immichFilename: string | null
  readonly thumbnailUrl: string
  readonly originalUrl: string
  readonly createdAt: number
}

type ImagegenReferenceAssetInsertParameters = [
  string,
  string,
  string | null,
  string,
  number,
  'local' | 'immich',
  'succeeded',
  string | null,
  string | null,
  string | null,
  string,
  string,
  number,
]

const IMAGEGEN_REFERENCE_SELECT = `
  SELECT id, ownerId, originalFilename, mimeType, byteSize, storageMode, storageStatus,
    localAssetId, immichAssetId, immichFilename, thumbnailUrl, originalUrl, createdAt
  FROM imagegenReferenceAssets
`

class ImagegenReferenceLocatorError extends Error {
  readonly name = 'ImagegenReferenceLocatorError'

  constructor(field: 'thumbnailUrl' | 'originalUrl') {
    super(`${field} 必须是同源参考图地址`)
  }
}

function nullable(value: string | undefined): string | null {
  return value || null
}

function sameOriginLocator(value: string, field: 'thumbnailUrl' | 'originalUrl'): string {
  if (value.startsWith('/api/')) return value
  throw new ImagegenReferenceLocatorError(field)
}

function safeOriginalFilename(value: string | undefined): string | undefined {
  const normalized = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return normalized ? normalized.slice(0, 120) : undefined
}

function rowToRecord(row: ImagegenReferenceAssetRow): ImagegenReferenceAssetRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    originalFilename: row.originalFilename || undefined,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    storageMode: row.storageMode,
    storageStatus: row.storageStatus,
    localAssetId: row.localAssetId || undefined,
    immichAssetId: row.immichAssetId || undefined,
    immichFilename: row.immichFilename || undefined,
    thumbnailUrl: row.thumbnailUrl,
    originalUrl: row.originalUrl,
    createdAt: row.createdAt,
  }
}

function insertReferenceAsset(record: ImagegenReferenceAssetRecord, database: DatabaseInstance): ImagegenReferenceAssetRecord {
  database.prepare<ImagegenReferenceAssetInsertParameters>(`
    INSERT INTO imagegenReferenceAssets (
      id, ownerId, originalFilename, mimeType, byteSize, storageMode, storageStatus,
      localAssetId, immichAssetId, immichFilename, thumbnailUrl, originalUrl, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.ownerId,
    nullable(record.originalFilename),
    record.mimeType,
    record.byteSize,
    record.storageMode,
    'succeeded',
    nullable(record.localAssetId),
    nullable(record.immichAssetId),
    nullable(record.immichFilename),
    record.thumbnailUrl,
    record.originalUrl,
    record.createdAt,
  )
  return record
}

export function validateUploadedReferenceImage(buffer: Buffer, browserMimeType: string): string {
  if (buffer.length === 0) throw new Error('参考图不能为空')
  const detectedMimeType = detectImageMime(buffer)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(browserMimeType)) throw new Error('仅支持 JPEG、PNG 或 WebP 参考图')
  if (detectedMimeType !== browserMimeType) throw new Error('参考图文件类型与实际内容不一致')
  return detectedMimeType
}

export async function createImagegenReferenceAsset(input: CreateImagegenReferenceAssetInput, database: DatabaseInstance = db): Promise<ImagegenReferenceAssetRecord> {
  const mimeType = detectImageMime(input.buffer)
  const originalFilename = safeOriginalFilename(input.originalFilename)
  const createdAt = Date.now()
  if (input.config.storageMode !== 'immich') {
    const saved = saveImageAsset('imagegen', input.ownerId, input.buffer, input.publicAssetUrl)
    return insertReferenceAsset({
      id: saved.id,
      ownerId: input.ownerId,
      originalFilename,
      mimeType,
      byteSize: input.buffer.length,
      storageMode: 'local',
      storageStatus: 'succeeded',
      localAssetId: saved.id,
      thumbnailUrl: sameOriginLocator(saved.thumbnailUrl, 'thumbnailUrl'),
      originalUrl: sameOriginLocator(saved.originalUrl, 'originalUrl'),
      createdAt,
    }, database)
  }

  const client = immichClientFromConfig(input.config)
  await client.assertReadyForUpload()
  const albumId = await client.ensureProjectAlbum()
  const filename = input.immichFilename(mimeType)
  const uploaded = await uploadToImmichWithRetry({ client, buffer: input.buffer, filename, mimeType, albumId })
  await waitForImmichThumbnail(client, uploaded.assetId)
  const id = randomUUID()
  return insertReferenceAsset({
    id,
    ownerId: input.ownerId,
    originalFilename,
    mimeType,
    byteSize: input.buffer.length,
    storageMode: 'immich',
    storageStatus: 'succeeded',
    immichAssetId: uploaded.assetId,
    immichFilename: uploaded.filename,
    thumbnailUrl: sameOriginLocator(input.publicAssetUrl(id, 'thumbnail'), 'thumbnailUrl'),
    originalUrl: sameOriginLocator(input.publicAssetUrl(id, 'original'), 'originalUrl'),
    createdAt,
  }, database)
}

export function listImagegenReferenceAssets(ownerId: string, database: DatabaseInstance = db): ImagegenReferenceAssetRecord[] {
  const rows = database.prepare<[string], ImagegenReferenceAssetRow>(`${IMAGEGEN_REFERENCE_SELECT} WHERE ownerId = ? ORDER BY createdAt DESC`).all(ownerId)
  return rows.map(rowToRecord)
}

export function getImagegenReferenceAsset(ownerId: string, id: string, database: DatabaseInstance = db): ImagegenReferenceAssetRecord | null {
  const row = database.prepare<[string, string], ImagegenReferenceAssetRow>(`${IMAGEGEN_REFERENCE_SELECT} WHERE id = ? AND ownerId = ?`).get(id, ownerId)
  return row ? rowToRecord(row) : null
}

export async function readImagegenReferenceAsset(ownerId: string, id: string, config: ImageGenerationConfig, variant: ImageAssetVariant = 'original'): Promise<ProviderReferenceImage> {
  const record = getImagegenReferenceAsset(ownerId, id)
  if (!record) throw new Error('参考图不存在或不属于当前用户')
  if (record.storageStatus !== 'succeeded') throw new Error('只能选择已成功上传并完成存储的参考图')
  if (record.storageMode === 'local') {
    const localAssetId = record.localAssetId || record.id
    const local = readLocalImageAsset(ownerId, localAssetId, 'imagegen')
    return { buffer: local.buffer, mimeType: local.mimeType }
  }
  if (!record.immichAssetId) throw new Error('参考图 Immich 定位信息不完整')
  const bytes = await immichClientFromConfig(config).fetchAssetBytes(record.immichAssetId, variant)
  return { buffer: bytes.buffer, mimeType: detectImageMime(bytes.buffer) }
}
