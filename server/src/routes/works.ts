import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest, CurrentUser } from '../middleware/auth.js'

const router = Router()

interface WorkRow {
  id: string
  ownerId: string
  shared: number
  title: string
  createdAt: number
  updatedAt: number
  data: string
  ownerName?: string
}

interface WorkInput extends Record<string, unknown> {
  id: string
  ownerId: string
  shared: boolean
  title: string
  createdAt: number
  updatedAt: number
}

function getAuthenticatedUser(req: AuthenticatedRequest) {
  return req.currentUser
}

// Work 行 → 完整 Work 对象
function rowToWork(row: WorkRow) {
  const data = JSON.parse(row.data)
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    shared: Boolean(row.shared),
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...data,
  }
}

function canAccessWork(user: CurrentUser, row: WorkRow) {
  if (row.ownerId === user.id) return 'owner'
  if (user.role === 'owner' || user.role === 'admin') return 'admin'
  if (row.shared) return 'shared'
  return 'none'
}

// 完整 Work 对象 → Work 行
function workToRow(work: WorkInput): WorkRow {
  const { id, ownerId, shared, title, createdAt, updatedAt, ...rest } = work
  return { id, ownerId, shared: shared ? 1 : 0, title, createdAt, updatedAt, data: JSON.stringify(rest) }
}

function mergeRecord(current: unknown, patch: unknown) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current
  return { ...((current && typeof current === 'object' && !Array.isArray(current)) ? current as Record<string, unknown> : {}), ...patch as Record<string, unknown> }
}

function mergeAudiobook(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const existing = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {}
  return {
    ...existing,
    ...patch,
    segmentsByChapter: mergeRecord(existing.segmentsByChapter, patch.segmentsByChapter),
    chapterAudio: mergeRecord(existing.chapterAudio, patch.chapterAudio),
    bystanderBindings: mergeRecord(existing.bystanderBindings, patch.bystanderBindings),
    characterBindings: mergeRecord(existing.characterBindings, patch.characterBindings),
    chapterBindings: mergeRecord(existing.chapterBindings, patch.chapterBindings),
  }
}

function defaultVisualAssets(): Record<string, unknown> {
  return { prompts: {}, images: {}, promptIdsByCharacter: {}, promptIdsByChapter: {}, candidateCache: {}, updatedAt: Date.now() }
}

function mergeVisualAssets(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const existing = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : defaultVisualAssets()
  const replaceImages = patch._replaceImages === true
  const next = {
    ...existing,
    prompts: mergeRecord(existing.prompts, patch.prompts),
    images: replaceImages ? mergeRecord({}, patch.images) : mergeRecord(existing.images, patch.images),
    promptIdsByCharacter: mergeRecord(existing.promptIdsByCharacter, patch.promptIdsByCharacter),
    promptIdsByChapter: mergeRecord(existing.promptIdsByChapter, patch.promptIdsByChapter),
    candidateCache: mergeRecord(existing.candidateCache, patch.candidateCache),
    updatedAt: Date.now(),
  }
  return next
}

const SEGMENT_PATCH_FIELDS = new Set([
  'speakerKind',
  'characterId',
  'speakerName',
  'text',
  'mood',
  'prompt',
  'attributionSource',
  'attributionStatus',
  'attributionConfidence',
  'attributionBatchId',
  'attributionError',
  'needsReview',
  'retryable',
  'textEditedAt',
  'speakerEditedAt',
  'promptEditedAt',
  'generationId',
  'status',
  'error',
  'generatedWith',
])

function applySegmentPatch(audiobook: Record<string, unknown>, segmentPatch: Record<string, unknown>): Record<string, unknown> {
  const chapterId = typeof segmentPatch.chapterId === 'string' ? segmentPatch.chapterId : ''
  const segmentId = typeof segmentPatch.segmentId === 'string' ? segmentPatch.segmentId : ''
  const fields = segmentPatch.fields && typeof segmentPatch.fields === 'object' && !Array.isArray(segmentPatch.fields) ? segmentPatch.fields as Record<string, unknown> : {}
  const baseVersion = typeof segmentPatch.baseVersion === 'number' ? segmentPatch.baseVersion : undefined
  if (!chapterId || !segmentId || !Object.keys(fields).length) throw new Error('缺少分段 patch 参数')
  const segmentsByChapter = mergeRecord(audiobook.segmentsByChapter, {}) as Record<string, unknown>
  const chapterSegments = Array.isArray(segmentsByChapter[chapterId]) ? segmentsByChapter[chapterId] as Record<string, unknown>[] : []
  const targetIndex = chapterSegments.findIndex((segment) => segment.id === segmentId)
  if (targetIndex < 0) throw new Error('分段不存在')
  const target = chapterSegments[targetIndex]
  const currentVersion = typeof target.segmentVersion === 'number' ? target.segmentVersion : 0
  if (typeof baseVersion === 'number' && baseVersion !== currentVersion) throw new Error('分段已更新，请刷新后重试')
  const allowedFields = Object.fromEntries(Object.entries(fields).filter(([key]) => SEGMENT_PATCH_FIELDS.has(key)))
  if (!Object.keys(allowedFields).length) throw new Error('无有效分段字段')
  const updatedSegment = { ...target, ...allowedFields, segmentVersion: currentVersion + 1 }
  return {
    ...audiobook,
    segmentsByChapter: {
      ...segmentsByChapter,
      [chapterId]: chapterSegments.map((segment, index) => index === targetIndex ? updatedSegment : segment),
    },
  }
}

// GET /api/works — 普通用户列出自己的作品 + 分享作品；拥有者和管理员列出全部作品
router.get('/', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const rows = currentUser.role === 'owner' || currentUser.role === 'admin'
    ? db.prepare('SELECT works.*, users.displayName as ownerName FROM works LEFT JOIN users ON users.id = works.ownerId').all() as WorkRow[]
    : db.prepare('SELECT works.*, users.displayName as ownerName FROM works LEFT JOIN users ON users.id = works.ownerId WHERE works.ownerId = ? OR works.shared = 1').all(currentUser.id) as WorkRow[]
  res.json(rows.map(rowToWork))
})

// GET /api/works/count?ownerId=X — 统计作品数
router.get('/count', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const ownerId = req.query.ownerId as string
  if (!ownerId) return res.status(400).json({ error: '缺少 ownerId 参数' })
  if (ownerId !== currentUser.id && currentUser.role === 'user') return res.status(403).json({ error: '无权统计该用户作品' })
  const row = db.prepare('SELECT COUNT(*) as count FROM works WHERE ownerId = ?').get(ownerId) as { count: number }
  res.json({ count: row.count })
})

// GET /api/works/:id — 按 ID 查询
router.get('/:id', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const row = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as WorkRow | undefined
  if (!row) return res.status(404).json({ error: '作品不存在' })
  const access = canAccessWork(currentUser, row)
  if (access === 'none') return res.status(403).json({ error: '无权查看该作品内容' })
  res.json(rowToWork(row))
})

// POST /api/works — 创建作品
router.post('/', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const row = workToRow({ ...(req.body as WorkInput), ownerId: currentUser.id })
  db.prepare(
    'INSERT INTO works (id, ownerId, shared, title, createdAt, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(row.id, row.ownerId, row.shared, row.title, row.createdAt, row.updatedAt, row.data)
  res.status(201).json(rowToWork(row))
})

router.patch('/:id/audiobook', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const existing = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as WorkRow | undefined
  if (!existing) return res.status(404).json({ error: '作品不存在' })
  if (existing.ownerId !== currentUser.id) return res.status(403).json({ error: '无权修改该作品' })
  const existingData = JSON.parse(existing.data)
  const audiobookChanges = req.body as Record<string, unknown>
  const updatedAt = Date.now()
  const { segmentPatch, ...audiobookPatch } = audiobookChanges
  let nextAudiobook = mergeAudiobook(existingData.audiobook, audiobookPatch)
  if (segmentPatch && typeof segmentPatch === 'object' && !Array.isArray(segmentPatch)) {
    try {
      nextAudiobook = applySegmentPatch(nextAudiobook, segmentPatch as Record<string, unknown>)
    } catch (error) {
      return res.status(error instanceof Error && error.message.includes('已更新') ? 409 : 400).json({ error: error instanceof Error ? error.message : '分段保存失败' })
    }
  }
  const merged = { ...existingData, audiobook: nextAudiobook }
  db.prepare('UPDATE works SET updatedAt = ?, data = ? WHERE id = ?').run(updatedAt, JSON.stringify(merged), req.params.id)
  res.json({ audiobook: merged.audiobook, updatedAt })
})

router.patch('/:id/visual-assets', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const existing = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as WorkRow | undefined
  if (!existing) return res.status(404).json({ error: '作品不存在' })
  if (existing.ownerId !== currentUser.id) return res.status(403).json({ error: '无权修改该作品' })
  const existingData = JSON.parse(existing.data)
  const visualAssetPatch = req.body as Record<string, unknown>
  const updatedAt = Date.now()
  const nextVisualAssets = mergeVisualAssets(existingData.visualAssets, visualAssetPatch)
  const merged = { ...existingData, visualAssets: nextVisualAssets }
  db.prepare('UPDATE works SET updatedAt = ?, data = ? WHERE id = ?').run(updatedAt, JSON.stringify(merged), req.params.id)
  res.json({ visualAssets: merged.visualAssets, updatedAt })
})

// PATCH /api/works/:id — 部分更新
router.patch('/:id', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const existing = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as WorkRow | undefined
  if (!existing) return res.status(404).json({ error: '作品不存在' })
  if (existing.ownerId !== currentUser.id) return res.status(403).json({ error: '无权修改该作品' })

  const fields = req.body
  const sets: string[] = []
  const values: any[] = []

  // 标量字段直接更新
  for (const key of ['shared', 'title', 'createdAt', 'updatedAt']) {
    if (key in fields) {
      sets.push(`${key} = ?`)
      values.push(key === 'shared' ? (fields[key] ? 1 : 0) : fields[key])
    }
  }

  // 嵌套字段合并到 data JSON
  const nestedKeys = ['seed', 'characters', 'settings', 'constraints', 'storylines', 'outline', 'chapters', 'eventLog', 'eventLogConfig', 'audiobook', 'visualAssets']
  const hasNested = nestedKeys.some((k) => k in fields)
  if (hasNested) {
    const existingData = JSON.parse(existing.data)
    const merged = { ...existingData }
    for (const key of nestedKeys) {
      if (key in fields) merged[key] = fields[key]
    }
    sets.push('data = ?')
    values.push(JSON.stringify(merged))
  }

  if (sets.length === 0) return res.status(400).json({ error: '无有效字段' })

  values.push(req.params.id)
  db.prepare(`UPDATE works SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as WorkRow
  res.json(rowToWork(updated))
})

// PUT /api/works/:id — 整体替换
router.put('/:id', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const existing = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as WorkRow | undefined
  if (!existing) return res.status(404).json({ error: '作品不存在' })
  if (existing.ownerId !== currentUser.id) return res.status(403).json({ error: '无权修改该作品' })
  const row = workToRow({ ...(req.body as WorkInput), ownerId: currentUser.id })
  db.prepare(
    'UPDATE works SET ownerId = ?, shared = ?, title = ?, createdAt = ?, updatedAt = ?, data = ? WHERE id = ?'
  ).run(row.ownerId, row.shared, row.title, row.createdAt, row.updatedAt, row.data, req.params.id)
  res.json({ ...req.body, id: req.params.id })
})

// DELETE /api/works/:id — 删除作品
router.delete('/:id', (req, res) => {
  const currentUser = getAuthenticatedUser(req as unknown as AuthenticatedRequest)
  const existing = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as WorkRow | undefined
  if (!existing) return res.status(404).json({ error: '作品不存在' })
  if (existing.ownerId !== currentUser.id) return res.status(403).json({ error: '无权删除该作品' })
  const result = db.prepare('DELETE FROM works WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: '作品不存在' })
  res.status(204).end()
})

export default router
