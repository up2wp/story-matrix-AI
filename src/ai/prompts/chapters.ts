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
): string {
  const eventSection = eventLog ? `\n\n历史事件时间线（必须遵守，不能与历史事件矛盾）：\n${eventLog}` : ''

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

要求：
- 直接输出正文内容，不要输出标题、场景划分或元信息
- 2000-4000字
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
