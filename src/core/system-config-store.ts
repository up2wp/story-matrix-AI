import { create } from 'zustand'
import { db } from './db'
import type { AIConfig, VoiceboxConfig } from './types'
import { useStore } from './store'

// ============================================================
// 系统配置状态管理
// ============================================================

interface SystemConfigState {
  registrationEnabled: boolean
  aiConfig: AIConfig
  voiceboxConfig: VoiceboxConfig
  isLoading: boolean
  loadConfig: () => Promise<void>
  toggleRegistration: () => Promise<void>
  saveAIConfig: (config: AIConfig) => Promise<void>
  saveVoiceboxConfig: (config: VoiceboxConfig) => Promise<void>
}

const defaultAIConfig: AIConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o-mini',
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
}

export const useSystemConfigStore = create<SystemConfigState>((set, get) => ({
  registrationEnabled: false,
  aiConfig: { ...defaultAIConfig },
  voiceboxConfig: { ...defaultVoiceboxConfig },
  isLoading: true,

  loadConfig: async () => {
    const config = await db.systemConfig.get('singleton')
    if (config) {
      const aiConfig = config.aiConfig || { ...defaultAIConfig }
      const voiceboxConfig = config.voiceboxConfig || { ...defaultVoiceboxConfig }
      set({ registrationEnabled: config.registrationEnabled, aiConfig, voiceboxConfig, isLoading: false })
      // 同步到全局 store
      useStore.getState().setAIConfig(aiConfig)
    } else {
      await db.systemConfig.add({ id: 'singleton', registrationEnabled: false, aiConfig: { ...defaultAIConfig }, voiceboxConfig: { ...defaultVoiceboxConfig } })
      set({ registrationEnabled: false, aiConfig: { ...defaultAIConfig }, voiceboxConfig: { ...defaultVoiceboxConfig }, isLoading: false })
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

  saveVoiceboxConfig: async (config: VoiceboxConfig) => {
    await db.systemConfig.update('singleton', { voiceboxConfig: config })
    set({ voiceboxConfig: config })
  },
}))
