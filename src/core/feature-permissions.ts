import type { FeatureKey, FeaturePermissionConfig, ImageGenerationConfig, ImageGenerationFailureType, ImageGenerationRiskControls, ImageGenerationRiskUserState, NovelImportConfig, User } from './types'

export type FeaturePermissionSources = {
  readonly novelImportConfig: NovelImportConfig
  readonly imageGenerationConfig: Pick<ImageGenerationConfig, 'enabled'>
}

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  novelImport: '本地小说导入',
  importBackfill: '导入后阶段反推',
  imageGeneration: '作品生图',
}

export const ALL_FEATURE_KEYS: FeatureKey[] = ['novelImport', 'importBackfill', 'imageGeneration']

function isFeatureKey(value: unknown): value is FeatureKey {
  return ALL_FEATURE_KEYS.some(feature => feature === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isImageGenerationFailureType(value: unknown): value is ImageGenerationFailureType {
  return value === 'timeout' || value === 'provider' || value === 'storage' || value === 'contentPolicy' || value === 'configuration' || value === 'unknown'
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeRiskUserState(state: unknown): ImageGenerationRiskUserState | undefined {
  if (!isRecord(state) || typeof state.userId !== 'string' || !state.userId.trim()) return undefined
  const autoDisabledSurface = state.autoDisabledSurface === 'work' || state.autoDisabledSurface === 'imagegen' ? state.autoDisabledSurface : undefined
  const autoDisabledFailureType = isImageGenerationFailureType(state.autoDisabledFailureType) ? state.autoDisabledFailureType : undefined
  return {
    userId: state.userId,
    baselineAt: numberValue(state.baselineAt),
    autoDisabledAt: numberValue(state.autoDisabledAt),
    autoDisabledByFailureId: typeof state.autoDisabledByFailureId === 'string' ? state.autoDisabledByFailureId : undefined,
    autoDisabledSurface,
    autoDisabledFailureType,
    recoveredAt: numberValue(state.recoveredAt),
    recoveredByUserId: typeof state.recoveredByUserId === 'string' ? state.recoveredByUserId : undefined,
  }
}

function normalizeRiskControls(riskControls?: unknown): ImageGenerationRiskControls | undefined {
  if (!isRecord(riskControls)) return undefined
  const imageGenerationConfig = isRecord(riskControls.imageGeneration) ? riskControls.imageGeneration : undefined
  const userStates = Array.isArray(imageGenerationConfig?.userStates) ? imageGenerationConfig.userStates : []
  const imageGeneration = userStates.map(normalizeRiskUserState).filter((state): state is ImageGenerationRiskUserState => Boolean(state))
  return imageGeneration.length > 0 ? { imageGeneration: { userStates: imageGeneration } } : undefined
}

export function normalizeFeaturePermissionConfig(config?: FeaturePermissionConfig): FeaturePermissionConfig {
  const grants = config?.userGrants ?? []
  return {
    userGrants: grants
      .filter(grant => typeof grant.userId === 'string' && grant.userId.trim())
      .map(grant => ({
        userId: grant.userId,
        features: Array.from(new Set((grant.features ?? []).filter(isFeatureKey))),
      }))
      .filter(grant => grant.features.length > 0),
  }
}

export function normalizeNovelImportConfig(config?: Partial<NovelImportConfig>): NovelImportConfig {
  return {
    enabled: Boolean(config?.enabled),
    featurePermissions: normalizeFeaturePermissionConfig(config?.featurePermissions),
    riskControls: normalizeRiskControls(config?.riskControls),
  }
}

export function canUseFeature(user: User | null | undefined, sources: FeaturePermissionSources, feature: FeatureKey): boolean {
  const featureEnabled: Record<FeatureKey, boolean> = {
    novelImport: sources.novelImportConfig.enabled,
    importBackfill: sources.novelImportConfig.enabled,
    imageGeneration: sources.imageGenerationConfig.enabled,
  }

  if (!user || !featureEnabled[feature]) return false
  if (user.role === 'owner' || user.role === 'admin') return true
  return normalizeFeaturePermissionConfig(sources.novelImportConfig.featurePermissions).userGrants.some(grant => {
    return grant.userId === user.id && grant.features.includes(feature)
  })
}

export function setUserFeatureGrant(config: NovelImportConfig, userId: string, feature: FeatureKey, granted: boolean): NovelImportConfig {
  const normalized = normalizeNovelImportConfig(config)
  const grants = normalized.featurePermissions?.userGrants ?? []
  const current = grants.find(grant => grant.userId === userId)
  const nextFeatures = new Set(current?.features ?? [])
  if (granted) nextFeatures.add(feature)
  else nextFeatures.delete(feature)

  const nextGrants = grants.filter(grant => grant.userId !== userId)
  if (nextFeatures.size > 0) {
    nextGrants.push({ userId, features: ALL_FEATURE_KEYS.filter(item => nextFeatures.has(item)) })
  }

  return {
    ...normalized,
    featurePermissions: { userGrants: nextGrants },
  }
}

export function grantedFeaturesForUser(config: NovelImportConfig, userId: string) {
  return normalizeFeaturePermissionConfig(config.featurePermissions).userGrants.find(grant => grant.userId === userId)?.features ?? []
}
