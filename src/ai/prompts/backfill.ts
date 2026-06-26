import type { BackfillTask, BackfillWindow } from '@/features/backfill/types'

export const BACKFILL_SYSTEM_PROMPT = `你是小说导入后的阶段反推助手。你只根据用户提供的小段正文摘录提出可核对的候选建议。
不要改写正文，不要补全没有证据的信息，不要把建议描述成已定稿设定。必须返回 JSON。`

const taskLabels: Record<BackfillTask, string> = {
  chapterSummary: '先补章节摘要',
  characters: '识别主要人物',
  settings: '补世界设定',
  constraints: '提取核心约束',
  storylines: '整理故事线',
  seed: '补故事萌芽',
}

export function buildBackfillPrompt(task: BackfillTask, window: BackfillWindow) {
  return `创作任务：${taskLabels[task]}

约束：
- 只根据当前摘录提出候选建议，没有证据就返回空 candidates。
- 每条候选必须包含 sourceExcerpt，且必须能在摘录中找到依据。
- 不要改写、续写或总结整章正文。
- 返回 JSON 对象：{ "candidates": [...] }。

当前章节：${window.chapterTitle}
章节 ID：${window.chapterId}
大纲 ID：${window.outlineId ?? '无'}
窗口序号：${window.windowIndex}
摘录长度：${window.text.length} 字符

候选字段要求：
- 章节摘要：summary。
- 角色：name, role, bio, traits, aliases。
- 世界设定：category, title, content。
- 核心约束：type, title, description, priority。
- 故事线：name, description, chapterLinks。
- 故事萌芽：field, value。
- 通用字段：confidence, sourceExcerpt。

正文摘录：
${window.text}`
}
