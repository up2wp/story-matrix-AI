import type { AudiobookSegment, Chapter, Work } from '@/core/types'
import { generateId } from '@/utils/id'
import { buildVoicePrompt } from '@/ai/prompts/audiobook'

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
      return {
        id: generateId(),
        chapterId: chapter.id,
        order: index,
        speakerKind,
        characterId: character?.id,
        speakerName: character?.name || segment.speakerName?.trim() || '旁白',
        text: segment.text?.trim() || '',
        mood,
        prompt: (segment.prompt?.trim() || buildVoicePrompt(work, character?.id, mood)).slice(0, 500),
        status: 'pending',
      }
    })
}

export function segmentSpeakerKey(segment: Pick<AudiobookSegment, 'speakerKind' | 'characterId'>) {
  return segment.speakerKind === 'narrator' ? 'narrator' : segment.characterId || 'unknown'
}
