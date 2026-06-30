import { useMemo, useRef, useState } from 'react'
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Empty, Select, Segmented, Space, Tag, Typography, message } from 'antd'
import type { ChapterVisualCandidateResult, ImageAssetRecord, ImageGenerationModelConfig, ImagePromptType, ImageViewDirection, VisualCandidateKind, VisualPromptRecord, VisualSubjectCandidate } from '@/core/types'
import { useAuthStore } from '@/core/auth-store'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { useImageGeneration } from '@/features/image-generation/useImageGeneration'
import { getImageAssetDisplayUrl } from '@/features/image-generation/imageGenerationClient'
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

const VIEW_DIRECTION_OPTIONS: Array<{ value: ImageViewDirection; label: string }> = [
  { value: 'front', label: '正面' },
  { value: 'side', label: '侧面' },
  { value: 'back', label: '背面' },
]

type CandidateState =
  | { status: 'idle'; chapterId?: string }
  | { status: 'loading'; chapterId: string }
  | { status: 'success'; chapterId: string; result: ChapterVisualCandidateResult; error?: string }
  | { status: 'error'; chapterId: string; error: string }

interface EligibleReferenceImage {
  image: ImageAssetRecord
  displayUrl: string
  label: string
  detail: string
}

function promptId(type: ImagePromptType, characterId?: string, chapterId?: string, visualSubjectId?: string) {
  return [type, characterId || 'none', chapterId || 'none', visualSubjectId || 'none'].join(':')
}

function legacyPromptId(type: ImagePromptType, characterId?: string, chapterId?: string) {
  return [type, characterId || 'none', chapterId || 'none'].join(':')
}

function typeRequiresChapter(type: ImagePromptType) {
  return type === 'chapterClothing' || type === 'chapterProp'
}

function typeUsesCandidateSubject(type: ImagePromptType) {
  return type === 'chapterClothing' || type === 'chapterProp'
}

function promptTitle(type: ImagePromptType) {
  return PROMPT_TYPES.find(item => item.value === type)?.label || '视觉提示词'
}

function modelReferenceLimit(model?: ImageGenerationModelConfig) {
  return Math.min(3, model?.capabilities.maxReferenceImages || 0)
}

function subjectKind(type: ImagePromptType): VisualCandidateKind | undefined {
  if (type === 'chapterClothing') return 'clothing'
  if (type === 'chapterProp') return 'prop'
  return undefined
}

function subjectOptionLabel(candidate: VisualSubjectCandidate) {
  return candidate.characterName ? `${candidate.label} / ${candidate.characterName}` : candidate.label
}

export default function ImageGenerationPage() {
  const user = useAuthStore(state => state.user)
  const currentWork = useStore(state => state.currentWork)
  const setCurrentWork = useStore(state => state.setCurrentWork)
  const readOnly = useStore(state => state.readOnly)
  const canUseFeature = useSystemConfigStore(state => state.canUseFeature)
  const { imageGenerationConfig, visualAssets, generatingPromptId, generatingImagePromptId, generatePromptDraft, savePrompt, generateImage, extractChapterCandidates, retryImmichUpload } = useImageGeneration()
  const [type, setType] = useState<ImagePromptType>('characterFace')
  const [characterId, setCharacterId] = useState<string | undefined>()
  const [chapterId, setChapterId] = useState<string | undefined>()
  const [visualSubjectId, setVisualSubjectId] = useState<string | undefined>()
  const [promptDraft, setPromptDraft] = useState<{ promptId: string; text: string } | null>(null)
  const [modelId, setModelId] = useState(imageGenerationConfig.defaultModelId)
  const [candidateState, setCandidateState] = useState<CandidateState>({ status: 'idle' })
  const [viewDirection, setViewDirection] = useState<ImageViewDirection>('front')
  const [referenceImageIds, setReferenceImageIds] = useState<string[]>([])
  const [refreshingImages, setRefreshingImages] = useState(false)
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0)
  const candidateRequestId = useRef(0)

  const editable = Boolean(currentWork && !readOnly && canUseFeature(user, 'imageGeneration'))
  const missingRequiredChapter = typeRequiresChapter(type) && !chapterId
  const subjectCandidates = useMemo(() => {
    if (candidateState.status !== 'success' || candidateState.chapterId !== chapterId) return []
    if (type === 'chapterClothing') return candidateState.result.clothing
    if (type === 'chapterProp') return candidateState.result.props
    return []
  }, [candidateState, chapterId, type])
  const selectedSubject = subjectCandidates.find(candidate => candidate.id === visualSubjectId)
  const selectedVisualSubjectId = typeUsesCandidateSubject(type) ? selectedSubject?.id : undefined
  const missingRequiredSubject = typeUsesCandidateSubject(type) && !selectedSubject
  const promptEditable = editable && !missingRequiredChapter
  const selectedPromptId = promptId(type, characterId, chapterId, selectedVisualSubjectId)
  const selectedLegacyPromptId = legacyPromptId(type, characterId, chapterId)
  const storedRecord = visualAssets.prompts[selectedPromptId]
  const record = storedRecord || (!selectedVisualSubjectId ? visualAssets.prompts[selectedLegacyPromptId] : undefined)
  const recordForActions: VisualPromptRecord | undefined = record ? {
    ...record,
    id: selectedPromptId,
    type,
    characterId,
    chapterId,
    visualSubjectId: selectedVisualSubjectId,
    subjectLabel: selectedSubject?.label || record.subjectLabel,
    candidateKind: selectedSubject?.kind || record.candidateKind,
  } : undefined
  const images = useMemo(() => Object.values(visualAssets.images).filter(image => image.promptId === selectedPromptId).sort((a, b) => b.createdAt - a.createdAt), [selectedPromptId, visualAssets.images])
  const effectiveModelId = modelId || imageGenerationConfig.defaultModelId
  const selectedModel = useMemo(() => imageGenerationConfig.models.find(model => model.id === effectiveModelId), [imageGenerationConfig.models, effectiveModelId])
  const maxReferenceImages = modelReferenceLimit(selectedModel)
  const modelSupportsReferenceImages = Boolean(selectedModel?.capabilities.referenceImages && maxReferenceImages > 0)
  const eligibleReferenceImages = useMemo<EligibleReferenceImage[]>(() => Object.values(visualAssets.images)
    .filter(image => image.status === 'succeeded' && image.storageStatus === 'succeeded')
    .map(image => ({ image, displayUrl: getImageAssetDisplayUrl(image) }))
    .filter((item): item is { image: ImageAssetRecord; displayUrl: string } => Boolean(item.displayUrl))
    .sort((a, b) => b.image.createdAt - a.image.createdAt)
    .map(({ image, displayUrl }) => {
      const prompt = visualAssets.prompts[image.promptId]
      const label = prompt?.subjectLabel || prompt?.title || image.promptSnapshot.slice(0, 18) || '已生成图片'
      const detail = `${image.modelName} / ${new Date(image.createdAt).toLocaleString('zh-CN')}`
      return { image, displayUrl, label, detail }
    }), [visualAssets.images, visualAssets.prompts])
  const eligibleReferenceIds = useMemo(() => new Set(eligibleReferenceImages.map(item => item.image.id)), [eligibleReferenceImages])
  const invalidSelectedReferenceIds = referenceImageIds.filter(id => !eligibleReferenceIds.has(id))
  const referenceGenerateBlockReason = type === 'characterFullBody' && referenceImageIds.length > 0
    ? (!modelSupportsReferenceImages
        ? '当前模型不支持参考图；清空参考图后可继续普通文生图，或切换到支持参考图的模型。'
        : invalidSelectedReferenceIds.length > 0
          ? '已选参考图中有图片不可用，请刷新或清空后重新选择。'
          : referenceImageIds.length > maxReferenceImages
            ? `当前模型最多支持 ${maxReferenceImages} 张参考图，请减少选择。`
            : undefined)
    : undefined
  const candidateCharacters = candidateState.status === 'success' && candidateState.chapterId === chapterId ? candidateState.result.characters : []
  const characterOptions = chapterId
    ? candidateCharacters.map(candidate => ({ value: candidate.characterId, label: candidate.evidence ? `${candidate.name} / ${candidate.evidence}` : candidate.name }))
    : currentWork?.characters.map(character => ({ value: character.id, label: character.name })) || []

  const promptText = promptDraft?.promptId === selectedPromptId ? promptDraft.text : (record?.draftPrompt || record?.prompt || '')

  if (!currentWork) return <Empty description="请先打开一个作品" />

  const loadChapterCandidates = async (nextChapterId: string) => {
    const requestId = candidateRequestId.current + 1
    candidateRequestId.current = requestId
    setCandidateState({ chapterId: nextChapterId, status: 'loading' })
    const result = await extractChapterCandidates(nextChapterId)
    if (candidateRequestId.current !== requestId) return
    if (!result) {
      setCandidateState({ chapterId: nextChapterId, status: 'error', error: '章节视觉候选提取失败，可点击刷新重试。' })
      return
    }
    setCandidateState({ chapterId: nextChapterId, status: 'success', result, error: result.error })
  }

  const handleTypeChange = (nextType: ImagePromptType) => {
    setType(nextType)
    if (nextType !== 'characterFullBody') {
      setViewDirection('front')
      setReferenceImageIds([])
    }
    if (!typeUsesCandidateSubject(nextType)) setVisualSubjectId(undefined)
  }

  const handleChapterChange = (nextChapterId?: string) => {
    candidateRequestId.current += 1
    setChapterId(nextChapterId)
    setCharacterId(undefined)
    setVisualSubjectId(undefined)
    setCandidateState(nextChapterId ? { chapterId: nextChapterId, status: 'idle' } : { status: 'idle' })
    if (nextChapterId) void loadChapterCandidates(nextChapterId)
  }

  const handleSubjectChange = (nextVisualSubjectId?: string) => {
    const nextSubject = subjectCandidates.find(candidate => candidate.id === nextVisualSubjectId)
    setVisualSubjectId(nextVisualSubjectId)
    if (nextSubject?.characterId) setCharacterId(nextSubject.characterId)
    if (!nextVisualSubjectId && typeUsesCandidateSubject(type)) setCharacterId(undefined)
  }

  const handleRefreshCandidates = () => {
    if (!chapterId) {
      message.warning('请先选择章节')
      return
    }
    void loadChapterCandidates(chapterId)
  }

  const handleReferenceToggle = (imageId: string) => {
    setReferenceImageIds(current => {
      if (current.includes(imageId)) return current.filter(id => id !== imageId)
      if (!modelSupportsReferenceImages || current.length >= maxReferenceImages) return current
      return [...current, imageId]
    })
  }

  const handleGenerateDraft = async () => {
    if (missingRequiredChapter) {
      message.warning('请先选择章节，再生成章节服饰或章节道具提示词')
      return
    }
    if (missingRequiredSubject) {
      message.warning('请先选择章节候选主体，再生成章节服饰或章节道具提示词')
      return
    }
    const candidateKind = subjectKind(type)
    const draft = await generatePromptDraft(type, characterId, chapterId, selectedSubject && candidateKind ? { visualSubjectId: selectedSubject.id, subjectLabel: selectedSubject.label, candidateKind } : undefined)
    if (draft?.draftPrompt) setPromptDraft({ promptId: draft.id, text: draft.draftPrompt })
  }

  const handleSave = async () => {
    if (missingRequiredChapter) {
      message.warning('请先选择章节，再保存章节服饰或章节道具提示词')
      return
    }
    if (missingRequiredSubject) {
      message.warning('请先选择章节候选主体，再保存章节服饰或章节道具提示词')
      return
    }
    const candidateKind = subjectKind(type)
    const nextRecord: VisualPromptRecord = {
      ...(recordForActions || {}),
      id: selectedPromptId,
      type,
      characterId,
      chapterId,
      visualSubjectId: selectedSubject?.id,
      subjectLabel: selectedSubject?.label,
      candidateKind,
      title: promptTitle(type),
      prompt: recordForActions?.prompt || '',
      status: recordForActions?.status || 'empty',
      createdAt: recordForActions?.createdAt || Date.now(),
      updatedAt: Date.now(),
    }
    await savePrompt(nextRecord, promptText)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promptText)
    message.success('提示词已复制')
  }

  const handleGenerateImage = async () => {
    if (!recordForActions || !effectiveModelId) return
    if (referenceGenerateBlockReason) {
      message.warning(referenceGenerateBlockReason)
      return
    }
    if (type === 'characterFullBody') {
      await generateImage(recordForActions, effectiveModelId, { referenceImageIds, viewDirection })
      return
    }
    await generateImage(recordForActions, effectiveModelId)
  }

  const handleRefreshImages = async () => {
    if (!currentWork) return
    setRefreshingImages(true)
    try {
      const freshWork = await db.works.get(currentWork.id)
      if (freshWork) setCurrentWork(freshWork)
      setGalleryRefreshKey(key => key + 1)
    } finally {
      setRefreshingImages(false)
    }
  }

  const renderCandidateStatus = () => {
    if (!chapterId) return <Text type="secondary">选择章节后可加载本章角色、服饰和道具候选。</Text>
    if (candidateState.status === 'loading') return <Alert type="info" showIcon message="正在提取当前章节视觉候选" />
    if (candidateState.status === 'error') return <Alert type="error" showIcon message={candidateState.error} />
    if (candidateState.status === 'success' && candidateState.chapterId === chapterId) {
      const total = candidateState.result.characters.length + candidateState.result.clothing.length + candidateState.result.props.length
      return (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text type={total ? 'secondary' : 'warning'}>{total ? `已加载 ${candidateState.result.characters.length} 个角色、${candidateState.result.clothing.length} 个服饰、${candidateState.result.props.length} 个道具候选。` : '本章暂未提取到可用视觉候选。'}</Text>
          {candidateState.result.unmappedCharacters.length > 0 && <Text type="secondary">未映射角色：{candidateState.result.unmappedCharacters.join('、')}</Text>}
          {candidateState.error && <Text type="warning">{candidateState.error}</Text>}
        </Space>
      )
    }
    return <Text type="secondary">点击刷新候选，加载当前章节的 AI 视觉主体。</Text>
  }

  const referenceControls = type === 'characterFullBody' ? (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Text strong>视角方向</Text>
        <Segmented<ImageViewDirection> value={viewDirection} onChange={setViewDirection} options={VIEW_DIRECTION_OPTIONS} block />
      </Space>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap align="center">
          <Text strong>参考图</Text>
          <Tag>{referenceImageIds.length}/{maxReferenceImages || 0}</Tag>
          {modelSupportsReferenceImages ? <Tag color="blue">当前模型最多 {maxReferenceImages} 张</Tag> : <Tag>当前模型不支持参考图</Tag>}
          {referenceImageIds.length > 0 && <Button size="small" onClick={() => setReferenceImageIds([])}>清空参考图</Button>}
        </Space>
        {referenceGenerateBlockReason && <Alert type="warning" showIcon message={referenceGenerateBlockReason} />}
        {eligibleReferenceImages.length ? (
          <div className="image-reference-grid">
            {eligibleReferenceImages.map(item => {
              const selected = referenceImageIds.includes(item.image.id)
              const disabled = !selected && (!modelSupportsReferenceImages || referenceImageIds.length >= maxReferenceImages)
              return (
                <button key={item.image.id} type="button" className={`image-reference-option${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`} disabled={disabled} onClick={() => handleReferenceToggle(item.image.id)}>
                  <img src={item.displayUrl} alt={item.label} />
                  <span className="image-reference-label">{item.label}</span>
                  <span className="image-reference-detail">{item.detail}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可作为参考图的成功图片" />
        )}
      </Space>
    </Space>
  ) : undefined

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
            <Select value={type} onChange={handleTypeChange} options={PROMPT_TYPES} />
            <Select allowClear value={chapterId} onChange={handleChapterChange} placeholder="选择章节" options={currentWork.chapters.map(chapter => ({ value: chapter.id, label: chapter.title }))} />
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space wrap align="center">
                <Text strong>章节候选</Text>
                <Button size="small" icon={<ReloadOutlined />} disabled={!chapterId || candidateState.status === 'loading'} loading={candidateState.status === 'loading'} onClick={handleRefreshCandidates}>刷新候选</Button>
              </Space>
              {renderCandidateStatus()}
            </Space>
            <Select
              allowClear
              value={characterId}
              onChange={setCharacterId}
              placeholder={chapterId ? '选择本章映射角色' : '选择角色'}
              loading={candidateState.status === 'loading'}
              disabled={Boolean(chapterId && candidateState.status === 'loading')}
              options={characterOptions}
              notFoundContent={chapterId ? '本章未识别到作品角色' : '暂无角色'}
            />
            {typeUsesCandidateSubject(type) && (
              <Select
                allowClear
                value={visualSubjectId}
                onChange={handleSubjectChange}
                placeholder={type === 'chapterClothing' ? '选择章节服饰候选' : '选择章节道具候选'}
                loading={candidateState.status === 'loading'}
                disabled={!chapterId || candidateState.status === 'loading' || candidateState.status === 'error'}
                options={subjectCandidates.map(candidate => ({ value: candidate.id, label: subjectOptionLabel(candidate) }))}
                notFoundContent={chapterId ? '本章暂无对应候选' : '请先选择章节'}
              />
            )}
            <ImageModelSelector models={imageGenerationConfig.models} value={effectiveModelId} onChange={setModelId} />
          </Space>
        </Card>

        <Card title="提示词编辑" className="image-generation-panel image-generation-main">
          {missingRequiredChapter && <Alert style={{ marginBottom: 12 }} type="info" showIcon message="请先选择章节" description="章节服饰和章节道具提示词需要章节标题、摘要、场景信息和小段摘录作为上下文。" />}
          {missingRequiredSubject && !missingRequiredChapter && <Alert style={{ marginBottom: 12 }} type="info" showIcon message="请先选择章节候选主体" description="章节服饰和章节道具会按候选主体保存独立提示词记录，避免同一章节内多个素材互相覆盖。" />}
          <ImagePromptEditor
            record={recordForActions}
            value={promptText}
            editable={promptEditable}
            generatingPrompt={generatingPromptId === selectedPromptId}
            generatingImage={generatingImagePromptId === selectedPromptId}
            draftDisabled={missingRequiredChapter || missingRequiredSubject}
            saveDisabled={missingRequiredChapter || missingRequiredSubject}
            generateDisabled={Boolean(referenceGenerateBlockReason)}
            generateDisabledReason={referenceGenerateBlockReason}
            generationControls={referenceControls}
            onChange={text => setPromptDraft({ promptId: selectedPromptId, text })}
            onGenerateDraft={handleGenerateDraft}
            onSave={handleSave}
            onCopy={handleCopy}
            onGenerateImage={handleGenerateImage}
          />
        </Card>
      </div>

      <Card title="图片结果" style={{ marginTop: 16 }} extra={<Button size="small" icon={<ReloadOutlined />} loading={refreshingImages} onClick={handleRefreshImages}>刷新</Button>}>
        <ImageResultGallery key={galleryRefreshKey} images={images} editable={editable} onRetryUpload={retryImmichUpload} />
      </Card>
    </div>
  )
}
