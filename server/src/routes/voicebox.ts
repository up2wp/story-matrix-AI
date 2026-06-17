import { Router } from 'express'
import type { Request, Response as ExpressResponse } from 'express'
import { randomUUID } from 'crypto'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

interface VoiceboxConfigPayload {
  serviceUrl?: string
  authType?: 'none' | 'bearer' | 'api-key' | 'custom-header'
  bearerToken?: string
  apiKey?: string
  customHeaderName?: string
  customHeaderValue?: string
  profileOwners?: Record<string, string>
  generationConcurrency?: number
}

interface VoiceboxProfilePayload {
  id?: string
  profile_id?: string
}

interface UserVoiceRow {
  id: string
  ownerId: string
  profileId: string
  sampleId?: string | null
  deletedAt?: number | null
}

interface ChapterAudioSegmentInput {
  order?: number
  generationId?: string
}

interface ChapterAudioJob {
  id: string
  ownerId: string
  status: 'pending' | 'generating' | 'completed' | 'failed'
  totalSegments: number
  completedSegments: number
  createdAt: number
  updatedAt: number
  audio?: Buffer
  error?: string
}

interface WavInfo {
  audioFormat: number
  numChannels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bitsPerSample: number
  data: Buffer
}

const CHAPTER_AUDIO_PAUSE_MS = 700
const chapterAudioJobs = new Map<string, ChapterAudioJob>()

function defaultVoiceboxConfig() {
  return { serviceUrl: 'http://127.0.0.1:17493', authType: 'none' as const, generationConcurrency: 2 }
}

function loadVoiceboxConfig(): VoiceboxConfigPayload {
  const row = db.prepare('SELECT voiceboxConfig FROM systemConfig WHERE id = ?').get('singleton') as { voiceboxConfig?: string } | undefined
  if (!row?.voiceboxConfig) return defaultVoiceboxConfig()
  return { ...defaultVoiceboxConfig(), ...JSON.parse(row.voiceboxConfig) } as VoiceboxConfigPayload
}

let activeVoiceboxGenerations = 0
const voiceboxGenerationQueue: Array<() => void> = []

function loadVoiceboxGenerationConcurrency() {
  const rawLimit = loadVoiceboxConfig().generationConcurrency
  return typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 2
}

async function runWithVoiceboxGenerationSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeVoiceboxGenerations >= loadVoiceboxGenerationConcurrency()) {
    await new Promise<void>((resolve) => voiceboxGenerationQueue.push(resolve))
  }
  activeVoiceboxGenerations += 1
  try {
    return await task()
  } finally {
    activeVoiceboxGenerations -= 1
    voiceboxGenerationQueue.shift()?.()
  }
}

function baseUrl() {
  const url = (loadVoiceboxConfig().serviceUrl || defaultVoiceboxConfig().serviceUrl).replace(/\/+$/, '')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Voicebox 服务地址必须使用 http 或 https')
  return parsed.toString().replace(/\/+$/, '')
}

function upstreamHeaders(extra?: Record<string, string>) {
  const config = loadVoiceboxConfig()
  const headers: Record<string, string> = { ...(extra || {}) }
  if (config.authType === 'bearer' && config.bearerToken && config.bearerToken !== '__server_configured__') {
    headers.Authorization = `Bearer ${config.bearerToken}`
  }
  if (config.authType === 'api-key' && config.apiKey && config.apiKey !== '__server_configured__') {
    headers['X-API-Key'] = config.apiKey
  }
  if (config.authType === 'custom-header' && config.customHeaderName && config.customHeaderValue && config.customHeaderValue !== '__server_configured__') {
    if (!/^[A-Za-z0-9-]+$/.test(config.customHeaderName)) throw new Error('自定义鉴权 Header 名称不合法')
    headers[config.customHeaderName] = config.customHeaderValue
  }
  return headers
}

function assertSafeId(id: string) {
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) throw new Error('ID 包含不安全字符')
}

function readAscii(buffer: Buffer, offset: number, length: number) {
  return buffer.toString('ascii', offset, offset + length)
}

function parseWav(buffer: Buffer): WavInfo {
  if (buffer.length < 44 || readAscii(buffer, 0, 4) !== 'RIFF' || readAscii(buffer, 8, 4) !== 'WAVE') throw new Error('Voicebox 返回的音频不是 WAV 格式')
  let offset = 12
  let format: Omit<WavInfo, 'data'> | undefined
  let data: Buffer | undefined
  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkStart + chunkSize > buffer.length) throw new Error('WAV 音频数据不完整')
    if (chunkId === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        numChannels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    }
    if (chunkId === 'data') data = buffer.subarray(chunkStart, chunkStart + chunkSize)
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  if (!format || !data) throw new Error('WAV 缺少 fmt 或 data 数据块')
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) throw new Error('当前仅支持拼接 PCM 16-bit WAV 音频')
  return { ...format, data }
}

function createWavHeader(format: Omit<WavInfo, 'data'>, dataBytes: number) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(format.audioFormat, 20)
  header.writeUInt16LE(format.numChannels, 22)
  header.writeUInt32LE(format.sampleRate, 24)
  header.writeUInt32LE(format.byteRate, 28)
  header.writeUInt16LE(format.blockAlign, 32)
  header.writeUInt16LE(format.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

function createSilentWavPcm16(format: Omit<WavInfo, 'data'>, durationMs: number) {
  const frameCount = Math.round((format.sampleRate * durationMs) / 1000)
  return Buffer.alloc(frameCount * format.blockAlign)
}

function concatWavSegments(buffers: Buffer[]) {
  if (!buffers.length) throw new Error('没有可合成的音频片段')
  const parsed = buffers.map(parseWav)
  const first = parsed[0]
  for (const item of parsed.slice(1)) {
    if (item.numChannels !== first.numChannels || item.sampleRate !== first.sampleRate || item.bitsPerSample !== first.bitsPerSample || item.blockAlign !== first.blockAlign) {
      throw new Error('音频片段 WAV 格式不一致，无法安全拼接')
    }
  }
  const silence = createSilentWavPcm16(first, CHAPTER_AUDIO_PAUSE_MS)
  const dataParts = parsed.flatMap((item, index) => index === 0 ? [item.data] : [silence, item.data])
  const data = Buffer.concat(dataParts)
  return Buffer.concat([createWavHeader(first, data.length), data])
}

async function readVoiceboxError(response: globalThis.Response) {
  const text = await response.text().catch(() => '')
  if (!text) return response.statusText
  try {
    const parsed = JSON.parse(text) as { detail?: string; error?: string; message?: string }
    return parsed.detail || parsed.error || parsed.message || text
  } catch {
    return text
  }
}

async function proxyJson(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: upstreamHeaders(init?.headers as Record<string, string> | undefined) })
  if (!response.ok) {
    return { ok: false as const, status: response.status, error: await readVoiceboxError(response) }
  }
  return { ok: true as const, status: response.status, data: await response.json() }
}

async function readVoiceboxStatus(response: globalThis.Response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) return response.json()
  const text = await response.text()
  const match = text.match(/^data:\s*(\{.*\})\s*$/m)
  if (!match) throw new Error('Voicebox 状态响应格式无效')
  return JSON.parse(match[1]) as Record<string, unknown>
}

function profileId(profile: VoiceboxProfilePayload) {
  return profile.id || profile.profile_id || ''
}

function filterVisibleProfiles(data: unknown, userId: string) {
  if (!Array.isArray(data)) return data
  const profileOwners = loadVoiceboxConfig().profileOwners || {}
  return data.filter((profile) => {
    const id = profileId(profile as VoiceboxProfilePayload)
    const ownerId = id ? profileOwners[id] : undefined
    return !ownerId || ownerId === userId
  })
}

function canUseProfile(profileId: string, userId: string) {
  const ownerId = loadVoiceboxConfig().profileOwners?.[profileId]
  return !ownerId || ownerId === userId
}

function canUploadSample(profileId: string, userId: string) {
  return loadVoiceboxConfig().profileOwners?.[profileId] === userId
}

function findOwnedVoiceByProfile(profileId: string, userId: string) {
  return db.prepare('SELECT * FROM userVoices WHERE profileId = ? AND ownerId = ? AND deletedAt IS NULL').get(profileId, userId) as UserVoiceRow | undefined
}

function ownsSample(sampleId: string, userId: string) {
  return Boolean(db.prepare('SELECT id FROM userVoices WHERE sampleId = ? AND ownerId = ? AND deletedAt IS NULL').get(sampleId, userId))
}

function canAccessGeneration(generationId: string, userId: string) {
  return Boolean(db.prepare('SELECT generationId FROM voiceboxGenerations WHERE generationId = ? AND ownerId = ?').get(generationId, userId))
}

function saveGenerationOwner(generationId: string, profileId: string, userId: string) {
  db.prepare('INSERT OR REPLACE INTO voiceboxGenerations (generationId, ownerId, profileId, createdAt) VALUES (?, ?, ?, ?)').run(generationId, userId, profileId, Date.now())
}

function saveProfileOwner(profile: VoiceboxProfilePayload, userId: string) {
  const id = profileId(profile)
  if (!id) return
  const config = loadVoiceboxConfig()
  const profileOwners = { ...(config.profileOwners || {}), [id]: userId }
  db.prepare('UPDATE systemConfig SET voiceboxConfig = ? WHERE id = ?').run(JSON.stringify({ ...config, profileOwners }), 'singleton')
}

async function collectRequestBody(req: Request) {
  const contentLength = Number(req.headers['content-length'] || 0)
  const maxBytes = 25 * 1024 * 1024
  if (contentLength > maxBytes) throw new Error('参考音频不能超过 25MB')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error('参考音频不能超过 25MB')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function assertMultipartLooksLikeAudio(body: Buffer) {
  const preview = body.toString('utf8', 0, Math.min(body.length, 4096))
  if (!/name="reference_text"/.test(preview)) throw new Error('请填写参考音频文本')
  if (!/name="file"/.test(preview)) throw new Error('请上传参考音频文件')
  if (!/(audio\/|filename="[^"]+\.(wav|mp3|m4a|ogg|flac|webm)")/i.test(preview)) throw new Error('请上传音频文件')
}

function sendProxyResult(res: ExpressResponse, result: Awaited<ReturnType<typeof proxyJson>>) {
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  return res.status(result.status).json(result.data)
}

router.get('/health', async (_req, res) => {
  try {
    sendProxyResult(res, await proxyJson('/health'))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 连接失败'
    res.status(502).json({ error: message })
  }
})

router.get('/profiles', async (req, res) => {
  try {
    const result = await proxyJson('/profiles')
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    res.status(result.status).json(filterVisibleProfiles(result.data, currentUser.id))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox profiles 获取失败'
    res.status(502).json({ error: message })
  }
})

router.post('/profiles', async (req, res) => {
  try {
    const result = await proxyJson('/profiles', {
      method: 'POST',
      headers: upstreamHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req.body),
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    saveProfileOwner(result.data as VoiceboxProfilePayload, currentUser.id)
    res.status(result.status).json(result.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox profile 创建失败'
    res.status(502).json({ error: message })
  }
})

router.get('/profiles/presets/:engine', async (req, res) => {
  try {
    assertSafeId(req.params.engine)
    sendProxyResult(res, await proxyJson(`/profiles/presets/${encodeURIComponent(req.params.engine)}`))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox presets 获取失败'
    res.status(400).json({ error: message })
  }
})

router.get('/profiles/:profileId/samples', async (req, res) => {
  try {
    assertSafeId(req.params.profileId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    if (!canUploadSample(req.params.profileId, currentUser.id)) return res.status(403).json({ error: '无权查看该音色样本' })
    sendProxyResult(res, await proxyJson(`/profiles/${encodeURIComponent(req.params.profileId)}/samples`))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox samples 获取失败'
    res.status(400).json({ error: message })
  }
})

router.post('/profiles/:profileId/samples', async (req, res) => {
  try {
    assertSafeId(req.params.profileId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    if (!canUploadSample(req.params.profileId, currentUser.id)) return res.status(403).json({ error: '无权上传该音色样本' })
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) return res.status(400).json({ error: '需要 multipart/form-data' })
    const body = await collectRequestBody(req)
    assertMultipartLooksLikeAudio(body)
    const response = await fetch(`${baseUrl()}/profiles/${encodeURIComponent(req.params.profileId)}/samples`, {
      method: 'POST',
      headers: upstreamHeaders({ 'Content-Type': contentType }),
      body,
    })
    if (!response.ok) return res.status(response.status).json({ error: await readVoiceboxError(response) })
    res.status(response.status).json(await response.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox sample 上传失败'
    res.status(502).json({ error: message })
  }
})

router.post('/generate', async (req, res) => {
  try {
    const profileId = String(req.body?.profile_id || '')
    assertSafeId(profileId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    const ownedVoice = findOwnedVoiceByProfile(profileId, currentUser.id)
    if (!canUseProfile(profileId, currentUser.id) || (loadVoiceboxConfig().profileOwners?.[profileId] && !ownedVoice)) return res.status(403).json({ error: '无权使用该音色' })
    const result = await runWithVoiceboxGenerationSlot(() => proxyJson('/generate', {
      method: 'POST',
      headers: upstreamHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req.body),
    }))
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    const generation = result.data as { generation_id?: string; id?: string }
    const generationId = generation.generation_id || generation.id
    if (generationId) {
      assertSafeId(generationId)
      saveGenerationOwner(generationId, profileId, currentUser.id)
    }
    res.status(result.status).json(result.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 生成请求失败'
    res.status(502).json({ error: message })
  }
})

router.get('/generate/:generationId/status', async (req, res) => {
  try {
    assertSafeId(req.params.generationId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    if (!canAccessGeneration(req.params.generationId, currentUser.id)) return res.status(403).json({ error: '无权查看该生成状态' })
    const response = await fetch(`${baseUrl()}/generate/${encodeURIComponent(req.params.generationId)}/status`, { headers: upstreamHeaders() })
    if (!response.ok) return res.status(response.status).json({ error: await readVoiceboxError(response) })
    res.status(response.status).json(await readVoiceboxStatus(response))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 状态获取失败'
    res.status(400).json({ error: message })
  }
})

async function streamAudio(res: ExpressResponse, path: string, range?: string) {
  const headers: Record<string, string> = {}
  if (range) headers.Range = range
  const response = await fetch(`${baseUrl()}${path}`, { headers: upstreamHeaders(headers) })
  if (!response.ok) return res.status(response.status).json({ error: await readVoiceboxError(response) })
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(header)
    if (value) res.setHeader(header, value)
  }
  res.status(response.status)
  if (!response.body) return res.end()
  for await (const chunk of response.body) res.write(chunk)
  return res.end()
}

async function fetchAudioBuffer(generationId: string) {
  const response = await fetch(`${baseUrl()}/audio/${encodeURIComponent(generationId)}`, { headers: upstreamHeaders() })
  if (!response.ok) throw new Error(await readVoiceboxError(response))
  return Buffer.from(await response.arrayBuffer())
}

function startChapterAudioJob(job: ChapterAudioJob, segments: Required<Pick<ChapterAudioSegmentInput, 'generationId' | 'order'>>[]) {
  void (async () => {
    try {
      job.status = 'generating'
      job.updatedAt = Date.now()
      const buffers: Buffer[] = []
      for (const segment of segments) {
        buffers.push(await fetchAudioBuffer(segment.generationId))
        job.completedSegments += 1
        job.updatedAt = Date.now()
      }
      job.audio = concatWavSegments(buffers)
      job.status = 'completed'
      job.updatedAt = Date.now()
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : '章节音频合成失败'
      job.updatedAt = Date.now()
    }
  })()
}

router.post('/chapter-audio', async (req, res) => {
  try {
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    const rawSegments = Array.isArray(req.body?.segments) ? req.body.segments as ChapterAudioSegmentInput[] : []
    const segments = rawSegments
      .map((segment) => ({ generationId: String(segment.generationId || ''), order: Number(segment.order || 0) }))
      .filter((segment) => segment.generationId)
      .sort((a, b) => a.order - b.order)
    if (!segments.length) return res.status(400).json({ error: '没有可合成的音频片段' })
    for (const segment of segments) {
      assertSafeId(segment.generationId)
      if (!canAccessGeneration(segment.generationId, currentUser.id)) return res.status(403).json({ error: '无权合成该音频片段' })
    }
    const job: ChapterAudioJob = {
      id: randomUUID(),
      ownerId: currentUser.id,
      status: 'pending',
      totalSegments: segments.length,
      completedSegments: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    chapterAudioJobs.set(job.id, job)
    startChapterAudioJob(job, segments)
    res.status(202).json({ jobId: job.id, status: job.status, totalSegments: job.totalSegments, completedSegments: job.completedSegments })
  } catch (error) {
    const message = error instanceof Error ? error.message : '章节音频合成请求失败'
    res.status(400).json({ error: message })
  }
})

router.get('/chapter-audio/:jobId', (req, res) => {
  try {
    assertSafeId(req.params.jobId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    const job = chapterAudioJobs.get(req.params.jobId)
    if (!job || job.ownerId !== currentUser.id) return res.status(404).json({ error: '章节音频合成任务不存在' })
    res.json({ jobId: job.id, status: job.status, totalSegments: job.totalSegments, completedSegments: job.completedSegments, error: job.error })
  } catch (error) {
    const message = error instanceof Error ? error.message : '章节音频合成状态获取失败'
    res.status(400).json({ error: message })
  }
})

router.get('/chapter-audio/:jobId/audio', (req, res) => {
  try {
    assertSafeId(req.params.jobId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    const job = chapterAudioJobs.get(req.params.jobId)
    if (!job || job.ownerId !== currentUser.id) return res.status(404).json({ error: '章节音频合成任务不存在' })
    if (job.status !== 'completed' || !job.audio) return res.status(409).json({ error: '章节音频尚未合成完成' })
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Content-Length', String(job.audio.length))
    res.setHeader('Content-Disposition', 'attachment; filename="chapter-audio.wav"')
    res.end(job.audio)
  } catch (error) {
    const message = error instanceof Error ? error.message : '章节音频下载失败'
    res.status(400).json({ error: message })
  }
})

router.get('/audio/:generationId', async (req, res) => {
  try {
    assertSafeId(req.params.generationId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    if (!canAccessGeneration(req.params.generationId, currentUser.id)) return res.status(403).json({ error: '无权播放该音频' })
    await streamAudio(res, `/audio/${encodeURIComponent(req.params.generationId)}`, req.headers.range)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 音频获取失败'
    res.status(400).json({ error: message })
  }
})

router.get('/samples/:sampleId', async (req, res) => {
  try {
    assertSafeId(req.params.sampleId)
    const currentUser = (req as unknown as AuthenticatedRequest).currentUser
    if (!ownsSample(req.params.sampleId, currentUser.id)) return res.status(403).json({ error: '无权播放该参考音频' })
    await streamAudio(res, `/samples/${encodeURIComponent(req.params.sampleId)}`, req.headers.range)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voicebox 样本音频获取失败'
    res.status(400).json({ error: message })
  }
})

export default router
