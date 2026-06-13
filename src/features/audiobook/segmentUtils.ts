import type { AudiobookSegment, Chapter, Work } from '@/core/types'
import { generateId } from '@/utils/id'

interface RawSegment {
  speakerKind?: string
  characterId?: string | null
  speakerName?: string
  text?: string
  mood?: string
  prompt?: string
}

export interface AttributionResult {
  segmentId?: string
  speakerKind?: string
  characterId?: string | null
  speakerName?: string
  mood?: string
  confidence?: number
  needsReview?: boolean
  reason?: string
}

export function parseSegmentJson(text: string): RawSegment[] {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('AI 没有返回 JSON 数组')
  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('AI 分段结果不是数组')
  return parsed as RawSegment[]
}

export function normalizeSegments(work: Work, chapter: Chapter, rawSegments: RawSegment[]): AudiobookSegment[] {
  return rawSegments
    .filter((segment) => segment.text?.trim())
    .map((segment, index) => {
      const character = segment.characterId ? work.characters.find((c) => c.id === segment.characterId) : undefined
      const speakerKind = character ? 'character' : 'narrator'
      const mood = segment.mood?.trim() || '平稳叙述'
      const text = segment.text?.trim() || ''
      const previousText = rawSegments.slice(0, index).map((item) => item.text?.trim() || '').filter(Boolean)
      let searchFrom = 0
      for (const prior of previousText) {
        const priorIndex = chapter.content.indexOf(prior, searchFrom)
        if (priorIndex >= 0) searchFrom = priorIndex + prior.length
      }
      const sourceStartOffset = chapter.content.indexOf(text, searchFrom)
      return {
        id: generateId(),
        chapterId: chapter.id,
        order: index,
        speakerKind,
        characterId: character?.id,
        speakerName: character?.name || segment.speakerName?.trim() || '旁白',
        text,
        mood,
        prompt: '',
        sourceStartOffset: sourceStartOffset >= 0 ? sourceStartOffset : undefined,
        sourceEndOffset: sourceStartOffset >= 0 ? sourceStartOffset + text.length : undefined,
        segmentationSource: 'ai',
        attributionSource: character ? 'ai' : 'legacy',
        attributionStatus: 'attributed',
        attributionConfidence: character ? 0.85 : 0.7,
        needsReview: false,
        retryable: false,
        status: 'pending',
      }
    })
}

export function parseAttributionJson(text: string): AttributionResult[] {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
    if (!Array.isArray(parsed)) throw new Error('AI 归因结果不是数组')
    return parsed as AttributionResult[]
  }

  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart === -1 || objectEnd <= objectStart) throw new Error('AI 没有返回归因 JSON')
  return [JSON.parse(cleaned.slice(objectStart, objectEnd + 1)) as AttributionResult]
}

export function applyAttributionResults(work: Work, segments: AudiobookSegment[], results: AttributionResult[], batchId: string): AudiobookSegment[] {
  return segments.map((segment) => {
    const result = results.find((item) => item.segmentId === segment.id) || (results.length === 1 ? results[0] : undefined)
    if (!result || segment.speakerEditedAt) return segment

    const character = result.characterId ? work.characters.find((item) => item.id === result.characterId) : undefined
    const wantsCharacter = result.speakerKind === 'character'
    const confidence = typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0.5
    const validCharacter = wantsCharacter && character
    const needsReview = Boolean(result.needsReview || (wantsCharacter && !character) || confidence < 0.72)

    return {
      ...segment,
      speakerKind: validCharacter ? 'character' : 'narrator',
      characterId: validCharacter ? character.id : undefined,
      speakerName: validCharacter ? character.name : '旁白',
      mood: result.mood?.trim() || segment.mood || '平稳叙述',
      attributionSource: 'llm',
      attributionStatus: needsReview ? 'needs_review' : 'attributed',
      attributionConfidence: confidence,
      attributionBatchId: batchId,
      attributionError: result.reason,
      needsReview,
      retryable: needsReview,
    }
  })
}

export function markAttributionFailed(segments: AudiobookSegment[], segmentIds: string[], batchId: string, error: string): AudiobookSegment[] {
  const failed = new Set(segmentIds)
  return segments.map((segment) => failed.has(segment.id)
    ? { ...segment, attributionStatus: 'failed', attributionBatchId: batchId, attributionError: error, needsReview: true, retryable: true }
    : segment)
}

export function segmentSpeakerKey(segment: Pick<AudiobookSegment, 'speakerKind' | 'characterId'>) {
  return segment.speakerKind === 'narrator' ? 'narrator' : segment.characterId || 'unknown'
}
