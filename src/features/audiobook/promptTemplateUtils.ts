import type { AudiobookSegment, Chapter, VoiceBinding } from '@/core/types'

export const CONTEXT_PLACEHOLDER = '【上下文】'
export const TEXT_PLACEHOLDER = '【文本】'
export const BYSTANDER_PROMPT_TEMPLATE = `当前语境：${CONTEXT_PLACEHOLDER}`

export function validatePromptTemplate(template: string) {
  return template.includes(CONTEXT_PLACEHOLDER)
}

function removeSpeechTextPlaceholder(template: string) {
  return template
    .replace(/^[ \t]*(朗读|待朗读正文|正文|文本)[:：][ \t]*【文本】[ \t]*$/gm, '')
    .replaceAll(TEXT_PLACEHOLDER, '')
}

function paragraphsWithOffsets(content: string) {
  const paragraphs: { text: string; start: number; end: number }[] = []
  const pattern = /\S(?:.|\n)*?(?=\n\s*\n|$)/g
  for (const match of content.matchAll(pattern)) {
    const raw = match[0]
    const text = raw.trim()
    if (!text) continue
    const leading = raw.search(/\S/)
    const start = (match.index || 0) + (leading >= 0 ? leading : 0)
    paragraphs.push({ text, start, end: start + text.length })
  }
  return paragraphs
}

export function locateSegment(chapter: Chapter, segment: Pick<AudiobookSegment, 'text' | 'sourceStartOffset'>) {
  if (typeof segment.sourceStartOffset === 'number' && segment.sourceStartOffset >= 0) return segment.sourceStartOffset
  return chapter.content.indexOf(segment.text)
}

export function contextBeforeSegment(chapter: Chapter, segment: Pick<AudiobookSegment, 'text' | 'sourceStartOffset'>, paragraphCount = 3) {
  const start = locateSegment(chapter, segment)
  if (start < 0) throw new Error('无法定位该分段在章节中的位置，请重新分段')
  const paragraphs = paragraphsWithOffsets(chapter.content)
  const before = paragraphs.filter((paragraph) => paragraph.end <= start).slice(-paragraphCount)
  return before.map((paragraph) => paragraph.text).join('\n\n')
}

function stableHash(text: string) {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  return String(hash >>> 0)
}

export function fillPromptTemplate(binding: VoiceBinding, chapter: Chapter, segment: AudiobookSegment, overridePrompt?: string, limit = 500) {
  if (overridePrompt?.trim()) {
    const prompt = removeSpeechTextPlaceholder(overridePrompt.trim())
    return { instruct: prompt.slice(-limit), clipped: prompt.length > limit, hash: stableHash(prompt.slice(-limit)) }
  }
  const template = overridePrompt || binding.promptTemplate || binding.prompt
  if (!template.trim()) throw new Error(`${binding.displayName} 缺少提示词模板`)
  if (binding.speakerKind === 'narrator') {
    const narratorPrompt = removeSpeechTextPlaceholder(template)
      .replace(new RegExp(`[ \\t]*当前语境[:：][ \\t]*${CONTEXT_PLACEHOLDER}[ \\t]*$`), '')
      .trim()
    return { instruct: narratorPrompt.slice(-limit), clipped: narratorPrompt.length > limit, hash: stableHash(narratorPrompt.slice(-limit)) }
  }
  if (!validatePromptTemplate(template)) throw new Error(`${binding.displayName} 的提示词模板缺少占位符`)
  const context = contextBeforeSegment(chapter, segment)
  const cleanedTemplate = removeSpeechTextPlaceholder(template)
  const filled = cleanedTemplate.replaceAll(CONTEXT_PLACEHOLDER, context)
  if (filled.length <= limit) return { instruct: filled, clipped: false, hash: stableHash(filled) }
  const overflow = filled.length - limit
  const clippedContext = context.slice(Math.min(context.length, overflow + 20))
  const clipped = cleanedTemplate.replaceAll(CONTEXT_PLACEHOLDER, clippedContext).slice(-limit)
  return { instruct: clipped, clipped: true, hash: stableHash(clipped) }
}

export function buildSegmentTonePrompt(binding: VoiceBinding, previousSegments: Pick<AudiobookSegment, 'text'>[]) {
  const template = binding.promptTemplate || binding.prompt
  if (!template.trim()) throw new Error(`${binding.displayName} 缺少提示词模板`)
  if (binding.speakerKind === 'narrator') {
    return removeSpeechTextPlaceholder(template)
      .replace(new RegExp(`[ \\t]*当前语境[:：][ \\t]*${CONTEXT_PLACEHOLDER}[ \\t]*$`), '')
      .trim()
  }
  if (!validatePromptTemplate(template)) throw new Error(`${binding.displayName} 的提示词模板缺少占位符`)
  const context = previousSegments.map((segment) => segment.text.trim()).filter(Boolean).join('\n')
  return removeSpeechTextPlaceholder(template).replaceAll(CONTEXT_PLACEHOLDER, context)
}

export function textHash(text: string) {
  return stableHash(text)
}
