import type { BackfillCandidate } from './types'
import { refreshCandidateEvidence } from './confidence'

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s·・,，。.!！?？:：;；「」『』“”"'()（）\[\]【】]/g, '')
}

function keyFor(candidate: BackfillCandidate) {
  if (candidate.task === 'chapterSummary') return `${candidate.task}:${candidate.value.outlineId}`
  if (candidate.task === 'characters') return `${candidate.task}:${normalizeKey(candidate.value.name)}`
  if (candidate.task === 'settings') return `${candidate.task}:${normalizeKey(candidate.value.category)}:${normalizeKey(candidate.value.title)}`
  if (candidate.task === 'constraints') return `${candidate.task}:${normalizeKey(candidate.value.title)}`
  if (candidate.task === 'storylines') return `${candidate.task}:${normalizeKey(candidate.value.name)}`
  return `${candidate.task}:${candidate.value.field}`
}

function mergeCandidate(existing: BackfillCandidate, incoming: BackfillCandidate): BackfillCandidate {
  const stronger = incoming.confidence > existing.confidence ? incoming : existing
  const weaker = stronger === incoming ? existing : incoming
  let merged = {
    ...stronger,
    sources: [...stronger.sources, ...weaker.sources],
    confidence: Math.max(stronger.confidence, weaker.confidence),
  } as BackfillCandidate

  if (existing.title !== incoming.title && existing.task !== 'characters') {
    merged.conflictReason = `发现多个不同说法：${existing.title} / ${incoming.title}`
  }
  if (existing.task === 'characters' && incoming.task === 'characters' && merged.task === 'characters') {
    const strongerCharacter = stronger.task === 'characters' ? stronger : existing
    const weakerCharacter = weaker.task === 'characters' ? weaker : incoming
    merged = {
      ...merged,
      value: {
        ...merged.value,
        aliases: Array.from(new Set([...(existing.value.aliases ?? []), ...(incoming.value.aliases ?? []), existing.value.name, incoming.value.name])).filter(alias => alias !== strongerCharacter.value.name),
        traits: Array.from(new Set([...existing.value.traits, ...incoming.value.traits])),
        bio: strongerCharacter.value.bio || weakerCharacter.value.bio,
      },
    }
  }

  return refreshCandidateEvidence(merged, Boolean(merged.conflictReason))
}

export function reconcileBackfillCandidates(candidates: BackfillCandidate[]) {
  const byKey = new Map<string, BackfillCandidate>()
  for (const candidate of candidates) {
    const key = keyFor(candidate)
    const existing = byKey.get(key)
    byKey.set(key, existing ? mergeCandidate(existing, candidate) : refreshCandidateEvidence(candidate))
  }
  return Array.from(byKey.values())
}
