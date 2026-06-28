import type { FeatureKey, FeaturePermissionConfig, NovelImportConfig, User } from './types'

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  novelImport: '本地小说导入',
  importBackfill: '导入后阶段反推',
  imageGeneration: '作品生图',
}

export const ALL_FEATURE_KEYS: FeatureKey[] = ['novelImport', 'importBackfill', 'imageGeneration']

export function normalizeFeaturePermissionConfig(config?: FeaturePermissionConfig): FeaturePermissionConfig {
  const grants = config?.userGrants ?? []
  return {
    userGrants: grants
      .filter(grant => typeof grant.userId === 'string' && grant.userId.trim())
      .map(grant => ({
        userId: grant.userId,
        features: Array.from(new Set((grant.features ?? []).filter((feature): feature is FeatureKey => ALL_FEATURE_KEYS.includes(feature as FeatureKey)))),
      }))
      .filter(grant => grant.features.length > 0),
  }
}

export function normalizeNovelImportConfig(config?: Partial<NovelImportConfig>): NovelImportConfig {
  return {
    enabled: Boolean(config?.enabled),
    featurePermissions: normalizeFeaturePermissionConfig(config?.featurePermissions),
  }
}

export function canUseFeature(user: User | null | undefined, config: NovelImportConfig, feature: FeatureKey) {
  if (!user || !config.enabled) return false
  if (user.role === 'owner' || user.role === 'admin') return true
  return normalizeFeaturePermissionConfig(config.featurePermissions).userGrants.some(grant => {
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
