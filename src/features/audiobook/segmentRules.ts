import type { AudiobookSegment, Chapter, Work } from '@/core/types'
import { generateId } from '@/utils/id'

interface TextUnit {
  text: string
  start: number
  end: number
  paragraphIndex: number
}

const SPEECH_VERBS = '(?:说|道|问|答|喊|叫|低声说|轻声说|喃喃|笑道|叹道|怒道|解释|提醒|嘀咕)'
const QUOTE_PATTERN = /[“"]([^”"]+)[”"]/g

function paragraphUnits(content: string): TextUnit[] {
  const units: TextUnit[] = []
  const pattern = /\S(?:.|\n)*?(?=\n\s*\n|$)/g
  let paragraphIndex = 0
  for (const match of content.matchAll(pattern)) {
    const raw = match[0]
    const text = raw.trim()
    if (!text) continue
    const leading = raw.search(/\S/)
    const start = (match.index || 0) + (leading >= 0 ? leading : 0)
    units.push({ text, start, end: start + text.length, paragraphIndex })
    paragraphIndex += 1
  }
  return units
}

function characterByName(work: Work, name?: string) {
  if (!name) return undefined
  const matches = work.characters.filter((character) => character.name === name || character.name.includes(name) || name.includes(character.name))
  return matches.length === 1 ? matches[0] : undefined
}

function detectSpeaker(work: Work, fullText: string, quoteStart: number, quoteEnd: number) {
  const before = fullText.slice(Math.max(0, quoteStart - 24), quoteStart)
  const after = fullText.slice(quoteEnd, Math.min(fullText.length, quoteEnd + 24))
  const preposed = new RegExp(`([\\p{Script=Han}A-Za-z0-9_·]{1,12})\\s*${SPEECH_VERBS}\\s*[:：]?$`, 'u').exec(before)
  const postposed = new RegExp(`^[，,。.!！?？、\\s]*([\\p{Script=Han}A-Za-z0-9_·]{1,12})\\s*${SPEECH_VERBS}`, 'u').exec(after)
  const character = characterByName(work, preposed?.[1] || postposed?.[1])
  return character
}

function shouldSplitQuote(fullText: string, quoteStart: number, speaker: ReturnType<typeof characterByName>) {
  if (speaker || quoteStart === 0) return true
  const before = fullText.slice(0, quoteStart)
  return /[。.!！?？]\s*$/.test(before)
}

function createSegment(chapter: Chapter, unit: TextUnit, order: number, text: string, start: number, speaker: ReturnType<typeof characterByName>, needsReview: boolean): AudiobookSegment {
  return {
    id: generateId(),
    chapterId: chapter.id,
    order,
    speakerKind: speaker ? 'character' : 'narrator',
    characterId: speaker?.id,
    speakerName: speaker?.name || '旁白',
    text: text.trim(),
    mood: speaker ? '自然对白' : '平稳叙述',
    prompt: '',
    sourceStartOffset: start,
    sourceEndOffset: start + text.trim().length,
    sourceParagraphIndex: unit.paragraphIndex,
    segmentationSource: 'rule',
    attributionSource: speaker ? 'rule' : 'rule',
    attributionStatus: needsReview ? 'needs_review' : 'attributed',
    attributionConfidence: speaker ? 0.92 : needsReview ? 0.45 : 0.82,
    needsReview,
    retryable: needsReview,
    status: 'pending',
  }
}

export function createRuleBasedSegments(work: Work, chapter: Chapter): AudiobookSegment[] {
  const units = paragraphUnits(chapter.content)
  const segments: AudiobookSegment[] = []

  for (const unit of units) {
    if (/^(#{1,6}\s+|[-*_]{3,})/.test(unit.text)) continue
    let cursor = 0
    const matches = [...unit.text.matchAll(QUOTE_PATTERN)]
    if (!matches.length) {
      segments.push(createSegment(chapter, unit, segments.length, unit.text, unit.start, undefined, false))
      continue
    }

    if (!matches.some((match) => shouldSplitQuote(unit.text, match.index || 0, detectSpeaker(work, unit.text, match.index || 0, (match.index || 0) + match[0].length)))) {
      segments.push(createSegment(chapter, unit, segments.length, unit.text, unit.start, undefined, false))
      continue
    }

    for (const match of matches) {
      const quoteStart = match.index || 0
      const quoteText = match[1]?.trim() || ''
      const speaker = detectSpeaker(work, unit.text, quoteStart, quoteStart + match[0].length)
      if (!shouldSplitQuote(unit.text, quoteStart, speaker)) continue
      if (quoteStart > cursor) {
        const narrator = unit.text.slice(cursor, quoteStart).replace(/[：:，,。\s]+$/g, '').trim()
        if (narrator) segments.push(createSegment(chapter, unit, segments.length, narrator, unit.start + cursor, undefined, false))
      }
      segments.push(createSegment(chapter, unit, segments.length, quoteText, unit.start + quoteStart + 1, speaker, !speaker))
      cursor = quoteStart + match[0].length
    }

    const tail = unit.text.slice(cursor).replace(/^[，,。\s]+/g, '').trim()
    if (tail && !new RegExp(`^[\\p{Script=Han}A-Za-z0-9_·]{1,12}\\s*${SPEECH_VERBS}`, 'u').test(tail)) {
      segments.push(createSegment(chapter, unit, segments.length, tail, unit.end - tail.length, undefined, false))
    }
  }

  return segments.map((segment, order) => ({ ...segment, order }))
}

export function segmentsNeedingAttribution(segments: AudiobookSegment[]) {
  return segments.filter((segment) => segment.needsReview || segment.attributionStatus === 'failed' || segment.attributionStatus === 'pending')
}
