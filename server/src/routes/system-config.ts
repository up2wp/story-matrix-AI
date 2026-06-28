import { Router } from 'express'
import db from '../db.js'
import { requireAdmin, getCurrentUser } from '../middleware/auth.js'

const router = Router()

// 行 → 对象（普通用户只获得可用性标记，不暴露真实 API Key）
function rowToConfig(row: any, includeAI = false) {
  const aiConfig = row.aiConfig ? JSON.parse(row.aiConfig) : undefined
  const voiceboxConfig = row.voiceboxConfig ? JSON.parse(row.voiceboxConfig) : defaultVoiceboxConfig()
  const novelImportConfig = row.novelImportConfig ? normalizeNovelImportConfig({ ...defaultNovelImportConfig(), ...JSON.parse(row.novelImportConfig) }) : defaultNovelImportConfig()
  const imageGenerationConfig = row.imageGenerationConfig ? normalizeImageGenerationConfig({ ...defaultImageGenerationConfig(), ...JSON.parse(row.imageGenerationConfig) }) : defaultImageGenerationConfig()
  const safeVoiceboxConfig = includeAI ? voiceboxConfig : maskVoiceboxConfig(voiceboxConfig)
  const safeImageGenerationConfig = includeAI ? maskImageGenerationConfigForAdmin(imageGenerationConfig) : maskImageGenerationConfigForUser(imageGenerationConfig)
  return {
    id: row.id,
    registrationEnabled: Boolean(row.registrationEnabled),
    voiceboxConfig: safeVoiceboxConfig,
    novelImportConfig,
    imageGenerationConfig: safeImageGenerationConfig,
    ...(includeAI && { aiConfig }),
    ...(!includeAI && aiConfig && {
      aiConfig: {
        provider: aiConfig.provider,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        apiKey: aiConfig.apiKey ? '__server_configured__' : '',
      },
    }),
  }
}

function defaultNovelImportConfig() {
  return { enabled: false, featurePermissions: { userGrants: [] } }
}

const FEATURE_KEYS = ['novelImport', 'importBackfill', 'imageGeneration']

function normalizeNovelImportConfig(config: any) {
  const grants = Array.isArray(config?.featurePermissions?.userGrants) ? config.featurePermissions.userGrants : []
  return {
    enabled: Boolean(config?.enabled),
    featurePermissions: {
      userGrants: grants
        .filter((grant: any) => typeof grant?.userId === 'string' && grant.userId.trim())
        .map((grant: any) => ({
          userId: grant.userId,
          features: Array.from(new Set(Array.isArray(grant.features) ? grant.features.filter((feature: string) => FEATURE_KEYS.includes(feature)) : [])),
        }))
        .filter((grant: any) => grant.features.length > 0),
    },
  }
}

function defaultVoiceboxConfig() {
  return {
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
}

function defaultImageGenerationConfig() {
  return {
    enabled: false,
    defaultModelId: '',
    models: [],
    storageMode: 'local',
    immich: {
      serviceUrl: '',
      apiKey: '',
      projectName: '',
      allowPrivateNetwork: false,
    },
  }
}

function normalizeImageGenerationConfig(config: any) {
  const models = Array.isArray(config?.models) ? config.models : []
  const seenIds = new Set<string>()
  const normalizedModels = models
    .map((model: any) => ({
      id: String(model?.id || '').trim(),
      label: String(model?.label || model?.id || '').trim(),
      provider: model?.provider === 'custom' ? 'custom' : 'openai',
      baseUrl: String(model?.baseUrl || '').trim(),
      apiKey: String(model?.apiKey || ''),
      model: String(model?.model || '').trim(),
      enabled: Boolean(model?.enabled),
      capabilities: {
        sizes: normalizeStringList(model?.capabilities?.sizes),
        qualities: normalizeStringList(model?.capabilities?.qualities),
        formats: normalizeStringList(model?.capabilities?.formats),
      },
    }))
    .filter((model: any) => {
      if (!model.id || seenIds.has(model.id)) return false
      seenIds.add(model.id)
      return true
    })

  const defaultModelId = String(config?.defaultModelId || '').trim()
  const enabledModelIds = new Set(normalizedModels.filter((model: any) => model.enabled).map((model: any) => model.id))
  const storageMode = config?.storageMode === 'immich' ? 'immich' : 'local'
  return {
    enabled: Boolean(config?.enabled),
    defaultModelId: enabledModelIds.has(defaultModelId) ? defaultModelId : (normalizedModels.find((model: any) => model.enabled)?.id || ''),
    models: normalizedModels,
    storageMode,
    immich: {
      serviceUrl: String(config?.immich?.serviceUrl || '').trim(),
      apiKey: String(config?.immich?.apiKey || ''),
      projectName: String(config?.immich?.projectName || '').trim(),
      allowPrivateNetwork: Boolean(config?.immich?.allowPrivateNetwork),
    },
  }
}

function normalizeStringList(value: unknown) {
  if (typeof value === 'string') return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)))
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)))
}

function validateImageGenerationConfig(config: ReturnType<typeof defaultImageGenerationConfig>) {
  if (!config.enabled) return
  const enabledModels = config.models.filter((model: any) => model.enabled)
  if (enabledModels.length === 0) throw new Error('开启生图功能前至少需要启用一个生图模型')
  for (const model of enabledModels as any[]) {
    if (!model.id || !model.label || !model.baseUrl || !model.model) throw new Error('启用的生图模型必须包含 ID、名称、API 地址和模型名')
    if (!model.apiKey) throw new Error(`生图模型 ${model.label} 缺少 API Key`)
  }
  if (config.storageMode === 'immich') {
    if (!config.immich.serviceUrl || !config.immich.apiKey || !config.immich.projectName) throw new Error('启用 Immich 存储前需要填写服务地址、API Key 和项目名称')
  }
}

function maskImageGenerationConfigForAdmin(config: any) {
  return {
    ...config,
    models: config.models.map((model: any) => ({
      ...model,
      apiKey: model.apiKey ? '__server_configured__' : '',
    })),
    immich: {
      ...config.immich,
      apiKey: config.immich?.apiKey ? '__server_configured__' : '',
    },
  }
}

function maskImageGenerationConfigForUser(config: any) {
  return {
    enabled: config.enabled,
    defaultModelId: config.defaultModelId,
    storageMode: config.storageMode,
    models: config.models
      .filter((model: any) => model.enabled)
      .map((model: any) => ({
        id: model.id,
        label: model.label,
        provider: model.provider,
        model: model.model,
        enabled: model.enabled,
        capabilities: model.capabilities,
      })),
  }
}

function mergeImageGenerationConfig(fieldsConfig: any) {
  const row = db.prepare('SELECT imageGenerationConfig FROM systemConfig WHERE id = ?').get('singleton') as { imageGenerationConfig?: string } | undefined
  const existing = row?.imageGenerationConfig ? normalizeImageGenerationConfig({ ...defaultImageGenerationConfig(), ...JSON.parse(row.imageGenerationConfig) }) : defaultImageGenerationConfig()
  const merged = normalizeImageGenerationConfig({ ...existing, ...fieldsConfig })
  merged.models = merged.models.map((model: any) => {
    const existingModel = (existing.models as any[]).find(item => item.id === model.id)
    return {
      ...model,
      apiKey: model.apiKey === '__server_configured__' ? existingModel?.apiKey || '' : model.apiKey,
    }
  })
  merged.immich = {
    ...merged.immich,
    apiKey: merged.immich.apiKey === '__server_configured__' ? existing.immich?.apiKey || '' : merged.immich.apiKey,
  }
  validateImageGenerationConfig(merged)
  return merged
}

function maskVoiceboxConfig(config: ReturnType<typeof defaultVoiceboxConfig>) {
  return {
    ...config,
    bearerToken: config.bearerToken ? '__server_configured__' : '',
    apiKey: config.apiKey ? '__server_configured__' : '',
    customHeaderValue: config.customHeaderValue ? '__server_configured__' : '',
  }
}

function mergeVoiceboxConfig(fieldsConfig: ReturnType<typeof defaultVoiceboxConfig>) {
  const row = db.prepare('SELECT voiceboxConfig FROM systemConfig WHERE id = ?').get('singleton') as { voiceboxConfig?: string } | undefined
  const existing = row?.voiceboxConfig ? { ...defaultVoiceboxConfig(), ...JSON.parse(row.voiceboxConfig) } as ReturnType<typeof defaultVoiceboxConfig> : defaultVoiceboxConfig()
  return {
    ...existing,
    ...fieldsConfig,
    bearerToken: fieldsConfig.bearerToken === '__server_configured__' ? existing.bearerToken : fieldsConfig.bearerToken,
    apiKey: fieldsConfig.apiKey === '__server_configured__' ? existing.apiKey : fieldsConfig.apiKey,
    customHeaderValue: fieldsConfig.customHeaderValue === '__server_configured__' ? existing.customHeaderValue : fieldsConfig.customHeaderValue,
  }
}

// GET /api/system-config — 获取配置（公开，不含 API Key；管理员带 cookie 可获取完整配置）
router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM systemConfig WHERE id = ?').get('singleton')
  if (!row) return res.status(404).json({ error: '配置不存在' })
  // 管理员可获取完整配置（含 AI Key）
  const user = getCurrentUser(req)
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'
  res.json(rowToConfig(row, isAdmin))
})

// POST /api/system-config — 创建配置（需管理员）
router.post('/', requireAdmin, (req, res) => {
  const { registrationEnabled, aiConfig, voiceboxConfig, novelImportConfig, imageGenerationConfig } = req.body
  const normalizedImageGenerationConfig = imageGenerationConfig ? mergeImageGenerationConfig(imageGenerationConfig) : defaultImageGenerationConfig()
  db.prepare(
    'INSERT INTO systemConfig (id, registrationEnabled, aiConfig, voiceboxConfig, novelImportConfig, imageGenerationConfig) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('singleton', registrationEnabled ? 1 : 0, aiConfig ? JSON.stringify(aiConfig) : null, JSON.stringify(voiceboxConfig || defaultVoiceboxConfig()), JSON.stringify(novelImportConfig || defaultNovelImportConfig()), JSON.stringify(normalizedImageGenerationConfig))
  res.status(201).json(req.body)
})

// PATCH /api/system-config — 部分更新（需管理员）
router.patch('/', requireAdmin, (req, res) => {
  const fields = req.body
  const sets: string[] = []
  const values: any[] = []

  if ('registrationEnabled' in fields) {
    sets.push('registrationEnabled = ?')
    values.push(fields.registrationEnabled ? 1 : 0)
  }
  if ('aiConfig' in fields) {
    sets.push('aiConfig = ?')
    values.push(fields.aiConfig ? JSON.stringify(fields.aiConfig) : null)
  }
  if ('voiceboxConfig' in fields) {
    sets.push('voiceboxConfig = ?')
    values.push(fields.voiceboxConfig ? JSON.stringify(mergeVoiceboxConfig(fields.voiceboxConfig)) : JSON.stringify(defaultVoiceboxConfig()))
  }
  if ('novelImportConfig' in fields) {
    sets.push('novelImportConfig = ?')
    values.push(fields.novelImportConfig ? JSON.stringify(normalizeNovelImportConfig({ ...defaultNovelImportConfig(), ...fields.novelImportConfig })) : JSON.stringify(defaultNovelImportConfig()))
  }
  if ('imageGenerationConfig' in fields) {
    try {
      sets.push('imageGenerationConfig = ?')
      values.push(fields.imageGenerationConfig ? JSON.stringify(mergeImageGenerationConfig(fields.imageGenerationConfig)) : JSON.stringify(defaultImageGenerationConfig()))
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : '生图配置无效' })
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: '无有效字段' })

  db.prepare(`UPDATE systemConfig SET ${sets.join(', ')} WHERE id = ?`).run(...values, 'singleton')
  const updated = db.prepare('SELECT * FROM systemConfig WHERE id = ?').get('singleton')
  res.json(rowToConfig(updated))
})

export default router
