import { generateId } from '@/utils/id'
import type { BackfillCandidate, BackfillTask, BackfillWindow } from './types'
import { evidenceLabelFor, reviewStatusFor } from './confidence'

type JsonRecord = Record<string, unknown>

export interface BackfillParseResult {
  candidates: BackfillCandidate[]
  errors: string[]
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function cleanJson(text: string) {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) return cleaned.slice(objectStart, objectEnd + 1)
  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) return `{"candidates":${cleaned.slice(arrayStart, arrayEnd + 1)}}`
  return cleaned
}

function normalizeConfidence(value: unknown) {
  return typeof value === 'number' ? Math.max(0, Math.min(1, value)) : 0.5
}

function sourceFor(item: JsonRecord, window: BackfillWindow) {
  const sourceExcerpt = typeof item.sourceExcerpt === 'string' ? item.sourceExcerpt.trim() : ''
  return [{
    chapterId: window.chapterId,
    chapterTitle: window.chapterTitle,
    outlineId: window.outlineId,
    excerpt: sourceExcerpt,
    windowIndex: window.windowIndex,
    startOffset: sourceExcerpt ? window.text.indexOf(sourceExcerpt) : undefined,
    endOffset: sourceExcerpt ? window.text.indexOf(sourceExcerpt) + sourceExcerpt.length : undefined,
  }]
}

function candidateTitle(task: BackfillTask, item: JsonRecord) {
  if (typeof item.title === 'string' && item.title.trim()) return item.title.trim()
  if (typeof item.name === 'string' && item.name.trim()) return item.name.trim()
  if (typeof item.summary === 'string' && item.summary.trim()) return item.summary.trim().slice(0, 32)
  if (typeof item.field === 'string') return item.field
  return task
}

export function parseBackfillJson(task: BackfillTask, text: string, window: BackfillWindow): BackfillParseResult {
  try {
    const parsed = JSON.parse(cleanJson(text))
    const record = asRecord(parsed)
    const rawCandidates = Array.isArray(record?.candidates) ? record.candidates : []
    const candidates: BackfillCandidate[] = []
    const errors: string[] = []

    rawCandidates.forEach((raw, index) => {
      const item = asRecord(raw)
      if (!item) {
        errors.push(`第 ${index + 1} 条候选格式无效`)
        return
      }
      const sources = sourceFor(item, window)
      const confidence = normalizeConfidence(item.confidence)
      const label = evidenceLabelFor(confidence, sources)
      const base = {
        id: generateId(),
        task,
        title: candidateTitle(task, item),
        sources,
        confidence,
        evidenceLabel: label,
        reviewStatus: reviewStatusFor(label),
      }

      if (task === 'chapterSummary' && typeof item.summary === 'string' && window.outlineId) {
        candidates.push({ ...base, task, value: { outlineId: window.outlineId, summary: item.summary.trim() } })
      } else if (task === 'characters' && typeof item.name === 'string') {
        candidates.push({ ...base, task, value: { name: item.name.trim(), role: item.role === 'supporting' || item.role === 'minor' ? item.role : 'major', bio: String(item.bio ?? '').trim(), traits: Array.isArray(item.traits) ? item.traits.filter((trait): trait is string => typeof trait === 'string') : [], aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === 'string') : [] } })
      } else if (task === 'settings' && typeof item.title === 'string') {
        candidates.push({ ...base, task, value: { category: String(item.category ?? 'world'), title: item.title.trim(), content: String(item.content ?? '').trim() } })
      } else if (task === 'constraints' && typeof item.title === 'string') {
        candidates.push({ ...base, task, value: { type: item.type === 'fate' || item.type === 'foreshadow' || item.type === 'rule' || item.type === 'rhythm' || item.type === 'structure' ? item.type : 'event', title: item.title.trim(), description: String(item.description ?? '').trim(), priority: item.priority === 'suggested' || item.priority === 'optional' ? item.priority : 'required' } })
      } else if (task === 'storylines' && typeof item.name === 'string') {
        candidates.push({ ...base, task, value: { name: item.name.trim(), description: String(item.description ?? '').trim(), chapterLinks: [{ chapterId: window.chapterId, description: String(item.description ?? '').trim() }] } })
      } else if (task === 'seed' && typeof item.field === 'string') {
        candidates.push({ ...base, task, value: { field: item.field as never, value: Array.isArray(item.value) ? item.value.filter((part): part is string => typeof part === 'string') : String(item.value ?? '').trim() } })
      } else {
        errors.push(`第 ${index + 1} 条候选缺少 ${task} 必填字段`)
      }
    })

    return { candidates, errors }
  } catch (error) {
    return { candidates: [], errors: [error instanceof Error ? `AI 返回 JSON 无法解析：${error.message}` : 'AI 返回 JSON 无法解析'] }
  }
}
