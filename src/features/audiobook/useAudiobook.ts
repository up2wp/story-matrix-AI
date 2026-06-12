import { useMemo, useState } from 'react'
import { Modal, message } from 'antd'
import type { AudiobookSegment, Chapter, ChapterAudioState, VoiceBinding, WorkAudiobookConfig } from '@/core/types'
import type { VoiceboxProfile } from './voiceboxClient'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generate } from '@/ai/client'
import { AUDIOBOOK_SEGMENT_SYSTEM_PROMPT, AUDIOBOOK_TEMPLATE_SYSTEM_PROMPT, buildAudiobookSegmentationPrompt, buildQwenTtsRoleTemplatePrompt } from '@/ai/prompts/audiobook'
import { normalizeSegments, parseSegmentJson, segmentSpeakerKey } from './segmentUtils'
import { voiceboxClient } from './voiceboxClient'
import { fillPromptTemplate, textHash, validatePromptTemplate } from './promptTemplateUtils'

function now() {
  return Date.now()
}

function defaultNarratorBinding(): VoiceBinding {
  const timestamp = now()
  return {
    id: 'narrator',
    speakerKind: 'narrator',
    displayName: '旁白',
    source: 'pending',
    prompt: '',
    promptTemplate: '',
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

export function useAudiobook() {
  const currentWork = useStore((state) => state.currentWork)
  const setCurrentWork = useStore((state) => state.setCurrentWork)
  const aiConfig = useSystemConfigStore((state) => state.aiConfig)
  const voiceboxConfig = useSystemConfigStore((state) => state.voiceboxConfig)
  const [profiles, setProfiles] = useState<VoiceboxProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [segmentingChapterId, setSegmentingChapterId] = useState<string | null>(null)
  const [generatingChapterId, setGeneratingChapterId] = useState<string | null>(null)

  const audiobook = useMemo(() => currentWork ? ensureAudiobook(currentWork) : null, [currentWork])

  const persistAudiobook = async (nextAudiobook: WorkAudiobookConfig) => {
    const work = useStore.getState().currentWork
    if (!work) return
    await db.works.update(work.id, { audiobook: nextAudiobook })
    setCurrentWork({ ...work, audiobook: nextAudiobook, updatedAt: now() })
  }

  const refreshProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const result = await voiceboxClient.profiles()
      setProfiles(result)
      message.success(`已读取 ${result.length} 个 Voicebox 音色`)
    } finally {
      setLoadingProfiles(false)
    }
  }

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
    const missing = new Set<string>()
    for (const segment of segments) {
      const binding = bindingForSegment(segment, chapterId)
      if (!isBindingReady(binding)) missing.add(segmentSpeakerKey(segment) === 'narrator' ? '旁白' : segment.speakerName)
      else if (!validatePromptTemplate(binding?.promptTemplate || binding?.prompt || '')) missing.add(`${segment.speakerName}提示词`)
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
      const prompt = buildAudiobookSegmentationPrompt(work, chapter)
      const text = await generate(prompt, AUDIOBOOK_SEGMENT_SYSTEM_PROMPT, aiConfig)
      const segments = normalizeSegments(work, chapter, parseSegmentJson(text))
      if (!segments.length) throw new Error('AI 未返回可用分段')
      await saveSegments(chapter.id, segments)
      message.success('章节分段已生成，可先检查并编辑后再生成音频')
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      message.error(`分段失败：${errMsg}`)
    } finally {
      setSegmentingChapterId(null)
    }
  }

  const updateSegment = async (chapterId: string, segmentId: string, changes: Partial<AudiobookSegment>) => {
    if (!audiobook) return
    const segments = audiobook.segmentsByChapter[chapterId] || []
    await saveSegments(chapterId, segments.map((segment) => segment.id === segmentId ? { ...segment, ...changes } : segment))
  }

  const generateChapterAudio = async (chapter: Chapter, retryFailedOnly = false) => {
    if (!audiobook) return
    const segments = audiobook.segmentsByChapter[chapter.id] || []
    if (!segments.length) {
      message.warning('请先生成并确认分段')
      return
    }
    const missing = missingBindings(segments, chapter.id)
    if (missing.length) {
      message.error(`以下说话人未配置完整：${missing.join('、')}`)
      return
    }

    setGeneratingChapterId(chapter.id)
    let nextSegments = segments.map((segment) => retryFailedOnly && segment.status !== 'failed' ? segment : { ...segment, status: 'pending' as const, error: undefined })
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
        const binding = bindingForSegment(segment, chapter.id)
        if (!binding?.profileId) continue
        nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'generating' } : item)
        await saveSegments(chapter.id, nextSegments)
        try {
          const { instruct, clipped, hash } = fillPromptTemplate(binding, chapter, segment)
          if (clipped) message.info('提示词已按 Voicebox 限制裁剪')
          const result = await voiceboxClient.generate({
            profile_id: binding.profileId,
            text: segment.text,
            engine: 'qwentts1.7b',
            language: voiceboxConfig.defaultLanguage,
            instruct,
            chunking: voiceboxConfig.defaultChunking,
            crossfade: voiceboxConfig.defaultCrossfade,
            normalize: voiceboxConfig.defaultNormalize,
          })
          const generationId = result.generation_id || result.id
          if (!generationId) throw new Error('Voicebox 未返回 generation_id')
          generationIds.push(generationId)
          nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'completed', generationId, generatedWith: { bindingUpdatedAt: binding.updatedAt, promptUpdatedAt: binding.promptUpdatedAt, narratorUpdatedAt: audiobook.narratorBinding.updatedAt, textHash: textHash(segment.text), instructHash: hash } } : item)
          await saveSegments(chapter.id, nextSegments)
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : '生成失败'
          nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'failed', error: errMsg } : item)
          await saveSegments(chapter.id, nextSegments)
        }
      }

      const failed = nextSegments.filter((segment) => segment.status === 'failed')
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
    if (!validatePromptTemplate(text)) throw new Error('AI 返回缺少【上下文】或【文本】占位符')
    return text.trim()
  }

  return {
    audiobook,
    profiles,
    loadingProfiles,
    segmentingChapterId,
    generatingChapterId,
    refreshProfiles,
    bindProfile,
    bindChapterProfile,
    bindChapterVoice,
    saveBinding,
    saveChapterBinding,
    uploadReference,
    segmentChapter,
    updateSegment,
    generateChapterAudio,
    generatePromptTemplate,
    missingBindings,
    narratorBinding: audiobook?.narratorBinding,
    characterBindings,
    chapterCharacterBindings,
    isBindingReady,
  }
}
