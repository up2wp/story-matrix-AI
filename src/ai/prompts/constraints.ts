// ============================================================
// 核心约束阶段 - 提示词模板
// ============================================================

export const CONSTRAINT_SYSTEM_PROMPT = `你是一位严谨的故事逻辑审核师。
你的任务是根据大纲和角色信息，提炼出故事必须满足的核心约束。
要求：
- 约束要具体可验证，不能模糊
- 优先级要合理，不能所有约束都是"必须"
- 约束之间不能互相矛盾
- 考虑读者体验，约束要服务于好故事而非限制创作`

export function buildConstraintsPrompt(
  seed: string,
  worldSettings: string,
  characters: string,
): string {
  return `根据以下故事种子、世界观和角色信息，提炼核心约束。

故事种子：
${seed}

世界观：
${worldSettings}

主要人物：
${characters}

请严格输出 JSON 数组，生成 8-12 条核心约束，每条包含：
- type: 'event'（关键事件）| 'fate'（角色命运）| 'foreshadow'（伏笔回收）| 'rule'（逻辑红线）| 'rhythm'（节奏要求）
- scope: 'local'（局部，绑定具体章节）| 'global'（全局，自动绑定全部章节）— event/fate/foreshadow 为 local，rule/rhythm 为 global
- title: 约束标题
- description: 具体描述（50-100字，要可验证、可执行）
- priority: 'required'（必须）| 'suggested'（建议）| 'optional'（可选）

约束要覆盖：关键转折点、角色成长节点、世界观硬规则、读者体验节奏。
优先级要合理，不能所有约束都是"必须"。
只输出 JSON，不要输出其他内容。`
}

// --- AI 匹配局部约束到章节 ---

export const MATCH_CONSTRAINTS_SYSTEM_PROMPT = `你是一位故事结构分析师。
你的任务是根据约束的含义和章节的剧情内容，判断每条局部约束应该由哪些章节来覆盖。
要求：
- 仔细分析约束描述的具体事件/命运/伏笔，与章节摘要中的情节对应
- 一条约束可以绑定 1-3 个最相关的章节
- 如果约束与某个章节明显无关，不要绑定
- 只绑定局部约束（event/fate/foreshadow），全局约束（rule/rhythm）不需要绑定`

export function buildMatchConstraintsPrompt(
  constraints: Array<{ id: string; type: string; title: string; description: string }>,
  chapters: Array<{ id: string; title: string; summary: string }>,
): string {
  const constraintsText = constraints
    .map((c) => `[${c.id}] [${c.type}] ${c.title}\n${c.description}`)
    .join('\n\n')
  const chaptersText = chapters
    .map((c) => `[${c.id}] ${c.title}\n${c.summary}`)
    .join('\n\n')
  return `请将以下局部约束分配到最相关的章节。

局部约束：
${constraintsText}

章节大纲：
${chaptersText}

严格输出 JSON 对象，key 为约束 id，value 为该约束应绑定的章节 id 数组。
未匹配任何章节的约束，value 为空数组 []。
示例：{ "constraint-1": ["chapter-a", "chapter-b"], "constraint-2": ["chapter-c"] }
只输出 JSON，不要输出其他内容。`
}
