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

/** 认证中间件 — 要求登录 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req)
  if (!session) {
    return res.status(401).json({ error: '未登录，请先登录' })
  }
  // 将会话信息挂载到 req 上
  ;(req as any).session = session
  next()
}

/** 管理员权限中间件 — 要求 admin 角色 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req)
  if (!session) {
    return res.status(401).json({ error: '未登录，请先登录' })
  }
  if (session.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' })
  }
  ;(req as any).session = session
  next()
}
