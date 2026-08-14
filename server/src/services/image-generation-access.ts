import type { Database as DatabaseInstance } from 'better-sqlite3'
import db from '../db.js'
import type { CurrentUser } from '../middleware/auth.js'
import { defaultImageGenerationConfig, normalizeImageGenerationConfig, type ImageGenerationConfig } from './image-generation-config.js'
import {
  classifyImageGenerationFailure,
  createImageGenerationFailureRecord,
  updateImageGenerationFailureRiskOutcome,
  type CreateImageGenerationFailureRecordInput,
  type ImageGenerationFailureRecord,
  type ImageGenerationFailureSurface,
  type ImageGenerationFailureType,
  type ImageGenerationRiskAudit,
} from './image-generation-failures.js'

const IMAGE_GENERATION_FEATURE = 'imageGeneration'
const ALL_FEATURE_KEYS = ['novelImport', 'importBackfill', 'imageGeneration'] as const
const AUTO_DISABLE_WINDOW_MS = 24 * 60 * 60 * 1000
const AUTO_DISABLE_THRESHOLD = 2

type FeatureKey = (typeof ALL_FEATURE_KEYS)[number]

type FeatureGrant = {
  readonly userId: string
  readonly features: readonly FeatureKey[]
}

type FeaturePermissionConfig = {
  readonly userGrants: readonly FeatureGrant[]
}

export type ImageGenerationRiskUserState = {
  readonly userId: string
  readonly baselineAt?: number
  readonly autoDisabledAt?: number
  readonly autoDisabledByFailureId?: string
  readonly autoDisabledSurface?: ImageGenerationFailureSurface
  readonly autoDisabledFailureType?: ImageGenerationFailureType
  readonly recoveredAt?: number
  readonly recoveredByUserId?: string
}

type ImageGenerationRiskControlConfig = {
  readonly userStates: readonly ImageGenerationRiskUserState[]
}

export type NovelImportConfig = {
  readonly enabled: boolean
  readonly featurePermissions: FeaturePermissionConfig
  readonly riskControls?: {
    readonly imageGeneration?: ImageGenerationRiskControlConfig
  }
}

export type RecordImageGenerationFailureInput = Omit<CreateImageGenerationFailureRecordInput, 'autoDisableTriggeredAt' | 'countsTowardAutoDisable' | 'failureType' | 'riskControlAudit'> & {
  readonly user: CurrentUser
  readonly countEligible: boolean
  readonly failureType?: ImageGenerationFailureType
  readonly fallbackFailureType?: ImageGenerationFailureType
}

export type RecordImageGenerationFailureResult = {
  readonly record: ImageGenerationFailureRecord
  readonly autoDisabled: boolean
}

type SystemConfigRow = {
  readonly novelImportConfig?: string | null
  readonly imageGenerationConfig?: string | null
}

type CountRow = {
  readonly count: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSystemConfigRow(value: unknown): value is SystemConfigRow {
  return isRecord(value)
}

function parseConfigJson(value: string | null | undefined): unknown | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isFeatureKey(value: unknown): value is FeatureKey {
  return ALL_FEATURE_KEYS.some(feature => feature === value)
}

function isImageGenerationFailureType(value: unknown): value is ImageGenerationFailureType {
  return value === 'timeout'
    || value === 'provider'
    || value === 'storage'
    || value === 'contentPolicy'
    || value === 'configuration'
    || value === 'unknown'
}

function featureList(value: unknown): readonly FeatureKey[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter(isFeatureKey)))
}

function normalizeFeatureGrant(value: unknown): FeatureGrant | undefined {
  if (!isRecord(value) || typeof value.userId !== 'string' || !value.userId.trim()) return undefined
  const features = featureList(value.features)
  return features.length > 0 ? { userId: value.userId, features } : undefined
}

function normalizeFeaturePermissionConfig(value: unknown): FeaturePermissionConfig {
  const featurePermissions = isRecord(value) ? value : {}
  const grants = Array.isArray(featurePermissions.userGrants) ? featurePermissions.userGrants : []
  return { userGrants: grants.map(normalizeFeatureGrant).filter((grant): grant is FeatureGrant => Boolean(grant)) }
}

function normalizeRiskUserState(value: unknown): ImageGenerationRiskUserState | undefined {
  if (!isRecord(value) || typeof value.userId !== 'string' || !value.userId.trim()) return undefined
  const autoDisabledSurface = value.autoDisabledSurface === 'work' || value.autoDisabledSurface === 'imagegen' ? value.autoDisabledSurface : undefined
  const autoDisabledFailureType = isImageGenerationFailureType(value.autoDisabledFailureType) ? value.autoDisabledFailureType : undefined
  return {
    userId: value.userId,
    baselineAt: numberValue(value.baselineAt),
    autoDisabledAt: numberValue(value.autoDisabledAt),
    autoDisabledByFailureId: typeof value.autoDisabledByFailureId === 'string' ? value.autoDisabledByFailureId : undefined,
    autoDisabledSurface,
    autoDisabledFailureType,
    recoveredAt: numberValue(value.recoveredAt),
    recoveredByUserId: typeof value.recoveredByUserId === 'string' ? value.recoveredByUserId : undefined,
  }
}

function normalizeRiskControls(value: unknown): NovelImportConfig['riskControls'] {
  if (!isRecord(value)) return undefined
  const imageGeneration = isRecord(value.imageGeneration) ? value.imageGeneration : undefined
  if (!imageGeneration) return undefined
  const userStates = Array.isArray(imageGeneration.userStates) ? imageGeneration.userStates.map(normalizeRiskUserState).filter((state): state is ImageGenerationRiskUserState => Boolean(state)) : []
  return userStates.length > 0 ? { imageGeneration: { userStates } } : undefined
}

export function defaultNovelImportConfig(): NovelImportConfig {
  return { enabled: false, featurePermissions: { userGrants: [] } }
}

export function normalizeNovelImportConfig(value: unknown): NovelImportConfig {
  const config = isRecord(value) ? value : {}
  return {
    enabled: Boolean(config.enabled),
    featurePermissions: normalizeFeaturePermissionConfig(isRecord(config.featurePermissions) ? config.featurePermissions : undefined),
    riskControls: normalizeRiskControls(config.riskControls),
  }
}

export function maskNovelImportConfigForUser(config: NovelImportConfig, userId: string | undefined): NovelImportConfig {
  const normalized = normalizeNovelImportConfig(config)
  const userGrants = userId ? normalized.featurePermissions.userGrants.filter(grant => grant.userId === userId) : []
  return { enabled: normalized.enabled, featurePermissions: { userGrants } }
}

export function loadImageGenerationConfig(database: DatabaseInstance = db): ImageGenerationConfig {
  const row = database.prepare('SELECT imageGenerationConfig FROM systemConfig WHERE id = ?').get('singleton')
  const parsed = isSystemConfigRow(row) ? parseConfigJson(row.imageGenerationConfig) : undefined
  return parsed === undefined ? defaultImageGenerationConfig() : normalizeImageGenerationConfig(parsed)
}

export function loadNovelImportConfig(database: DatabaseInstance = db): NovelImportConfig {
  const row = database.prepare('SELECT novelImportConfig FROM systemConfig WHERE id = ?').get('singleton')
  const parsed = isSystemConfigRow(row) ? parseConfigJson(row.novelImportConfig) : undefined
  return parsed === undefined ? defaultNovelImportConfig() : normalizeNovelImportConfig(parsed)
}

function hasImageGenerationGrant(config: NovelImportConfig, userId: string): boolean {
  return config.featurePermissions.userGrants.some(grant => grant.userId === userId && grant.features.includes(IMAGE_GENERATION_FEATURE))
}

function setImageGenerationGrant(config: NovelImportConfig, userId: string, granted: boolean): NovelImportConfig {
  const currentGrant = config.featurePermissions.userGrants.find(grant => grant.userId === userId)
  const features = new Set(currentGrant?.features || [])
  if (granted) features.add(IMAGE_GENERATION_FEATURE)
  else features.delete(IMAGE_GENERATION_FEATURE)

  const userGrants = config.featurePermissions.userGrants.filter(grant => grant.userId !== userId)
  const nextFeatures = ALL_FEATURE_KEYS.filter(feature => features.has(feature))
  const nextGrants = nextFeatures.length > 0 ? [...userGrants, { userId, features: nextFeatures }] : userGrants
  return { ...config, featurePermissions: { userGrants: nextGrants } }
}

function riskUserState(config: NovelImportConfig, userId: string): ImageGenerationRiskUserState | undefined {
  return config.riskControls?.imageGeneration?.userStates.find(state => state.userId === userId)
}

function isActiveAutoDisabled(state: ImageGenerationRiskUserState | undefined): boolean {
  if (!state?.autoDisabledAt) return false
  return !state.recoveredAt || state.recoveredAt < state.autoDisabledAt
}

function upsertRiskUserState(config: NovelImportConfig, state: ImageGenerationRiskUserState): NovelImportConfig {
  const existingStates = config.riskControls?.imageGeneration?.userStates || []
  const userStates = [...existingStates.filter(item => item.userId !== state.userId), state]
  return { ...config, riskControls: { ...config.riskControls, imageGeneration: { userStates } } }
}

function preventStaleImageGenerationRestores(existing: NovelImportConfig, incoming: NovelImportConfig): NovelImportConfig {
  return (existing.riskControls?.imageGeneration?.userStates || []).reduce((nextConfig, state) => {
    if (!isActiveAutoDisabled(state)) return nextConfig
    const wasGranted = hasImageGenerationGrant(existing, state.userId)
    const wantsGrant = hasImageGenerationGrant(nextConfig, state.userId)
    const acknowledgedState = riskUserState(nextConfig, state.userId)
    if (wasGranted || !wantsGrant || acknowledgedState?.autoDisabledAt === state.autoDisabledAt) return nextConfig
    return setImageGenerationGrant(nextConfig, state.userId, false)
  }, incoming)
}

export function applyImageGenerationRecoveryBaselines(input: {
  readonly existing: NovelImportConfig
  readonly incoming: NovelImportConfig
  readonly actorUserId: string
  readonly now?: number
}): NovelImportConfig {
  const now = input.now ?? Date.now()
  const protectedIncoming = preventStaleImageGenerationRestores(input.existing, input.incoming)
  const userIds = new Set([
    ...input.existing.featurePermissions.userGrants.map(grant => grant.userId),
    ...protectedIncoming.featurePermissions.userGrants.map(grant => grant.userId),
  ])
  let next = protectedIncoming
  for (const userId of userIds) {
    const wasGranted = hasImageGenerationGrant(input.existing, userId)
    const isGranted = hasImageGenerationGrant(protectedIncoming, userId)
    if (wasGranted || !isGranted) continue
    next = upsertRiskUserState(next, {
      ...(riskUserState(next, userId) || { userId }),
      userId,
      baselineAt: now,
      recoveredAt: now,
      recoveredByUserId: input.actorUserId,
    })
  }
  return next
}

export function prepareNovelImportConfigForAdminSave(input: {
  readonly incoming: unknown
  readonly actorUserId: string
  readonly database?: DatabaseInstance
  readonly now?: number
}): NovelImportConfig {
  const database = input.database || db
  const existing = loadNovelImportConfig(database)
  const incoming = normalizeNovelImportConfig(input.incoming)
  return applyImageGenerationRecoveryBaselines({ existing, incoming, actorUserId: input.actorUserId, now: input.now })
}

export function canUseImageGeneration(user: CurrentUser | undefined, config: ImageGenerationConfig, database: DatabaseInstance = db): boolean {
  if (!user || !config.enabled) return false
  if (user.role === 'owner' || user.role === 'admin') return true
  return hasImageGenerationGrant(loadNovelImportConfig(database), user.id)
}

export function isImageGenerationAutoDisabled(userId: string, database: DatabaseInstance = db): boolean {
  return isActiveAutoDisabled(riskUserState(loadNovelImportConfig(database), userId))
}

function countRiskFailures(input: { readonly ownerId: string; readonly baselineAt: number; readonly createdAt: number }, database: DatabaseInstance): number {
  const windowStart = Math.max(input.createdAt - AUTO_DISABLE_WINDOW_MS, input.baselineAt)
  const row = database.prepare<[string, number, number], CountRow>(`
    SELECT COUNT(*) as count
    FROM imageGenerationFailures
    WHERE ownerId = ?
      AND countsTowardAutoDisable = 1
      AND createdAt >= ?
      AND createdAt > ?
  `).get(input.ownerId, windowStart, input.baselineAt)
  return row?.count || 0
}

function updateNovelImportConfig(config: NovelImportConfig, database: DatabaseInstance): void {
  database.prepare<[string, string]>('UPDATE systemConfig SET novelImportConfig = ? WHERE id = ?').run(JSON.stringify(config), 'singleton')
}

function riskAudit(input: {
  readonly userId: string
  readonly surface: ImageGenerationFailureSurface
  readonly failureType: ImageGenerationFailureType
  readonly counted: boolean
  readonly baselineAt?: number
  readonly triggeredAt?: number
  readonly result: ImageGenerationRiskAudit['result']
}): ImageGenerationRiskAudit {
  return {
    actorUserId: input.userId,
    targetUserId: input.userId,
    surface: input.surface,
    failureType: input.failureType,
    counted: input.counted,
    triggeredAt: input.triggeredAt,
    baselineAt: input.baselineAt,
    result: input.result,
  }
}

function autoDisableConfig(input: {
  readonly config: NovelImportConfig
  readonly userId: string
  readonly failureId: string
  readonly surface: ImageGenerationFailureSurface
  readonly failureType: ImageGenerationFailureType
  readonly now: number
}): NovelImportConfig {
  const revoked = setImageGenerationGrant(input.config, input.userId, false)
  return upsertRiskUserState(revoked, {
    ...(riskUserState(revoked, input.userId) || { userId: input.userId }),
    userId: input.userId,
    autoDisabledAt: input.now,
    autoDisabledByFailureId: input.failureId,
    autoDisabledSurface: input.surface,
    autoDisabledFailureType: input.failureType,
  })
}

export function recordImageGenerationFailureAndMaybeDisable(input: RecordImageGenerationFailureInput, database: DatabaseInstance = db): RecordImageGenerationFailureResult {
  const execute = database.transaction((createdAt: number) => {
    const failureType = input.failureType || classifyImageGenerationFailure(input.error, input.fallbackFailureType || 'unknown')
    const existingConfig = loadNovelImportConfig(database)
    const baselineAt = riskUserState(existingConfig, input.user.id)?.baselineAt || 0
    const counted = input.countEligible && failureType !== 'timeout'
    const record = createImageGenerationFailureRecord({
      ...input,
      failureType,
      countsTowardAutoDisable: counted,
      riskControlAudit: riskAudit({ userId: input.user.id, surface: input.surface, failureType, counted, baselineAt, result: counted ? 'recorded' : 'notCounted' }),
      createdAt,
    }, database)

    if (!counted) return { record, autoDisabled: false }

    const failureCount = countRiskFailures({ ownerId: input.ownerId, baselineAt, createdAt }, database)
    if (failureCount < AUTO_DISABLE_THRESHOLD) return { record, autoDisabled: false }

    const latestConfig = loadNovelImportConfig(database)
    const disabledAt = createdAt
    const disabledConfig = autoDisableConfig({ config: latestConfig, userId: input.user.id, failureId: record.id, surface: input.surface, failureType, now: disabledAt })
    updateNovelImportConfig(disabledConfig, database)
    const audit = riskAudit({ userId: input.user.id, surface: input.surface, failureType, counted, baselineAt, triggeredAt: disabledAt, result: 'autoDisabled' })
    updateImageGenerationFailureRiskOutcome({ id: record.id, autoDisableTriggeredAt: disabledAt, riskControlAudit: audit }, database)
    return { record: { ...record, autoDisableTriggeredAt: disabledAt, riskControlAudit: audit }, autoDisabled: true }
  })

  return execute(input.createdAt ?? Date.now())
}

export function imageGenerationAutoDisabledPayload(result: RecordImageGenerationFailureResult): { readonly imageGenerationPermissionAutoDisabled?: true } {
  return result.autoDisabled ? { imageGenerationPermissionAutoDisabled: true } : {}
}
