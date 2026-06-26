import type { Character, Constraint, OutlineNode, Setting, Storyline, Work, StorySeed } from '@/core/types'
import { generateId } from '@/utils/id'
import type { BackfillCandidate } from './types'

export interface BackfillApplySummary {
  acceptedCount: number
  charactersAdded: number
  settingsAdded: number
  constraintsAdded: number
  storylinesAdded: number
  outlineSummariesUpdated: number
  seedFieldsFilled: number
  bodyChanges: 0
  replacementWarnings: string[]
}

export type BackfillWorkPatch = Partial<Omit<Work, 'chapters'>>

function nonEmptySeedField(seed: StorySeed, field: keyof StorySeed) {
  const value = seed[field]
  return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? '').trim())
}

function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function applySeedCandidate(seed: StorySeed, candidate: Extract<BackfillCandidate, { task: 'seed' }>, warnings: string[]) {
  if (nonEmptySeedField(seed, candidate.value.field)) {
    warnings.push(`故事萌芽「${candidate.value.field}」已有内容，未默认替换`)
    return seed
  }
  return { ...seed, [candidate.value.field]: candidate.value.value }
}

export function buildBackfillPatch(work: Work, candidates: BackfillCandidate[]) {
  const accepted = candidates.filter(candidate => candidate.reviewStatus === 'accepted')
  let seed = work.seed
  let outline = work.outline
  const characters: Character[] = [...work.characters]
  const settings: Setting[] = [...work.settings]
  const constraints: Constraint[] = [...work.constraints]
  const storylines: Storyline[] = [...work.storylines]
  const summary: BackfillApplySummary = {
    acceptedCount: accepted.length,
    charactersAdded: 0,
    settingsAdded: 0,
    constraintsAdded: 0,
    storylinesAdded: 0,
    outlineSummariesUpdated: 0,
    seedFieldsFilled: 0,
    bodyChanges: 0,
    replacementWarnings: [],
  }

  for (const candidate of accepted) {
    if (candidate.task === 'chapterSummary') {
      outline = outline.map((node): OutlineNode => {
        if (node.id !== candidate.value.outlineId) return node
        if (node.summary.trim()) {
          summary.replacementWarnings.push(`章节「${node.title}」已有摘要，未默认替换`)
          return node
        }
        summary.outlineSummariesUpdated += 1
        return { ...node, summary: candidate.value.summary }
      })
    } else if (candidate.task === 'characters') {
      const existing = characters.find(character => sameName(character.name, candidate.value.name))
      if (existing) continue
      characters.push({
        id: generateId(),
        name: candidate.value.name,
        role: candidate.value.role,
        bio: candidate.value.bio,
        personality: { traits: candidate.value.traits, habits: [], arc: [] },
        relations: [],
        tags: candidate.value.tags ?? [],
      })
      summary.charactersAdded += 1
    } else if (candidate.task === 'settings') {
      if (settings.some(setting => sameName(setting.title, candidate.value.title))) continue
      settings.push({
        id: generateId(),
        category: candidate.value.category,
        title: candidate.value.title,
        content: candidate.value.content,
        relatedSettingIds: [],
        relatedCharacterIds: [],
      })
      summary.settingsAdded += 1
    } else if (candidate.task === 'constraints') {
      if (constraints.some(constraint => sameName(constraint.title, candidate.value.title))) continue
      constraints.push({
        id: generateId(),
        type: candidate.value.type,
        title: candidate.value.title,
        description: candidate.value.description,
        priority: candidate.value.priority,
      })
      summary.constraintsAdded += 1
    } else if (candidate.task === 'storylines') {
      if (storylines.some(storyline => sameName(storyline.name, candidate.value.name))) continue
      storylines.push({
        id: generateId(),
        name: candidate.value.name,
        color: '#1677ff',
        description: candidate.value.description,
        chapterLinks: candidate.value.chapterLinks,
      })
      summary.storylinesAdded += 1
    } else if (candidate.task === 'seed') {
      const nextSeed = applySeedCandidate(seed, candidate, summary.replacementWarnings)
      if (nextSeed !== seed) summary.seedFieldsFilled += 1
      seed = nextSeed
    }
  }

  const patch: BackfillWorkPatch = {
    seed,
    characters,
    settings,
    constraints,
    storylines,
    outline,
    updatedAt: Date.now(),
  }

  return { patch, summary }
}

export function applyBackfillPatch(work: Work, candidates: BackfillCandidate[]) {
  const { patch, summary } = buildBackfillPatch(work, candidates)
  return { work: { ...work, ...patch, chapters: work.chapters }, patch, summary }
}

export function formatBackfillImpact(summary: BackfillApplySummary) {
  const parts = [
    summary.charactersAdded ? `新增 ${summary.charactersAdded} 个角色` : '',
    summary.settingsAdded ? `新增 ${summary.settingsAdded} 条设定` : '',
    summary.constraintsAdded ? `新增 ${summary.constraintsAdded} 条约束` : '',
    summary.storylinesAdded ? `新增 ${summary.storylinesAdded} 条故事线` : '',
    summary.outlineSummariesUpdated ? `更新 ${summary.outlineSummariesUpdated} 个章节摘要` : '',
    summary.seedFieldsFilled ? `补充 ${summary.seedFieldsFilled} 个故事萌芽字段` : '',
  ].filter(Boolean)
  return `${parts.length ? parts.join(' / ') : '暂无可写入阶段字段'}，正文 0 处修改`
}
