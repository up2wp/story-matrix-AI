import { create } from 'zustand'
import type { Work, AIConfig, WorkAudiobookConfig, Chapter, VoiceBinding, AudiobookSegment } from './types'
import { db } from './db'

type LegacyRecord = Record<string, unknown>

function asRecord(value: unknown): LegacyRecord {
  return value && typeof value === 'object' ? value as LegacyRecord : {}
}

function ensurePromptTemplatePlaceholder(template: string, speakerKind: unknown) {
  if (!template.trim()) return ''
  if (speakerKind === 'narrator') return template.replace(/[ \t]*当前语境[:：][ \t]*【上下文】[ \t]*$/, '').trim()
  if (template.includes('【上下文】')) return template
  return `${template}。当前语境：【上下文】`
}

function bindingNeedsPromptTemplateMigration(binding: unknown) {
  const record = asRecord(binding)
  if (record.speakerKind === 'narrator') {
    return (typeof record.prompt === 'string' && record.prompt.includes('【上下文】'))
      || (typeof record.promptTemplate === 'string' && record.promptTemplate.includes('【上下文】'))
  }
  return (typeof record.prompt === 'string' && record.prompt.trim() && !record.prompt.includes('【上下文】'))
    || (typeof record.promptTemplate === 'string' && record.promptTemplate.trim() && !record.promptTemplate.includes('【上下文】'))
}

/** 清理旧版本遗留字段，补充新字段默认值 */
function migrateWork(work: Work): Work {
  let changed = false

  const defaultAudiobook: WorkAudiobookConfig = {
    narratorBinding: {
      id: 'narrator',
      speakerKind: 'narrator',
      displayName: '旁白',
      source: 'pending',
      prompt: `${work.seed.tone || '自然'}、清晰、适合长篇小说旁白。`,
      promptTemplate: `${work.seed.tone || '自然'}、清晰、适合长篇小说旁白。`,
      updatedAt: Date.now(),
      promptUpdatedAt: Date.now(),
    },
    characterBindings: {},
    chapterBindings: {},
    segmentsByChapter: {},
    chapterAudio: {},
  }

  const migrateBinding = (binding: unknown): VoiceBinding => {
    const record = asRecord(binding)
    return {
      ...record,
      prompt: ensurePromptTemplatePlaceholder(typeof record.prompt === 'string' ? record.prompt : '', record.speakerKind),
      promptTemplate: ensurePromptTemplatePlaceholder(typeof record.promptTemplate === 'string' ? record.promptTemplate : typeof record.prompt === 'string' ? record.prompt : '', record.speakerKind),
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      promptUpdatedAt: typeof record.promptUpdatedAt === 'number' ? record.promptUpdatedAt : typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    } as unknown as VoiceBinding
  }

  const migrateSegment = (segment: unknown, chapter: Chapter | undefined): AudiobookSegment => {
    const record = asRecord(segment)
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    const sourceStartOffset = typeof record.sourceStartOffset === 'number'
      ? record.sourceStartOffset
      : chapter?.content?.indexOf(text)
    return {
      ...record,
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
      sourceStartOffset: typeof sourceStartOffset === 'number' && sourceStartOffset >= 0 ? sourceStartOffset : undefined,
      sourceEndOffset: typeof record.sourceEndOffset === 'number'
        ? record.sourceEndOffset
        : typeof sourceStartOffset === 'number' && sourceStartOffset >= 0 ? sourceStartOffset + text.length : undefined,
      sourceParagraphIndex: typeof record.sourceParagraphIndex === 'number' ? record.sourceParagraphIndex : undefined,
      segmentationSource: typeof record.segmentationSource === 'string' ? record.segmentationSource : 'legacy',
      attributionSource: typeof record.attributionSource === 'string' ? record.attributionSource : 'legacy',
      attributionStatus: typeof record.attributionStatus === 'string' ? record.attributionStatus : 'attributed',
      attributionConfidence: typeof record.attributionConfidence === 'number' ? record.attributionConfidence : 1,
      needsReview: typeof record.needsReview === 'boolean' ? record.needsReview : false,
      retryable: typeof record.retryable === 'boolean' ? record.retryable : false,
    } as unknown as AudiobookSegment
  }
  // 清理约束的 scope 和 relatedOutlineIds
  const constraints = work.constraints.map((constraint) => {
    const record = asRecord(constraint)
    if ('scope' in record || 'relatedOutlineIds' in record) {
      changed = true
      const { scope: _scope, relatedOutlineIds: _relatedOutlineIds, ...rest } = record
      return rest as unknown as typeof constraint
    }
    return constraint
  })
  // 清理大纲节点的 constraintIds
  const outline = work.outline.map((node) => {
    const record = asRecord(node)
    if ('constraintIds' in record) {
      changed = true
      const { constraintIds: _constraintIds, ...rest } = record
      return rest as unknown as typeof node
    }
    return node
  })
  // 补充事件簿默认值
  if (!work.eventLog) {
    work = { ...work, eventLog: [] }
    changed = true
  }
  if (!work.audiobook) {
    work = { ...work, audiobook: defaultAudiobook }
    changed = true
  } else {
    const audiobook = asRecord(work.audiobook)
    const characterBindings = asRecord(audiobook.characterBindings)
    const chapterBindings = asRecord(audiobook.chapterBindings)
    const segmentsByChapter = asRecord(audiobook.segmentsByChapter)
    const nextAudiobook: WorkAudiobookConfig = {
      narratorBinding: migrateBinding(audiobook.narratorBinding || defaultAudiobook.narratorBinding),
      characterBindings: Object.fromEntries(Object.entries(characterBindings).map(([key, value]) => [key, migrateBinding(value)])),
      chapterBindings: Object.fromEntries(Object.entries(chapterBindings).map(([chapterId, bindings]) => [
        chapterId,
        Object.fromEntries(Object.entries(asRecord(bindings)).map(([key, value]) => [key, migrateBinding(value)])),
      ])),
      segmentsByChapter: Object.fromEntries(Object.entries(segmentsByChapter).map(([chapterId, segments]) => {
        const chapter = work.chapters.find((item) => item.id === chapterId)
        return [chapterId, Array.isArray(segments) ? segments.map((segment) => migrateSegment(segment, chapter)) : []]
      })),
      chapterAudio: asRecord(audiobook.chapterAudio) as WorkAudiobookConfig['chapterAudio'],
    }
    const narratorBinding = asRecord(audiobook.narratorBinding)
    if (!audiobook.chapterBindings || !narratorBinding.promptTemplate || bindingNeedsPromptTemplateMigration(audiobook.narratorBinding) || Object.values(characterBindings).some(bindingNeedsPromptTemplateMigration) || Object.values(chapterBindings).some((bindings) => Object.values(asRecord(bindings)).some(bindingNeedsPromptTemplateMigration)) || Object.values(segmentsByChapter).some((segments) => Array.isArray(segments) && segments.some((segment) => typeof asRecord(segment).sourceStartOffset !== 'number' || typeof asRecord(segment).segmentationSource !== 'string'))) {
      work = { ...work, audiobook: nextAudiobook }
      changed = true
    }
  }
  if (changed) {
    const migrated = { ...work, constraints, outline }
    // 异步持久化迁移结果
    db.works.update(work.id, { constraints, outline, eventLog: migrated.eventLog, audiobook: migrated.audiobook }).catch(() => {})
    return migrated
  }
  return work
}

// ============================================================
// 最近作品记忆
// ============================================================

const LAST_WORK_KEY = 'story-matrix-last-work'

function saveLastWorkId(id: string | null) {
  if (id) localStorage.setItem(LAST_WORK_KEY, id)
  else localStorage.removeItem(LAST_WORK_KEY)
}

function getLastWorkId(): string | null {
  return localStorage.getItem(LAST_WORK_KEY)
}

// ============================================================
// Zustand 全局状态
// ============================================================

interface AppState {
  // 当前作品
  currentWork: Work | null
  setCurrentWork: (work: Work | null) => void
  /** 从 localStorage 恢复上次打开的作品 */
  loadLastWork: () => Promise<void>

  // 当前阶段
  currentPhase: 'seed' | 'world' | 'constraints' | 'outline' | 'chapters'
  setCurrentPhase: (phase: AppState['currentPhase']) => void

  // 当前编辑的章节 ID
  activeChapterId: string | null
  setActiveChapterId: (id: string | null) => void

  // 侧边栏折叠
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void

  // AI 面板开关
  aiPanelOpen: boolean
  toggleAIPanel: () => void

  // AI 配置
  aiConfig: AIConfig | null
  setAIConfig: (config: AIConfig | null) => void

  // AI 流式消息
  aiStreaming: boolean
  aiStreamText: string
  setAIStream: (streaming: boolean, text?: string) => void

  // 专注模式
  focusMode: boolean
  toggleFocusMode: () => void

  // 只读模式（查看他人分享的作品）
  readOnly: boolean
  setReadOnly: (v: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  currentWork: null,
  setCurrentWork: (work) => {
    saveLastWorkId(work?.id ?? null)
    set({ currentWork: work ? migrateWork(work) : null })
  },
  loadLastWork: async () => {
    const id = getLastWorkId()
    if (!id) return
    try {
      const work = await db.works.get(id)
      if (work) set({ currentWork: migrateWork(work) })
      else saveLastWorkId(null)
    } catch {
      saveLastWorkId(null)
    }
  },

  currentPhase: 'seed',
  setCurrentPhase: (phase) => set({ currentPhase: phase }),

  activeChapterId: null,
  setActiveChapterId: (id) => set({ activeChapterId: id }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  aiPanelOpen: true,
  toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),

  aiConfig: null,
  setAIConfig: (config) => set({ aiConfig: config }),

  aiStreaming: false,
  aiStreamText: '',
  setAIStream: (streaming, text) => set({ aiStreaming: streaming, aiStreamText: text ?? '' }),

  focusMode: false,
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  readOnly: false,
  setReadOnly: (v) => set({ readOnly: v }),
}))
