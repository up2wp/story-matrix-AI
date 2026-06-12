// ============================================================
// Story Matrix AI - 核心类型定义
// ============================================================

// --- 故事萌芽 ---

export type LaunchMode = 'random' | 'inspired'

export interface StorySeed {
  timePeriod: string           // 时间背景
  regions: string[]            // 地域范围（一个或多个）
  genre: string                // 主类型
  subGenre?: string            // 子类型
  coreConcept: string          // 核心概念（一句话概括）
  tone: string                 // 基调风格
  targetAudience?: string      // 目标读者
  pov?: string                 // 叙述视角
  launchMode?: LaunchMode      // 启动方式（已废弃，保留兼容旧数据）
}

// --- 角色 ---

export type CharacterRole = 'major' | 'supporting' | 'minor'

export interface Relation {
  targetId: string             // 目标角色 ID
  description: string          // 关系描述
}

export interface CharacterArc {
  stage: string                // 阶段名称
  description: string          // 该阶段的状态描述
  trigger?: string             // 触发转变的事件
}

export interface Character {
  id: string
  name: string
  avatar?: string
  role: CharacterRole
  bio: string                  // 经历背景
  personality: {
    traits: string[]           // 性格特质
    habits: string[]           // 行为习惯
    arc: CharacterArc[]        // 性格发展弧线
  }
  relations: Relation[]
  tags: string[]
}

// --- 设定 ---

export interface Setting {
  id: string
  category: string             // world/magic/tech/culture/politics/economy...
  title: string
  content: string
  relatedSettingIds: string[]  // 关联的其他设定
  relatedCharacterIds: string[] // 相关角色
}

// --- 核心约束 ---

export type ConstraintType = 'event' | 'fate' | 'foreshadow' | 'rule' | 'rhythm'
export type ConstraintPriority = 'required' | 'suggested' | 'optional'
export type ConstraintStatus = 'pending' | 'fulfilled' | 'waived'

export interface Constraint {
  id: string
  type: ConstraintType
  title: string
  description: string
  priority: ConstraintPriority
  status: ConstraintStatus
}

// --- 大纲 ---

export type OutlineLevel = 'volume' | 'chapter' | 'section'

export interface OutlineNode {
  id: string
  parentId?: string
  title: string
  summary: string
  order: number
  level: OutlineLevel
  characterIds: string[]       // 涉及角色
  storylineIds: string[]       // 关联故事线
}

// --- 章节 ---

export interface Scene {
  id: string
  title: string
  summary: string
  emotion: string              // 情绪基调
  characterIds: string[]
  content: string              // 正文内容
}

export interface Chapter {
  id: string
  outlineId: string            // 关联的大纲节点
  title: string
  content: string              // 正文内容（Markdown）
  wordCount: number
  scenes: Scene[]
  versions: Version[]
  userDirection?: string       // 用户创作方向
}

export interface Version {
  id: string
  timestamp: number
  content: string
  wordCount: number
  note?: string
}

// --- 故事线 ---

export interface ChapterLink {
  chapterId: string
  description: string
}

export interface Storyline {
  id: string
  name: string
  color: string
  description: string
  chapterLinks: ChapterLink[]
}

// --- 事件簿 ---

export interface EventLogEntry {
  id: string
  chapterId: string          // 来源章节 ID
  chapterTitle: string       // 章节标题
  type: string               // 事件类型
  characters: string[]       // 涉及的角色名称
  description: string        // 事件描述（50字以内）
  timestamp: number          // 记录时间
}

export interface EventLogConfig {
  enabled: boolean
  extractPrompt: string
}

// --- 有声读物 / Voicebox ---

export interface VoiceboxConfig {
  serviceUrl: string
  authType: 'none' | 'bearer' | 'api-key' | 'custom-header'
  bearerToken?: string
  apiKey?: string
  customHeaderName?: string
  customHeaderValue?: string
  defaultEngine: string
  defaultLanguage: string
  defaultChunking: boolean
  defaultCrossfade: number
  defaultNormalize: boolean
}

export type VoiceBindingSource = 'profile' | 'sample' | 'pending'
export type AudiobookSpeakerKind = 'narrator' | 'character'
export type ChapterAudioStatus = 'pending' | 'generating' | 'completed' | 'failed'

export interface VoiceBinding {
  id: string
  speakerKind: AudiobookSpeakerKind
  characterId?: string
  displayName: string
  source: VoiceBindingSource
  profileId?: string
  profileName?: string
  sampleId?: string
  prompt: string
  referenceText?: string
  updatedAt: number
}

export interface AudiobookSegment {
  id: string
  chapterId: string
  order: number
  speakerKind: AudiobookSpeakerKind
  characterId?: string
  speakerName: string
  text: string
  mood: string
  prompt: string
  generationId?: string
  status: ChapterAudioStatus
  error?: string
}

export interface ChapterAudioState {
  chapterId: string
  status: ChapterAudioStatus
  segmentIds: string[]
  generationIds: string[]
  updatedAt: number
  error?: string
}

export interface WorkAudiobookConfig {
  narratorBinding: VoiceBinding
  characterBindings: Record<string, VoiceBinding>
  segmentsByChapter: Record<string, AudiobookSegment[]>
  chapterAudio: Record<string, ChapterAudioState>
}

// --- 作品 ---

export interface Work {
  id: string
  ownerId: string            // 作品所有者 User.id
  shared: boolean            // 是否分享给其他用户
  title: string
  createdAt: number
  updatedAt: number
  seed: StorySeed
  characters: Character[]
  settings: Setting[]
  constraints: Constraint[]
  storylines: Storyline[]
  outline: OutlineNode[]
  chapters: Chapter[]
  eventLog?: EventLogEntry[]
  eventLogConfig?: EventLogConfig
  audiobook?: WorkAudiobookConfig
}

// --- AI 相关 ---

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'custom'
  apiKey: string
  baseUrl?: string
  model: string
  maxTokens?: number
}

// --- 用户 ---

export interface User {
  id: string
  username: string
  passwordHash?: string   // SHA-256 hex digest
  displayName: string
  role: 'owner' | 'admin' | 'user'
  createdAt: number
  deletedAt?: number | null
}

// --- 系统配置 ---

export interface SystemConfig {
  id: 'singleton'
  registrationEnabled: boolean
  aiConfig?: AIConfig
  voiceboxConfig?: VoiceboxConfig
}
