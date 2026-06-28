import { useEffect, useMemo, useState } from 'react'
import { Alert, Card, Empty, Select, Space, Typography, message } from 'antd'
import type { ImagePromptType, VisualPromptRecord } from '@/core/types'
import { useAuthStore } from '@/core/auth-store'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { useImageGeneration } from '@/features/image-generation/useImageGeneration'
import ImageModelSelector from '@/features/image-generation/ImageModelSelector'
import ImagePromptEditor from '@/features/image-generation/ImagePromptEditor'
import ImageResultGallery from '@/features/image-generation/ImageResultGallery'

const { Title, Text } = Typography

const PROMPT_TYPES: Array<{ value: ImagePromptType; label: string }> = [
  { value: 'characterFace', label: '角色高清面部特写' },
  { value: 'chapterClothing', label: '章节服饰' },
  { value: 'chapterProp', label: '章节道具' },
  { value: 'characterFullBody', label: '多视角全身图' },
]

function promptId(type: ImagePromptType, characterId?: string, chapterId?: string) {
  return [type, characterId || 'none', chapterId || 'none'].join(':')
}

function typeRequiresChapter(type: ImagePromptType) {
  return type === 'chapterClothing' || type === 'chapterProp'
}

export default function ImageGenerationPage() {
  const user = useAuthStore(state => state.user)
  const currentWork = useStore(state => state.currentWork)
  const readOnly = useStore(state => state.readOnly)
  const canUseFeature = useSystemConfigStore(state => state.canUseFeature)
  const { imageGenerationConfig, visualAssets, generatingPromptId, generatingImagePromptId, generatePromptDraft, savePrompt, generateImage, retryImmichUpload } = useImageGeneration()
  const [type, setType] = useState<ImagePromptType>('characterFace')
  const [characterId, setCharacterId] = useState<string | undefined>()
  const [chapterId, setChapterId] = useState<string | undefined>()
  const [promptText, setPromptText] = useState('')
  const [modelId, setModelId] = useState(imageGenerationConfig.defaultModelId)

  const editable = Boolean(currentWork && !readOnly && canUseFeature(user, 'imageGeneration'))
  const missingRequiredChapter = typeRequiresChapter(type) && !chapterId
  const promptEditable = editable && !missingRequiredChapter
  const selectedPromptId = promptId(type, characterId, chapterId)
  const record = visualAssets.prompts[selectedPromptId]
  const images = useMemo(() => Object.values(visualAssets.images).filter(image => image.promptId === selectedPromptId).sort((a, b) => b.createdAt - a.createdAt), [selectedPromptId, visualAssets.images])

  useEffect(() => {
    setPromptText(record?.draftPrompt || record?.prompt || '')
  }, [record?.draftPrompt, record?.prompt, selectedPromptId])

  useEffect(() => {
    if (!modelId && imageGenerationConfig.defaultModelId) setModelId(imageGenerationConfig.defaultModelId)
  }, [imageGenerationConfig.defaultModelId, modelId])

  if (!currentWork) return <Empty description="请先打开一个作品" />

  const handleGenerateDraft = async () => {
    if (missingRequiredChapter) {
      message.warning('请先选择章节，再生成章节服饰或章节道具提示词')
      return
    }
    const draft = await generatePromptDraft(type, characterId, chapterId)
    if (draft?.draftPrompt) setPromptText(draft.draftPrompt)
  }

  const handleSave = async () => {
    if (missingRequiredChapter) {
      message.warning('请先选择章节，再保存章节服饰或章节道具提示词')
      return
    }
    const nextRecord: VisualPromptRecord = record || {
      id: selectedPromptId,
      type,
      characterId,
      chapterId,
      title: PROMPT_TYPES.find(item => item.value === type)?.label || '视觉提示词',
      prompt: '',
      status: 'empty',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await savePrompt(nextRecord, promptText)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promptText)
    message.success('提示词已复制')
  }

  const handleGenerateImage = async () => {
    if (!record || !modelId) return
    await generateImage(record, modelId)
  }

  return (
    <div className="image-generation-page">
      <Title level={4}>视觉资产工作台</Title>
      <Text type="secondary">在作品上下文中沉淀角色、章节和多视角视觉提示词，并通过服务端代理生成图片。</Text>

      {!imageGenerationConfig.enabled && <Alert style={{ marginTop: 16 }} type="warning" showIcon message="生图功能未开启" description="已有视觉资产可查看；生成和保存需要管理员开启功能并授权。" />}
      {readOnly && <Alert style={{ marginTop: 16 }} type="info" showIcon message="只读作品" description="你可以查看已有视觉资产，但不能保存提示词或生成图片。" />}
      {!editable && !readOnly && imageGenerationConfig.enabled && <Alert style={{ marginTop: 16 }} type="warning" showIcon message="当前账号未授权生图" />}

      <div className="image-generation-layout">
        <Card title="筛选视觉记录" className="image-generation-panel">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Select value={type} onChange={setType} options={PROMPT_TYPES} />
            <Select allowClear value={characterId} onChange={setCharacterId} placeholder="选择角色" options={currentWork.characters.map(character => ({ value: character.id, label: character.name }))} />
            <Select allowClear value={chapterId} onChange={setChapterId} placeholder="选择章节" disabled={type === 'characterFace' || type === 'characterFullBody'} options={currentWork.chapters.map(chapter => ({ value: chapter.id, label: chapter.title }))} />
            <ImageModelSelector models={imageGenerationConfig.models} value={modelId} onChange={setModelId} />
          </Space>
        </Card>

        <Card title="提示词编辑" className="image-generation-panel image-generation-main">
          {missingRequiredChapter && <Alert style={{ marginBottom: 12 }} type="info" showIcon message="请先选择章节" description="章节服饰和章节道具提示词需要章节标题、摘要、场景信息和小段摘录作为上下文。" />}
          <ImagePromptEditor
            record={record}
            value={promptText}
            editable={promptEditable}
            generatingPrompt={generatingPromptId === selectedPromptId}
            generatingImage={generatingImagePromptId === selectedPromptId}
            onChange={setPromptText}
            onGenerateDraft={handleGenerateDraft}
            onSave={handleSave}
            onCopy={handleCopy}
            onGenerateImage={handleGenerateImage}
          />
        </Card>
      </div>

      <Card title="图片结果" style={{ marginTop: 16 }}>
        <ImageResultGallery images={images} editable={editable} onRetryUpload={retryImmichUpload} />
      </Card>
    </div>
  )
}
