export const IMAGE_PROMPT_SYSTEM_PROMPT = `你是小说视觉设定提示词助手。你只输出适合图像生成模型的中文视觉提示词。
不要生成剧情正文，不要补写章节，不要输出 JSON。`

export function buildImagePromptInstruction(type: string, context: string) {
  const label = type === 'characterFace'
    ? '角色高清面部特写'
    : type === 'chapterClothing'
      ? '章节服饰'
      : type === 'chapterProp'
        ? '章节道具'
        : type === 'chapterObject'
          ? '章节服饰/道具（旧）'
          : '角色多视角全身图'
  return `任务：生成「${label}」视觉提示词草稿。

要求：
- 只描述可见画面、材质、光线、构图、服饰、道具、表情和风格。
- 章节服饰聚焦服装、材质、配色、磨损、身份和时代线索；章节道具聚焦关键物件、手持物、符号和剧情用途。
- 不写剧情正文，不写解释，不写模型参数。
- 以一段可直接复制的提示词输出。
- 如果信息不足，保留为可编辑的合理占位描述，不要编造关键设定。

上下文：
${context}`
}
