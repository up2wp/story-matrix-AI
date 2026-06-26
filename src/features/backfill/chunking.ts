import type { Chapter } from '@/core/types'
import type { BackfillWindowResult } from './types'

export const BACKFILL_WINDOW_CHAR_LIMIT = 1800
export const BACKFILL_WINDOW_OVERLAP = 180

interface BuildBackfillWindowsOptions {
  maxChars?: number
  overlapChars?: number
}

function splitParagraphs(text: string) {
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
}

function sliceWithParagraphBoundaries(text: string, maxChars: number, overlapChars: number) {
  const paragraphs = splitParagraphs(text)
  const chunks: { text: string; startOffset: number; endOffset: number }[] = []
  let cursor = 0
  let buffer = ''
  let bufferStart = 0

  const flush = () => {
    const trimmed = buffer.trim()
    if (!trimmed) return
    const startOffset = text.indexOf(trimmed.slice(0, Math.min(12, trimmed.length)), bufferStart)
    const safeStart = startOffset >= 0 ? startOffset : bufferStart
    chunks.push({ text: trimmed, startOffset: safeStart, endOffset: safeStart + trimmed.length })
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    const paragraphStart = text.indexOf(paragraph, cursor)
    cursor = paragraphStart >= 0 ? paragraphStart + paragraph.length : cursor
    if (!buffer) bufferStart = paragraphStart >= 0 ? paragraphStart : cursor
    if (paragraph.length > maxChars) {
      flush()
      for (let offset = 0; offset < paragraph.length; offset += Math.max(1, maxChars - overlapChars)) {
        const part = paragraph.slice(offset, offset + maxChars).trim()
        if (part) chunks.push({ text: part, startOffset: (paragraphStart >= 0 ? paragraphStart : 0) + offset, endOffset: (paragraphStart >= 0 ? paragraphStart : 0) + offset + part.length })
      }
      continue
    }
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph
    if (next.length > maxChars) {
      flush()
      bufferStart = paragraphStart >= 0 ? paragraphStart : cursor
      buffer = paragraph
    } else {
      buffer = next
    }
  }
  flush()

  if (chunks.length <= 1 || overlapChars <= 0) return chunks
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk
    const previous = chunks[index - 1]
    const overlap = previous.text.slice(-overlapChars)
    const textWithOverlap = `${overlap}\n${chunk.text}`.slice(0, maxChars)
    return { ...chunk, text: textWithOverlap, startOffset: Math.max(0, chunk.startOffset - overlap.length) }
  })
}

export function buildBackfillWindows(chapters: Chapter[], options: BuildBackfillWindowsOptions = {}): BackfillWindowResult {
  const maxChars = options.maxChars ?? BACKFILL_WINDOW_CHAR_LIMIT
  const overlapChars = Math.min(options.overlapChars ?? BACKFILL_WINDOW_OVERLAP, Math.floor(maxChars / 3))
  const result: BackfillWindowResult = { windows: [], skipped: [] }

  for (const chapter of chapters) {
    const content = chapter.content.trim()
    if (!content) {
      result.skipped.push({ chapterId: chapter.id, chapterTitle: chapter.title, reason: '本章暂无可用于反推的正文' })
      continue
    }
    const chunks = sliceWithParagraphBoundaries(content, maxChars, overlapChars)
    chunks.forEach((chunk, index) => {
      result.windows.push({
        id: `${chapter.id}-window-${index + 1}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        outlineId: chapter.outlineId,
        windowIndex: index + 1,
        text: chunk.text,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        previousHint: index > 0 ? chunks[index - 1].text.slice(-80) : undefined,
        nextHint: index < chunks.length - 1 ? chunks[index + 1].text.slice(0, 80) : undefined,
      })
    })
  }

  return result
}
