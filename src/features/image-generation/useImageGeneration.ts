import { useMemo, useState } from 'react'
import { message } from 'antd'
import type { ImageAssetRecord, ImagePromptType, VisualPromptRecord, WorkVisualAssetsConfig } from '@/core/types'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { buildImagePromptInstruction, IMAGE_PROMPT_SYSTEM_PROMPT } from '@/ai/prompts/imageGeneration'
import { buildImagePromptContext } from './promptContext'
import { emptyVisualAssets, visualAssetDelta } from './visualAssetState'
import { imageGenerationClient } from './imageGenerationClient'

function now() {
  return Date.now()
}

function promptId(type: ImagePromptType, characterId?: string, chapterId?: string) {
  return [type, characterId || 'none', chapterId || 'none'].join(':')
}

function promptTitle(type: ImagePromptType) {
  if (type === 'characterFace') return '角色高清面部特写'
  if (type === 'chapterObject') return '章节服饰/道具（旧）'
  if (type === 'chapterClothing') return '章节服饰'
  if (type === 'chapterProp') return '章节道具'
  return '多视角全身图'
}

function ensureVisualAssets(config?: WorkVisualAssetsConfig): WorkVisualAssetsConfig {
  return config || emptyVisualAssets()
}

export function useImageGeneration() {
  const currentWork = useStore(state => state.currentWork)
  const setCurrentWork = useStore(state => state.setCurrentWork)
  const imageGenerationConfig = useSystemConfigStore(state => state.imageGenerationConfig)
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

  const generatePromptDraft = async (type: ImagePromptType, characterId?: string, chapterId?: string) => {
    if (!currentWork) return undefined
    const id = promptId(type, characterId, chapterId)
    setGeneratingPromptId(id)
    try {
      const context = buildImagePromptContext(currentWork, type, characterId, chapterId)
      const instruction = buildImagePromptInstruction(type, context)
      const { prompt } = await imageGenerationClient.prompt({ workId: currentWork.id, systemPrompt: IMAGE_PROMPT_SYSTEM_PROMPT, instruction, context })
      const record: VisualPromptRecord = {
        ...(visualAssets.prompts[id] || {}),
        id,
        type,
        characterId,
        chapterId,
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

  const generateImage = async (record: VisualPromptRecord, modelId: string, options: { size?: string; quality?: string; format?: string } = {}) => {
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
      message.error(error instanceof Error ? error.message : '图片生成失败')
      return undefined
    } finally {
      setGeneratingImagePromptId(null)
    }
  }

  const retryImmichUpload = async (image: ImageAssetRecord) => {
    if (!currentWork) return undefined
    try {
      const result = await imageGenerationClient.retryImmichUpload({ workId: currentWork.id, imageId: image.id })
      const nextImage: ImageAssetRecord = { ...image, ...result, error: result.error }
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

  return {
    imageGenerationConfig,
    visualAssets,
    generatingPromptId,
    generatingImagePromptId,
    generatePromptDraft,
    savePrompt,
    generateImage,
    retryImmichUpload,
  }
}
