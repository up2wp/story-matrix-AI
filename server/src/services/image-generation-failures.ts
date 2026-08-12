import { randomUUID } from 'crypto'
import type { Database as DatabaseInstance } from 'better-sqlite3'
import db from '../db.js'
import type { ImageGenerationConfig, ImageProviderType } from './image-generation-config.js'

export type ImageGenerationFailureSurface = 'work' | 'imagegen'

export type ImageGenerationFailureRecord = {
  readonly id: string
  readonly surface: ImageGenerationFailureSurface
  readonly ownerId: string
  readonly workId?: string
  readonly prompt: string
  readonly generationPromptSnapshot: string
  readonly referenceImageIds: readonly string[]
  readonly provider: ImageProviderType
  readonly providerLabel: string
  readonly modelId: string
  readonly modelName: string
  readonly storageMode: 'local' | 'immich'
  readonly storageStatus: 'failed'
  readonly status: 'failed'
  readonly error: string
  readonly createdAt: number
}

export type CreateImageGenerationFailureRecordInput = Omit<ImageGenerationFailureRecord, 'id' | 'storageStatus' | 'status' | 'error' | 'createdAt'> & {
  readonly error: unknown
  readonly config: ImageGenerationConfig
  readonly id?: string
  readonly createdAt?: number
}

type ImageGenerationFailureInsertParameters = [
  string,
  ImageGenerationFailureSurface,
  string,
  string | null,
  string,
  string,
  string | null,
  ImageProviderType,
  string,
  string,
  string,
  'local' | 'immich',
  'failed',
  'failed',
  string,
  number,
]

function nullable(value: string | undefined): string | null {
  return value || null
}

function sensitiveValues(config: ImageGenerationConfig) {
  const providerValues = config.providers.flatMap(provider => [provider.apiKey, provider.baseUrl])
  return Array.from(new Set([...providerValues, config.immich.apiKey, config.immich.serviceUrl].filter((value): value is string => Boolean(value))))
}

export function imageGenerationFailureErrorMessage(error: unknown, config: ImageGenerationConfig): string {
  const raw = error instanceof Error ? error.message : '生图请求失败'
  const sanitized = sensitiveValues(config).reduce((message, value) => message.replaceAll(value, '[redacted]'), raw).trim()
  return (sanitized || '生图请求失败').slice(0, 500)
}

export function createImageGenerationFailureRecord(input: CreateImageGenerationFailureRecordInput, database: DatabaseInstance = db): ImageGenerationFailureRecord {
  const record: ImageGenerationFailureRecord = {
    id: input.id || randomUUID(),
    surface: input.surface,
    ownerId: input.ownerId,
    workId: input.workId,
    prompt: input.prompt,
    generationPromptSnapshot: input.generationPromptSnapshot,
    referenceImageIds: input.referenceImageIds,
    provider: input.provider,
    providerLabel: input.providerLabel,
    modelId: input.modelId,
    modelName: input.modelName,
    storageMode: input.storageMode,
    storageStatus: 'failed',
    status: 'failed',
    error: imageGenerationFailureErrorMessage(input.error, input.config),
    createdAt: input.createdAt ?? Date.now(),
  }
  database.prepare<ImageGenerationFailureInsertParameters>(`
    INSERT INTO imageGenerationFailures (
      id, surface, ownerId, workId, prompt, generationPromptSnapshot, referenceImageIds,
      provider, providerLabel, modelId, modelName, storageMode, storageStatus, status, error, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.surface,
    record.ownerId,
    nullable(record.workId),
    record.prompt,
    record.generationPromptSnapshot,
    record.referenceImageIds.length > 0 ? JSON.stringify(record.referenceImageIds) : null,
    record.provider,
    record.providerLabel,
    record.modelId,
    record.modelName,
    record.storageMode,
    'failed',
    'failed',
    record.error,
    record.createdAt,
  )
  return record
}
