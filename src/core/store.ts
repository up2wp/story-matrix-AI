import { create } from 'zustand'
import type { Work, AIConfig } from './types'

// ============================================================
// Zustand 全局状态
// ============================================================

interface AppState {
  // 当前作品
  currentWork: Work | null
  setCurrentWork: (work: Work | null) => void

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
  setCurrentWork: (work) => set({ currentWork: work }),

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
