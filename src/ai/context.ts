import type { Work, Character, Constraint, OutlineNode, EventLogEntry } from '@/core/types'

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

/** 约束 → 文本摘要 */
export function constraintsContext(constraints: Constraint[]): string {
  if (!constraints.length) return '（暂无核心约束）'
  return constraints
    .map((c) => `[${c.priority}][${c.type}] ${c.title}\n${c.description}`)
    .join('\n\n')
}

/** 事件簿 → 时间线文本 */
export function eventLogContext(
  eventLog: EventLogEntry[],
  beforeChapterId?: string,
  maxEntries: number = 50,
): string {
  if (!eventLog.length) return '（暂无历史事件记录）'

  // 按时间排序（不复制整个数组）
  const sorted = eventLog
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.timestamp - b.e.timestamp)

  // 如果指定了章节，只返回该章节之前的事件
  let startIdx = 0
  let endIdx = sorted.length
  if (beforeChapterId) {
    const idx = sorted.findIndex(({ e }) => e.chapterId === beforeChapterId)
    if (idx > 0) endIdx = idx
  }

  // 限制条目数量
  if (endIdx - startIdx > maxEntries) {
    startIdx = endIdx - maxEntries
  }

  const parts: string[] = []
  for (let i = startIdx; i < endIdx; i++) {
    const e = sorted[i].e
    const chars = e.characters.length ? `(${e.characters.join('、')})` : ''
    parts.push(`【${e.chapterTitle}】${chars} ${e.description}`)
  }
  return parts.join('\n')
}
