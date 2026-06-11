import { Router } from 'express'
import db from '../db.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'

const router = Router()

// 用户安全字段（排除 passwordHash）
const SAFE_FIELDS = 'id, username, displayName, role, createdAt'

// GET /api/users — 列出所有用户（需登录）
router.get('/', requireAuth, (_req, res) => {
  const users = db.prepare(`SELECT ${SAFE_FIELDS} FROM users`).all()
  res.json(users)
})

// GET /api/users/by-username?username=X — 按用户名查询（需登录）
router.get('/by-username', requireAuth, (req, res) => {
  const username = req.query.username as string
  if (!username) return res.status(400).json({ error: '缺少 username 参数' })
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE username = ?`).get(username)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  res.json(user)
})

// GET /api/users/:id — 按 ID 查询（需登录）
router.get('/:id', requireAuth, (req, res) => {
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  res.json(user)
})

// POST /api/users — 创建用户（需管理员）
router.post('/', requireAdmin, (req, res) => {
  const { id, username, passwordHash, displayName, role, createdAt } = req.body
  try {
    db.prepare(
      'INSERT INTO users (id, username, passwordHash, displayName, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, username, passwordHash, displayName, role || 'user', createdAt || Date.now())
    res.status(201).json(req.body)
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '用户名已存在' })
    }
    throw err
  }
})

// PUT /api/users/:id — 整体替换（需登录）
router.put('/:id', requireAuth, (req, res) => {
  const { username, passwordHash, displayName, role, createdAt } = req.body
  const result = db.prepare(
    'UPDATE users SET username = ?, passwordHash = ?, displayName = ?, role = ?, createdAt = ? WHERE id = ?'
  ).run(username, passwordHash, displayName, role, createdAt, req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: '用户不存在' })
  res.json({ ...req.body, id: req.params.id })
})

// PATCH /api/users/:id — 部分更新（需登录）
router.patch('/:id', requireAuth, (req, res) => {
  const fields = req.body
  const sets: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (['username', 'passwordHash', 'displayName', 'role', 'createdAt'].includes(key)) {
      sets.push(`${key} = ?`)
      values.push(value)
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: '无有效字段' })
  values.push(req.params.id)
  const result = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  if (result.changes === 0) return res.status(404).json({ error: '用户不存在' })
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id)
  res.json(user)
})

// DELETE /api/users/:id — 删除用户（需登录）
router.delete('/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: '用户不存在' })
  res.status(204).end()
})

export default router
