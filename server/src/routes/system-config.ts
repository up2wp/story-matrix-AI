import { Router } from 'express'
import db from '../db.js'
import { requireAdmin, getCurrentUser } from '../middleware/auth.js'
import {
  defaultImageGenerationConfig,
  maskImageGenerationConfigForAdmin,
  maskImageGenerationConfigForUser,
  mergeImageGenerationConfig as mergeImageGenerationConfigFromService,
  normalizeImageGenerationConfig,
} from '../services/image-generation-config.js'
import {
  defaultNovelImportConfig,
  maskNovelImportConfigForUser,
  normalizeNovelImportConfig,
  prepareNovelImportConfigForAdminSave,
} from '../services/image-generation-access.js'

const router = Router()

// 行 → 对象（普通用户只获得可用性标记，不暴露真实 API Key）
function rowToConfig(row: any, includeAI = false, userId?: string) {
  const aiConfig = row.aiConfig ? JSON.parse(row.aiConfig) : undefined
  const voiceboxConfig = row.voiceboxConfig ? JSON.parse(row.voiceboxConfig) : defaultVoiceboxConfig()
  const novelImportConfig = row.novelImportConfig ? normalizeNovelImportConfig(JSON.parse(row.novelImportConfig)) : defaultNovelImportConfig()
  const imageGenerationConfig = row.imageGenerationConfig ? normalizeImageGenerationConfig(JSON.parse(row.imageGenerationConfig)) : defaultImageGenerationConfig()
  const safeVoiceboxConfig = includeAI ? voiceboxConfig : maskVoiceboxConfig(voiceboxConfig)
  const safeNovelImportConfig = includeAI ? novelImportConfig : maskNovelImportConfigForUser(novelImportConfig, userId)
  const safeImageGenerationConfig = includeAI ? maskImageGenerationConfigForAdmin(imageGenerationConfig) : maskImageGenerationConfigForUser(imageGenerationConfig)
  return {
    id: row.id,
    registrationEnabled: Boolean(row.registrationEnabled),
    voiceboxConfig: safeVoiceboxConfig,
    novelImportConfig: safeNovelImportConfig,
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

function mergeImageGenerationConfig(fieldsConfig: any) {
  const row = db.prepare('SELECT imageGenerationConfig FROM systemConfig WHERE id = ?').get('singleton') as { imageGenerationConfig?: string } | undefined
  const existing = row?.imageGenerationConfig ? JSON.parse(row.imageGenerationConfig) : defaultImageGenerationConfig()
  return mergeImageGenerationConfigFromService(fieldsConfig, existing)
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
  res.json(rowToConfig(row, isAdmin, user?.id))
})

// POST /api/system-config — 创建配置（需管理员）
router.post('/', requireAdmin, (req, res) => {
  const currentUser = getCurrentUser(req)
  if (!currentUser) return res.status(401).json({ error: '未登录，请先登录' })
  const { registrationEnabled, aiConfig, voiceboxConfig, novelImportConfig, imageGenerationConfig } = req.body
  const normalizedImageGenerationConfig = imageGenerationConfig ? mergeImageGenerationConfig(imageGenerationConfig) : defaultImageGenerationConfig()
  const normalizedNovelImportConfig = novelImportConfig ? prepareNovelImportConfigForAdminSave({ incoming: novelImportConfig, actorUserId: currentUser.id }) : defaultNovelImportConfig()
  db.prepare(
    'INSERT INTO systemConfig (id, registrationEnabled, aiConfig, voiceboxConfig, novelImportConfig, imageGenerationConfig) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('singleton', registrationEnabled ? 1 : 0, aiConfig ? JSON.stringify(aiConfig) : null, JSON.stringify(voiceboxConfig || defaultVoiceboxConfig()), JSON.stringify(normalizedNovelImportConfig), JSON.stringify(normalizedImageGenerationConfig))
  const created = db.prepare('SELECT * FROM systemConfig WHERE id = ?').get('singleton')
  res.status(201).json(rowToConfig(created, true, currentUser.id))
})

// PATCH /api/system-config — 部分更新（需管理员）
router.patch('/', requireAdmin, (req, res) => {
  const currentUser = getCurrentUser(req)
  if (!currentUser) return res.status(401).json({ error: '未登录，请先登录' })
  const fields = req.body

  const updateConfig = db.transaction(() => {
    const sets: string[] = []
    const values: unknown[] = []

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
      values.push(fields.novelImportConfig ? JSON.stringify(prepareNovelImportConfigForAdminSave({ incoming: fields.novelImportConfig, actorUserId: currentUser.id, database: db })) : JSON.stringify(defaultNovelImportConfig()))
    }
    if ('imageGenerationConfig' in fields) {
      sets.push('imageGenerationConfig = ?')
      values.push(fields.imageGenerationConfig ? JSON.stringify(mergeImageGenerationConfig(fields.imageGenerationConfig)) : JSON.stringify(defaultImageGenerationConfig()))
    }

    if (sets.length === 0) return undefined

    db.prepare(`UPDATE systemConfig SET ${sets.join(', ')} WHERE id = ?`).run(...values, 'singleton')
    return db.prepare('SELECT * FROM systemConfig WHERE id = ?').get('singleton')
  })

  let updated: unknown
  try {
    updated = updateConfig()
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : '系统配置无效' })
  }

  if (!updated) return res.status(400).json({ error: '无有效字段' })
  res.json(rowToConfig(updated, true, currentUser.id))
})

export default router
