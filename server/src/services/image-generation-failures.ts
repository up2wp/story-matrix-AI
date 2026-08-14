import { randomUUID } from 'crypto'
import type { Database as DatabaseInstance } from 'better-sqlite3'
import db from '../db.js'
import type { ImageGenerationConfig, ImageProviderType } from './image-generation-config.js'
import { ProviderGatewayTimeoutError } from './image-provider-transport.js'

export type ImageGenerationFailureSurface = 'work' | 'imagegen'

export const IMAGE_GENERATION_FAILURE_TYPES = ['timeout', 'provider', 'storage', 'contentPolicy', 'configuration', 'unknown'] as const

export type ImageGenerationFailureType = (typeof IMAGE_GENERATION_FAILURE_TYPES)[number]

export type ImageGenerationRiskAudit = {
  readonly actorUserId: string
  readonly targetUserId: string
  readonly surface: ImageGenerationFailureSurface
  readonly failureType: ImageGenerationFailureType
  readonly counted: boolean
  readonly triggeredAt?: number
  readonly baselineAt?: number
  readonly result: 'recorded' | 'autoDisabled' | 'notCounted'
}

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
  readonly failureType?: ImageGenerationFailureType
  readonly countsTowardAutoDisable?: boolean
  readonly autoDisableTriggeredAt?: number
  readonly riskControlAudit?: ImageGenerationRiskAudit
  readonly createdAt: number
}

export type CreateImageGenerationFailureRecordInput = Omit<ImageGenerationFailureRecord, 'id' | 'storageStatus' | 'status' | 'error' | 'createdAt'> & {
  readonly error: unknown
  readonly config: ImageGenerationConfig
  readonly id?: string
  readonly createdAt?: number
}

export type UpdateImageGenerationFailureRiskOutcomeInput = {
  readonly id: string
  readonly autoDisableTriggeredAt?: number
  readonly riskControlAudit?: ImageGenerationRiskAudit
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
  string | null,
  number | null,
  number | null,
  string | null,
  number,
]

type ImageGenerationFailureRiskUpdateParameters = [number | null, string | null, string]

type ImageGenerationFailureSignalParameters = [string, string]

function nullable(value: string | undefined): string | null {
  return value || null
}

function riskAuditValue(value: ImageGenerationRiskAudit | undefined): string | null {
  return value ? JSON.stringify(value) : null
}

function errorCause(error: Error): unknown {
  return error.cause
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'SafeUpstreamTimeoutError' || error.name === 'ImmichRequestTimeoutError') return true
  if (error instanceof ProviderGatewayTimeoutError || error.name === 'ProviderGatewayTimeoutError') return true
  const cause = errorCause(error)
  return cause instanceof Error ? isTimeoutError(cause) : false
}

function isStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'ImageGenerationStorageError') return true
  const cause = errorCause(error)
  return cause instanceof Error ? isStorageError(cause) : false
}

export function classifyImageGenerationFailure(error: unknown, fallback: ImageGenerationFailureType = 'unknown'): ImageGenerationFailureType {
  if (isTimeoutError(error)) return 'timeout'
  if (isStorageError(error)) return 'storage'
  return fallback
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
  const failureType = input.failureType || classifyImageGenerationFailure(input.error)
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
    failureType,
    countsTowardAutoDisable: input.countsTowardAutoDisable === true,
    autoDisableTriggeredAt: input.autoDisableTriggeredAt,
    riskControlAudit: input.riskControlAudit,
    createdAt: input.createdAt ?? Date.now(),
  }
  database.prepare<ImageGenerationFailureInsertParameters>(`
    INSERT INTO imageGenerationFailures (
      id, surface, ownerId, workId, prompt, generationPromptSnapshot, referenceImageIds,
      provider, providerLabel, modelId, modelName, storageMode, storageStatus, status, error,
      failureType, countsTowardAutoDisable, autoDisableTriggeredAt, riskControlAudit, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    record.failureType || null,
    record.countsTowardAutoDisable === true ? 1 : 0,
    record.autoDisableTriggeredAt || null,
    riskAuditValue(record.riskControlAudit),
    record.createdAt,
  )
  return record
}

export function updateImageGenerationFailureRiskOutcome(input: UpdateImageGenerationFailureRiskOutcomeInput, database: DatabaseInstance = db): void {
  database.prepare<ImageGenerationFailureRiskUpdateParameters>(`
    UPDATE imageGenerationFailures
    SET autoDisableTriggeredAt = ?, riskControlAudit = ?
    WHERE id = ?
  `).run(input.autoDisableTriggeredAt || null, riskAuditValue(input.riskControlAudit), input.id)
}

export function imagegenHistoryRecordTriggeredAutoDisable(input: {
  readonly id: string
  readonly ownerId: string
  readonly error?: string
}, database: DatabaseInstance = db): boolean {
  if (!input.error) return false
  const row = database.prepare<ImageGenerationFailureSignalParameters, { readonly id: string }>(`
    SELECT id
    FROM imageGenerationFailures
    WHERE id = ?
      AND surface = 'imagegen'
      AND ownerId = ?
      AND autoDisableTriggeredAt IS NOT NULL
    LIMIT 1
  `).get(input.id, input.ownerId)
  return Boolean(row)
}
