import { create } from 'zustand'
import { db } from './db'
import type { AIConfig, FeatureKey, NovelImportConfig, User, VoiceboxConfig } from './types'
import { canUseFeature, normalizeNovelImportConfig } from './feature-permissions'
import { useStore } from './store'

// ============================================================
// 系统配置状态管理
// ============================================================

interface SystemConfigState {
  registrationEnabled: boolean
  aiConfig: AIConfig
  voiceboxConfig: VoiceboxConfig
  novelImportConfig: NovelImportConfig
  isLoading: boolean
  loadConfig: () => Promise<void>
  toggleRegistration: () => Promise<void>
  toggleNovelImport: () => Promise<void>
  saveNovelImportConfig: (config: NovelImportConfig) => Promise<void>
  canUseFeature: (user: User | null | undefined, feature: FeatureKey) => boolean
  saveAIConfig: (config: AIConfig) => Promise<void>
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

export const useSystemConfigStore = create<SystemConfigState>((set, get) => ({
  registrationEnabled: false,
  aiConfig: { ...defaultAIConfig },
  voiceboxConfig: { ...defaultVoiceboxConfig },
  novelImportConfig: { ...defaultNovelImportConfig },
  isLoading: true,

  loadConfig: async () => {
    const config = await db.systemConfig.get('singleton')
    if (config) {
      const aiConfig = config.aiConfig || { ...defaultAIConfig }
      const voiceboxConfig = { ...defaultVoiceboxConfig, ...(config.voiceboxConfig || {}) }
      const novelImportConfig = normalizeNovelImportConfig({ ...defaultNovelImportConfig, ...(config.novelImportConfig || {}) })
      set({ registrationEnabled: config.registrationEnabled, aiConfig, voiceboxConfig, novelImportConfig, isLoading: false })
      // 同步到全局 store
      useStore.getState().setAIConfig(aiConfig)
    } else {
      await db.systemConfig.add({ id: 'singleton', registrationEnabled: false, aiConfig: { ...defaultAIConfig }, voiceboxConfig: { ...defaultVoiceboxConfig }, novelImportConfig: { ...defaultNovelImportConfig } })
      set({ registrationEnabled: false, aiConfig: { ...defaultAIConfig }, voiceboxConfig: { ...defaultVoiceboxConfig }, novelImportConfig: { ...defaultNovelImportConfig }, isLoading: false })
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

  canUseFeature: (user, feature) => canUseFeature(user, get().novelImportConfig, feature),

  saveAIConfig: async (config: AIConfig) => {
    await db.systemConfig.update('singleton', { aiConfig: config })
    set({ aiConfig: config })
    useStore.getState().setAIConfig(config)
  },

  saveVoiceboxConfig: async (config: VoiceboxConfig) => {
    await db.systemConfig.update('singleton', { voiceboxConfig: config })
    set({ voiceboxConfig: config })
  },
}))
