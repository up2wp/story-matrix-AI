import type { BackfillCandidate, BackfillEvidenceLabel, BackfillReviewStatus, BackfillSourceEvidence } from './types'

export function evidenceLabelFor(confidence: number, sources: BackfillSourceEvidence[], hasConflict = false): BackfillEvidenceLabel {
  if (hasConflict) return '存在冲突'
  const hasExcerpt = sources.some((source) => source.excerpt.trim().length > 0)
  if (!hasExcerpt) return '需要核对'
  return confidence >= 0.78 ? '证据充分' : '需要核对'
}

export function reviewStatusFor(label: BackfillEvidenceLabel): BackfillReviewStatus {
  if (label === '存在冲突') return 'conflict'
  if (label === '需要核对') return 'needsReview'
  return 'suggested'
}

export function refreshCandidateEvidence<T extends BackfillCandidate>(candidate: T, hasConflict = Boolean(candidate.conflictReason)): T {
  const evidenceLabel = evidenceLabelFor(candidate.confidence, candidate.sources, hasConflict)
  return {
    ...candidate,
    evidenceLabel,
    reviewStatus: candidate.reviewStatus === 'accepted' || candidate.reviewStatus === 'ignored'
      ? candidate.reviewStatus
      : reviewStatusFor(evidenceLabel),
  }
}
