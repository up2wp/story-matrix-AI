import { randomUUID } from 'crypto'
import type { Database as DatabaseInstance } from 'better-sqlite3'
import db from '../db.js'
import type { ImageProviderType } from './image-generation-config.js'

export type ImagegenStorageMode = 'local' | 'immich'
export type ImagegenStorageStatus = 'generating' | 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
export type ImagegenHistoryStatus = ImagegenStorageStatus

export type ImagegenHistoryRecord = {
  readonly id: string
  readonly ownerId: string
  readonly prompt: string
  readonly generationPromptSnapshot: string
  readonly provider: ImageProviderType
  readonly providerLabel: string
  readonly modelId: string
  readonly modelName: string
  readonly mimeType?: string
  readonly storageMode: ImagegenStorageMode
  readonly storageStatus: ImagegenStorageStatus
  readonly status: ImagegenHistoryStatus
  readonly localAssetId?: string
  readonly immichAssetId?: string
  readonly immichFilename?: string
  readonly thumbnailUrl?: string
  readonly originalUrl?: string
  readonly referenceImageIds: readonly string[]
  readonly immichShare?: ImmichSharedLinkMetadata
  readonly error?: string
  readonly createdAt: number
}

export type ImmichSharedLinkMetadata = {
  readonly id: string
  readonly assetId: string
  readonly expiresAt: string
}

export type ImagegenHistoryStorageLocator = {
  readonly ownerId: string
  readonly localAssetId?: string
  readonly immichAssetId?: string
}

export type CreateImagegenHistoryRecordInput = Omit<ImagegenHistoryRecord, 'id' | 'createdAt'> & {
  readonly id?: string
  readonly createdAt?: number
}

export type UpdateImagegenHistoryRecordInput = Omit<ImagegenHistoryRecord, 'id' | 'ownerId' | 'prompt' | 'generationPromptSnapshot' | 'provider' | 'providerLabel' | 'modelId' | 'modelName' | 'storageMode' | 'immichShare' | 'createdAt'>

export type ListImagegenHistoryInput = {
  readonly page: number
  readonly pageSize: number
  readonly prompt?: string
  readonly createdFrom?: number
  readonly createdTo?: number
}

export type ListImagegenHistoryResult = {
  readonly items: ImagegenHistoryRecord[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

type ImagegenHistoryRow = {
  readonly id: string
  readonly ownerId: string
  readonly prompt: string
  readonly generationPromptSnapshot: string
  readonly provider: ImageProviderType
  readonly providerLabel: string
  readonly modelId: string
  readonly modelName: string
  readonly mimeType: string | null
  readonly storageMode: ImagegenStorageMode
  readonly storageStatus: ImagegenStorageStatus
  readonly status: ImagegenHistoryStatus
  readonly localAssetId: string | null
  readonly immichAssetId: string | null
  readonly immichFilename: string | null
  readonly immichSharedLinkId: string | null
  readonly immichSharedLinkAssetId: string | null
  readonly immichSharedLinkExpiresAt: string | null
  readonly thumbnailUrl: string | null
  readonly originalUrl: string | null
  readonly referenceImageIds: string | null
  readonly error: string | null
  readonly createdAt: number
}

type ImagegenHistoryInsertParameters = [
  string,
  string,
  string,
  string,
  ImageProviderType,
  string,
  string,
  string,
  string | null,
  ImagegenStorageMode,
  ImagegenStorageStatus,
  ImagegenHistoryStatus,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  number,
]

type ImagegenHistoryUpdateParameters = [
  string | null,
  ImagegenStorageStatus,
  ImagegenHistoryStatus,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
  string,
]

type ImagegenHistoryShareUpdateParameters = [string | null, string | null, string | null, string, string]

const IMAGEGEN_HISTORY_SELECT = `
  SELECT id, ownerId, prompt, generationPromptSnapshot, provider, providerLabel, modelId, modelName,
    mimeType, storageMode, storageStatus, status, localAssetId, immichAssetId, immichFilename,
    immichSharedLinkId, immichSharedLinkAssetId, immichSharedLinkExpiresAt,
    thumbnailUrl, originalUrl, referenceImageIds, error, createdAt
  FROM imagegenHistory
`

class ImagegenHistoryLocatorError extends Error {
  constructor(field: 'thumbnailUrl' | 'originalUrl') {
    super(`${field} 必须是同源资产地址`)
    this.name = 'ImagegenHistoryLocatorError'
  }
}

function nullable(value: string | undefined): string | null {
  return value || null
}

function sameOriginLocator(value: string | undefined, field: 'thumbnailUrl' | 'originalUrl'): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/api/')) return value
  throw new ImagegenHistoryLocatorError(field)
}

function referenceImageIdList(value: string | null): readonly string[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : []
}

function immichShareMetadata(row: ImagegenHistoryRow): ImmichSharedLinkMetadata | undefined {
  if (!row.immichSharedLinkId || !row.immichSharedLinkAssetId || !row.immichSharedLinkExpiresAt) return undefined
  return {
    id: row.immichSharedLinkId,
    assetId: row.immichSharedLinkAssetId,
    expiresAt: row.immichSharedLinkExpiresAt,
  }
}

function escapedLikePattern(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

function imagegenHistoryFilterSql(input: ListImagegenHistoryInput): { readonly sql: string; readonly params: unknown[] } {
  const conditions: string[] = ['ownerId = ?']
  const params: unknown[] = []
  if (input.prompt && input.prompt.trim()) {
    const pattern = `%${escapedLikePattern(input.prompt.trim())}%`
    conditions.push(`(prompt LIKE ? ESCAPE '\\' OR generationPromptSnapshot LIKE ? ESCAPE '\\')`)
    params.push(pattern, pattern)
  }
  if (typeof input.createdFrom === 'number') {
    conditions.push('createdAt >= ?')
    params.push(input.createdFrom)
  }
  if (typeof input.createdTo === 'number') {
    conditions.push('createdAt <= ?')
    params.push(input.createdTo)
  }
  return { sql: conditions.join(' AND '), params }
}

function rowToRecord(row: ImagegenHistoryRow): ImagegenHistoryRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    prompt: row.prompt,
    generationPromptSnapshot: row.generationPromptSnapshot,
    provider: row.provider,
    providerLabel: row.providerLabel,
    modelId: row.modelId,
    modelName: row.modelName,
    mimeType: row.mimeType || undefined,
    storageMode: row.storageMode,
    storageStatus: row.storageStatus,
    status: row.status,
    localAssetId: row.localAssetId || undefined,
    immichAssetId: row.immichAssetId || undefined,
    immichFilename: row.immichFilename || undefined,
    thumbnailUrl: row.thumbnailUrl || undefined,
    originalUrl: row.originalUrl || undefined,
    referenceImageIds: referenceImageIdList(row.referenceImageIds),
    immichShare: immichShareMetadata(row),
    error: row.error || undefined,
    createdAt: row.createdAt,
  }
}

export function createImagegenHistoryRecord(input: CreateImagegenHistoryRecordInput, database: DatabaseInstance = db): ImagegenHistoryRecord {
  const record: ImagegenHistoryRecord = {
    ...input,
    id: input.id || randomUUID(),
    referenceImageIds: input.referenceImageIds || [],
    thumbnailUrl: sameOriginLocator(input.thumbnailUrl, 'thumbnailUrl'),
    originalUrl: sameOriginLocator(input.originalUrl, 'originalUrl'),
    createdAt: input.createdAt ?? Date.now(),
  }
  database.prepare<ImagegenHistoryInsertParameters>(`
    INSERT INTO imagegenHistory (
      id, ownerId, prompt, generationPromptSnapshot, provider, providerLabel, modelId, modelName,
      mimeType, storageMode, storageStatus, status, localAssetId, immichAssetId, immichFilename,
      immichSharedLinkId, immichSharedLinkAssetId, immichSharedLinkExpiresAt,
      thumbnailUrl, originalUrl, referenceImageIds, error, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.ownerId,
    record.prompt,
    record.generationPromptSnapshot,
    record.provider,
    record.providerLabel,
    record.modelId,
    record.modelName,
    nullable(record.mimeType),
    record.storageMode,
    record.storageStatus,
    record.status,
    nullable(record.localAssetId),
    nullable(record.immichAssetId),
    nullable(record.immichFilename),
    nullable(record.immichShare?.id),
    nullable(record.immichShare?.assetId),
    nullable(record.immichShare?.expiresAt),
    nullable(record.thumbnailUrl),
    nullable(record.originalUrl),
    record.referenceImageIds.length > 0 ? JSON.stringify(record.referenceImageIds) : null,
    nullable(record.error),
    record.createdAt,
  )
  return record
}

export function updateImagegenHistoryRecord(ownerId: string, id: string, input: UpdateImagegenHistoryRecordInput, database: DatabaseInstance = db): ImagegenHistoryRecord | null {
  const thumbnailUrl = sameOriginLocator(input.thumbnailUrl, 'thumbnailUrl')
  const originalUrl = sameOriginLocator(input.originalUrl, 'originalUrl')
  database.prepare<ImagegenHistoryUpdateParameters>(`
    UPDATE imagegenHistory
    SET mimeType = ?, storageStatus = ?, status = ?, localAssetId = ?, immichAssetId = ?,
      immichFilename = ?, thumbnailUrl = ?, originalUrl = ?, referenceImageIds = ?, error = ?
    WHERE id = ? AND ownerId = ?
  `).run(
    nullable(input.mimeType),
    input.storageStatus,
    input.status,
    nullable(input.localAssetId),
    nullable(input.immichAssetId),
    nullable(input.immichFilename),
    nullable(thumbnailUrl),
    nullable(originalUrl),
    input.referenceImageIds.length > 0 ? JSON.stringify(input.referenceImageIds) : null,
    nullable(input.error),
    id,
    ownerId,
  )
  return getImagegenHistoryRecord(ownerId, id, database)
}

export function updateImagegenHistoryShare(ownerId: string, id: string, metadata: ImmichSharedLinkMetadata | undefined, database: DatabaseInstance = db): ImagegenHistoryRecord | null {
  database.prepare<ImagegenHistoryShareUpdateParameters>(`
    UPDATE imagegenHistory
    SET immichSharedLinkId = ?, immichSharedLinkAssetId = ?, immichSharedLinkExpiresAt = ?
    WHERE id = ? AND ownerId = ?
  `).run(
    nullable(metadata?.id),
    nullable(metadata?.assetId),
    nullable(metadata?.expiresAt),
    id,
    ownerId,
  )
  return getImagegenHistoryRecord(ownerId, id, database)
}

export function listImagegenHistory(ownerId: string, input: ListImagegenHistoryInput, database: DatabaseInstance = db): ListImagegenHistoryResult {
  const { sql: filterSql, params: filterParams } = imagegenHistoryFilterSql(input)
  const totalRow = database.prepare<unknown[], { count: number }>(`
    SELECT COUNT(*) AS count FROM imagegenHistory WHERE ${filterSql}
  `).get(ownerId, ...filterParams)
  const total = totalRow?.count ?? 0
  const offset = (input.page - 1) * input.pageSize
  const rows = database.prepare<unknown[], ImagegenHistoryRow>(`
    ${IMAGEGEN_HISTORY_SELECT}
    WHERE ${filterSql}
    ORDER BY createdAt DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(ownerId, ...filterParams, input.pageSize, offset)
  return {
    items: rows.map(rowToRecord),
    total,
    page: input.page,
    pageSize: input.pageSize,
  }
}

export function getImagegenHistoryRecord(ownerId: string, id: string, database: DatabaseInstance = db): ImagegenHistoryRecord | null {
  const row = database.prepare<[string, string], ImagegenHistoryRow>(`${IMAGEGEN_HISTORY_SELECT} WHERE id = ? AND ownerId = ?`).get(id, ownerId)
  return row ? rowToRecord(row) : null
}

export function deleteImagegenHistoryRecord(ownerId: string, id: string, database: DatabaseInstance = db): boolean {
  const result = database.prepare<[string, string]>('DELETE FROM imagegenHistory WHERE id = ? AND ownerId = ?').run(id, ownerId)
  return result.changes === 1
}

export function deleteImagegenHistoryRecords(ownerId: string, ids: readonly string[], database: DatabaseInstance = db): number {
  const uniqueIds = Array.from(new Set(ids.map(id => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return 0
  const placeholders = uniqueIds.map(() => '?').join(', ')
  const result = database.prepare(`
    DELETE FROM imagegenHistory
    WHERE ownerId = ? AND id IN (${placeholders})
  `).run(ownerId, ...uniqueIds)
  return result.changes
}

export function listImagegenHistoryStorageLocators(database: DatabaseInstance = db): ImagegenHistoryStorageLocator[] {
  const rows = database.prepare<[], Pick<ImagegenHistoryRow, 'ownerId' | 'localAssetId' | 'immichAssetId'>>(`
    SELECT ownerId, localAssetId, immichAssetId
    FROM imagegenHistory
    WHERE localAssetId IS NOT NULL OR immichAssetId IS NOT NULL
  `).all()
  return rows.map(row => ({
    ownerId: row.ownerId,
    localAssetId: row.localAssetId || undefined,
    immichAssetId: row.immichAssetId || undefined,
  }))
}
