import { useCallback, useMemo, useState } from 'react'
import { Modal, message } from 'antd'
import type { AudiobookSegment, Chapter, ChapterAudioState, VoiceBinding, WorkAudiobookConfig } from '@/core/types'
import type { VoiceboxProfile } from './voiceboxClient'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generate } from '@/ai/client'
import { AUDIOBOOK_ATTRIBUTION_SYSTEM_PROMPT, AUDIOBOOK_TEMPLATE_SYSTEM_PROMPT, AUDIOBOOK_TONE_SYSTEM_PROMPT, buildAudiobookAttributionPrompt, buildAudiobookToneCompressionPrompt, buildQwenTtsRoleTemplatePrompt } from '@/ai/prompts/audiobook'
import { applyAttributionResults, markAttributionFailed, mergeConsecutiveSegments, parseAttributionJson, segmentSpeakerKey } from './segmentUtils'
import { createRuleBasedSegments, segmentsNeedingAttribution } from './segmentRules'
import { voiceboxClient } from './voiceboxClient'
import { buildSegmentTonePrompt, fillPromptTemplate, textHash, validatePromptTemplate } from './promptTemplateUtils'

function now() {
  return Date.now()
}

function defaultNarratorBinding(): VoiceBinding {
  const timestamp = now()
  const prompt = '自然、清晰、克制，适合长篇小说旁白。当前语境：【上下文】'
  return {
    id: 'narrator',
    speakerKind: 'narrator',
    displayName: '旁白',
    source: 'pending',
    prompt,
    promptTemplate: prompt,
    updatedAt: timestamp,
    promptUpdatedAt: timestamp,
  }
}

function ensureAudiobook(work: NonNullable<ReturnType<typeof useStore.getState>['currentWork']>): WorkAudiobookConfig {
  return work.audiobook || {
    narratorBinding: defaultNarratorBinding(),
    characterBindings: {},
    chapterBindings: {},
    segmentsByChapter: {},
    chapterAudio: {},
  }
}

function profileId(profile: VoiceboxProfile) {
  return profile.id || profile.profile_id || ''
}

function profileName(profile: VoiceboxProfile) {
  return profile.name || profile.display_name || profileId(profile)
}

function isBindingReady(binding?: VoiceBinding) {
  return Boolean(binding?.profileId && binding.source !== 'pending')
}

function defaultNarratorPrompt(work: NonNullable<ReturnType<typeof useStore.getState>['currentWork']>) {
  return `${work.seed.tone || '自然'}、清晰、克制，适合长篇小说旁白。当前语境：【上下文】`
}

function bindingPromptTemplate(binding: VoiceBinding | undefined, work: NonNullable<ReturnType<typeof useStore.getState>['currentWork']>) {
  if (!binding) return ''
  return binding.promptTemplate || binding.prompt || (binding.speakerKind === 'narrator' ? defaultNarratorPrompt(work) : '')
}

interface ToneCompressionResult {
  id?: string
  segmentId?: string
  tone?: string
  prompt?: string
  description?: string
}

function parseToneCompressionJson(text: string): ToneCompressionResult[] {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    if (!Array.isArray(parsed)) throw new Error('AI 语气结果不是数组')
    return parsed as ToneCompressionResult[]
  }
  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart === -1 || objectEnd <= objectStart) throw new Error('AI 没有返回语气 JSON')
  const parsed = JSON.parse(cleaned.slice(objectStart, objectEnd + 1)) as { results?: ToneCompressionResult[] } | ToneCompressionResult
  if ('results' in parsed && Array.isArray(parsed.results)) return parsed.results
  return [parsed as ToneCompressionResult]
}

function toneText(result: ToneCompressionResult) {
  return result.tone?.trim() || result.prompt?.trim() || result.description?.trim() || ''
}

function toneSegmentId(result: ToneCompressionResult) {
  return result.segmentId || result.id || ''
}

const ATTRIBUTION_BATCH_SIZE = 4

interface SegmentationProgress {
  chapterId: string
  stage: 'rule_splitting' | 'attributing_batches' | 'completed' | 'partial_failed' | 'failed'
  total: number
  completed: number
  failed: number
  message: string
}

const VOICEBOX_COMPLETE_STATUSES = new Set(['completed', 'succeeded', 'success', 'done', 'finished'])
const VOICEBOX_FAILED_STATUSES = new Set(['failed', 'error'])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForVoiceboxGeneration(generationId: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { status, error } = await voiceboxClient.status(generationId)
    const normalizedStatus = status?.toLowerCase()
    if (normalizedStatus && VOICEBOX_COMPLETE_STATUSES.has(normalizedStatus)) return
    if (normalizedStatus && VOICEBOX_FAILED_STATUSES.has(normalizedStatus)) throw new Error(error || 'Voicebox 音频生成失败')
    await sleep(2000)
  }
  throw new Error('Voicebox 音频生成超时')
}

function invalidateAllAudio(config: WorkAudiobookConfig): WorkAudiobookConfig {
  return {
    ...config,
    segmentsByChapter: Object.fromEntries(Object.entries(config.segmentsByChapter).map(([chapterId, segments]) => [
      chapterId,
      segments.map((segment) => segment.generationId ? { ...segment, status: 'stale' as const, generationId: undefined } : segment),
    ])),
    chapterAudio: Object.fromEntries(Object.entries(config.chapterAudio).map(([chapterId, state]) => [
      chapterId,
      { ...state, status: 'stale' as const, generationIds: [], error: '旁白配置已变更，请重新生成' },
    ])),
  }
}

function invalidateCharacterAudio(config: WorkAudiobookConfig, characterId: string): WorkAudiobookConfig {
  return {
    ...config,
    segmentsByChapter: Object.fromEntries(Object.entries(config.segmentsByChapter).map(([chapterId, segments]) => [
      chapterId,
      segments.map((segment) => segment.characterId === characterId && segment.generationId ? { ...segment, status: 'stale' as const, generationId: undefined } : segment),
    ])),
    chapterAudio: Object.fromEntries(Object.entries(config.chapterAudio).map(([chapterId, state]) => {
      const affected = config.segmentsByChapter[chapterId]?.some((segment) => segment.characterId === characterId)
      return [chapterId, affected ? { ...state, status: 'stale' as const, generationIds: [], error: '角色配置已变更，请重新生成' } : state]
    })),
  }
}

function changedRecordEntries<T>(current: Record<string, T>, next: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)))
}

function audiobookDelta(current: WorkAudiobookConfig, next: WorkAudiobookConfig) {
  const changes: Partial<WorkAudiobookConfig> = {}
  const segmentsByChapter = changedRecordEntries(current.segmentsByChapter, next.segmentsByChapter)
  const chapterAudio = changedRecordEntries(current.chapterAudio, next.chapterAudio)
  const characterBindings = changedRecordEntries(current.characterBindings, next.characterBindings)
  const chapterBindings = changedRecordEntries(current.chapterBindings, next.chapterBindings)
  if (Object.keys(segmentsByChapter).length) changes.segmentsByChapter = segmentsByChapter
  if (Object.keys(chapterAudio).length) changes.chapterAudio = chapterAudio
  if (Object.keys(characterBindings).length) changes.characterBindings = characterBindings
  if (Object.keys(chapterBindings).length) changes.chapterBindings = chapterBindings
  if (JSON.stringify(current.narratorBinding) !== JSON.stringify(next.narratorBinding)) changes.narratorBinding = next.narratorBinding
  return changes
}

export function useAudiobook() {
  const currentWork = useStore((state) => state.currentWork)
  const setCurrentWork = useStore((state) => state.setCurrentWork)
  const aiConfig = useSystemConfigStore((state) => state.aiConfig)
  const voiceboxConfig = useSystemConfigStore((state) => state.voiceboxConfig)
  const [profiles, setProfiles] = useState<VoiceboxProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [segmentingChapterId, setSegmentingChapterId] = useState<string | null>(null)
  const [generatingChapterId, setGeneratingChapterId] = useState<string | null>(null)
  const [segmentationProgress, setSegmentationProgress] = useState<SegmentationProgress | null>(null)

  const audiobook = useMemo(() => currentWork ? ensureAudiobook(currentWork) : null, [currentWork])

  const persistAudiobook = async (nextAudiobook: WorkAudiobookConfig) => {
    const work = useStore.getState().currentWork
    if (!work) return
    const audiobookChanges = work.audiobook ? audiobookDelta(work.audiobook, nextAudiobook) : nextAudiobook
    const result = await db.works.updateAudiobook(work.id, audiobookChanges)
    setCurrentWork({ ...work, audiobook: result.audiobook, updatedAt: result.updatedAt })
  }

  const refreshProfiles = useCallback(async () => {
    setLoadingProfiles(true)
    try {
      const result = await voiceboxClient.profiles()
      setProfiles(result)
      message.success(`已读取 ${result.length} 个 Voicebox 音色`)
    } finally {
      setLoadingProfiles(false)
    }
  }, [])

  const saveBinding = async (binding: VoiceBinding) => {
    if (!currentWork || !audiobook) return
    const previous = binding.speakerKind === 'narrator' ? audiobook.narratorBinding : audiobook.characterBindings[binding.characterId || binding.id]
    const promptChanged = previous?.prompt !== binding.prompt
    const nextBinding = {
      ...binding,
      promptTemplate: binding.prompt,
      promptUpdatedAt: promptChanged ? now() : binding.promptUpdatedAt || binding.updatedAt,
      updatedAt: binding.updatedAt || now(),
    }
    const next = binding.speakerKind === 'narrator'
      ? invalidateAllAudio({ ...audiobook, narratorBinding: nextBinding })
      : invalidateCharacterAudio({ ...audiobook, characterBindings: { ...audiobook.characterBindings, [binding.characterId || binding.id]: nextBinding } }, binding.characterId || binding.id)
    await persistAudiobook(next)
  }

  const saveChapterBinding = async (chapterId: string, binding: VoiceBinding) => {
    if (!currentWork || !audiobook || binding.speakerKind === 'narrator') {
      await saveBinding(binding)
      return
    }
    const key = binding.characterId || binding.id
    const previous = audiobook.chapterBindings[chapterId]?.[key] || audiobook.characterBindings[key]
    const promptChanged = previous?.prompt !== binding.prompt
    const nextBinding = {
      ...binding,
      promptTemplate: binding.prompt,
      promptUpdatedAt: promptChanged ? now() : binding.promptUpdatedAt || binding.updatedAt,
      updatedAt: binding.updatedAt || now(),
    }
    const chapterBindings = {
      ...audiobook.chapterBindings,
      [chapterId]: {
        ...(audiobook.chapterBindings[chapterId] || {}),
        [key]: nextBinding,
      },
    }
    const next = invalidateCharacterAudio({ ...audiobook, chapterBindings }, key)
    await persistAudiobook(next)
  }

  const bindProfile = async (binding: VoiceBinding, profile: VoiceboxProfile) => {
    await saveBinding({
      ...binding,
      source: 'profile',
      profileId: profileId(profile),
      profileName: profileName(profile),
      updatedAt: now(),
    })
  }

  const bindVoice = async (binding: VoiceBinding, voice: { id: string; displayName: string; profileId: string; profileName?: string; sampleId?: string; referenceText?: string }) => {
    await saveBinding({
      ...binding,
      source: 'sample',
      soundId: voice.id,
      profileId: voice.profileId,
      profileName: voice.profileName || voice.displayName,
      sampleId: voice.sampleId,
      referenceText: voice.referenceText,
      updatedAt: now(),
    })
  }

  const bindChapterProfile = async (chapterId: string, binding: VoiceBinding, profile: VoiceboxProfile) => {
    await saveChapterBinding(chapterId, {
      ...binding,
      source: 'profile',
      profileId: profileId(profile),
      profileName: profileName(profile),
      soundId: undefined,
      sampleId: undefined,
      updatedAt: now(),
    })
  }

  const bindChapterVoice = async (chapterId: string, binding: VoiceBinding, voice: { id: string; displayName: string; profileId: string; profileName?: string; sampleId?: string; referenceText?: string }) => {
    await saveChapterBinding(chapterId, {
      ...binding,
      source: 'sample',
      soundId: voice.id,
      profileId: voice.profileId,
      profileName: voice.profileName || voice.displayName,
      sampleId: voice.sampleId,
      referenceText: voice.referenceText,
      updatedAt: now(),
    })
  }

  const uploadReference = async (_binding: VoiceBinding, _file: File, _referenceText: string) => {
    message.info('参考音频上传已迁移到声音管理页面')
  }

  const bindingForSegment = (segment: Pick<AudiobookSegment, 'speakerKind' | 'characterId'>, chapterId?: string) => {
    if (!audiobook) return undefined
    if (segment.speakerKind === 'narrator') return audiobook.narratorBinding
    const key = segment.characterId || ''
    return chapterId ? audiobook.chapterBindings[chapterId]?.[key] || audiobook.characterBindings[key] : audiobook.characterBindings[key]
  }

  const missingBindings = (segments: AudiobookSegment[], chapterId?: string) => {
    const work = useStore.getState().currentWork
    if (!work) return []
    const missing = new Set<string>()
    for (const segment of segments) {
      const binding = bindingForSegment(segment, chapterId)
      if (!isBindingReady(binding)) missing.add(segmentSpeakerKey(segment) === 'narrator' ? '旁白' : segment.speakerName)
      else if (!validatePromptTemplate(bindingPromptTemplate(binding, work))) missing.add(`${segment.speakerName}提示词`)
    }
    return [...missing]
  }

  const saveSegments = async (chapterId: string, segments: AudiobookSegment[]) => {
    if (!audiobook) return
    await persistAudiobook({
      ...audiobook,
      segmentsByChapter: { ...audiobook.segmentsByChapter, [chapterId]: segments },
    })
  }

  const attributeSegmentBatch = async (work: NonNullable<ReturnType<typeof useStore.getState>['currentWork']>, chapter: Chapter, batch: AudiobookSegment[], batchIndex: number) => {
    const latest = ensureAudiobook(useStore.getState().currentWork!)
    const currentSegments = latest.segmentsByChapter[chapter.id] || []
    const batchId = `${chapter.id}-attr-${batchIndex + 1}`
    const contextSegments = currentSegments
      .filter((segment) => typeof segment.sourceStartOffset === 'number' && batch.some((item) => Math.abs((item.sourceStartOffset || 0) - (segment.sourceStartOffset || 0)) < 600))
      .slice(0, 8)
    const marking = currentSegments.map((segment) => batch.some((item) => item.id === segment.id)
      ? { ...segment, attributionStatus: 'attributing' as const, attributionBatchId: batchId, attributionError: undefined }
      : segment)
    await persistAudiobook({ ...latest, segmentsByChapter: { ...latest.segmentsByChapter, [chapter.id]: marking } })

    try {
      const prompt = buildAudiobookAttributionPrompt(work, chapter, batch, contextSegments)
      const text = await generate(prompt, AUDIOBOOK_ATTRIBUTION_SYSTEM_PROMPT, { ...aiConfig, maxTokens: Math.min(aiConfig.maxTokens || 1200, 1200) })
      const results = parseAttributionJson(text)
      const afterGenerate = ensureAudiobook(useStore.getState().currentWork!)
      const applied = applyAttributionResults(work, afterGenerate.segmentsByChapter[chapter.id] || [], results, batchId)
      await persistAudiobook({ ...afterGenerate, segmentsByChapter: { ...afterGenerate.segmentsByChapter, [chapter.id]: applied } })
      return true
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '归因失败'
      const afterError = ensureAudiobook(useStore.getState().currentWork!)
      const failed = markAttributionFailed(afterError.segmentsByChapter[chapter.id] || [], batch.map((segment) => segment.id), batchId, errMsg)
      await persistAudiobook({ ...afterError, segmentsByChapter: { ...afterError.segmentsByChapter, [chapter.id]: failed } })
      return false
    }
  }

  const segmentChapter = async (chapter: Chapter) => {
    const work = useStore.getState().currentWork
    if (!work || !audiobook) return
    if (!chapter.content.trim()) {
      message.warning('章节正文为空，无法分段')
      return
    }
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI')
      return
    }
    const existing = audiobook.segmentsByChapter[chapter.id]
    if (existing?.length) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '重新分段会覆盖当前编辑',
          content: '已存在的有声读物分段会被新的 AI 结果替换。',
          okText: '覆盖并重新分段',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      if (!confirmed) return
    }
    setSegmentingChapterId(chapter.id)
    try {
      setSegmentationProgress({ chapterId: chapter.id, stage: 'rule_splitting', total: 0, completed: 0, failed: 0, message: '正在规则切段' })
      const segments = createRuleBasedSegments(work, chapter)
      if (!segments.length) throw new Error('未生成可用分段')
      await saveSegments(chapter.id, segments)
      const pendingAttribution = segmentsNeedingAttribution(segments)
      if (!pendingAttribution.length) {
        setSegmentationProgress({ chapterId: chapter.id, stage: 'completed', total: 0, completed: 0, failed: 0, message: '规则分段已完成' })
        message.success('章节分段已生成，可先检查并编辑后再生成音频')
        return
      }

      const batches: AudiobookSegment[][] = []
      for (let index = 0; index < pendingAttribution.length; index += ATTRIBUTION_BATCH_SIZE) batches.push(pendingAttribution.slice(index, index + ATTRIBUTION_BATCH_SIZE))
      let failed = 0
      for (const [index, batch] of batches.entries()) {
        setSegmentationProgress({ chapterId: chapter.id, stage: 'attributing_batches', total: batches.length, completed: index, failed, message: `正在归因 ${index}/${batches.length}` })
        const ok = await attributeSegmentBatch(work, chapter, batch, index)
        if (!ok) failed += 1
      }
      setSegmentationProgress({ chapterId: chapter.id, stage: failed ? 'partial_failed' : 'completed', total: batches.length, completed: batches.length, failed, message: failed ? `${failed} 个批次归因失败，可重试片段` : '分段归因已完成' })
      if (failed) message.warning(`${failed} 个归因批次失败，已保留可用分段`)
      else message.success('章节分段已生成，可先检查并编辑后再生成音频')
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      setSegmentationProgress({ chapterId: chapter.id, stage: 'failed', total: 0, completed: 0, failed: 1, message: errMsg })
      message.error(`分段失败：${errMsg}`)
    } finally {
      setSegmentingChapterId(null)
    }
  }

  const updateSegment = async (chapterId: string, segmentId: string, changes: Partial<AudiobookSegment>) => {
    if (!audiobook) return
    const segments = audiobook.segmentsByChapter[chapterId] || []
    const editedAt = now()
    await saveSegments(chapterId, segments.map((segment) => segment.id === segmentId ? {
      ...segment,
      ...changes,
      ...(typeof changes.text === 'string' ? { textEditedAt: editedAt, status: 'stale' as const } : {}),
      ...(changes.speakerKind || changes.characterId || changes.speakerName ? { speakerEditedAt: editedAt, attributionSource: 'manual' as const, attributionStatus: 'manual' as const, needsReview: false, retryable: false } : {}),
    } : segment))
  }

  const approveReviewSegments = async (chapterId: string) => {
    const latest = ensureAudiobook(useStore.getState().currentWork!)
    const segments = latest.segmentsByChapter[chapterId] || []
    const reviewed = segments.filter((segment) => segment.needsReview || segment.attributionStatus === 'needs_review')
    if (!reviewed.length) return
    await saveSegments(chapterId, segments.map((segment) => reviewed.some((item) => item.id === segment.id)
      ? { ...segment, needsReview: false, retryable: false, attributionStatus: 'manual' as const, attributionSource: 'manual' as const, speakerEditedAt: now() }
      : segment))
    message.success(`已确认 ${reviewed.length} 个待复核分段`)
  }

  const generateSegmentTonePrompts = async (chapterId: string) => {
    const work = useStore.getState().currentWork
    if (!work) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI')
      return
    }
    const latest = ensureAudiobook(useStore.getState().currentWork!)
    const segments = latest.segmentsByChapter[chapterId] || []
    if (!segments.length) return
    try {
      const orderedSegments = [...segments].sort((a, b) => a.order - b.order)
      const promptInputs: { segmentId: string; speakerName: string; text: string; expandedPrompt: string }[] = []
      const directPromptsBySegmentId = new Map<string, string>()
      for (const [index, segment] of orderedSegments.entries()) {
        const binding = segment.speakerKind === 'narrator'
          ? latest.narratorBinding
          : latest.chapterBindings[chapterId]?.[segment.characterId || ''] || latest.characterBindings[segment.characterId || '']
        if (!binding) throw new Error(`${segment.speakerName} 缺少声音提示词配置`)
        const previousSegments = orderedSegments.slice(Math.max(0, index - 2), index)
        const effectiveBinding = { ...binding, prompt: bindingPromptTemplate(binding, work), promptTemplate: bindingPromptTemplate(binding, work) }
        if (segment.speakerKind === 'narrator') {
          directPromptsBySegmentId.set(segment.id, buildSegmentTonePrompt(effectiveBinding, previousSegments))
          continue
        }
        promptInputs.push({ segmentId: segment.id, speakerName: segment.speakerName, text: segment.text, expandedPrompt: buildSegmentTonePrompt(effectiveBinding, previousSegments) })
      }
      const promptsBySegmentId = new Map(directPromptsBySegmentId)
      if (promptInputs.length) {
        const resultText = await generate(buildAudiobookToneCompressionPrompt(promptInputs), AUDIOBOOK_TONE_SYSTEM_PROMPT, { ...aiConfig, maxTokens: Math.min(aiConfig.maxTokens || 1200, 1600) })
        const tones = parseToneCompressionJson(resultText)
        for (const item of tones) {
          const segmentId = toneSegmentId(item)
          const prompt = toneText(item)
          if (segmentId && prompt) promptsBySegmentId.set(segmentId, prompt)
        }
      }
      if (!promptsBySegmentId.size) throw new Error('AI 没有返回可用语气提示词')
      await saveSegments(chapterId, segments.map((segment) => ({ ...segment, prompt: promptsBySegmentId.get(segment.id) || segment.prompt })))
      message.success(`已生成 ${promptsBySegmentId.size} 条语气提示词`)
    } catch (error) {
      message.warning(error instanceof Error ? error.message : '生成语气提示词失败')
    }
  }

  const retrySegmentAttribution = async (chapter: Chapter, segmentId: string) => {
    const work = useStore.getState().currentWork
    if (!work || !audiobook) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI')
      return
    }
    const segment = audiobook.segmentsByChapter[chapter.id]?.find((item) => item.id === segmentId)
    if (!segment) return
    setSegmentingChapterId(chapter.id)
    setSegmentationProgress({ chapterId: chapter.id, stage: 'attributing_batches', total: 1, completed: 0, failed: 0, message: '正在重试片段归因' })
    const ok = await attributeSegmentBatch(work, chapter, [segment], 0)
    setSegmentationProgress({ chapterId: chapter.id, stage: ok ? 'completed' : 'partial_failed', total: 1, completed: 1, failed: ok ? 0 : 1, message: ok ? '片段归因已完成' : '片段归因失败' })
    setSegmentingChapterId(null)
  }

  const mergeSegments = async (chapterId: string, segmentIds: string[]) => {
    if (!audiobook) return
    try {
      const segments = audiobook.segmentsByChapter[chapterId] || []
      await saveSegments(chapterId, mergeConsecutiveSegments(segments, segmentIds, now()))
      message.success(`已合并 ${segmentIds.length} 个分段`)
    } catch (error) {
      message.warning(error instanceof Error ? error.message : '合并分段失败')
    }
  }

  const generateChapterAudio = async (chapter: Chapter, options: boolean | { segmentIds?: string[] } = false) => {
    const retryFailedOnly = options === true
    const targetSegmentIds = typeof options === 'object' ? new Set(options.segmentIds || []) : null
    if (!audiobook) return
    const segments = audiobook.segmentsByChapter[chapter.id] || []
    if (!segments.length) {
      message.warning('请先生成并确认分段')
      return
    }
    const targetSegments = targetSegmentIds ? segments.filter((segment) => targetSegmentIds.has(segment.id)) : segments
    if (!targetSegments.length) return
    const missing = missingBindings(targetSegments, chapter.id)
    if (missing.length) {
      message.error(`以下说话人未配置完整：${missing.join('、')}`)
      return
    }
    const unresolved = targetSegments.filter((segment) => segment.attributionStatus === 'failed' || (segment.needsReview && segment.speakerKind === 'narrator' && (segment.attributionConfidence || 0) < 0.6))
    if (unresolved.length) {
      message.error(`还有 ${unresolved.length} 个分段需要复核或重试归因`)
      return
    }

    setGeneratingChapterId(chapter.id)
    let nextSegments = segments.map((segment) => (retryFailedOnly && segment.status !== 'failed') || (targetSegmentIds && !targetSegmentIds.has(segment.id)) ? segment : { ...segment, status: 'pending' as const, error: undefined })
    const generationIds: string[] = []
    const chapterAudio: ChapterAudioState = {
      chapterId: chapter.id,
      status: 'generating',
      segmentIds: nextSegments.map((segment) => segment.id),
      generationIds,
      updatedAt: now(),
    }
    await persistAudiobook({ ...audiobook, segmentsByChapter: { ...audiobook.segmentsByChapter, [chapter.id]: nextSegments }, chapterAudio: { ...audiobook.chapterAudio, [chapter.id]: chapterAudio } })

    try {
      for (const segment of nextSegments) {
        if (retryFailedOnly && segment.status !== 'pending') continue
        if (targetSegmentIds && !targetSegmentIds.has(segment.id)) continue
        const binding = bindingForSegment(segment, chapter.id)
        if (!binding?.profileId) continue
        nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'generating' } : item)
        await saveSegments(chapter.id, nextSegments)
        try {
          const effectiveBinding = { ...binding, prompt: bindingPromptTemplate(binding, useStore.getState().currentWork!), promptTemplate: bindingPromptTemplate(binding, useStore.getState().currentWork!) }
          const { instruct, clipped, hash } = fillPromptTemplate(effectiveBinding, chapter, segment, segment.prompt)
          if (clipped) message.info('提示词已按 Voicebox 限制裁剪')
          const result = await voiceboxClient.generate({
            profile_id: binding.profileId,
            text: segment.text,
            engine: 'qwen',
            model_size: '1.7B',
            language: voiceboxConfig.defaultLanguage,
            instruct,
            chunking: voiceboxConfig.defaultChunking,
            crossfade: voiceboxConfig.defaultCrossfade,
            normalize: voiceboxConfig.defaultNormalize,
          })
          const generationId = result.generation_id || result.id
          if (!generationId) throw new Error('Voicebox 未返回 generation_id')
          await waitForVoiceboxGeneration(generationId)
          generationIds.push(generationId)
          nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'completed', generationId, generatedWith: { bindingUpdatedAt: binding.updatedAt, promptUpdatedAt: binding.promptUpdatedAt, narratorUpdatedAt: audiobook.narratorBinding.updatedAt, textHash: textHash(segment.text), instructHash: hash } } : item)
          await saveSegments(chapter.id, nextSegments)
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : '生成失败'
          nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'failed', error: errMsg } : item)
          await saveSegments(chapter.id, nextSegments)
        }
      }

      const targetGenerationSegments = targetSegmentIds ? nextSegments.filter((segment) => targetSegmentIds.has(segment.id)) : nextSegments
      const failed = targetGenerationSegments.filter((segment) => segment.status === 'failed')
      const completedIds = nextSegments.map((segment) => segment.generationId).filter((id): id is string => Boolean(id))
      const latest = ensureAudiobook(useStore.getState().currentWork!)
      await persistAudiobook({
        ...latest,
        segmentsByChapter: { ...latest.segmentsByChapter, [chapter.id]: nextSegments },
        chapterAudio: {
          ...latest.chapterAudio,
          [chapter.id]: {
            chapterId: chapter.id,
            status: failed.length ? 'failed' : 'completed',
            segmentIds: nextSegments.map((segment) => segment.id),
            generationIds: completedIds,
            updatedAt: now(),
            error: failed.length ? `${failed.length} 个片段生成失败，可重试` : undefined,
          },
        },
      })
      if (failed.length) message.warning(`${failed.length} 个片段生成失败，可重试失败片段`)
      else message.success('章节音频已生成')
    } finally {
      setGeneratingChapterId(null)
    }
  }

  const regenerateSegmentAudio = async (chapter: Chapter, segmentId: string) => {
    await generateChapterAudio(chapter, { segmentIds: [segmentId] })
  }

  const characterBindings = useMemo(() => {
    if (!currentWork || !audiobook) return []
    return currentWork.characters.map((character) => audiobook.characterBindings[character.id] || {
      id: character.id,
      speakerKind: 'character' as const,
      characterId: character.id,
      displayName: character.name,
      source: 'pending' as const,
      prompt: '',
      promptTemplate: '',
      updatedAt: now(),
      promptUpdatedAt: now(),
    })
  }, [audiobook, currentWork])

  const chapterCharacterBindings = (chapterId: string, characterIds: string[]) => {
    if (!currentWork || !audiobook) return []
    return characterIds.map((characterId) => {
      const character = currentWork.characters.find((item) => item.id === characterId)
      const fallback = character ? {
        id: character.id,
        speakerKind: 'character' as const,
        characterId: character.id,
        displayName: character.name,
        source: 'pending' as const,
        prompt: '',
        promptTemplate: '',
        updatedAt: now(),
        promptUpdatedAt: now(),
      } : undefined
      return audiobook.chapterBindings[chapterId]?.[characterId] || audiobook.characterBindings[characterId] || fallback
    }).filter((binding): binding is VoiceBinding => Boolean(binding))
  }

  const generatePromptTemplate = async (characterId: string) => {
    const work = useStore.getState().currentWork
    if (!work) return ''
    if (!aiConfig.apiKey) throw new Error('请先在系统管理中配置 AI')
    const text = await generate(buildQwenTtsRoleTemplatePrompt(work, characterId), AUDIOBOOK_TEMPLATE_SYSTEM_PROMPT, aiConfig)
    if (!validatePromptTemplate(text)) throw new Error('AI 返回缺少【上下文】占位符')
    return text.trim()
  }

  return {
    audiobook,
    profiles,
    loadingProfiles,
    segmentingChapterId,
    generatingChapterId,
    segmentationProgress,
    refreshProfiles,
    bindProfile,
    bindVoice,
    bindChapterProfile,
    bindChapterVoice,
    saveBinding,
    saveChapterBinding,
    uploadReference,
    segmentChapter,
    updateSegment,
    approveReviewSegments,
    generateSegmentTonePrompts,
    mergeSegments,
    retrySegmentAttribution,
    generateChapterAudio,
    regenerateSegmentAudio,
    generatePromptTemplate,
    missingBindings,
    narratorBinding: audiobook?.narratorBinding,
    characterBindings,
    chapterCharacterBindings,
    isBindingReady,
  }
}
