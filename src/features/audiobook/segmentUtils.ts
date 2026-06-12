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
        status: 'pending',
      }
    })
}

export function segmentSpeakerKey(segment: Pick<AudiobookSegment, 'speakerKind' | 'characterId'>) {
  return segment.speakerKind === 'narrator' ? 'narrator' : segment.characterId || 'unknown'
}
