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
- 性格特质要具体而非泛泛，习惯要有画面感，每条习惯必须是完整的一句话（不要换行拆句）
- 性格弧线要有内在逻辑，从起点到归宿要有清晰的转变路径
- 人物要能推动故事发展，与已有角色形成关系张力
- 如故事种子的 pov 为"第一人称"，主角的背景描述中注意：主角的名字是别人对他的称呼，叙述时用"我"`

export function buildCharacterPrompt(seed: string, existingCharacters: string, worldSettings?: string): string {
  return `根据以下故事种子和已有角色${worldSettings ? '以及世界观设定' : ''}，生成一个新的主要人物。

故事种子：
${seed}

已有角色：
${existingCharacters}
${worldSettings ? `\n世界观设定：\n${worldSettings}\n` : ''}
请严格输出 JSON，包含以下字段：
- name: 姓名
- bio: 经历背景（100-200字）
- personality.traits: 性格特质（2-3个字符串数组）
- personality.habits: 行为习惯（1-2个字符串数组，每条必须是完整的一句话，不要换行拆句）
- personality.arc: 性格弧线（2-3个阶段数组，每阶段含 stage/description/trigger 字段）
- relations: 与已有角色的关系数组（每项含 targetId/description，targetId 填已有角色的 name）
- tags: 标签（2-3个字符串数组）

新人物要与已有角色形成差异化和关系张力。
${worldSettings ? '人物的背景和能力要与世界观设定相契合。' : ''}
只输出 JSON，不要输出其他内容。`
}

// --- 核心概念润色/生成 ---

export const CORE_CONCEPT_SYSTEM_PROMPT = `你是一位创意策划师，擅长提炼小说的核心卖点。
你的任务是生成或润色一句话核心概念，让读者看到就想继续读下去。
要求：
- 一句话，20-50 字，简洁有力
- 要有"反差感"或"好奇心钩子"，让人想知道接下来会发生什么
- 不能是泛泛的类型描述，必须有独特的创意角度
- 语言要口语化、有画面感`

export function buildCoreConceptPolishPrompt(currentConcept: string, seed: Record<string, unknown>): string {
  return `当前核心概念：
${currentConcept}

故事基础信息：
${JSON.stringify(seed, null, 2)}

请润色这个核心概念，让它更有吸引力。
保留原始创意方向，但让表达更精炼、更有钩子。

只输出润色后的一句话，不要输出其他内容。`
}

export function buildCoreConceptGeneratePrompt(seed: Record<string, unknown>): string {
  return `故事基础信息：
${JSON.stringify(seed, null, 2)}

根据以上信息，生成一个让人眼前一亮的核心概念（一句话概括故事核心卖点）。
要求：
- 20-50 字
- 要有"反差感"或"好奇心钩子"
- 结合时间背景、地域、类型、基调，找到独特的创意角度

只输出一句话，不要输出其他内容。`
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
- bio: 润色后的经历背景（150-250字）
- personality.traits: 性格特质（3-4个）
- personality.habits: 行为习惯（2-3个，每条必须是完整的一句话，不要换行拆句）
- personality.arc: 性格弧线（2-3个阶段，每阶段含 stage/description/trigger）
- tags: 标签（2-4个）

只输出 JSON，不要输出其他内容。`
}
