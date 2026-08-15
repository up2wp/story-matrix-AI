import { randomUUID } from 'crypto'
import type { Database as DatabaseInstance } from 'better-sqlite3'
import db from '../db.js'
import type { ImageProviderType } from './image-generation-config.js'

export type ImagegenStorageMode = 'local' | 'immich'
export type ImagegenStorageStatus = 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
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
  readonly error?: string
  readonly createdAt: number
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
  number,
]

const IMAGEGEN_HISTORY_SELECT = `
  SELECT id, ownerId, prompt, generationPromptSnapshot, provider, providerLabel, modelId, modelName,
    mimeType, storageMode, storageStatus, status, localAssetId, immichAssetId, immichFilename,
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
      thumbnailUrl, originalUrl, referenceImageIds, error, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    nullable(record.thumbnailUrl),
    nullable(record.originalUrl),
    record.referenceImageIds.length > 0 ? JSON.stringify(record.referenceImageIds) : null,
    nullable(record.error),
    record.createdAt,
  )
  return record
}

export function listImagegenHistory(ownerId: string, database: DatabaseInstance = db): ImagegenHistoryRecord[] {
  const rows = database.prepare<[string], ImagegenHistoryRow>(`${IMAGEGEN_HISTORY_SELECT} WHERE ownerId = ? ORDER BY createdAt DESC`).all(ownerId)
  return rows.map(rowToRecord)
}

export function getImagegenHistoryRecord(ownerId: string, id: string, database: DatabaseInstance = db): ImagegenHistoryRecord | null {
  const row = database.prepare<[string, string], ImagegenHistoryRow>(`${IMAGEGEN_HISTORY_SELECT} WHERE id = ? AND ownerId = ?`).get(id, ownerId)
  return row ? rowToRecord(row) : null
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
