import type { Constraint, ConstraintType, ConstraintScope, OutlineNode } from '@/core/types'

// ============================================================
// 核心约束工具函数
// ============================================================

/** 全局约束类型（自动绑定所有章节） */
const GLOBAL_TYPES: ConstraintType[] = ['rule', 'rhythm']

/** 判断约束类型是否为全局类型 */
export function isGlobalType(type: ConstraintType): boolean {
  return GLOBAL_TYPES.includes(type)
}

/** 根据类型推导 scope */
export function deriveScope(type: ConstraintType): 'local' | 'global' {
  return isGlobalType(type) ? 'global' : 'local'
}

/** 获取约束的 scope（兼容旧数据：无 scope 字段时从 type 推导） */
export function getScope(c: Constraint): 'local' | 'global' {
  return c.scope ?? deriveScope(c.type)
}

/**
 * 将全局约束自动绑定到所有大纲节点
 * - 全局约束的 ID 会注入每个节点的 constraintIds
 * - 同步更新全局约束的 relatedOutlineIds
 * 返回更新后的大纲节点数组和约束数组
 */
export function autoBindGlobalConstraints(
  constraints: Constraint[],
  outline: OutlineNode[],
): { outline: OutlineNode[]; constraints: Constraint[] } {
  const globalIds = constraints.filter((c) => getScope(c) === 'global').map((c) => c.id)
  if (!globalIds.length) return { outline, constraints }

  const globalIdSet = new Set(globalIds)

  // 大纲节点：保留局部约束 ID，替换全局约束 ID
  const newOutline = outline.map((node) => {
    const localIds = node.constraintIds.filter((id) => !globalIdSet.has(id))
    return { ...node, constraintIds: [...globalIds, ...localIds] }
  })

  // 全局约束：relatedOutlineIds 更新为所有大纲节点 ID
  const allNodeIds = outline.map((n) => n.id)
  const newConstraints = constraints.map((c) =>
    getScope(c) === 'global' ? { ...c, relatedOutlineIds: allNodeIds } : c,
  )

  return { outline: newOutline, constraints: newConstraints }
}

/**
 * 新增大纲节点时，自动带入全局约束 ID
 */
export function injectGlobalConstraintsToNode(
  node: OutlineNode,
  constraints: Constraint[],
): OutlineNode {
  const globalIds = constraints.filter((c) => getScope(c) === 'global').map((c) => c.id)
  const localIds = node.constraintIds.filter((id) => !globalIds.includes(id))
  return { ...node, constraintIds: [...globalIds, ...localIds] }
}

/**
 * 获取某大纲节点关联的所有约束（局部绑定的 + 全局的）
 */
export function getNodeConstraints(
  node: OutlineNode,
  constraints: Constraint[],
): Constraint[] {
  const idSet = new Set(node.constraintIds)
  return constraints.filter((c) => idSet.has(c.id))
}

/**
 * 局部约束绑定到指定大纲节点
 * 同步更新 constraint.relatedOutlineIds 和 outlineNode.constraintIds
 */
export function bindConstraintToNodes(
  constraintId: string,
  nodeIds: string[],
  constraints: Constraint[],
  outline: OutlineNode[],
): { constraints: Constraint[]; outline: OutlineNode[] } {
  // 更新约束的 relatedOutlineIds
  const newConstraints = constraints.map((c) =>
    c.id === constraintId ? { ...c, relatedOutlineIds: nodeIds } : c,
  )

  // 更新大纲节点的 constraintIds
  const newOutline = outline.map((node) => {
    const hasConstraint = nodeIds.includes(node.id)
    const hasId = node.constraintIds.includes(constraintId)
    if (hasConstraint && !hasId) {
      return { ...node, constraintIds: [...node.constraintIds, constraintId] }
    }
    if (!hasConstraint && hasId) {
      return { ...node, constraintIds: node.constraintIds.filter((id) => id !== constraintId) }
    }
    return node
  })

  return { constraints: newConstraints, outline: newOutline }
}

/**
 * 自动匹配未绑定的局部约束到大纲节点
 * 基于约束标题/描述与大纲节点标题/摘要的关键词重叠
 * @param forceRematch - true 时清空所有局部约束的绑定，重新匹配全部
 */
export function autoMatchUnboundConstraints(
  constraints: Constraint[],
  outline: OutlineNode[],
  forceRematch = false,
): { constraints: Constraint[]; outline: OutlineNode[] } {
  const chapterNodes = outline.filter((n) => n.level === 'chapter')
  if (!chapterNodes.length) return { constraints, outline }

  // 分词：提取连续汉字（3字以上）和英文词（2字母以上）
  const tokenize = (text: string): string[] => {
    const cn = text.match(/[一-鿿]{3,}/g) || []
    const en = text.match(/[a-zA-Z]{2,}/g) || []
    return [...cn, ...en.map((w) => w.toLowerCase())]
  }

  // 计算两个文本的关键词重叠数（去重后）
  const overlap = (a: string, b: string): number => {
    const tokensA = new Set(tokenize(a))
    const tokensB = new Set(tokenize(b))
    let count = 0
    for (const w of tokensA) {
      if (tokensB.has(w)) count++
    }
    return count
  }

  let outlineChanged = false
  const newConstraints = constraints.map((c) => {
    // 只处理局部约束
    if (getScope(c) !== 'local') return c
    // forceRematch 时清空已有绑定，否则只处理未绑定的
    if (!forceRematch && c.relatedOutlineIds.length > 0) return c

    // 计算每个大纲节点的匹配分数
    const scores = chapterNodes.map((node) => {
      const tt = overlap(c.title, node.title)           // 标题↔标题
      const dt = overlap(c.description, node.title)     // 描述↔标题
      const ts = overlap(c.title, node.summary)         // 标题↔摘要
      const ds = overlap(c.description, node.summary)   // 描述↔摘要
      return { node, score: tt * 4 + dt * 2 + ts * 2 + ds }
    })

    // 阈值：至少 3 分才匹配
    const best = scores.filter((s) => s.score >= 3).sort((a, b) => b.score - a.score)
    if (best.length === 0) {
      outlineChanged = true
      return { ...c, relatedOutlineIds: [] }
    }

    const matchedIds = best.map((s) => s.node.id)
    outlineChanged = true
    return { ...c, relatedOutlineIds: matchedIds }
  })

  // 同步更新大纲节点的 constraintIds
  const newOutline = outlineChanged
    ? outline.map((node) => {
        // 保留全局约束 ID
        const globalIds = node.constraintIds.filter((id) => {
          const constraint = constraints.find((c) => c.id === id)
          return constraint && getScope(constraint) === 'global'
        })
        // 重新计算绑定到该节点的局部约束 ID
        const localIds = newConstraints
          .filter((c) => getScope(c) === 'local' && c.relatedOutlineIds.includes(node.id))
          .map((c) => c.id)
        const merged = [...new Set([...globalIds, ...localIds])]
        // 检查是否有变化
        if (
          merged.length === node.constraintIds.length &&
          merged.every((id) => node.constraintIds.includes(id))
        ) {
          return node
        }
        return { ...node, constraintIds: merged }
      })
    : outline

  return { constraints: newConstraints, outline: newOutline }
}
