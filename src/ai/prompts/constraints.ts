// ============================================================
// 核心约束阶段 - 提示词模板
// ============================================================

export const CONSTRAINT_SYSTEM_PROMPT = `你是一位严谨的故事逻辑审核师。
你的任务是根据大纲和角色信息，提炼出故事必须满足的核心约束。
要求：
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
- type: 'event'（关键事件）| 'fate'（角色命运）| 'foreshadow'（伏笔回收）| 'rule'（逻辑红线）| 'rhythm'（节奏要求）
- title: 约束标题
- description: 具体描述（50-100字，要可验证、可执行）
- priority: 'required'（必须）| 'suggested'（建议）| 'optional'（可选）

约束要覆盖：关键转折点、角色成长节点、世界观硬规则、读者体验节奏。
优先级要合理，不能所有约束都是"必须"。
只输出 JSON，不要输出其他内容。`
}
