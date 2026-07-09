import type { ImageAssetRecord, VisualCandidateCacheEntry, VisualPromptRecord, WorkVisualAssetsConfig } from '@/core/types'

export function emptyVisualAssets(): WorkVisualAssetsConfig {
  return {
    prompts: {},
    images: {},
    promptIdsByCharacter: {},
    promptIdsByChapter: {},
    candidateCache: {},
    updatedAt: Date.now(),
  }
}

export function visualAssetDelta(current: WorkVisualAssetsConfig | undefined, next: WorkVisualAssetsConfig) {
  if (!current) return next
  const hasRemovedImages = Object.keys(current.images).some(key => !(key in next.images))
  const changedRecordEntries = <T>(before: Record<string, T>, after: Record<string, T>) => Object.fromEntries(
    Object.entries(after).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value)),
  )
  const prompts = changedRecordEntries<VisualPromptRecord>(current.prompts, next.prompts)
  const images = hasRemovedImages ? next.images : changedRecordEntries<ImageAssetRecord>(current.images, next.images)
  const promptIdsByCharacter = changedRecordEntries<string[]>(current.promptIdsByCharacter, next.promptIdsByCharacter)
  const promptIdsByChapter = changedRecordEntries<string[]>(current.promptIdsByChapter, next.promptIdsByChapter)
  const candidateCache = changedRecordEntries<VisualCandidateCacheEntry>(current.candidateCache || {}, next.candidateCache || {})
  return {
    ...(Object.keys(prompts).length ? { prompts } : {}),
    ...(hasRemovedImages || Object.keys(images).length ? { images } : {}),
    ...(hasRemovedImages ? { _replaceImages: true } : {}),
    ...(Object.keys(promptIdsByCharacter).length ? { promptIdsByCharacter } : {}),
    ...(Object.keys(promptIdsByChapter).length ? { promptIdsByChapter } : {}),
    ...(Object.keys(candidateCache).length ? { candidateCache } : {}),
    updatedAt: next.updatedAt,
  }
}
