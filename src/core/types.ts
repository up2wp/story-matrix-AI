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
  type: string                 // 关系类型：血缘/师徒/敌对/暧昧/朋友...
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
export type ConstraintScope = 'local' | 'global'
export type ConstraintPriority = 'required' | 'suggested' | 'optional'
export type ConstraintStatus = 'pending' | 'fulfilled' | 'waived'

export interface Constraint {
  id: string
  type: ConstraintType
  scope: ConstraintScope           // local=绑定具体章节, global=自动绑定全部章节
  title: string
  description: string
  priority: ConstraintPriority
  relatedOutlineIds: string[]      // 关联的大纲节点（局部约束手动绑定，全局约束自动绑定）
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
  constraintIds: string[]      // 需覆盖的约束
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
}

// --- AI 相关 ---

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'custom'
  apiKey: string
  baseUrl?: string
  model: string
}

// --- 用户 ---

export interface User {
  id: string
  username: string
  passwordHash: string   // SHA-256 hex digest
  displayName: string
  role: 'admin' | 'user'
  createdAt: number
}

// --- 系统配置 ---

export interface SystemConfig {
  id: 'singleton'
  registrationEnabled: boolean
  aiConfig?: AIConfig
}
