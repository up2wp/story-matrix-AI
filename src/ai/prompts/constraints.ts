// ============================================================
// 核心约束阶段 - 提示词模板
// ============================================================

export const CONSTRAINT_SYSTEM_PROMPT = `你是一位严谨的故事逻辑审核师。
你的任务是提炼故事必须满足的核心约束——结构性规则和逻辑边界，而非具体剧情。
要求：
- 约束聚焦于规则、红线、节奏、结构，不要涉及具体人物和事件（那些属于故事线）
- 约束要具体可验证，不能模糊
- 优先级要合理，不能所有约束都是"必须"
- 约束之间不能互相矛盾
- 考虑读者体验，约束要服务于好故事而非限制创作`

export function buildConstraintsPrompt(
  seed: string,
  worldSettings: string,
  characters: string,
): string {
  return `根据以下故事种子、世界观和角色信息，提炼核心约束。

故事种子：
${seed}

世界观：
${worldSettings}

主要人物：
${characters}

请严格输出 JSON 数组，生成 8-12 条核心约束，每条包含：
- type: 'rule'（逻辑红线）| 'rhythm'（节奏要求）| 'foreshadow'（伏笔结构）| 'structure'（叙事结构）
- title: 约束标题
- description: 具体描述（50-100字，要可验证、可执行）
- priority: 'required'（必须）| 'suggested'（建议）| 'optional'（可选）

核心约束聚焦于结构性规则和逻辑边界：
- 世界观硬规则、魔法/科技体系的逻辑限制
- 叙事节奏要求（如每卷高潮节点、伏笔回收时限）
- 不可违背的逻辑红线（如因果律、时间线一致性）
- 叙事结构约束（如视角切换规则、时空线安排）
不要包含具体人物命运或具体事件，那些属于故事线范畴。
优先级要合理，不能所有约束都是"必须"。
只输出 JSON，不要输出其他内容。`
}

export const CONSTRAINT_POLISH_SYSTEM_PROMPT = `你是一位严谨的故事逻辑审核师。
你的任务是润色单条核心约束，使其更具体、更可验证、表述更精准。
要求：
- 保持约束的原意和作用范围不变
- title 简洁有力，不超过 20 字
- description 具体可验证，50-100 字
- type 和 priority 可根据润色后的内容微调
- 不要改变约束的根本意图`

export function buildConstraintPolishPrompt(
  currentConstraint: string,
  allConstraints: string,
  seed: string,
  worldSettings: string,
  characters: string,
): string {
  return `请润色以下核心约束。

故事种子：
${seed}

世界观：
${worldSettings}

主要人物：
${characters}

当前所有约束：
${allConstraints}

待润色的约束：
${currentConstraint}

请严格输出 JSON 对象，包含：
- title: 润色后的标题
- description: 润色后的描述（50-100字，具体可验证）
- type: 'event' | 'fate' | 'foreshadow' | 'rule' | 'rhythm'
- priority: 'required' | 'suggested' | 'optional'

只输出 JSON，不要输出其他内容。`
}
