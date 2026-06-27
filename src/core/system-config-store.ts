import { create } from 'zustand'
import { db } from './db'
import type { AIConfig, AIModelConfig, VoiceboxConfig } from './types'
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
  isLoading: boolean
  loadConfig: () => Promise<void>
  toggleRegistration: () => Promise<void>
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

export const useSystemConfigStore = create<SystemConfigState>((set, get) => ({
  registrationEnabled: false,
  aiConfig: { ...defaultAIConfig },
  aiConfigs: [],
  activeConfigId: '',
  voiceboxConfig: { ...defaultVoiceboxConfig },
  isLoading: true,

  loadConfig: async () => {
    const config = await db.systemConfig.get('singleton')
    if (config) {
      const voiceboxConfig = { ...defaultVoiceboxConfig, ...(config.voiceboxConfig || {}) }
      const aiConfigs = config.aiConfigs || []
      const activeConfigId = config.activeConfigId || ''
      // 兼容旧数据：如果没有 aiConfigs，用现有 aiConfig 作为唯一配置
      let aiConfig = config.aiConfig || { ...defaultAIConfig }
      if (aiConfigs.length > 0 && activeConfigId) {
        const active = aiConfigs.find((c) => c.id === activeConfigId)
        if (active) aiConfig = { provider: active.provider, apiKey: active.apiKey, baseUrl: active.baseUrl, model: active.model, maxTokens: active.maxTokens }
      }
      set({ registrationEnabled: config.registrationEnabled, aiConfig, aiConfigs, activeConfigId, voiceboxConfig, isLoading: false })
      useStore.getState().setAIConfig(aiConfig)
    } else {
      await db.systemConfig.add({ id: 'singleton', registrationEnabled: false, aiConfig: { ...defaultAIConfig }, aiConfigs: [], activeConfigId: '', voiceboxConfig: { ...defaultVoiceboxConfig } })
      set({ registrationEnabled: false, aiConfig: { ...defaultAIConfig }, aiConfigs: [], activeConfigId: '', voiceboxConfig: { ...defaultVoiceboxConfig }, isLoading: false })
    }
  },

  toggleRegistration: async () => {
    const newValue = !get().registrationEnabled
    await db.systemConfig.update('singleton', { registrationEnabled: newValue })
    set({ registrationEnabled: newValue })
  },

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
