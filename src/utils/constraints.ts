import type { ConstraintType } from '@/core/types'

// ============================================================
// 核心约束工具函数
// ============================================================

/** 约束类型中文名 */
export const CONSTRAINT_TYPE_LABELS: Record<ConstraintType, string> = {
  event: '关键事件',
  fate: '命运走向',
  foreshadow: '伏笔',
  rule: '逻辑红线',
  rhythm: '节奏要求',
  structure: '叙事结构',
}
