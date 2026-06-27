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
  chapterCount?: number,
  prevTitles?: string[],
): string {
  const modeDesc = mode === 'newVolume'
    ? '新的一卷（全新的情节线、冲突和转折）'
    : '在当前卷中继续推进故事'

  const contextParts = [`故事种子：\n${seed}`]
  if (worldSettings && worldSettings !== '暂无') contextParts.push(`世界观：\n${worldSettings}`)
  if (characters && characters !== '暂无') contextParts.push(`主要人物：\n${characters}`)
  if (previousSummary) contextParts.push(`前文要点：\n${previousSummary}`)
  if (eventLog) contextParts.push(`已有事件：\n${eventLog}`)

  const nextNum = (chapterCount ?? 0) + 1
  const titleRef = prevTitles && prevTitles.length > 0
    ? `\n【前序章节标题（请参考其命名风格和编号格式）】\n${prevTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n下一章应编号为"第${nextNum}章"，标题风格需与前序保持一致。`
    : ''

  return `你是一位天马行空的小说策划师。请为一部网络小说的"第${nextNum}章"生成 5 个不同的创作灵感。

⚠️ 核心规则：5 个灵感的 title 必须都是"第${nextNum}章"开头，这是同一章的 5 种不同写法，绝对不能编成连续的 5 章！

当前需要生成的是：${modeDesc}
${titleRef}

${contextParts.join('\n\n')}

请生成 5 个完全不同的灵感方向，每个灵感需要：
- title：必须以"第${nextNum}章"开头，后接不同的情节标题（如"第${nextNum}章 暗流涌动"、"第${nextNum}章 风暴前夕"）
- summary：约300字的内容简介，描述这一章的主要情节、冲突、转折和结局

要求：
- 每个灵感方向要截然不同（不要同质化）
- 要有戏剧冲突、悬念和反转
- 要与已有世界观和角色兼容
- 要有网文的节奏感和爽感

输出示例：[{"title":"第${nextNum}章 暗流涌动","summary":"..."},{"title":"第${nextNum}章 风暴前夕","summary":"..."}]

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

// ============================================================
// ============================================================
// 全文逻辑检查 — 问题扫描
// ============================================================

export function buildIssueScanPrompt(
  chaptersText: string,
  prevVolumeText: string,
  earlierEvents: string,
  volumeName: string,
  focus?: string,
): string {
  const prevVolumeSection = prevVolumeText ? `\n上一卷正文（用于跨卷一致性检查）：\n${prevVolumeText}\n` : ''
  const earlierSection = earlierEvents ? `\n更早卷的事件时间线：\n${earlierEvents}\n` : ''
  const focusSection = focus?.trim() ? `\n用户重点关注：\n${focus.trim()}\n请优先检查以上关注项。\n` : ''

  return `你是一位专业的小说编辑。请仔细检查「${volumeName}」中以下章节的剧情逻辑，找出所有具体问题。

${prevVolumeSection}${earlierSection}${focusSection}
本卷各章节正文（按顺序）：
${chaptersText}

检查维度：
1. **前后矛盾**：人物行为、性格、能力是否前后一致
2. **时间线错误**：事件发生的先后顺序是否合理
3. **角色遗忘**：重要角色是否突然消失或未交代
4. **因果断裂**：重要转折是否有足够的铺垫和动机
5. **逻辑漏洞**：情节是否合理，有无硬伤
6. **跨卷一致性**：与前序卷的信息是否有冲突

对每个问题，找出原文中**具体的段落或句子**作为 findText（用于定位问题位置）。

严格输出 JSON，格式如下：
{
  "issues": [
    {
      "chapterTitle": "问题所在章节的标题",
      "issue": "问题描述（一句话）",
      "findText": "原文中需要修改的段落或句子（完整复制，用于定位）",
      "severity": "high 或 medium 或 low"
    }
  ]
}

findText 必须是原文中真实存在的连续文本（10-200字），用于精确定位问题位置。
issues 只包含确实有问题的条目。如果没有问题，issues 为空数组。
只输出 JSON，不要输出其他内容。`
}

// ============================================================
// 全文逻辑检查 — 按章节合并修复
// ============================================================

export function buildChapterFixPrompt(
  chapterTitle: string,
  chapterContent: string,
  issues: { issue: string; findText: string }[],
): string {
  const issueList = issues.map((item, i) => `${i + 1}. ${item.issue}\n   定位：「${item.findText.slice(0, 80)}」`).join('\n')

  return `你是一位专业的小说编辑。请修复以下章节中的所有问题，输出完整的修改后正文。

章节标题：${chapterTitle}

需要修复的问题：
${issueList}

章节正文：
${chapterContent}

要求：
1. 一次性修复所有问题，输出完整的修改后章节正文
2. 保持原文的风格、语气和叙事视角
3. 保持原文的篇幅和节奏，不要大幅删减或扩写
4. 修改处与上下文自然衔接
5. 不要输出任何分析、解释或元信息，只输出正文

严格输出 JSON，格式如下：
{
  "content": "修改后的完整章节正文",
  "changes": ["修改1的原因", "修改2的原因"]
}

只输出 JSON，不要输出其他内容。`
}

// ============================================================
// AI 微调
// ============================================================

export function buildRefinePrompt(
  chapterContent: string,
  instruction: string,
  prevChaptersText?: string,
): string {
  const prevSection = prevChaptersText ? `\n\n前文参考（当前卷之前的章节，仅供理解上下文，不要修改）：\n${prevChaptersText}\n` : ''
  return `你是一位专业的小说编辑。请根据用户的修改指令，对"原文"部分进行微调。

重要：你只能修改"原文"中的内容。"前文参考"仅供理解上下文，绝对不要输出前文参考中的任何内容，也不要基于前文写新章节。

用户指令：
${instruction}
${prevSection}
【需要修改的原文】：
${chapterContent}
【原文结束】

要求：
1. 严格按照用户指令修改，不要偏离指令做额外改动
2. 保持原文的风格、语气和叙事视角
3. 保持原文的篇幅，不要大幅删减或扩写
4. 修改处与上下文自然衔接
5. 参考前文保持人物性格、情节逻辑的一致性
6. 不要输出任何分析、解释或元信息，只输出修改后的完整正文

直接输出修改后的完整章节正文。`
}
