// ============================================================
// 主线大纲阶段 - 提示词模板
// ============================================================

export const OUTLINE_SYSTEM_PROMPT = `你是一位结构感极强的小说大纲策划师。
你的任务是根据世界观和角色信息，生成起承转合的章节骨架。
要求：
- 节奏要有起伏，不能平铺直叙
- 每个章节都要推进故事或揭示角色
- 伏笔和回收要自然，不能刻意
- 考虑读者的阅读节奏，适当设置悬念和爽点`

export function buildOutlinePrompt(
  seed: string,
  worldSettings: string,
  characters: string,
  constraints: string,
  storylines?: { id: string; name: string; description: string }[],
): string {
  const storylineSection = storylines && storylines.length > 0
    ? `\n\n故事线索（章节必须关联相关的故事线）：
${storylines.map((s) => `- ID: ${s.id}，名称: ${s.name}，描述: ${s.description}`).join('\n')}

重要：chapter 级别的节点必须包含 storylineIds 数组，填写上述 ID，不能为 null 或空数组。`
    : ''

  return `根据以下信息，生成小说的主线大纲。

故事种子：
${seed}

世界观：
${worldSettings}

主要人物：
${characters}

核心约束：
${constraints}
${storylineSection}

请生成大纲结构，采用 卷 > 章 两级结构（每卷 3-5 章，总计 3 卷）。

严格输出 JSON 数组，每个元素包含：
- title: 标题
- summary: 剧情简述（100-200字，描述本章/卷的核心事件、冲突和转折，而非泛泛的概括）
- level: 'volume' 或 'chapter'
- characters: 涉及的主要角色名称数组
- emotion: 本章情绪走向（如"紧张→释放"）
- storylineIds: 关联的故事线索 ID 数组（仅 chapter 级别必填，volume 级别可省略）

章节的 summary 要具体到关键事件和人物行动，不要写成"主角经历了挑战"这种空话。卷的 summary 可以是对整卷的概括。

大纲要体现完整的起承转合，在适当位置设置转折和高潮。
大纲必须覆盖所有核心约束，尤其是"必须"级别的约束要在对应章节中体现。
只输出 JSON，不要输出其他内容。`
}

export function buildOutlineNodePolishPrompt(
  node: { title: string; summary: string; level: string },
  parentContext: string,
  siblingContext: string,
  worldSettings: string,
  characters: string,
): string {
  return `请润色以下${node.level === 'volume' ? '卷' : '章节'}的标题和剧情简述。

当前内容：
- 标题：${node.title}
- 剧情简述：${node.summary}

所属卷上下文：
${parentContext}

同级章节：
${siblingContext}

世界观：
${worldSettings}

主要人物：
${characters}

要求：
- 保留原标题格式（如"第X章"前缀），只润色措辞，不要改变标题结构
- 剧情简述在原有框架上补充细节和画面感，不要凭空添加新情节或改变核心走向
- 与上下文逻辑衔接，推进故事发展
- 改动幅度控制在 30% 以内，保留原有信息量

严格输出 JSON，包含：
- title: 润色后的标题
- summary: 润色后的剧情简述

只输出 JSON，不要输出其他内容。`
}

export function buildAddChaptersPrompt(
  volume: { title: string; summary: string; index: number },
  allVolumes: { title: string; summary: string }[],
  existingChapters: { title: string; summary: string }[],
  count: number,
  nextChapterNumber: number,
  worldSettings: string,
  characters: string,
  constraints: string,
  storylines?: { id: string; name: string; description: string }[],
): string {
  const volumeNumber = volume.index + 1

  const storylineSection = storylines && storylines.length > 0
    ? `\n\n故事线索（必须为每章关联 1-3 条）：
${storylines.map((s) => `- ID: ${s.id}，名称: ${s.name}，描述: ${s.description}`).join('\n')}

重要：storylineIds 数组中必须填写上述 ID（如 "${storylines[0]?.id}"），不要填写名称。`
    : ''

  return `请为第 ${volumeNumber} 卷「${volume.title}」生成 ${count} 个新章节的大纲。

【全书卷目结构】（你需要严格遵守，不要提前写后续卷的内容）：
${allVolumes.map((v, i) => {
  const marker = i === volume.index ? ' ◀ 当前正在生成' : ''
  return `第${i + 1}卷「${v.title}」：${v.summary || '（未设定）'}${marker}`
}).join('\n')}

当前卷已有章节（不要重复，保持衔接）：
${existingChapters.length ? existingChapters.map((c, i) => `${i + 1}. ${c.title}：${c.summary}`).join('\n') : '（暂无章节）'}

新章节编号从 第${nextChapterNumber}章 开始，依次递增。标题格式必须是"第X章 标题内容"。

世界观：
${worldSettings}

主要人物：
${characters}

核心约束：
${constraints}
${storylineSection}

要求：
- 只写第 ${volumeNumber} 卷「${volume.title}」范围内的剧情，绝对不要提前涉及后续卷的内容
- 新章节要承接本卷已有章节的情节走向，不能重复已有内容
- 每章标题精炼有画面感，保留"第X章"前缀格式（续接已有编号）
- 每章剧情简述要具体到关键事件和人物行动，100-200字
- 本卷结尾要留悬念或转折，为下一卷「${allVolumes[volume.index + 1]?.title || '后续'}」做铺垫，但不要展开后续卷的剧情
- 覆盖所有核心约束中与本卷相关的内容
- 每章必须关联 1-3 条故事线索的 ID

严格输出 JSON 数组，每个元素包含：
- title: 章节标题
- summary: 剧情简述
- storylineIds: 关联的故事线索 ID 数组（必填，不能为 null 或空数组）

只输出 JSON，不要输出其他内容。`
}

export function buildStorylineRecommendPrompt(
  seed: string,
  characters: string,
  outline: string,
  existingStorylines: string,
): string {
  return `根据以下故事信息，推荐 3 条故事线索。严格只输出 3 条，不多不少。

故事种子：
${seed}

主要人物：
${characters}

当前大纲：
${outline}

${existingStorylines ? `已有线索（不要重复）：\n${existingStorylines}` : ''}

故事线索是贯穿全书的暗线，例如：
- 角色的情感发展线（如：林婉儿从抗拒到接受的感情变化）
- 势力的博弈线（如：朝廷与江湖的暗中较量）
- 秘密的揭露线（如：主角身世之谜逐步揭开）
- 理念的碰撞线（如：正义与生存的两难抉择）

要求：
- 严格只输出 3 条线索，这是最重要的要求
- 每条线索要有清晰的起点和终点
- 线索之间要有交织和呼应
- 与已有大纲节点自然关联

严格输出 JSON 数组（长度必须为 3），每个元素包含：
- name: 线索名称（简短有力，4-8字）
- description: 线索描述（100-200字，说明起点、发展、终点）
- color: 颜色名称（只能选以下之一：red, orange, gold, green, cyan, blue, purple, magenta）
- keyNodes: 关键节点数组，每个包含 { chapterTitle: string, event: string }

只输出 JSON，不要输出其他内容。`
}

export function buildStorylinePolishPrompt(
  storyline: { name: string; description: string },
  seed: string,
  characters: string,
  outline: string,
): string {
  return `请润色以下故事线索的描述。

当前线索：
- 名称：${storyline.name}
- 描述：${storyline.description}

故事种子：
${seed}

主要人物：
${characters}

当前大纲：
${outline}

要求：
- 保留线索名称不变
- 描述要更有画面感和张力
- 明确起点、发展过程、终点
- 与大纲中的具体章节关联
- 改动幅度控制在 50% 以内

严格输出 JSON，包含：
- description: 润色后的描述

只输出 JSON，不要输出其他内容。`
}

export function buildFixStorylineBindingPrompt(
  chapters: { id: string; title: string; summary: string }[],
  storylines: { id: string; name: string; description: string }[],
): string {
  return `根据以下章节大纲摘要，判断每个章节应该关联哪些故事线索。

故事线索：
${storylines.map((s) => `- ID: ${s.id}，名称: ${s.name}，描述: ${s.description}`).join('\n')}

章节列表：
${chapters.map((c) => `- [${c.id}] ${c.title}：${c.summary}`).join('\n')}

判断规则：
- 如果章节内容明显涉及某条故事线的起点、发展或终点，就应该关联
- 每章至少关联 1 条故事线，最多 3 条
- 根据章节摘要中的关键词和情节走向判断，不要猜测

严格输出 JSON 数组，每个元素包含：
- id: 章节 ID（原样返回）
- storylineIds: 应关联的故事线索 ID 数组

只输出 JSON，不要输出其他内容。`
}
