import { Router } from 'express'
import db from '../db.js'

const router = Router()

// Work 行 → 完整 Work 对象
function rowToWork(row: any) {
  const data = JSON.parse(row.data)
  return {
    id: row.id,
    ownerId: row.ownerId,
    shared: Boolean(row.shared),
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...data,
  }
}

// 完整 Work 对象 → Work 行
function workToRow(work: any) {
  const { id, ownerId, shared, title, createdAt, updatedAt, ...rest } = work
  return { id, ownerId, shared: shared ? 1 : 0, title, createdAt, updatedAt, data: JSON.stringify(rest) }
}

// GET /api/works — 列出所有作品
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM works').all()
  res.json(rows.map(rowToWork))
})

// GET /api/works/count?ownerId=X — 统计作品数
router.get('/count', (req, res) => {
  const ownerId = req.query.ownerId as string
  if (!ownerId) return res.status(400).json({ error: '缺少 ownerId 参数' })
  const row: any = db.prepare('SELECT COUNT(*) as count FROM works WHERE ownerId = ?').get(ownerId)
  res.json({ count: row.count })
})

// GET /api/works/:id — 按 ID 查询
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: '作品不存在' })
  res.json(rowToWork(row))
})

// POST /api/works — 创建作品
router.post('/', (req, res) => {
  const row = workToRow(req.body)
  db.prepare(
    'INSERT INTO works (id, ownerId, shared, title, createdAt, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(row.id, row.ownerId, row.shared, row.title, row.createdAt, row.updatedAt, row.data)
  res.status(201).json(req.body)
})

// PATCH /api/works/:id — 部分更新
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as any
  if (!existing) return res.status(404).json({ error: '作品不存在' })

  const fields = req.body
  const sets: string[] = []
  const values: any[] = []

  // 标量字段直接更新
  for (const key of ['ownerId', 'shared', 'title', 'createdAt', 'updatedAt']) {
    if (key in fields) {
      sets.push(`${key} = ?`)
      values.push(key === 'shared' ? (fields[key] ? 1 : 0) : fields[key])
    }
  }

  // 嵌套字段合并到 data JSON
  const nestedKeys = ['seed', 'characters', 'settings', 'constraints', 'storylines', 'outline', 'chapters', 'eventLog', 'eventLogConfig']
  const hasNested = nestedKeys.some((k) => k in fields)
  if (hasNested) {
    const existingData = JSON.parse(existing.data)
    const merged = { ...existingData }
    for (const key of nestedKeys) {
      if (key in fields) merged[key] = fields[key]
    }
    sets.push('data = ?')
    values.push(JSON.stringify(merged))
  }

  if (sets.length === 0) return res.status(400).json({ error: '无有效字段' })

  values.push(req.params.id)
  db.prepare(`UPDATE works SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id)
  res.json(rowToWork(updated))
})

// PUT /api/works/:id — 整体替换
router.put('/:id', (req, res) => {
  const row = workToRow(req.body)
  const result = db.prepare(
    'UPDATE works SET ownerId = ?, shared = ?, title = ?, createdAt = ?, updatedAt = ?, data = ? WHERE id = ?'
  ).run(row.ownerId, row.shared, row.title, row.createdAt, row.updatedAt, row.data, req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: '作品不存在' })
  res.json({ ...req.body, id: req.params.id })
})

// DELETE /api/works/:id — 删除作品
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM works WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: '作品不存在' })
  res.status(204).end()
})

export default router
