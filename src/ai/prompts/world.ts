// ============================================================
// 世界构建阶段 - 提示词模板
// ============================================================

export const WORLD_SYSTEM_PROMPT = `你是一位资深的世界观架构师，擅长为小说构建自洽的虚构世界。
你的任务是根据故事种子信息，生成完整的世界观设定。
要求：
- 设定之间要有内在逻辑，互相支撑
- 符合所选类型的读者预期，但要有独特的记忆点
- 留出足够的故事发展空间，不要把世界观写死
- 每个设定都要有"为什么对故事重要"的潜在价值`

export function buildWorldviewPrompt(seed: string): string {
  return `根据以下故事种子，生成世界观设定卡片。

故事种子：
${seed}

请生成 5-8 张设定卡片，严格输出 JSON 数组，每个元素包含：
- category: 分类（world/geography/politics/magic/tech/culture/economy/history/species 选一）
- title: 标题
- content: 设定内容（200-400字）

设定之间如果有引用关系，在 content 中用【设定名称】标注。
只输出 JSON，不要输出其他内容。`
}

export function buildCharacterDeepPrompt(
  character: string,
  worldSettings: string,
): string {
  return `根据以下角色初步信息和世界观设定，深化角色档案。

角色信息：
${character}

世界观：
${worldSettings}

请丰富以下内容：
- bio: 详细的经历背景（300-500字）
- personality.traits: 5-8个性格特质
- personality.habits: 3-5个行为习惯
- personality.arc: 3-5个性格发展阶段，每阶段包含 stage/description/trigger
- relations: 与其他角色的关系（如果已知其他角色）
- tags: 3-5个角色标签`
}

export const SUPPORTING_SYSTEM_PROMPT = `你是一位资深的小说配角设计师，擅长创造丰富故事世界的非主要人物。
你的任务是根据主要人物和世界观，生成配角和路人。
要求：
- 人物要覆盖不同类型：盟友、对手、导师、信息源、普通民众、势力代表等
- 每个人物要有鲜明的辨识度，不能是工具人
- 要与主要人物形成互动关系，能推动或丰富故事
- 角色定位（supporting/minor）要合理`

export function buildSupportingCharsPrompt(
  majorCharacters: string,
  worldSettings: string,
): string {
  return `根据以下主要人物和世界观，生成 3 个非主要人物（配角、路人、势力代表等）。

主要人物：
${majorCharacters}

世界观：
${worldSettings}

请严格输出 JSON 数组，每个元素包含：
- name: 姓名
- role: 'supporting' 或 'minor'
- bio: 简要背景（50-100字）
- personality.traits: 2-3个性格特质
- personality.habits: 1-2个行为习惯
- tags: 2-3个标签

人物要覆盖不同类型，彼此之间要有差异化。只输出 JSON，不要输出其他内容。`
}
