import type { Chapter, Work } from '@/core/types'
import { charactersContext, outlineContext, seedContext, worldContext } from '@/ai/context'

export const AUDIOBOOK_SEGMENT_SYSTEM_PROMPT = `你是小说有声读物分镜导演。
你的任务是把已完成章节拆成适合 TTS 生成的旁白/角色语音片段，并为每个片段给出 Story Matrix AI 自己拥有的语音表演提示词。

严格要求：
- 只输出 JSON 数组，不要 Markdown，不要解释
- speakerKind 只能是 "narrator" 或 "character"
- characterId 必须来自给定角色列表；无法判断时使用 narrator
- prompt 必须简短，最多 120 个中文字符，适合放入 Voicebox instruct
- 不要引用 Voicebox personality，不要要求 Voicebox 自己理解角色设定
- 保持原文顺序，不要改写正文内容`

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
- mood: string
- prompt: string`
}
