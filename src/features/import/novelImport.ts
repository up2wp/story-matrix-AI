import type { Chapter, OutlineNode, Work } from '@/core/types'
import { generateId } from '@/utils/id'

export type ImportIssueLevel = 'warning' | 'error'
export type ImportBoundarySource = 'rule' | 'ai'

export interface ImportIssue {
  level: ImportIssueLevel
  message: string
}

export interface ImportChapterDraft {
  id: string
  title: string
  body: string
  order: number
  wordCount: number
  confidence: number
  needsReview: boolean
  source: ImportBoundarySource
}

export interface NovelImportDraft {
  fileName: string
  title: string
  chapters: ImportChapterDraft[]
  issues: ImportIssue[]
  needsReview: boolean
}

export interface AiBoundarySuggestion {
  title: string
  startOffset: number
  endOffset?: number
  confidence?: number
  reason?: string
}

const SUPPORTED_EXTENSIONS = ['.txt', '.md']

const MARKDOWN_HEADING = /^(#{1,3})\s+(.+)$/
const CHINESE_CHAPTER_HEADING = /^(第\s*[\d一二三四五六七八九十百千万〇零两]+\s*[章节回卷部集篇].*)$/
const ENGLISH_CHAPTER_HEADING = /^(chapter\s+[\divxlcdm]+\b.*)$/i

function normalizeText(text: string) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function extensionOf(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

function stripHeading(line: string) {
  const markdown = line.match(MARKDOWN_HEADING)
  if (markdown) return markdown[2].trim()
  return line.trim()
}

function isChapterHeading(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return false
  return MARKDOWN_HEADING.test(trimmed) || CHINESE_CHAPTER_HEADING.test(trimmed) || ENGLISH_CHAPTER_HEADING.test(trimmed)
}

function wordCount(text: string) {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length || 0
  const words = text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+(?:['-][A-Za-z0-9_]+)*/g)?.length || 0
  return cjk + words
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim() || '导入作品'
}

export function canImportNovelFile(fileName: string) {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(fileName))
}

export function parseNovelImportDraft(fileName: string, rawText: string): NovelImportDraft {
  const issues: ImportIssue[] = []
  const title = titleFromFileName(fileName)

  if (!canImportNovelFile(fileName)) {
    return {
      fileName,
      title,
      chapters: [],
      issues: [{ level: 'error', message: '仅支持导入 .txt 或 .md 文件' }],
      needsReview: true,
    }
  }

  const text = normalizeText(rawText)
  if (!text.trim()) {
    return {
      fileName,
      title,
      chapters: [],
      issues: [{ level: 'error', message: '文件内容为空，无法导入' }],
      needsReview: true,
    }
  }

  const lines = text.split('\n')
  const chapters: ImportChapterDraft[] = []
  let currentTitle = ''
  let currentBody: string[] = []
  let preface: string[] = []

  const pushChapter = () => {
    if (!currentTitle) return
    const body = currentBody.join('\n').trim()
    chapters.push({
      id: generateId(),
      title: currentTitle,
      body,
      order: chapters.length,
      wordCount: wordCount(body),
      confidence: body ? 0.95 : 0.72,
      needsReview: !body,
      source: 'rule',
    })
  }

  for (const line of lines) {
    if (isChapterHeading(line)) {
      pushChapter()
      currentTitle = stripHeading(line)
      currentBody = []
      continue
    }

    if (currentTitle) currentBody.push(line)
    else preface.push(line)
  }
  pushChapter()

  const prefaceText = preface.join('\n').trim()
  if (prefaceText && chapters.length) {
    issues.push({ level: 'warning', message: '章节标题前存在正文，已作为导入提示保留，请确认是否为序章' })
  }

  if (!chapters.length) {
    issues.push({ level: 'warning', message: '未识别到明确章节标题，可使用 AI 辅助边界建议后再确认' })
  }

  if (chapters.some((chapter) => chapter.needsReview)) {
    issues.push({ level: 'warning', message: '存在空章节或低置信度章节，请确认后再创建作品' })
  }

  return {
    fileName,
    title,
    chapters,
    issues,
    needsReview: issues.some((issue) => issue.level === 'error') || chapters.some((chapter) => chapter.needsReview),
  }
}

export function parseAiBoundaryJson(text: string): AiBoundarySuggestion[] {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('AI 没有返回边界 JSON 数组')
  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('AI 边界结果不是数组')
  return parsed
    .filter((item): item is AiBoundarySuggestion => {
      return Boolean(item && typeof item === 'object' && typeof item.title === 'string' && typeof item.startOffset === 'number')
    })
    .map((item) => ({
      title: item.title.trim(),
      startOffset: Math.max(0, Math.floor(item.startOffset)),
      endOffset: typeof item.endOffset === 'number' ? Math.max(0, Math.floor(item.endOffset)) : undefined,
      confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
      reason: item.reason,
    }))
}

export function applyAiBoundarySuggestions(draft: NovelImportDraft, suggestions: AiBoundarySuggestion[]): NovelImportDraft {
  if (!suggestions.length) return draft
  const aiChapters = suggestions.map((suggestion, index): ImportChapterDraft => ({
    id: generateId(),
    title: suggestion.title || `AI 建议章节 ${index + 1}`,
    body: '',
    order: index,
    wordCount: 0,
    confidence: suggestion.confidence ?? 0.5,
    needsReview: true,
    source: 'ai',
  }))
  return {
    ...draft,
    chapters: draft.chapters.length ? draft.chapters : aiChapters,
    issues: [
      ...draft.issues,
      { level: 'warning', message: 'AI 已提供章节边界建议，低置信度结果需人工确认后才能创建作品' },
    ],
    needsReview: true,
  }
}

export function createWorkFromImportDraft(draft: NovelImportDraft, ownerId: string): Work {
  if (!draft.chapters.length) throw new Error('没有可导入的章节')
  const now = Date.now()
  const outline: OutlineNode[] = draft.chapters.map((chapter) => ({
    id: generateId(),
    title: chapter.title,
    summary: '',
    order: chapter.order,
    level: 'chapter',
    characterIds: [],
    storylineIds: [],
  }))
  const chapters: Chapter[] = draft.chapters.map((chapter, index) => ({
    id: generateId(),
    outlineId: outline[index].id,
    title: chapter.title,
    content: chapter.body,
    wordCount: chapter.wordCount,
    scenes: [],
    versions: [],
  }))

  return {
    id: generateId(),
    ownerId,
    shared: false,
    title: draft.title,
    createdAt: now,
    updatedAt: now,
    seed: {
      timePeriod: '',
      regions: [],
      genre: '',
      coreConcept: '',
      tone: '',
    },
    characters: [],
    settings: [],
    constraints: [],
    storylines: [],
    outline,
    chapters,
  }
}
