import { Router } from 'express'
import db from '../db.js'
import { requireAdmin, sessions } from '../middleware/auth.js'

const router = Router()

// 行 → 对象（普通用户只获得可用性标记，不暴露真实 API Key）
function rowToConfig(row: any, includeAI = false) {
  const aiConfig = row.aiConfig ? JSON.parse(row.aiConfig) : undefined
  return {
    id: row.id,
    registrationEnabled: Boolean(row.registrationEnabled),
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

// GET /api/system-config — 获取配置（公开，不含 API Key；管理员带 token 可获取完整配置）
router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM systemConfig WHERE id = ?').get('singleton')
  if (!row) return res.status(404).json({ error: '配置不存在' })
  // 管理员可获取完整配置（含 AI Key）
  const authHeader = req.headers.authorization
  let isAdmin = false
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const session = sessions.get(token)
    isAdmin = session?.role === 'admin'
  }
  res.json(rowToConfig(row, isAdmin))
})

// POST /api/system-config — 创建配置（需管理员）
router.post('/', requireAdmin, (req, res) => {
  const { registrationEnabled, aiConfig } = req.body
  db.prepare(
    'INSERT INTO systemConfig (id, registrationEnabled, aiConfig) VALUES (?, ?, ?)'
  ).run('singleton', registrationEnabled ? 1 : 0, aiConfig ? JSON.stringify(aiConfig) : null)
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

  if (sets.length === 0) return res.status(400).json({ error: '无有效字段' })

  db.prepare(`UPDATE systemConfig SET ${sets.join(', ')} WHERE id = ?`).run(...values, 'singleton')
  const updated = db.prepare('SELECT * FROM systemConfig WHERE id = ?').get('singleton')
  res.json(rowToConfig(updated))
})

export default router
