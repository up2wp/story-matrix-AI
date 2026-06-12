import { useMemo, useState } from 'react'
import { Modal, message } from 'antd'
import type { AudiobookSegment, Chapter, ChapterAudioState, VoiceBinding, WorkAudiobookConfig } from '@/core/types'
import type { VoiceboxProfile } from './voiceboxClient'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generate } from '@/ai/client'
import { AUDIOBOOK_SEGMENT_SYSTEM_PROMPT, buildAudiobookSegmentationPrompt, buildVoicePrompt } from '@/ai/prompts/audiobook'
import { normalizeSegments, parseSegmentJson, segmentSpeakerKey } from './segmentUtils'
import { voiceboxClient } from './voiceboxClient'

function defaultNarratorBinding(tone?: string): VoiceBinding {
  return {
    id: 'narrator',
    speakerKind: 'narrator',
    displayName: '旁白',
    source: 'pending',
    prompt: `${tone || '自然'}、清晰、克制，适合长篇小说旁白`,
    updatedAt: Date.now(),
  }
}

function ensureAudiobook(work: NonNullable<ReturnType<typeof useStore.getState>['currentWork']>): WorkAudiobookConfig {
  return work.audiobook || {
    narratorBinding: defaultNarratorBinding(work.seed.tone),
    characterBindings: {},
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
    setCurrentWork({ ...work, audiobook: nextAudiobook, updatedAt: Date.now() })
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
    const next: WorkAudiobookConfig = binding.speakerKind === 'narrator'
      ? { ...audiobook, narratorBinding: binding }
      : { ...audiobook, characterBindings: { ...audiobook.characterBindings, [binding.characterId || binding.id]: binding } }
    await persistAudiobook(next)
  }

  const bindProfile = async (binding: VoiceBinding, profile: VoiceboxProfile) => {
    const nextBinding: VoiceBinding = {
      ...binding,
      source: 'profile',
      profileId: profileId(profile),
      profileName: profileName(profile),
      updatedAt: Date.now(),
    }
    await saveBinding(nextBinding)
  }

  const uploadReference = async (binding: VoiceBinding, file: File, referenceText: string) => {
    const profile = await voiceboxClient.createProfile({ name: binding.displayName, voice_type: 'cloned', description: binding.prompt })
    const id = profileId(profile)
    if (!id) throw new Error('Voicebox 未返回 profile id')
    const sample = await voiceboxClient.uploadSample(id, file, referenceText)
    await saveBinding({
      ...binding,
      source: 'sample',
      profileId: id,
      profileName: profileName(profile),
      sampleId: sample.id || sample.sample_id,
      referenceText,
      updatedAt: Date.now(),
    })
    message.success('参考音频已上传到 Voicebox')
  }

  const bindingForSegment = (segment: Pick<AudiobookSegment, 'speakerKind' | 'characterId'>) => {
    if (!audiobook) return undefined
    return segment.speakerKind === 'narrator' ? audiobook.narratorBinding : audiobook.characterBindings[segment.characterId || '']
  }

  const missingBindings = (segments: AudiobookSegment[]) => {
    const missing = new Set<string>()
    for (const segment of segments) {
      if (!isBindingReady(bindingForSegment(segment))) missing.add(segmentSpeakerKey(segment) === 'narrator' ? '旁白' : segment.speakerName)
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
    const missing = missingBindings(segments)
    if (missing.length) {
      message.error(`以下说话人未绑定音色：${missing.join('、')}`)
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
      updatedAt: Date.now(),
    }
    await persistAudiobook({ ...audiobook, segmentsByChapter: { ...audiobook.segmentsByChapter, [chapter.id]: nextSegments }, chapterAudio: { ...audiobook.chapterAudio, [chapter.id]: chapterAudio } })

    try {
      for (const segment of nextSegments) {
        if (retryFailedOnly && segment.status !== 'pending') continue
        const binding = bindingForSegment(segment)
        if (!binding?.profileId) continue
        nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'generating' } : item)
        await saveSegments(chapter.id, nextSegments)
        try {
          const result = await voiceboxClient.generate({
            profile_id: binding.profileId,
            text: segment.text,
            engine: 'qwentts1.7b',
            language: voiceboxConfig.defaultLanguage,
            instruct: segment.prompt.slice(0, 500),
            chunking: voiceboxConfig.defaultChunking,
            crossfade: voiceboxConfig.defaultCrossfade,
            normalize: voiceboxConfig.defaultNormalize,
          })
          const generationId = result.generation_id || result.id
          if (!generationId) throw new Error('Voicebox 未返回 generation_id')
          generationIds.push(generationId)
          nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'completed', generationId } : item)
          await saveSegments(chapter.id, nextSegments)
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : '生成失败'
          nextSegments = nextSegments.map((item) => item.id === segment.id ? { ...item, status: 'failed', error: errMsg } : item)
          await saveSegments(chapter.id, nextSegments)
        }
      }

      const failed = nextSegments.filter((segment) => segment.status === 'failed')
      const completedIds = nextSegments.map((segment) => segment.generationId).filter((id): id is string => Boolean(id))
      await persistAudiobook({
        ...ensureAudiobook(useStore.getState().currentWork!),
        segmentsByChapter: { ...ensureAudiobook(useStore.getState().currentWork!).segmentsByChapter, [chapter.id]: nextSegments },
        chapterAudio: {
          ...ensureAudiobook(useStore.getState().currentWork!).chapterAudio,
          [chapter.id]: {
            chapterId: chapter.id,
            status: failed.length ? 'failed' : 'completed',
            segmentIds: nextSegments.map((segment) => segment.id),
            generationIds: completedIds,
            updatedAt: Date.now(),
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
      prompt: buildVoicePrompt(currentWork, character.id),
      updatedAt: Date.now(),
    })
  }, [audiobook, currentWork])

  return {
    audiobook,
    profiles,
    loadingProfiles,
    segmentingChapterId,
    generatingChapterId,
    refreshProfiles,
    bindProfile,
    saveBinding,
    uploadReference,
    segmentChapter,
    updateSegment,
    generateChapterAudio,
    missingBindings,
    narratorBinding: audiobook?.narratorBinding,
    characterBindings,
    isBindingReady,
  }
}
