import { Router } from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { createSession, destroySession, requireAuth } from '../middleware/auth.js'

const router = Router()

function sha256(msg: string): string {
  return crypto.createHash('sha256').update(msg).digest('hex')
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
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
    },
  })
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
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  })
})

export default router
