const IMPORT_EXCERPT_LIMIT = 6000

export const IMPORT_BOUNDARY_SYSTEM_PROMPT = `你是小说章节边界识别助手。只根据用户提供的短摘录判断可能的章节标题和起始位置。
必须返回 JSON 数组，不要返回正文改写，不要补全章节内容。`

export function buildImportBoundaryPrompt(text: string) {
  const excerpt = text.slice(0, IMPORT_EXCERPT_LIMIT)
  return `请从以下小说短摘录中识别可能的章节边界。

约束：
- 只基于这段短摘录判断，不要假设整本书结构。
- 返回 JSON 数组。
- 每项字段：title, startOffset, confidence, reason。
- startOffset 是该标题在摘录中的字符偏移。
- confidence 范围 0 到 1。
- 不要返回章节正文，不要改写原文。

摘录长度：${excerpt.length} 字符
摘录：
${excerpt}`
}

export function importBoundaryExcerptLength(text: string) {
  return Math.min(text.length, IMPORT_EXCERPT_LIMIT)
}
