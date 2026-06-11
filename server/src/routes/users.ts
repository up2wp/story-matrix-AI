import { Router } from 'express'
import type { Response } from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { canCreateRole, canManageUser, requireAdmin, requireAuth, type AuthenticatedRequest, type CurrentUser } from '../middleware/auth.js'

const router = Router()

// 用户安全字段（排除 passwordHash）
const SAFE_FIELDS = 'id, username, displayName, role, createdAt, deletedAt'

function sha256(msg: string): string {
  return crypto.createHash('sha256').update(msg).digest('hex')
}

function createId(): string {
  return crypto.randomUUID()
}

function normalizeRole(role: unknown): CurrentUser['role'] {
  return role === 'owner' || role === 'admin' || role === 'user' ? role : 'user'
}

function getUser(id: string): CurrentUser | undefined {
  return db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(id) as CurrentUser | undefined
}

function paramId(req: AuthenticatedRequest) {
  return Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
}

function updateUser(req: AuthenticatedRequest, res: Response) {
  const currentUser = req.currentUser
  const id = paramId(req)
  const target = getUser(id)
  if (!target || target.deletedAt) return res.status(404).json({ error: '用户不存在' })
  if (!canManageUser(currentUser, target)) return res.status(403).json({ error: '无权编辑该用户' })

  const sets: string[] = []
  const values: unknown[] = []

  if ('displayName' in req.body) {
    const displayName = String(req.body.displayName || '').trim()
    if (!displayName) return res.status(400).json({ error: '显示名称不能为空' })
    sets.push('displayName = ?')
    values.push(displayName)
  }

  if ('role' in req.body) {
    const role = normalizeRole(req.body.role)
    if (target.role === 'owner' || role === 'owner') return res.status(403).json({ error: '不能变更拥有者角色' })
    if (!canCreateRole(currentUser, role)) return res.status(403).json({ error: '无权设置该角色' })
    sets.push('role = ?')
    values.push(role)
  }

  if ('password' in req.body || 'passwordHash' in req.body) {
    const hash = req.body.password ? sha256(String(req.body.password)) : String(req.body.passwordHash || '')
    if (!hash) return res.status(400).json({ error: '密码不能为空' })
    sets.push('passwordHash = ?')
    values.push(hash)
  }

  if (sets.length === 0) return res.status(400).json({ error: '无有效字段' })
  values.push(id)
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(id)
  return res.json(user)
}

// GET /api/users — 列出所有用户（需登录）
router.get('/', requireAdmin, (req, res) => {
  const currentUser = (req as AuthenticatedRequest).currentUser
  const users = currentUser.role === 'owner'
    ? db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE deletedAt IS NULL ORDER BY createdAt`).all()
    : db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE deletedAt IS NULL AND role = 'user' ORDER BY createdAt`).all()
  res.json(users)
})

// GET /api/users/by-username?username=X — 按用户名查询（需登录）
router.get('/by-username', requireAuth, (req, res) => {
  const username = req.query.username as string
  if (!username) return res.status(400).json({ error: '缺少 username 参数' })
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE username = ? AND deletedAt IS NULL`).get(username)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  res.json(user)
})

// GET /api/users/:id — 按 ID 查询（需登录）
router.get('/:id', requireAuth, (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ? AND deletedAt IS NULL`).get(id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  res.json(user)
})

// POST /api/users — 创建用户（需管理员）
router.post('/', requireAdmin, (req, res) => {
  const currentUser = (req as AuthenticatedRequest).currentUser
  const { username, password, passwordHash, displayName } = req.body
  const role = normalizeRole(req.body.role)
  if (!username || !displayName || (!password && !passwordHash)) {
    return res.status(400).json({ error: '缺少用户名、密码或显示名称' })
  }
  if (!canCreateRole(currentUser, role)) {
    return res.status(403).json({ error: '无权创建该角色用户' })
  }
  try {
    const id = req.body.id || createId()
    const createdAt = req.body.createdAt || Date.now()
    const hash = password ? sha256(password) : passwordHash
    db.prepare(
      'INSERT INTO users (id, username, passwordHash, displayName, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, username, hash, displayName, role, createdAt)
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(id)
    res.status(201).json(user)
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '用户名已存在' })
    }
    throw err
  }
})

// PUT /api/users/:id — 整体替换（需登录）
router.put('/:id', requireAdmin, (req, res) => {
  return updateUser(req as AuthenticatedRequest, res)
})

// PATCH /api/users/:id — 部分更新（需管理员）
router.patch('/:id', requireAdmin, (req, res) => {
  return updateUser(req as AuthenticatedRequest, res)
})

// DELETE /api/users/:id — 软删除用户（需管理员）
router.delete('/:id', requireAdmin, (req, res) => {
  const currentUser = (req as AuthenticatedRequest).currentUser
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const target = getUser(id)
  if (!target || target.deletedAt) return res.status(404).json({ error: '用户不存在' })
  if (target.id === currentUser.id) return res.status(400).json({ error: '不能停用当前登录用户' })
  if (target.role === 'owner') return res.status(403).json({ error: '不能停用拥有者' })
  if (!canManageUser(currentUser, target)) return res.status(403).json({ error: '无权停用该用户' })
  db.prepare('UPDATE users SET deletedAt = ? WHERE id = ?').run(Date.now(), id)
  res.status(204).end()
})

export default router
