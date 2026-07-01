import type { Chapter, Character, ImagePromptType, Work } from '@/core/types'

const CHAPTER_EXCERPT_LIMIT = 900

function compact(value: string | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function characterLine(character: Character | undefined) {
  if (!character) return '角色：未选择'
  return [
    `角色：${character.name}`,
    `定位：${character.role}`,
    `背景：${compact(character.bio) || '暂无'}`,
    `性格：${character.personality.traits.join('、') || '暂无'}`,
    `标签：${character.tags.join('、') || '暂无'}`,
  ].join('\n')
}

function chapterLine(chapter: Chapter | undefined) {
  if (!chapter) return '章节：未选择'
  return [
    `章节：${chapter.title}`,
    `用户方向：${compact(chapter.userDirection) || '暂无'}`,
    `场景：${chapter.scenes.map(scene => `${scene.title || '未命名'}：${compact(scene.summary || scene.content).slice(0, 180)}`).join(' / ') || '暂无'}`,
    `正文摘录：${buildChapterExcerpt(chapter) || '暂无'}`,
  ].join('\n')
}

export function buildChapterExcerpt(chapter: Chapter) {
  const sceneText = chapter.scenes.map(scene => compact(scene.summary || scene.content)).filter(Boolean).join('\n')
  if (sceneText) return sceneText.slice(0, CHAPTER_EXCERPT_LIMIT)
  const paragraphs = chapter.content.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(compact).filter(Boolean)
  return paragraphs.slice(0, 3).join('\n').slice(0, CHAPTER_EXCERPT_LIMIT)
}

function characterMatchLine(character: Character) {
  const tags = character.tags.slice(0, 6).join('、') || '暂无'
  return `- id: ${character.id}; name: ${character.name}; tags: ${tags}`
}

export function buildChapterVisualCandidateContext(work: Work, chapterId: string) {
  const chapter = work.chapters.find(item => item.id === chapterId)
  if (!chapter) return ''
  const sceneSummary = chapter.scenes
    .map(scene => `${scene.title || '未命名'}：${compact(scene.summary || scene.content).slice(0, 180)}`)
    .filter(Boolean)
    .join(' / ')
  const characterIndex = work.characters.map(characterMatchLine).join('\n') || '暂无'
  return [
    `作品类型：${work.seed.genre}${work.seed.subGenre ? ` / ${work.seed.subGenre}` : ''}`,
    `章节：${chapter.title}`,
    `用户方向：${compact(chapter.userDirection) || '暂无'}`,
    `场景摘要：${sceneSummary || '暂无'}`,
    `正文摘录：${buildChapterExcerpt(chapter) || '暂无'}`,
    `角色匹配索引（只包含 id、name、tags，不包含 bio 或整章正文）：\n${characterIndex}`,
  ].join('\n\n')
}

export function buildImagePromptContext(work: Work, type: ImagePromptType, characterId?: string, chapterId?: string) {
  const character = characterId ? work.characters.find(item => item.id === characterId) : undefined
  const chapter = chapterId ? work.chapters.find(item => item.id === chapterId) : undefined
  const savedPrompts = Object.values(work.visualAssets?.prompts || {})
    .filter(prompt => prompt.status === 'saved' && (prompt.characterId === characterId || prompt.chapterId === chapterId))
    .map(prompt => `【${prompt.title}】${prompt.prompt}`)
    .slice(0, 4)
    .join('\n')
  const needsChapter = type === 'chapterObject' || type === 'chapterClothing' || type === 'chapterProp'
  return [
    `作品基调：${work.seed.tone || '暂无'}`,
    `类型：${work.seed.genre}${work.seed.subGenre ? ` / ${work.seed.subGenre}` : ''}`,
    characterLine(character),
    needsChapter ? chapterLine(chapter) : '',
    type === 'characterFullBody' ? `已保存视觉信息：\n${savedPrompts || '暂无'}` : '',
  ].filter(Boolean).join('\n\n')
}
