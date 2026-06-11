// ============================================================
// 章节丰盈阶段 - 提示词模板
// ============================================================

export const CHAPTER_SYSTEM_PROMPT = `你是一位文笔细腻的小说写手。
你的任务是根据大纲摘要和约束信息，为章节撰写完整正文。
要求：
- 正文风格要符合故事基调
- 对话要体现角色性格差异
- 遵守核心约束，不违背已设定的逻辑红线
- 每章结尾要有适当的悬念或情绪钩子
- 段落之间要有自然过渡，节奏有起伏
- 适当运用环境描写、心理描写、动作描写
- 严格遵守故事种子中指定的叙述视角（pov），这是最重要的约束之一`

export function buildChapterPrompt(
  seed: string,
  worldSettings: string,
  characters: string,
  constraints: string,
  chapterTitle: string,
  chapterSummary: string,
  previousContent: string,
  eventLog?: string,
  userDirection?: string,
): string {
  const eventSection = eventLog ? `\n\n历史事件时间线（必须遵守，不能与历史事件矛盾）：\n${eventLog}` : ''
  const directionSection = userDirection?.trim()
    ? `\n\n用户创作方向（必须严格遵循，不得偏离）：\n${userDirection.trim()}`
    : ''

  return `根据以下信息，为「${chapterTitle}」撰写完整正文。

故事种子：
${seed}

世界观：
${worldSettings}

主要人物：
${characters}

核心约束：
${constraints}

本章大纲摘要：
${chapterSummary}

${previousContent ? `前文末尾（用于衔接）：\n${previousContent}` : '这是全书第一章。'}
${eventSection}
${directionSection}

要求：
- 直接输出正文内容，不要输出标题、场景划分或元信息
- 充分展开每一个情节点，不少于3000字，内容充实饱满
- 风格符合故事基调
- 对话体现角色性格
- 结尾留悬念或情绪钩子，自然过渡到下一章
- 严格遵守叙述视角（pov）：如果 pov 是"第一人称"，全文用"我"叙述主角的所见所感，其他角色用名字；如果是"第三人称限制视角"，紧跟主角但用"他/她"；如果是"第三人称全知视角"，可自由切换视角
- 不能与历史事件时间线中的记录矛盾`
}

export const DEFAULT_EVENT_EXTRACT_PROMPT = `从本章内容中提取会影响后续剧情的关键事件。

重点关注：
- 人物关系变化（结仇、结盟、感情转变等）
- 重要冲突和战斗
- 秘密揭露、伏笔埋设
- 角色死亡或重伤
- 重要物品获取或失去
- 其他会影响后续剧情走向的事件

忽略日常细节，只记录对故事有实际影响的节点。
如果没有值得记录的事件，返回空数组。`

export function buildExtractEventsPrompt(
  chapterTitle: string,
  chapterContent: string,
  characters: string,
  customPrompt: string,
): string {
  return `从以下章节内容中提取关键事件。

章节标题：${chapterTitle}

章节正文：
${chapterContent}

主要人物：
${characters}

${customPrompt}

严格输出 JSON 数组，每个元素包含：
- type: 事件类型（简短分类，如"战斗"、"关系变化"、"剧情进度"等）
- characters: 涉及的角色名称数组
- description: 事件描述（30-50字）

只输出 JSON，不要输出其他内容。`
}

// ============================================================
// 快速续写 - 灵感生成 & 章节写作
// ============================================================

export function buildInspirationPrompt(
  mode: 'newVolume' | 'continue',
  seed: string,
  worldSettings: string,
  characters: string,
  previousSummary: string,
  eventLog?: string,
): string {
  const modeDesc = mode === 'newVolume'
    ? '新的一卷（全新的情节线、冲突和转折）'
    : '在当前卷中继续推进故事'

  const contextParts = [`故事种子：\n${seed}`]
  if (worldSettings && worldSettings !== '暂无') contextParts.push(`世界观：\n${worldSettings}`)
  if (characters && characters !== '暂无') contextParts.push(`主要人物：\n${characters}`)
  if (previousSummary) contextParts.push(`前文要点：\n${previousSummary}`)
  if (eventLog) contextParts.push(`已有事件：\n${eventLog}`)

  return `你是一位天马行空的小说策划师。请为一部网络小说生成 5 个随机创作灵感。

当前需要生成的是：${modeDesc}

${contextParts.join('\n\n')}

请生成 5 个完全不同的灵感方向，每个灵感需要：
- title：一个抓人眼球的章节标题（中文，4-10字）
- summary：约300字的内容简介，描述这一章的主要情节、冲突、转折和结局

要求：
- 每个灵感方向要截然不同（不要同质化）
- 要有戏剧冲突、悬念和反转
- 要与已有世界观和角色兼容
- 要有网文的节奏感和爽感

严格输出 JSON 数组，每个元素包含 title 和 summary 字段。
只输出 JSON，不要输出其他内容。`
}

export function buildInspirationChapterPrompt(
  seed: string,
  worldSettings: string,
  characters: string,
  constraints: string,
  chapterTitle: string,
  chapterSummary: string,
  previousContent: string,
  eventLog?: string,
): string {
  const eventSection = eventLog ? `\n\n历史事件时间线（必须遵守，不能与历史事件矛盾）：\n${eventLog}` : ''

  return `根据以下信息，为「${chapterTitle}」撰写完整正文。

${`故事种子：
${seed}`}

${`世界观：
${worldSettings}`}

${`主要人物：
${characters}`}

${`核心约束：
${constraints}`}

本章大纲摘要：
${chapterSummary}

${previousContent ? `前文末尾（用于衔接）：\n${previousContent}` : '这是全书第一章。'}
${eventSection}

要求：
- 直接输出正文内容，不要输出标题、场景划分或元信息
- 充分展开每一个情节点，不少于3000字，内容充实饱满
- 风格符合故事基调，对话体现角色性格
- 结尾留悬念或情绪钩子
- 严格遵守叙述视角（pov）
- 不能与历史事件时间线中的记录矛盾`
}
