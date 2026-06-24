import type { CharacterRole, ConstraintPriority, ConstraintType, StorySeed } from '@/core/types'

export type BackfillTask = 'chapterSummary' | 'characters' | 'settings' | 'constraints' | 'storylines' | 'seed'

export type BackfillEvidenceLabel = '证据充分' | '需要核对' | '存在冲突'
export type BackfillReviewStatus = 'suggested' | 'accepted' | 'ignored' | 'needsReview' | 'conflict'

export interface BackfillSourceEvidence {
  chapterId: string
  chapterTitle: string
  outlineId?: string
  excerpt: string
  windowIndex?: number
  startOffset?: number
  endOffset?: number
}

export interface BackfillCandidateBase<TTask extends BackfillTask, TValue> {
  id: string
  task: TTask
  title: string
  value: TValue
  sources: BackfillSourceEvidence[]
  confidence: number
  evidenceLabel: BackfillEvidenceLabel
  reviewStatus: BackfillReviewStatus
  conflictReason?: string
  replacementWarning?: string
}

export interface ChapterSummaryValue {
  outlineId: string
  summary: string
}

export interface CharacterCandidateValue {
  name: string
  role: CharacterRole
  bio: string
  traits: string[]
  aliases?: string[]
  tags?: string[]
}

export interface SettingCandidateValue {
  category: string
  title: string
  content: string
}

export interface ConstraintCandidateValue {
  type: ConstraintType
  title: string
  description: string
  priority: ConstraintPriority
}

export interface StorylineCandidateValue {
  name: string
  description: string
  chapterLinks: { chapterId: string; description: string }[]
}

export interface SeedCandidateValue {
  field: keyof StorySeed
  value: string | string[]
}

export type ChapterSummaryCandidate = BackfillCandidateBase<'chapterSummary', ChapterSummaryValue>
export type CharacterBackfillCandidate = BackfillCandidateBase<'characters', CharacterCandidateValue>
export type SettingBackfillCandidate = BackfillCandidateBase<'settings', SettingCandidateValue>
export type ConstraintBackfillCandidate = BackfillCandidateBase<'constraints', ConstraintCandidateValue>
export type StorylineBackfillCandidate = BackfillCandidateBase<'storylines', StorylineCandidateValue>
export type SeedBackfillCandidate = BackfillCandidateBase<'seed', SeedCandidateValue>

export type BackfillCandidate =
  | ChapterSummaryCandidate
  | CharacterBackfillCandidate
  | SettingBackfillCandidate
  | ConstraintBackfillCandidate
  | StorylineBackfillCandidate
  | SeedBackfillCandidate

export interface BackfillWindow {
  id: string
  chapterId: string
  chapterTitle: string
  outlineId?: string
  windowIndex: number
  text: string
  startOffset: number
  endOffset: number
  previousHint?: string
  nextHint?: string
}

export interface BackfillSkippedChapter {
  chapterId: string
  chapterTitle: string
  reason: string
}

export interface BackfillWindowResult {
  windows: BackfillWindow[]
  skipped: BackfillSkippedChapter[]
}
