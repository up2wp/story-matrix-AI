import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

interface UserVoiceRow {
  id: string
  ownerId: string
  displayName: string
  profileId: string
  profileName?: string | null
  sampleId?: string | null
  referenceText: string
  consentConfirmedAt: number
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

interface VoiceboxConfigRow {
  voiceboxConfig?: string | null
}

interface VoiceboxConfigPayload {
  profileOwners?: Record<string, string>
}

function currentUserId(req: AuthenticatedRequest) {
  return req.currentUser.id
}

function rowToVoice(row: UserVoiceRow) {
  return {
    ...row,
    profileName: row.profileName || undefined,
    sampleId: row.sampleId || undefined,
    deletedAt: row.deletedAt || undefined,
  }
}

function requireText(value: unknown, message: string) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(message)
  return text
}

function assertSafeId(id: string) {
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) throw new Error('ID 包含不安全字符')
}

function loadProfileOwners() {
  const row = db.prepare('SELECT voiceboxConfig FROM systemConfig WHERE id = ?').get('singleton') as VoiceboxConfigRow | undefined
  if (!row?.voiceboxConfig) return {}
  const config = JSON.parse(row.voiceboxConfig) as VoiceboxConfigPayload
  return config.profileOwners || {}
}

router.get('/', (req, res) => {
  const ownerId = currentUserId(req as unknown as AuthenticatedRequest)
  const rows = db.prepare('SELECT * FROM userVoices WHERE ownerId = ? AND deletedAt IS NULL ORDER BY updatedAt DESC').all(ownerId) as UserVoiceRow[]
  res.json(rows.map(rowToVoice))
})

router.post('/', (req, res) => {
  try {
    const ownerId = currentUserId(req as unknown as AuthenticatedRequest)
    const displayName = requireText(req.body?.displayName, '请填写音色名称')
    const profileId = requireText(req.body?.profileId, '缺少 Voicebox profileId')
    const referenceText = requireText(req.body?.referenceText, '请填写参考音频文本')
    assertSafeId(profileId)
    if (!req.body?.consentConfirmed) return res.status(400).json({ error: '请确认声音授权' })
    if (loadProfileOwners()[profileId] !== ownerId) return res.status(403).json({ error: '无权登记该 Voicebox 音色' })
    const now = Date.now()
    const id = typeof req.body?.id === 'string' && req.body.id.trim() ? req.body.id.trim() : `voice_${now}_${Math.random().toString(36).slice(2, 8)}`
    assertSafeId(id)
    const profileName = typeof req.body?.profileName === 'string' ? req.body.profileName.trim() : null
    const sampleId = typeof req.body?.sampleId === 'string' ? req.body.sampleId.trim() : null
    if (sampleId) assertSafeId(sampleId)
    db.prepare(`
      INSERT INTO userVoices (id, ownerId, displayName, profileId, profileName, sampleId, referenceText, consentConfirmedAt, createdAt, updatedAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(id, ownerId, displayName, profileId, profileName, sampleId, referenceText, now, now, now)
    const row = db.prepare('SELECT * FROM userVoices WHERE id = ? AND ownerId = ?').get(id, ownerId) as UserVoiceRow
    res.status(201).json(rowToVoice(row))
  } catch (error) {
    const message = error instanceof Error ? error.message : '声音创建失败'
    res.status(400).json({ error: message })
  }
})

router.patch('/:id', (req, res) => {
  const ownerId = currentUserId(req as unknown as AuthenticatedRequest)
  const existing = db.prepare('SELECT * FROM userVoices WHERE id = ? AND ownerId = ? AND deletedAt IS NULL').get(req.params.id, ownerId) as UserVoiceRow | undefined
  if (!existing) return res.status(404).json({ error: '声音不存在' })
  const displayName = requireText(req.body?.displayName, '请填写音色名称')
  const now = Date.now()
  db.prepare('UPDATE userVoices SET displayName = ?, updatedAt = ? WHERE id = ? AND ownerId = ?').run(displayName, now, req.params.id, ownerId)
  const row = db.prepare('SELECT * FROM userVoices WHERE id = ? AND ownerId = ?').get(req.params.id, ownerId) as UserVoiceRow
  res.json(rowToVoice(row))
})

router.delete('/:id', (req, res) => {
  const ownerId = currentUserId(req as unknown as AuthenticatedRequest)
  const existing = db.prepare('SELECT * FROM userVoices WHERE id = ? AND ownerId = ? AND deletedAt IS NULL').get(req.params.id, ownerId) as UserVoiceRow | undefined
  if (!existing) return res.status(404).json({ error: '声音不存在' })
  const now = Date.now()
  db.prepare('UPDATE userVoices SET deletedAt = ?, updatedAt = ? WHERE id = ? AND ownerId = ?').run(now, now, req.params.id, ownerId)
  res.status(204).end()
})

export default router
