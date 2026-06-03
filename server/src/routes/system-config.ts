import { Router } from 'express'
import db from '../db.js'

const router = Router()

// 行 → 对象
function rowToConfig(row: any) {
  return {
    id: row.id,
    registrationEnabled: Boolean(row.registrationEnabled),
    aiConfig: row.aiConfig ? JSON.parse(row.aiConfig) : undefined,
  }
}

// GET /api/system-config — 获取配置
router.get('/', (_req, res) => {
  const row = db.prepare('SELECT * FROM systemConfig WHERE id = ?').get('singleton')
  if (!row) return res.status(404).json({ error: '配置不存在' })
  res.json(rowToConfig(row))
})

// POST /api/system-config — 创建配置
router.post('/', (req, res) => {
  const { registrationEnabled, aiConfig } = req.body
  db.prepare(
    'INSERT INTO systemConfig (id, registrationEnabled, aiConfig) VALUES (?, ?, ?)'
  ).run('singleton', registrationEnabled ? 1 : 0, aiConfig ? JSON.stringify(aiConfig) : null)
  res.status(201).json(req.body)
})

// PATCH /api/system-config — 部分更新
router.patch('/', (req, res) => {
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
