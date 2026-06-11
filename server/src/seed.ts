import crypto from 'crypto'
import db from './db.js'

function sha256(msg: string): string {
  return crypto.createHash('sha256').update(msg).digest('hex')
}

export function seed() {
  // 确保 systemConfig 存在
  const config = db.prepare('SELECT id FROM systemConfig WHERE id = ?').get('singleton')
  if (!config) {
    db.prepare(
      'INSERT INTO systemConfig (id, registrationEnabled, aiConfig) VALUES (?, ?, ?)'
    ).run('singleton', 0, JSON.stringify({
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
      model: 'gpt-4o-mini',
    }))
    console.log('[seed] 已创建默认系统配置')
  }

  // 确保 admin 拥有者存在
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (!admin) {
    const id = crypto.randomUUID()
    db.prepare(
      'INSERT INTO users (id, username, passwordHash, displayName, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, 'admin', sha256('admin'), 'Admin', 'owner', Date.now())
    console.log('[seed] 已创建默认拥有者 (admin/admin)')
  } else {
    db.prepare("UPDATE users SET role = 'owner', deletedAt = NULL WHERE username = 'admin'").run()
  }
}
