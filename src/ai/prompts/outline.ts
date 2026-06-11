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
  chaptersPerVolume?: number,
): string {
  const storylineSection = storylines && storylines.length > 0
    ? `\n\n故事线索（章节必须关联相关的故事线）：
${storylines.map((s) => `- ID: ${s.id}，名称: ${s.name}，描述: ${s.description}`).join('\n')}

重要：chapter 级别的节点必须包含 storylineIds 数组，填写上述 ID，不能为 null 或空数组。`
    : ''

  const volumeOnly = chaptersPerVolume === 0

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

${volumeOnly
  ? `请只生成卷级别的大纲，不要生成任何 chapter 节点。每卷的 summary 要概括本卷的核心走向（100-200字）。`
  : `请生成大纲结构，采用 卷 > 章 两级结构（每卷章数可为 0）。

章节的 summary 要具体到关键事件和人物行动，不要写成"主角经历了挑战"这种空话。卷的 summary 可以是对整卷的概括。`}

严格输出 JSON 数组，每个元素包含：
- title: 标题
- summary: 剧情简述（100-200字）
- level: 'volume'${volumeOnly ? '' : ` 或 'chapter'`}
- characters: 涉及的主要角色名称数组
${volumeOnly ? '' : `- emotion: 本章情绪走向（如"紧张→释放"）
- storylineIds: 关联的故事线索 ID 数组（仅 chapter 级别必填，volume 级别可省略）`}

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

export function buildMultiVolumeChaptersPrompt(
  volumes: { index: number; title: string; summary: string; existingChapters: { title: string; summary: string }[]; count: number; nextChapterNumber: number }[],
  allVolumes: { title: string; summary: string }[],
  worldSettings: string,
  characters: string,
  constraints: string,
  storylines?: { id: string; name: string; description: string }[],
  allowReshuffle?: boolean,
): string {
  const storylineSection = storylines && storylines.length > 0
    ? `\n\n故事线索（必须为每章关联 1-3 条）：
${storylines.map((s) => `- ID: ${s.id}，名称: ${s.name}，描述: ${s.description}`).join('\n')}

重要：storylineIds 数组中必须填写上述 ID（如 "${storylines[0]?.id}"），不要填写名称。`
    : ''

  const volumeDetails = volumes.map((v) => {
    const existing = v.existingChapters.length
      ? v.existingChapters.map((c, i) => `  ${i + 1}. ${c.title}：${c.summary}`).join('\n')
      : '  （暂无章节）'
    return `【第${v.index + 1}卷「${v.title}」】需要生成 ${v.count} 章，从 第${v.nextChapterNumber}章 开始
已有章节：
${existing}`
  }).join('\n\n')

  const reshuffleNote = allowReshuffle
    ? `\n\n你有权重新分配各卷的核心事件。当前各卷摘要是参考，你可以把某些事件从一卷移到另一卷，使整体节奏和因果链更合理。如果调整了卷摘要，请在输出末尾用单独的 JSON 对象标注。
如果需要调整摘要，输出格式为：
{ "chapters": [...], "updatedVolumes": [{ "index": 0, "newSummary": "..." }] }
如果不需要调整，只输出 chapters 数组即可。`
    : ''

  return `请为以下多卷一次性生成章节大纲。这几卷的剧情需要**相互交织、紧密衔接**，形成一个不可分割的整体。

【全书卷目结构】：
${allVolumes.map((v, i) => `第${i + 1}卷「${v.title}」：${v.summary || '（未设定）'}`).join('\n')}

【需要生成的卷】：
${volumeDetails}

新章节标题格式必须是"第X章 标题内容"，编号严格按指定的起始编号递增。

世界观：
${worldSettings}

主要人物：
${characters}

核心约束：
${constraints}
${storylineSection}

要求：
- 这几卷的剧情要紧密交织，事件跨卷关联、伏笔回收跨卷呼应
- 每卷结尾要为下一卷留下悬念或铺垫，但不能提前展开后续卷的内容
- 不要重复已有章节的内容
- 每章剧情简述要具体到关键事件和人物行动，100-200字
- 每章必须关联 1-3 条故事线索的 ID
- 覆盖相关核心约束
${reshuffleNote}

严格输出 JSON 数组，每个元素包含：
- volumeIndex: 所属卷的索引（从 0 开始）
- title: 章节标题
- summary: 剧情简述
- storylineIds: 关联的故事线索 ID 数组

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

export function buildOutlineCheckPrompt(
  seed: string,
  worldSettings: string,
  characters: string,
  constraints: string,
  outline: string,
  storylines: string,
): string {
  return `请检查以下小说大纲的逻辑完整性和一致性，找出所有问题。

故事种子：
${seed}

世界观：
${worldSettings}

主要人物：
${characters}

核心约束：
${constraints}

大纲结构（缩进表示层级，章属于其上方最近的卷）：
${outline}

故事线索：
${storylines}

请从以下维度检查：
1. **逻辑连贯性**：各卷/章之间的情节是否衔接自然，有无跳跃或矛盾
2. **约束覆盖**：核心约束（尤其是"必须"级别）是否在大纲中得到体现
3. **线索完整性**：每条故事线是否有清晰的起点→发展→终点，是否在章节中有对应节点
4. **角色发展**：主要人物的弧线是否贯穿，有无角色被遗忘
5. **节奏合理性**：高潮、转折、缓和的分布是否合理
6. **因果关系**：事件之间是否有合理的因果链，有无凭空出现的转折

对于每个发现的问题，请输出：
- 卷/章位置（指出具体哪卷哪章）
- 问题描述
- 修改建议

如果没有问题，说明大纲逻辑完整。

请用以下格式输出（Markdown）：

## 检查结果

### 问题 1
- **位置**：第X卷 / 第X章
- **问题**：...
- **建议**：...

### 问题 2
...

如果没有问题，输出：✅ 大纲逻辑完整，未发现明显问题。`
}
