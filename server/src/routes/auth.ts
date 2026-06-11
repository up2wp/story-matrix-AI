import { Router } from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { createSession, destroySession, requireAuth } from '../middleware/auth.js'

const router = Router()
const SAFE_FIELDS = 'id, username, displayName, role, createdAt'

function sha256(msg: string): string {
  return crypto.createHash('sha256').update(msg).digest('hex')
}

function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function serializeUser(user: any) {
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
  const user: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username)

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

  const config: any = db.prepare('SELECT registrationEnabled FROM systemConfig WHERE id = ?').get('singleton')
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
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '用户名已存在' })
    }
    throw err
  }

  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(id)
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
  const session = (req as any).session
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId)
  if (!user) {
    return res.status(404).json({ error: '用户不存在' })
  }
  res.json({
    ...serializeUser(user),
  })
})

export default router
