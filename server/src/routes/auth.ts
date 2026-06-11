import { Router } from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { createSession, destroySession, requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()
const SAFE_FIELDS = 'id, username, displayName, role, createdAt, deletedAt'

interface UserRow {
  id: string
  username: string
  passwordHash: string
  displayName: string
  role: 'owner' | 'admin' | 'user'
  createdAt: number
  deletedAt: number | null
}

interface SystemConfigRow {
  registrationEnabled: number
}

function isSqliteUniqueError(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE'
}

function sha256(msg: string): string {
  return crypto.createHash('sha256').update(msg).digest('hex')
}

function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function serializeUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  }
}

// POST /api/auth/login — 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: '缺少用户名或密码' })
  }

  const passwordHash = sha256(password)
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND deletedAt IS NULL').get(username) as UserRow | undefined

  if (!user || user.passwordHash !== passwordHash) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }

  const token = createSession(user.id, user.username, user.role)
  res.json({
    token,
    user: serializeUser(user),
  })
})

// POST /api/auth/register — 公开注册（需系统开启）
router.post('/register', (req, res) => {
  const { username, password, displayName } = req.body
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: '缺少用户名、密码或显示名称' })
  }

  const config = db.prepare('SELECT registrationEnabled FROM systemConfig WHERE id = ?').get('singleton') as SystemConfigRow | undefined
  if (!config?.registrationEnabled) {
    return res.status(403).json({ error: '系统未开放注册' })
  }

  const id = createId()
  const createdAt = Date.now()
  const passwordHash = sha256(password)

  try {
    db.prepare(
      'INSERT INTO users (id, username, passwordHash, displayName, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, username, passwordHash, displayName, 'user', createdAt)
  } catch (err: unknown) {
    if (isSqliteUniqueError(err)) {
      return res.status(409).json({ error: '用户名已存在' })
    }
    throw err
  }

  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(id) as UserRow
  const token = createSession(id, username, 'user')
  res.status(201).json({ token, user })
})

// POST /api/auth/logout — 登出
router.post('/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization!
  const token = authHeader.slice(7)
  destroySession(token)
  res.json({ success: true })
})

// GET /api/auth/me — 获取当前用户信息
router.get('/me', requireAuth, (req, res) => {
  const session = (req as AuthenticatedRequest).session
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deletedAt IS NULL').get(session.userId) as UserRow | undefined
  if (!user) {
    return res.status(404).json({ error: '用户不存在' })
  }
  res.json({
    ...serializeUser(user),
  })
})

// PATCH /api/auth/profile — 修改当前用户资料
router.patch('/profile', requireAuth, (req, res) => {
  const currentUser = (req as AuthenticatedRequest).currentUser
  const displayName = String(req.body.displayName || '').trim()
  if (!displayName) return res.status(400).json({ error: '显示名称不能为空' })

  db.prepare('UPDATE users SET displayName = ? WHERE id = ?').run(displayName, currentUser.id)
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(currentUser.id)
  res.json(user)
})

// POST /api/auth/change-password — 修改当前用户密码
router.post('/change-password', requireAuth, (req, res) => {
  const currentUser = (req as AuthenticatedRequest).currentUser
  const { oldPassword, newPassword } = req.body
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '缺少原密码或新密码' })
  if (String(newPassword).length < 4) return res.status(400).json({ error: '密码至少4位' })

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deletedAt IS NULL').get(currentUser.id) as UserRow | undefined
  if (!user || user.passwordHash !== sha256(oldPassword)) {
    return res.status(401).json({ error: '原密码错误' })
  }

  db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(sha256(newPassword), currentUser.id)
  res.json({ success: true })
})

export default router
