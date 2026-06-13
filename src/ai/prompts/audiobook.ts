import type { AudiobookSegment, Chapter, Work } from '@/core/types'
import { charactersContext, outlineContext, seedContext, worldContext } from '@/ai/context'

export const AUDIOBOOK_SEGMENT_SYSTEM_PROMPT = `你是小说有声读物分镜导演。
你的任务是把已完成章节拆成适合 TTS 生成的旁白/角色语音片段。

严格要求：
- 只输出 JSON 数组，不要 Markdown，不要解释
- speakerKind 只能是 "narrator" 或 "character"
- characterId 必须来自给定角色列表；无法判断时使用 narrator
- 不要引用 Voicebox personality，不要要求 Voicebox 自己理解角色设定
- 保持原文顺序，不要改写正文内容`

export const AUDIOBOOK_TEMPLATE_SYSTEM_PROMPT = `你是 QwenTTS 有声读物提示词设计师。
只输出 100-200 字中文朗读指导，不要 Markdown，不要解释。
指导必须包含占位符【上下文】，只能描述角色音色、语气、节奏、情绪控制和朗读规则。
不要包含待合成正文，不要包含【文本】占位符；正文会通过 Voicebox text 参数单独传入。`

export const AUDIOBOOK_ATTRIBUTION_SYSTEM_PROMPT = `你是中文小说有声读物说话人归因助手。
只输出 JSON 数组，不要 Markdown，不要解释。
你只能从候选 speaker 中选择 speakerId；无法判断时选择 narrator 并标记 needsReview=true。
不要改写 text，不要新增角色，不要输出候选列表之外的 characterId。`

export const AUDIOBOOK_TONE_SYSTEM_PROMPT = `你是 QwenTTS 有声读物语气编辑。
只输出 JSON 数组，不要 Markdown，不要解释。
每条 tone 控制在 50 字左右，描述当前分段的声音状态、情绪、节奏和重音倾向。
不要复述待朗读正文，不要输出角色设定全文。`

export function buildVoicePrompt(work: Work, characterId?: string, mood?: string) {
  if (!characterId) {
    return `${work.seed.tone || '自然'}、清晰、克制，适合长篇小说旁白${mood ? `，当前情绪：${mood}` : ''}`.slice(0, 180)
  }
  const character = work.characters.find((c) => c.id === characterId)
  if (!character) return `自然清晰，贴合当前情绪${mood ? `：${mood}` : ''}`
  const traits = character.personality.traits.slice(0, 4).join('、') || '自然'
  return `${character.name}：${traits}；背景气质：${character.bio.slice(0, 80)}${mood ? `；当前情绪：${mood}` : ''}`.slice(0, 180)
}

export function buildAudiobookSegmentationPrompt(work: Work, chapter: Chapter) {
  const outlineNode = work.outline.find((node) => node.id === chapter.outlineId)
  const characterList = work.characters.map((character) => ({ id: character.id, name: character.name, role: character.role }))

  return `请把以下章节拆成有声读物 TTS 片段。

故事种子：
${seedContext(work)}

世界观摘要：
${worldContext(work)}

角色资料：
${charactersContext(work.characters)}

大纲：
${outlineContext(work.outline)}

可用角色 ID：
${JSON.stringify(characterList, null, 2)}

章节标题：${chapter.title}
章节大纲：${outlineNode?.summary || '（无）'}

章节正文：
${chapter.content}

输出 JSON 数组，每个对象必须包含：
- speakerKind: "narrator" | "character"
- characterId: string | null
- speakerName: string
- text: string
- mood: string`
}

export function buildAudiobookAttributionPrompt(work: Work, chapter: Chapter, segments: AudiobookSegment[], contextSegments: AudiobookSegment[] = []) {
  const outlineNode = work.outline.find((node) => node.id === chapter.outlineId)
  const mentioned = new Set<string>()
  const sourceText = [...segments, ...contextSegments].map((segment) => segment.text).join('\n')
  for (const character of work.characters) {
    if (sourceText.includes(character.name)) mentioned.add(character.id)
  }
  for (const segment of [...segments, ...contextSegments]) {
    if (segment.characterId) mentioned.add(segment.characterId)
  }
  const candidates = [
    { speakerId: 'narrator', speakerKind: 'narrator', name: '旁白' },
    ...work.characters
      .filter((character) => mentioned.has(character.id) || mentioned.size < 4)
      .slice(0, 12)
      .map((character) => ({ speakerId: character.id, speakerKind: 'character', name: character.name, role: character.role })),
  ]

  return `请为以下有声读物片段补全说话人归因。

章节标题：${chapter.title}
章节大纲摘要：${outlineNode?.summary || '无'}

候选 speaker：
${JSON.stringify(candidates, null, 2)}

邻近上下文片段：
${JSON.stringify(contextSegments.map((segment) => ({ id: segment.id, speakerName: segment.speakerName, text: segment.text.slice(0, 240) })), null, 2)}

待归因片段：
${JSON.stringify(segments.map((segment) => ({ id: segment.id, text: segment.text, ruleGuess: { speakerKind: segment.speakerKind, characterId: segment.characterId, speakerName: segment.speakerName, confidence: segment.attributionConfidence } })), null, 2)}

输出 JSON 数组，每个对象必须包含：
- segmentId: 对应待归因片段 id
- speakerKind: "narrator" | "character"
- characterId: 候选角色 id 或 null
- speakerName: 候选 speaker 名称
- mood: 适合 TTS 的短语气描述
- confidence: 0 到 1
- needsReview: boolean
- reason: 简短原因`
}

export function buildAudiobookToneCompressionPrompt(items: { segmentId: string; speakerName: string; text: string; expandedPrompt: string }[]) {
  return `请把以下已展开的角色朗读指导压缩为适合单个 TTS 分段使用的简洁语气描述。

输入：
${JSON.stringify(items, null, 2)}

输出 JSON 数组，每个对象必须包含：
- segmentId: 输入中的 segmentId
- tone: 50 字左右的中文语气描述`
}

export function buildQwenTtsRoleTemplatePrompt(work: Work, characterId: string) {
  const character = work.characters.find((item) => item.id === characterId)
  if (!character) throw new Error('角色不存在')
  return `请基于以下世界观和角色设定，为该角色生成 QwenTTS 有声读物朗读指导。

# 世界观
${seedContext(work)}

${worldContext(work)}

# 角色设定
姓名：${character.name}
经历：${character.bio}
性格：${character.personality.traits.join('、') || '未设定'}
习惯：${character.personality.habits.join('、') || '未设定'}
标签：${character.tags.join('、') || '未设定'}
关系：${character.relations.map((relation) => relation.description).join('；') || '未设定'}

# 输出要求
请生成 100-200 字中文朗读指导，必须包含并保留这一行：
当前语境：【上下文】

朗读指导应说明角色音色、语气、节奏、情绪控制和朗读规则。不要写待朗读正文，不要输出【文本】占位符。`
}
