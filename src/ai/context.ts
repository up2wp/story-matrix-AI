import type { Work, Character, Constraint, OutlineNode } from '@/core/types'
import { getScope } from '@/utils/constraints'

// ============================================================
// AI 上下文组装
// 根据不同阶段，组装传递给 AI 的上下文信息
// ============================================================

/** 故事种子 → JSON 字符串 */
export function seedContext(work: Work): string {
  return JSON.stringify(work.seed, null, 2)
}

/** 世界观设定 → 文本摘要 */
export function worldContext(work: Work): string {
  if (!work.settings.length) return '（暂无世界观设定）'
  return work.settings
    .map((s) => `【${s.title}】(${s.category})\n${s.content}`)
    .join('\n\n')
}

/** 角色信息 → 文本摘要 */
export function charactersContext(characters: Character[], roleFilter?: Character['role']): string {
  const filtered = roleFilter
    ? characters.filter((c) => c.role === roleFilter)
    : characters
  if (!filtered.length) return '（暂无角色信息）'
  return filtered
    .map(
      (c) =>
        `${c.name} [${c.role}]\n背景：${c.bio}\n性格：${c.personality.traits.join('、')}\n标签：${c.tags.join('、')}`,
    )
    .join('\n\n')
}

/** 大纲 → 文本摘要 */
export function outlineContext(outline: OutlineNode[]): string {
  if (!outline.length) return '（暂无大纲）'
  const sorted = [...outline].sort((a, b) => a.order - b.order)
  return sorted
    .map((n) => {
      const indent = n.level === 'volume' ? '' : n.level === 'chapter' ? '  ' : '    '
      return `${indent}[${n.level}] ${n.title}\n${indent}摘要：${n.summary}`
    })
    .join('\n\n')
}

/** 约束 → 文本摘要（区分全局/局部） */
export function constraintsContext(constraints: Constraint[]): string {
  if (!constraints.length) return '（暂无核心约束）'
  const global = constraints.filter((c) => getScope(c) === 'global')
  const local = constraints.filter((c) => getScope(c) === 'local')
  const parts: string[] = []
  if (global.length) {
    parts.push('【全局约束 - 所有章节必须遵守】')
    parts.push(
      global
        .map((c) => `[${c.priority}][${c.type}] ${c.title}\n${c.description}`)
        .join('\n\n'),
    )
  }
  if (local.length) {
    parts.push('【局部约束 - 关联章节需覆盖】')
    parts.push(
      local
        .map((c) => `[${c.priority}][${c.type}] ${c.title}\n${c.description}`)
        .join('\n\n'),
    )
  }
  return parts.join('\n\n')
}
