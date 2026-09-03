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

export type ConstraintType = 'event' | 'fate' | 'foreshadow' | 'rule' | 'rhythm' | 'structure'
export type ConstraintPriority = 'required' | 'suggested' | 'optional'

export interface Constraint {
  id: string
  type: ConstraintType
  title: string
  description: string
  priority: ConstraintPriority
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
  generationConcurrency: number
}

export interface NovelImportConfig {
  enabled: boolean
  featurePermissions?: FeaturePermissionConfig
  riskControls?: ImageGenerationRiskControls
}

export type ImageProviderType = 'openai' | 'openai-compatible' | 'custom' | 'minimax'

export type ImageProviderProtocol = 'openai-images' | 'openai-compatible-images' | 'minimax-image-generation'

export const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 300000

export interface ImageGenerationModelCapability {
  sizes: string[]
  qualities: string[]
  formats: string[]
  aspectRatios?: string[]
  referenceImages?: boolean
  maxReferenceImages?: number
}

export interface ImageGenerationProviderConfig {
  id: string
  type: ImageProviderType
  label: string
  baseUrl: string
  apiKey?: string
  protocol: ImageProviderProtocol
  enabled: boolean
  status?: 'untested' | 'ready' | 'failed'
  statusMessage?: string
}

export interface ImageGenerationModelConfig {
  id: string
  label: string
  provider: ImageProviderType
  providerId?: string
  baseUrl: string
  apiKey?: string
  model: string
  providerModel?: string
  enabled: boolean
  capabilities: ImageGenerationModelCapability
  requestTimeoutMs: number
}

export type ImageStorageMode = 'local' | 'immich'
export type ImageStorageStatus = 'succeeded' | 'pendingImmichUpload' | 'storageUploadFailed' | 'failed'
export type ImagegenHistoryStatus = ImageStorageStatus | 'generating'
export type ImageGenerationFailureSurface = 'work' | 'imagegen'
export type ImageGenerationFailureType = 'timeout' | 'provider' | 'storage' | 'contentPolicy' | 'configuration' | 'unknown'

export interface ImageGenerationRiskUserState {
  userId: string
  baselineAt?: number
  autoDisabledAt?: number
  autoDisabledByFailureId?: string
  autoDisabledSurface?: ImageGenerationFailureSurface
  autoDisabledFailureType?: ImageGenerationFailureType
  recoveredAt?: number
  recoveredByUserId?: string
}

export interface ImageGenerationRiskControlConfig {
  userStates: ImageGenerationRiskUserState[]
}

export interface ImageGenerationRiskControls {
  imageGeneration?: ImageGenerationRiskControlConfig
}

export interface ImagegenReferenceImageSummary {
  id: string
  thumbnailUrl: string
  originalUrl: string
}

export interface ImmichSharedLinkMetadata {
  id: string
  assetId: string
  expiresAt: string
}

export interface ImagegenHistoryRecord {
  id: string
  ownerId: string
  prompt: string
  generationPromptSnapshot: string
  provider: ImageProviderType
  providerLabel: string
  modelId: string
  modelName: string
  mimeType?: string
  storageMode: ImageStorageMode
  storageStatus: ImagegenHistoryStatus
  status: ImagegenHistoryStatus
  localAssetId?: string
  immichAssetId?: string
  immichFilename?: string
  thumbnailUrl?: string
  originalUrl?: string
  referenceImageIds: string[]
  referenceImages?: ImagegenReferenceImageSummary[]
  immichShare?: ImmichSharedLinkMetadata
  error?: string
  imageGenerationPermissionAutoDisabled?: true
  createdAt: number
}

export interface ImagegenReferenceAssetRecord {
  id: string
  ownerId: string
  originalFilename?: string
  mimeType: string
  byteSize: number
  storageMode: ImageStorageMode
  storageStatus: ImageStorageStatus
  thumbnailUrl: string
  originalUrl: string
  createdAt: number
}

export interface ImmichImageStorageConfig {
  serviceUrl: string
  publicBaseUrl?: string
  apiKey?: string
  projectName: string
  allowPrivateNetwork: boolean
}

export interface ImageGenerationConfig {
  enabled: boolean
  defaultModelId: string
  providers: ImageGenerationProviderConfig[]
  models: ImageGenerationModelConfig[]
  storageMode: ImageStorageMode
  immich: ImmichImageStorageConfig
}

export type FeatureKey = 'novelImport' | 'importBackfill' | 'imageGeneration'

export interface FeaturePermissionGrant {
  userId: string
  features: FeatureKey[]
}

export interface FeaturePermissionConfig {
  userGrants: FeaturePermissionGrant[]
}

export type VoiceBindingSource = 'profile' | 'sample' | 'pending'
export type AudiobookSpeakerKind = 'narrator' | 'character' | 'bystanderMale' | 'bystanderFemale'
export type BystanderVoiceKey = 'male' | 'female'
export type ChapterAudioStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'stale'
export type AudiobookSegmentationSource = 'legacy' | 'ai' | 'rule'
export type AudiobookAttributionSource = 'legacy' | 'ai' | 'rule' | 'llm' | 'manual'
export type AudiobookAttributionStatus = 'pending' | 'attributing' | 'attributed' | 'needs_review' | 'failed' | 'manual'

export interface UserVoiceAsset {
  id: string
  ownerId: string
  displayName: string
  profileId: string
  profileName?: string
  sampleId?: string
  referenceText: string
  consentConfirmedAt: number
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export interface VoiceBinding {
  id: string
  speakerKind: AudiobookSpeakerKind
  characterId?: string
  displayName: string
  source: VoiceBindingSource
  soundId?: string
  profileId?: string
  profileName?: string
  sampleId?: string
  prompt: string
  promptTemplate?: string
  referenceText?: string
  updatedAt: number
  promptUpdatedAt?: number
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
  sourceStartOffset?: number
  sourceEndOffset?: number
  sourceParagraphIndex?: number
  segmentationSource?: AudiobookSegmentationSource
  attributionSource?: AudiobookAttributionSource
  attributionStatus?: AudiobookAttributionStatus
  attributionConfidence?: number
  attributionBatchId?: string
  attributionError?: string
  needsReview?: boolean
  retryable?: boolean
  textEditedAt?: number
  speakerEditedAt?: number
  promptEditedAt?: number
  segmentVersion?: number
  generationId?: string
  status: ChapterAudioStatus
  error?: string
  generatedWith?: SegmentGenerationSnapshot
}

export interface SegmentGenerationSnapshot {
  bindingUpdatedAt?: number
  promptUpdatedAt?: number
  narratorUpdatedAt?: number
  textHash: string
  instructHash: string
}

export interface ChapterAudioState {
  chapterId: string
  status: ChapterAudioStatus
  segmentIds: string[]
  generationIds: string[]
  updatedAt: number
  error?: string
  generatedWith?: ChapterGenerationSnapshot
}

export interface ChapterGenerationSnapshot {
  narratorUpdatedAt?: number
  narratorPromptUpdatedAt?: number
  roleVersions: Record<string, number | undefined>
  segmentVersion: string
}

export interface WorkAudiobookConfig {
  narratorBinding: VoiceBinding
  bystanderBindings: Record<BystanderVoiceKey, VoiceBinding>
  characterBindings: Record<string, VoiceBinding>
  chapterBindings: Record<string, Record<string, VoiceBinding>>
  segmentsByChapter: Record<string, AudiobookSegment[]>
  chapterAudio: Record<string, ChapterAudioState>
}

export type ImagePromptType = 'characterFace' | 'chapterObject' | 'chapterClothing' | 'chapterProp' | 'characterFullBody'
export type ImagePromptStatus = 'empty' | 'draft' | 'dirty' | 'saving' | 'saved' | 'saveFailed' | 'generatingImage' | 'imageFailed' | 'imageSucceeded'
export type ImageViewDirection = 'front' | 'side' | 'back'
export type VisualCandidateKind = 'character' | 'bystander' | 'clothing' | 'prop'

export interface VisualCharacterCandidate {
  kind: 'character'
  characterId: string
  name: string
  matchedName: string
  evidence?: string
}

export interface VisualBystanderCandidate {
  kind: 'bystander'
  id: string
  name: string
  evidence?: string
}

export interface VisualSubjectCandidate {
  kind: 'clothing' | 'prop'
  id: string
  label: string
  description?: string
  characterId?: string
  characterCandidateId?: string
  characterName?: string
  evidence?: string
}

export interface VisualExtractedCharacter {
  name: string
  alias_in_text: string[]
  mapping_status: 'matched' | 'new_character'
  matched_character: string
  character_type: 'protagonist' | 'supporting' | 'unknown'
  context_summary: string
  first_mention: string
}

export interface ChapterVisualCandidateResult {
  extracted_characters: VisualExtractedCharacter[]
  characters: VisualCharacterCandidate[]
  bystanders: VisualBystanderCandidate[]
  clothing: VisualSubjectCandidate[]
  props: VisualSubjectCandidate[]
  unmappedCharacters: string[]
  mappingStatus?: 'ok' | 'partial' | 'failed'
  mappingError?: string
  error?: string
}

export interface VisualCandidateCacheEntry {
  chapterId: string
  chapterContentHash: string
  characterIndexHash: string
  extractionVersion: string
  result: ChapterVisualCandidateResult
  status: 'success' | 'error'
  error?: string
  updatedAt: number
}

export interface VisualPromptRecord {
  id: string
  type: ImagePromptType
  characterId?: string
  chapterId?: string
  visualSubjectId?: string
  subjectLabel?: string
  candidateKind?: VisualCandidateKind
  title: string
  prompt: string
  draftPrompt?: string
  status: ImagePromptStatus
  error?: string
  createdAt: number
  updatedAt: number
}

export interface ImageAssetRecord {
  id: string
  promptId: string
  promptSnapshot: string
  basePromptSnapshot?: string
  generationPromptSnapshot?: string
  viewDirection?: ImageViewDirection
  referenceImageIds?: string[]
  referenceImages?: ImagegenReferenceImageSummary[]
  provider: ImageProviderType
  modelId: string
  modelName: string
  mimeType: string
  width?: number
  height?: number
  storageMode: ImageStorageMode
  storageStatus: ImageStorageStatus
  assetUrl?: string
  localAssetId?: string
  immichAssetId?: string
  immichFilename?: string
  immichShare?: ImmichSharedLinkMetadata
  thumbnailUrl: string
  originalUrl: string
  createdAt: number
  status: ImageStorageStatus
  error?: string
}

export interface WorkVisualAssetsConfig {
  prompts: Record<string, VisualPromptRecord>
  images: Record<string, ImageAssetRecord>
  promptIdsByCharacter: Record<string, string[]>
  promptIdsByChapter: Record<string, string[]>
  candidateCache: Record<string, VisualCandidateCacheEntry>
  updatedAt: number
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
  visualAssets?: WorkVisualAssetsConfig
}

// --- AI 相关 ---

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'custom'
  apiKey: string
  baseUrl?: string
  model: string
  maxTokens?: number
}

/** 多模型配置项 */
export interface AIModelConfig {
  id: string
  name: string
  provider: 'openai' | 'anthropic' | 'custom'
  apiKey: string
  baseUrl?: string
  model: string
  maxTokens?: number
}

// --- 用户 ---

export type ThemePreference = 'system' | 'light' | 'dark'

export interface User {
  id: string
  username: string
  passwordHash?: string   // SHA-256 hex digest
  displayName: string
  role: 'owner' | 'admin' | 'user'
  createdAt: number
  deletedAt?: number | null
}

export interface AuthenticatedUser extends User {
  themePreference: ThemePreference
}

// --- 系统配置 ---

export interface SystemConfig {
  id: 'singleton'
  registrationEnabled: boolean
  aiConfig?: AIConfig
  aiConfigs?: AIModelConfig[]
  activeConfigId?: string
  voiceboxConfig?: VoiceboxConfig
  novelImportConfig?: NovelImportConfig
  imageGenerationConfig?: ImageGenerationConfig
}
