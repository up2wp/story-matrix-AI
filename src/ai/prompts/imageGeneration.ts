export const IMAGE_PROMPT_SYSTEM_PROMPT = `你是小说视觉设定提示词助手。你只输出适合图像生成模型的中文视觉提示词。
不要生成剧情正文，不要补写章节，不要输出 JSON。`

export function buildChapterVisualCandidateInstruction(context: string) {
  return `任务：从当前章节小上下文中提取视觉候选，只输出严格 JSON，不要输出解释、Markdown 或额外文本。

JSON 结构必须完全符合：
{
  "characters": [{ "name": "章节中出现的人名或称谓", "evidence": "不超过40字的出现证据" }],
  "clothing": [{ "label": "服饰名称", "description": "可见材质、颜色、剪裁或状态", "characterName": "关联角色名或空字符串", "evidence": "不超过40字的章节证据" }],
  "props": [{ "label": "道具名称", "description": "可见材质、形状、尺寸或用途", "characterName": "关联角色名或空字符串", "evidence": "不超过40字的章节证据" }]
}

要求：
- 只使用上下文中明确出现或可由场景摘要直接支持的视觉要素。
- characters 只列当前章节出现的人名、别名或称谓，不要创造新角色。
- clothing 只列服饰、配饰、盔甲、制服等可画成独立素材的对象。
- props 只列武器、器物、符号、书信、钥匙等可画成独立素材的对象。
- 不生成视觉提示词，不总结剧情，不返回章节正文或摘录。
- 信息不足时返回空数组。

上下文：
${context}`
}

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
- 所有类型都优先生成白色背景、主体清晰、可复用的设定素材，不写复杂场景插画。
- characterFace：白色背景，大头像或头肩近景，脸部占画面主体，清晰五官，发型、脸型、肤色和面部特征可复用，避免复杂环境、戏剧光影和剧情动作。
- chapterClothing：白色背景，服饰主体单独展示，突出材质、配色、剪裁、层次、磨损和时代线索；不要包含角色姓名、角色身份、人物脸、身体、姿势或剧情动作。
- chapterProp：白色背景，道具主体单独展示，突出材质、形状、尺寸、纹样、使用痕迹和用途线索；不要包含角色姓名、角色身份、人物脸、身体、手持动作或剧情动作。
- characterFullBody：白色背景，全身设定图，清晰展示角色体型、服饰轮廓、配色和可复用视觉特征，可引用已保存面部、服饰和道具视觉信息。
- 旧 chapterObject 按服饰/道具独立素材处理，避免人物身份和剧情动作。
- 不写剧情正文，不写解释，不写模型参数。
- 以一段可直接复制的提示词输出。
- 如果信息不足，保留为可编辑的合理占位描述，不要编造关键设定。

上下文：
${context}`
}
