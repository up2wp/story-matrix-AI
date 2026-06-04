// ============================================================
// 故事萌芽阶段 - 提示词模板
// ============================================================

export const SEED_SYSTEM_PROMPT = `你是一位经验丰富的小说策划编辑，擅长帮助作者构建故事框架。
你的任务是根据用户选择的要素，生成或补全故事基础信息。
要求：
- 信息之间要有内在逻辑关联，不能随意拼凑
- 符合所选类型和基调的常见范式，但要有新意
- 核心概念要能用一句话引起读者兴趣
- 人物设定要有差异化，避免同质化`

export function buildSeedPrompt(partial: Record<string, unknown>): string {
  return `请根据以下已有信息，补全缺失的故事基础要素。

已有信息：
${JSON.stringify(partial, null, 2)}

请以 JSON 格式返回完整的故事基础信息，包含以下字段：
- timePeriod: 时间背景
- regions: 地域范围（数组）
- genre: 主类型
- subGenre: 子类型（可选）
- coreConcept: 核心概念（一句话）
- tone: 基调风格
- targetAudience: 目标读者
- suggestedCharacters: 候选主要人物数组，每人包含 name/role/coreTrait`
}

export function buildCharacterSuggestionPrompt(seed: Record<string, unknown>): string {
  return `基于以下故事设定，推荐 5-8 个有差异化的主要人物候选。

故事设定：
${JSON.stringify(seed, null, 2)}

每个人物包含：
- name: 姓名
- role: 在故事中的身份
- coreTrait: 核心性格特征（一句话）
- backgroundHint: 背景暗示（一句话，为后续深化留空间）

人物之间要有潜在的关系张力，避免全部是同类型角色。`
}

export const CHARACTER_SYSTEM_PROMPT = `你是一位资深的小说角色设计师，擅长创造有深度、有差异化的虚构人物。
你的任务是根据故事种子和已有角色信息，生成一个新的主要人物。
要求：
- 人物要有独特的性格和背景，不能与已有角色同质化
- 性格特质要具体而非泛泛，习惯要有画面感
- 性格弧线要有内在逻辑，从起点到归宿要有清晰的转变路径
- 人物要能推动故事发展，与已有角色形成关系张力`

export function buildCharacterPrompt(seed: string, existingCharacters: string): string {
  return `根据以下故事种子和已有角色，生成一个新的主要人物。

故事种子：
${seed}

已有角色：
${existingCharacters}

请严格输出 JSON，包含以下字段：
- name: 姓名
- bio: 经历背景（200-300字）
- personality.traits: 性格特质（3-5个）
- personality.habits: 行为习惯（2-3个）
- personality.arc: 性格弧线（3-4个阶段，每阶段含 stage/description/trigger）
- tags: 标签（3-5个）

新人物要与已有角色形成差异化和关系张力。`
}

export function buildCharacterPolishPrompt(
  character: Record<string, unknown>,
  worldSettings: string,
  existingCharacters: string,
): string {
  return `请根据以下已有的角色信息，进行润色和丰富。

当前角色信息：
${JSON.stringify(character, null, 2)}

世界观背景：
${worldSettings}

已有角色（避免重复）：
${existingCharacters}

要求：
- 保留已有的核心设定，在此基础上丰富细节
- 补充经历背景的细节和转折
- 丰富性格特质，使其更立体
- 如有性格弧线，深化每个阶段的描述
- 可以适当添加 1-2 个新的标签

请严格输出 JSON，包含以下字段：
- bio: 润色后的经历背景（300-400字）
- personality.traits: 丰富的性格特质（4-6个）
- personality.habits: 行为习惯（3-4个）
- personality.arc: 性格弧线（3-4个阶段，每阶段含 stage/description/trigger）
- tags: 标签（3-5个）

只输出 JSON，不要输出其他内容。`
}
