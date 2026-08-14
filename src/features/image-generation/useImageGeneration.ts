import { useMemo, useState } from 'react'
import { message } from 'antd'
import type { ChapterVisualCandidateResult, ImageAssetRecord, ImagePromptType, ImageViewDirection, VisualCandidateCacheEntry, VisualPromptRecord, Work, WorkVisualAssetsConfig } from '@/core/types'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import type { ImagePromptSubjectContext } from './promptContext'
import { emptyVisualAssets, visualAssetDelta } from './visualAssetState'
import { ImageGenerationClientError, imageGenerationClient } from './imageGenerationClient'

function now() {
  return Date.now()
}

function promptId(type: ImagePromptType, characterId?: string, chapterId?: string, visualSubjectId?: string) {
  return [type, characterId || 'none', chapterId || 'none', visualSubjectId || 'none'].join(':')
}

function promptTitle(type: ImagePromptType) {
  if (type === 'characterFace') return '角色高清面部特写'
  if (type === 'chapterObject') return '章节服饰/道具（旧）'
  if (type === 'chapterClothing') return '章节服饰'
  if (type === 'chapterProp') return '章节道具'
  return '多视角全身图'
}

const CANDIDATE_EXTRACTION_VERSION = 'visual-candidates-v2'

interface PromptDraftInput {
  type: ImagePromptType
  characterId?: string
  chapterId?: string
  subject?: ImagePromptSubjectContext
  referenceImageIds?: string[]
}

function stableHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  return String(hash >>> 0)
}

function candidateCacheMetadata(work: Work, chapterId: string) {
  const chapter = work.chapters.find(item => item.id === chapterId)
  const characterIndex = work.characters.map(character => `${character.id}:${character.name}:${(character.tags || []).join('|')}`).join('\n')
  return {
    chapterContentHash: stableHash(chapter?.content || ''),
    characterIndexHash: stableHash(characterIndex),
    extractionVersion: CANDIDATE_EXTRACTION_VERSION,
  }
}

function validCandidateCache(entry: VisualCandidateCacheEntry | undefined, metadata: ReturnType<typeof candidateCacheMetadata>) {
  return Boolean(entry && entry.extractionVersion === metadata.extractionVersion && entry.chapterContentHash === metadata.chapterContentHash && entry.characterIndexHash === metadata.characterIndexHash && entry.status === 'success')
}

function ensureVisualAssets(config?: WorkVisualAssetsConfig): WorkVisualAssetsConfig {
  return { ...emptyVisualAssets(), ...(config || {}), candidateCache: config?.candidateCache || {} }
}

export function useImageGeneration() {
  const currentWork = useStore(state => state.currentWork)
  const setCurrentWork = useStore(state => state.setCurrentWork)
  const imageGenerationConfig = useSystemConfigStore(state => state.imageGenerationConfig)
  const loadConfig = useSystemConfigStore(state => state.loadConfig)
  const [generatingPromptId, setGeneratingPromptId] = useState<string | null>(null)
  const [generatingImagePromptId, setGeneratingImagePromptId] = useState<string | null>(null)

  const visualAssets = useMemo(() => ensureVisualAssets(currentWork?.visualAssets), [currentWork])

  const persistVisualAssets = async (nextVisualAssets: WorkVisualAssetsConfig) => {
    const work = useStore.getState().currentWork
    if (!work) return
    const changes = visualAssetDelta(work.visualAssets, nextVisualAssets)
    const result = await db.works.updateVisualAssets(work.id, changes)
    setCurrentWork({ ...work, visualAssets: result.visualAssets, updatedAt: result.updatedAt })
  }

  const upsertPrompt = async (record: VisualPromptRecord) => {
    await persistVisualAssets({
      ...visualAssets,
      prompts: { ...visualAssets.prompts, [record.id]: record },
      promptIdsByCharacter: record.characterId ? { ...visualAssets.promptIdsByCharacter, [record.characterId]: Array.from(new Set([...(visualAssets.promptIdsByCharacter[record.characterId] || []), record.id])) } : visualAssets.promptIdsByCharacter,
      promptIdsByChapter: record.chapterId ? { ...visualAssets.promptIdsByChapter, [record.chapterId]: Array.from(new Set([...(visualAssets.promptIdsByChapter[record.chapterId] || []), record.id])) } : visualAssets.promptIdsByChapter,
      updatedAt: now(),
    })
  }

  const generatePromptDraft = async ({ type, characterId, chapterId, subject, referenceImageIds }: PromptDraftInput) => {
    if (!currentWork) return undefined
    const id = promptId(type, characterId, chapterId, subject?.visualSubjectId)
    setGeneratingPromptId(id)
    try {
      const { prompt } = await imageGenerationClient.prompt({ workId: currentWork.id, type, characterId, chapterId, visualSubjectId: subject?.visualSubjectId, candidateKind: subject?.candidateKind, referenceImageIds })
      const record: VisualPromptRecord = {
        ...(visualAssets.prompts[id] || {}),
        id,
        type,
        characterId,
        chapterId,
        visualSubjectId: subject?.visualSubjectId,
        subjectLabel: subject?.subjectLabel,
        candidateKind: subject?.candidateKind,
        title: promptTitle(type),
        prompt: visualAssets.prompts[id]?.prompt || '',
        draftPrompt: prompt,
        status: 'draft',
        createdAt: visualAssets.prompts[id]?.createdAt || now(),
        updatedAt: now(),
      }
      await upsertPrompt(record)
      return record
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视觉提示词生成失败')
      return undefined
    } finally {
      setGeneratingPromptId(null)
    }
  }

  const savePrompt = async (record: VisualPromptRecord, prompt: string) => {
    const nextRecord: VisualPromptRecord = { ...record, prompt, draftPrompt: undefined, status: 'saved', error: undefined, updatedAt: now() }
    await upsertPrompt(nextRecord)
    message.success('视觉提示词已保存')
  }

  const generateImage = async (record: VisualPromptRecord, modelId: string, options: { size?: string; quality?: string; format?: string; referenceImageIds?: string[]; viewDirection?: ImageViewDirection } = {}) => {
    if (!currentWork) return undefined
    if (!record.prompt.trim()) {
      message.warning('请先保存提示词')
      return undefined
    }
    setGeneratingImagePromptId(record.id)
    try {
      const result = await imageGenerationClient.generate({ workId: currentWork.id, modelId, promptId: record.id, characterId: record.characterId, chapterId: record.chapterId, prompt: record.prompt, ...options })
      const image: ImageAssetRecord = {
        id: result.id,
        promptId: record.id,
        promptSnapshot: record.prompt,
        basePromptSnapshot: result.basePromptSnapshot,
        generationPromptSnapshot: result.generationPromptSnapshot,
        viewDirection: result.viewDirection,
        referenceImageIds: result.referenceImageIds,
        provider: result.provider,
        modelId: result.modelId,
        modelName: result.modelName,
        mimeType: result.mimeType,
        storageMode: result.storageMode,
        storageStatus: result.storageStatus,
        assetUrl: result.assetUrl,
        localAssetId: result.localAssetId,
        immichAssetId: result.immichAssetId,
        immichFilename: result.immichFilename,
        thumbnailUrl: result.thumbnailUrl,
        originalUrl: result.originalUrl,
        createdAt: now(),
        status: result.status,
        error: result.error,
      }
      await persistVisualAssets({
        ...visualAssets,
        prompts: { ...visualAssets.prompts, [record.id]: { ...record, status: result.status === 'succeeded' ? 'imageSucceeded' : 'imageFailed', error: result.error, updatedAt: now() } },
        images: { ...visualAssets.images, [image.id]: image },
        updatedAt: now(),
      })
      return image
    } catch (error) {
      await upsertPrompt({ ...record, status: 'imageFailed', error: error instanceof Error ? error.message : '图片生成失败', updatedAt: now() })
      if (error instanceof ImageGenerationClientError) {
        if (error.imageGenerationPermissionAutoDisabled) {
          await loadConfig()
          message.warning('多次非超时生图失败后，当前账号的生图权限已自动关闭，请联系管理员恢复。')
        } else {
          if (error.status === 403) await loadConfig()
          message.error(error.message)
        }
      } else {
        message.error(error instanceof Error ? error.message : '图片生成失败')
      }
      return undefined
    } finally {
      setGeneratingImagePromptId(null)
    }
  }

  const retryImmichUpload = async (image: ImageAssetRecord) => {
    if (!currentWork) return undefined
    try {
      const result = await imageGenerationClient.retryImmichUpload({ workId: currentWork.id, imageId: image.id })
      const nextImage: ImageAssetRecord = { ...image, ...result, localAssetId: result.localAssetId, assetUrl: result.assetUrl, error: result.error }
      await persistVisualAssets({
        ...visualAssets,
        images: { ...visualAssets.images, [image.id]: nextImage },
        updatedAt: now(),
      })
      message.success('Immich 重传成功')
      return nextImage
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Immich 重传失败')
      return undefined
    }
  }

  const deleteImage = async (image: ImageAssetRecord) => {
    if (!currentWork) return false
    try {
      const result = await imageGenerationClient.deleteAsset({ workId: currentWork.id, imageId: image.id })
      const work = useStore.getState().currentWork
      if (work?.id === currentWork.id) setCurrentWork({ ...work, visualAssets: result.visualAssets, updatedAt: result.updatedAt })
      message.success('图片资产已删除')
      return true
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片资产删除失败')
      return false
    }
  }

  const persistCandidateCache = async (chapterId: string, result: ChapterVisualCandidateResult, status: 'success' | 'error' = 'success') => {
    if (!currentWork) return undefined
    const metadata = candidateCacheMetadata(currentWork, chapterId)
    const entry: VisualCandidateCacheEntry = { chapterId, ...metadata, result, status, error: result.error, updatedAt: now() }
    await persistVisualAssets({
      ...visualAssets,
      candidateCache: { ...visualAssets.candidateCache, [chapterId]: entry },
      updatedAt: now(),
    })
    return entry
  }

  const extractChapterCandidates = async (chapterId: string, options: { refresh?: boolean } = {}) => {
    if (!currentWork) return undefined
    const metadata = candidateCacheMetadata(currentWork, chapterId)
    const cached = visualAssets.candidateCache?.[chapterId]
    if (!options.refresh && validCandidateCache(cached, metadata)) return cached?.result
    try {
      const result = await imageGenerationClient.extractCandidates({ workId: currentWork.id, chapterId })
      await persistCandidateCache(chapterId, result, result.error ? 'error' : 'success')
      return result
    } catch (error) {
      message.error(error instanceof Error ? error.message : '章节视觉候选提取失败')
      return undefined
    }
  }

  return {
    imageGenerationConfig,
    visualAssets,
    generatingPromptId,
    generatingImagePromptId,
    generatePromptDraft,
    savePrompt,
    generateImage,
    extractChapterCandidates,
    retryImmichUpload,
    deleteImage,
  }
}
