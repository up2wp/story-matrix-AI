import { create } from 'zustand'
import { db } from './db'
import type { AIConfig, AIModelConfig, FeatureKey, ImageGenerationConfig, NovelImportConfig, User, VoiceboxConfig } from './types'
import { canUseFeature, normalizeNovelImportConfig } from './feature-permissions'
import { useStore } from './store'

// ============================================================
// 系统配置状态管理
// ============================================================

interface SystemConfigState {
  registrationEnabled: boolean
  aiConfig: AIConfig
  aiConfigs: AIModelConfig[]
  activeConfigId: string
  voiceboxConfig: VoiceboxConfig
  novelImportConfig: NovelImportConfig
  imageGenerationConfig: ImageGenerationConfig
  isLoading: boolean
  loadConfig: () => Promise<void>
  toggleRegistration: () => Promise<void>
  toggleNovelImport: () => Promise<void>
  saveNovelImportConfig: (config: NovelImportConfig) => Promise<void>
  saveImageGenerationConfig: (config: ImageGenerationConfig) => Promise<void>
  canUseFeature: (user: User | null | undefined, feature: FeatureKey) => boolean
  saveAIConfig: (config: AIConfig) => Promise<void>
  saveAIConfigs: (configs: AIModelConfig[], activeId: string) => Promise<void>
  switchAIConfig: (id: string) => Promise<void>
  saveVoiceboxConfig: (config: VoiceboxConfig) => Promise<void>
}

const defaultAIConfig: AIConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o-mini',
  maxTokens: 8192,
}

export const defaultVoiceboxConfig: VoiceboxConfig = {
  serviceUrl: 'http://127.0.0.1:17493',
  authType: 'none',
  bearerToken: '',
  apiKey: '',
  customHeaderName: '',
  customHeaderValue: '',
  defaultEngine: 'f5-tts',
  defaultLanguage: 'zh',
  defaultChunking: true,
  defaultCrossfade: 0.15,
  defaultNormalize: true,
  generationConcurrency: 2,
}

export const defaultNovelImportConfig: NovelImportConfig = {
  enabled: false,
  featurePermissions: { userGrants: [] },
}

export const defaultImageGenerationConfig: ImageGenerationConfig = {
  enabled: false,
  defaultModelId: '',
  providers: [],
  models: [],
  storageMode: 'local',
  immich: {
    serviceUrl: '',
    apiKey: '',
    projectName: '',
    allowPrivateNetwork: false,
  },
}

function normalizeImageGenerationConfig(config: ImageGenerationConfig): ImageGenerationConfig {
  const providers = Array.isArray(config.providers) ? config.providers : []
  return {
    ...defaultImageGenerationConfig,
    ...config,
    providers,
    models: (Array.isArray(config.models) ? config.models : []).map(model => {
      const provider = providers.find(item => item.id === model.providerId)
      return {
        ...model,
        providerId: model.providerId || provider?.id || '',
        providerModel: model.providerModel || model.model,
        baseUrl: provider?.baseUrl || model.baseUrl,
        apiKey: provider?.apiKey || model.apiKey,
        capabilities: {
          sizes: model.capabilities?.sizes || [],
          qualities: model.capabilities?.qualities || [],
          formats: model.capabilities?.formats || [],
          aspectRatios: model.capabilities?.aspectRatios || [],
        },
      }
    }),
    storageMode: config.storageMode === 'immich' ? 'immich' : 'local',
    immich: { ...defaultImageGenerationConfig.immich, ...(config.immich || {}) },
  }
}

export const useSystemConfigStore = create<SystemConfigState>((set, get) => ({
  registrationEnabled: false,
  aiConfig: { ...defaultAIConfig },
  aiConfigs: [],
  activeConfigId: '',
  voiceboxConfig: { ...defaultVoiceboxConfig },
  novelImportConfig: { ...defaultNovelImportConfig },
  imageGenerationConfig: { ...defaultImageGenerationConfig },
  isLoading: true,

  loadConfig: async () => {
    const config = await db.systemConfig.get('singleton')
    if (config) {
      const voiceboxConfig = { ...defaultVoiceboxConfig, ...(config.voiceboxConfig || {}) }
      const novelImportConfig = normalizeNovelImportConfig({ ...defaultNovelImportConfig, ...(config.novelImportConfig || {}) })
      const imageGenerationConfig = normalizeImageGenerationConfig({ ...defaultImageGenerationConfig, ...(config.imageGenerationConfig || {}) })
      const aiConfigs: AIModelConfig[] = config.aiConfigs || []
      const activeConfigId = config.activeConfigId || ''
      // 兼容旧数据：如果没有 aiConfigs，用现有 aiConfig 作为唯一配置
      let aiConfig = config.aiConfig || { ...defaultAIConfig }
      if (aiConfigs.length > 0 && activeConfigId) {
        const active = aiConfigs.find((c) => c.id === activeConfigId)
        if (active) aiConfig = { provider: active.provider, apiKey: active.apiKey, baseUrl: active.baseUrl, model: active.model, maxTokens: active.maxTokens }
      }
      set({ registrationEnabled: config.registrationEnabled, aiConfig, aiConfigs, activeConfigId, voiceboxConfig, novelImportConfig, imageGenerationConfig, isLoading: false })
      // 同步到全局 store
      useStore.getState().setAIConfig(aiConfig)
    } else {
      await db.systemConfig.add({ id: 'singleton', registrationEnabled: false, aiConfig: { ...defaultAIConfig }, aiConfigs: [], activeConfigId: '', voiceboxConfig: { ...defaultVoiceboxConfig }, novelImportConfig: { ...defaultNovelImportConfig }, imageGenerationConfig: { ...defaultImageGenerationConfig } })
      set({ registrationEnabled: false, aiConfig: { ...defaultAIConfig }, aiConfigs: [], activeConfigId: '', voiceboxConfig: { ...defaultVoiceboxConfig }, novelImportConfig: { ...defaultNovelImportConfig }, imageGenerationConfig: { ...defaultImageGenerationConfig }, isLoading: false })
    }
  },

  toggleRegistration: async () => {
    const newValue = !get().registrationEnabled
    await db.systemConfig.update('singleton', { registrationEnabled: newValue })
    set({ registrationEnabled: newValue })
  },

  toggleNovelImport: async () => {
    const newValue = !get().novelImportConfig.enabled
    const novelImportConfig = { ...get().novelImportConfig, enabled: newValue }
    await db.systemConfig.update('singleton', { novelImportConfig })
    set({ novelImportConfig })
  },

  saveNovelImportConfig: async (config: NovelImportConfig) => {
    const novelImportConfig = normalizeNovelImportConfig(config)
    await db.systemConfig.update('singleton', { novelImportConfig })
    set({ novelImportConfig })
  },

  saveImageGenerationConfig: async (config: ImageGenerationConfig) => {
    const imageGenerationConfig = normalizeImageGenerationConfig(config)
    await db.systemConfig.update('singleton', { imageGenerationConfig })
    set({ imageGenerationConfig })
  },

  canUseFeature: (user, feature) => canUseFeature(user, get().novelImportConfig, feature),

  saveAIConfig: async (config: AIConfig) => {
    await db.systemConfig.update('singleton', { aiConfig: config })
    set({ aiConfig: config })
    useStore.getState().setAIConfig(config)
  },

  saveAIConfigs: async (configs: AIModelConfig[], activeId: string) => {
    const active = configs.find((c) => c.id === activeId)
    const aiConfig: AIConfig = active
      ? { provider: active.provider, apiKey: active.apiKey, baseUrl: active.baseUrl, model: active.model, maxTokens: active.maxTokens }
      : get().aiConfig
    await db.systemConfig.update('singleton', { aiConfigs: configs, activeConfigId: activeId, aiConfig })
    set({ aiConfigs: configs, activeConfigId: activeId, aiConfig })
    useStore.getState().setAIConfig(aiConfig)
  },

  switchAIConfig: async (id: string) => {
    const { aiConfigs } = get()
    const active = aiConfigs.find((c) => c.id === id)
    if (!active) return
    const aiConfig: AIConfig = { provider: active.provider, apiKey: active.apiKey, baseUrl: active.baseUrl, model: active.model, maxTokens: active.maxTokens }
    await db.systemConfig.update('singleton', { activeConfigId: id, aiConfig })
    set({ activeConfigId: id, aiConfig })
    useStore.getState().setAIConfig(aiConfig)
  },

  saveVoiceboxConfig: async (config: VoiceboxConfig) => {
    await db.systemConfig.update('singleton', { voiceboxConfig: config })
    set({ voiceboxConfig: config })
  },
}))
