import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import db from '../db.js'

// ============================================================
// 简易会话管理（适用于局域网工具场景）
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

export const sessions = new Map<string, Session>()

const SESSION_TTL = 24 * 60 * 60 * 1000 // 24 小时

/** 创建会话，返回 token */
export function createSession(userId: string, username: string, role: string): string {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, { userId, username, role, createdAt: Date.now() })
  return token
}

/** 销毁会话 */
export function destroySession(token: string): void {
  sessions.delete(token)
}

/** 清理过期会话 */
function cleanExpiredSessions() {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(token)
    }
  }
}

// 每 10 分钟清理一次过期会话
setInterval(cleanExpiredSessions, 10 * 60 * 1000)

/** 从请求中解析会话 */
function getSession(req: Request): Session | null {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const session = sessions.get(token)
  if (!session) return null
  // 检查是否过期
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token)
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
  session.username = user.username
  session.role = user.role
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
