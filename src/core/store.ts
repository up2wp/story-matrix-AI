import { create } from 'zustand'
import type { Work, AIConfig } from './types'
import { db } from './db'

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
    set({ currentWork: work })
  },
  loadLastWork: async () => {
    const id = getLastWorkId()
    if (!id) return
    try {
      const work = await db.works.get(id)
      if (work) set({ currentWork: work })
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
