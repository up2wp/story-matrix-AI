import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import db from '../db.js'

// ============================================================
// 会话管理 — SQLite 持久化 + httpOnly Cookie
// ============================================================

interface Session {
  userId: string
  username: string
  role: string
  createdAt: number
}

export interface CurrentUser {
  id: string
  username: string
  displayName: string
  role: 'owner' | 'admin' | 'user'
  createdAt: number
  deletedAt: number | null
}

export interface AuthenticatedRequest extends Request {
  session: Session
  currentUser: CurrentUser
}

const SESSION_TTL = 2 * 365 * 24 * 60 * 60 * 1000 // 2 年
const COOKIE_NAME = 'sm_session'
const isDev = process.env.NODE_ENV !== 'production'

/** 创建会话，设置 httpOnly cookie */
export function createSession(userId: string, username: string, role: string, res: Response): string {
  const token = crypto.randomBytes(32).toString('hex')
  const createdAt = Date.now()
  db.prepare('INSERT INTO sessions (token, userId, username, role, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(token, userId, username, role, createdAt)

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !isDev,
    maxAge: SESSION_TTL,
    path: '/',
  })
  return token
}

/** 销毁会话，清除 cookie */
export function destroySession(req: Request, res: Response): void {
  const token = req.cookies?.[COOKIE_NAME]
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  }
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

/** 销毁指定用户的所有会话（改密码/被禁用时调用） */
export function destroyUserSessions(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId)
}

/** 清理过期会话 */
function cleanExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE createdAt < ?').run(Date.now() - SESSION_TTL)
}

// 每 10 分钟清理一次过期会话
setInterval(cleanExpiredSessions, 10 * 60 * 1000)

/** 从请求 cookie 中解析会话 */
function getSession(req: Request): Session | null {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return null

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as Session | undefined
  if (!session) return null

  // 检查是否过期
  if (Date.now() - session.createdAt > SESSION_TTL) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  return session
}

export function getCurrentUser(req: Request): CurrentUser | null {
  const session = getSession(req)
  if (!session) return null

  const user = db.prepare(
    'SELECT id, username, displayName, role, createdAt, deletedAt FROM users WHERE id = ?'
  ).get(session.userId) as CurrentUser | undefined

  if (!user || user.deletedAt) return null
  // 同步最新用户名和角色
  if (session.username !== user.username || session.role !== user.role) {
    db.prepare('UPDATE sessions SET username = ?, role = ? WHERE token = ?')
      .run(user.username, user.role, req.cookies?.[COOKIE_NAME])
  }
  return user
}

/** 认证中间件 — 要求登录 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req)
  const user = getCurrentUser(req)
  if (!session || !user) {
    return res.status(401).json({ error: '未登录，请先登录' })
  }
  const authReq = req as AuthenticatedRequest
  authReq.session = session
  authReq.currentUser = user
  next()
}

/** 管理员权限中间件 — 要求 owner/admin 角色 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req)
  const user = getCurrentUser(req)
  if (!session || !user) {
    return res.status(401).json({ error: '未登录，请先登录' })
  }
  if (!['owner', 'admin'].includes(user.role)) {
    return res.status(403).json({ error: '需要管理员权限' })
  }
  const authReq = req as AuthenticatedRequest
  authReq.session = session
  authReq.currentUser = user
  next()
}

export function canManageUser(actor: CurrentUser, target: CurrentUser | { role: CurrentUser['role']; id?: string }) {
  if (actor.role === 'owner') return target.role !== 'owner'
  if (actor.role === 'admin') return target.role === 'user'
  return false
}

export function canCreateRole(actor: CurrentUser, role: CurrentUser['role']) {
  if (actor.role === 'owner') return role === 'admin' || role === 'user'
  if (actor.role === 'admin') return role === 'user'
  return false
}
