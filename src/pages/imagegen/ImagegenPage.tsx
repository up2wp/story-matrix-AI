import { DeleteOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography, message } from 'antd'
import type { ImageAssetRecord } from '@/core/types'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { canUseFeature } from '@/core/feature-permissions'
import type { FeaturePermissionSources } from '@/core/feature-permissions'
import ImageModelSelector from '@/features/image-generation/ImageModelSelector'
import ImageResultGallery from '@/features/image-generation/ImageResultGallery'
import { getImagegenReferenceAssetUrl, ImagegenClientError, imagegenClient } from '@/features/imagegen/imagegenClient'
import type { ImagegenHistoryResponse, ImagegenReferenceAssetResponse, ImagegenReferenceInput } from '@/features/imagegen/imagegenClient'

const { Paragraph, Text, Title } = Typography
const EMPTY_HISTORY: ImagegenHistoryResponse[] = []
const EMPTY_REFERENCE_ASSETS: ImagegenReferenceAssetResponse[] = []

type ReferenceSlot =
  | { readonly kind: 'empty'; readonly file: undefined; readonly previewUrl: undefined; readonly assetId: undefined }
  | { readonly kind: 'file'; readonly file: File; readonly previewUrl: string; readonly assetId: undefined }
  | { readonly kind: 'asset'; readonly file: undefined; readonly previewUrl: undefined; readonly assetId: string }

const EMPTY_REFERENCE_SLOT: ReferenceSlot = { kind: 'empty', file: undefined, previewUrl: undefined, assetId: undefined }

export default function ImagegenPage() {
  const user = useAuthStore(state => state.user)
  const novelImportConfig = useSystemConfigStore(state => state.novelImportConfig)
  const imageGenerationConfig = useSystemConfigStore(state => state.imageGenerationConfig)
  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [size, setSize] = useState<string>()
  const [quality, setQuality] = useState<string>()
  const [format, setFormat] = useState<string>()
  const [aspectRatio, setAspectRatio] = useState<string>()
  const [history, setHistory] = useState<ImagegenHistoryResponse[]>([])
  const [historyError, setHistoryError] = useState<string>()
  const [historyLoading, setHistoryLoading] = useState(false)
  const [referenceAssets, setReferenceAssets] = useState<ImagegenReferenceAssetResponse[]>([])
  const [storedReferenceSlots, setReferenceSlots] = useState<readonly ReferenceSlot[]>([])
  const [referenceAssetTargetSlot, setReferenceAssetTargetSlot] = useState<number>()
  const [referenceAssetsError, setReferenceAssetsError] = useState<string>()
  const [referenceAssetsLoading, setReferenceAssetsLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const referenceSlotsRef = useRef<readonly ReferenceSlot[]>([])

  const permissionSources: FeaturePermissionSources = {
    novelImportConfig,
    imageGenerationConfig: { enabled: imageGenerationConfig.enabled },
  }
  const imageGenerationEnabled = imageGenerationConfig.enabled
  const canUseImagegen = imageGenerationEnabled && canUseFeature(user, permissionSources, 'imageGeneration')
  const enabledModels = useMemo(() => imageGenerationConfig.models.filter(model => model.enabled), [imageGenerationConfig.models])
  const selectedModelId = modelId || imageGenerationConfig.defaultModelId
  const selectedModel = useMemo(() => enabledModels.find(model => model.id === selectedModelId), [enabledModels, selectedModelId])
  const maxReferenceImages = selectedModel?.capabilities.referenceImages
    ? Math.min(3, selectedModel.capabilities.maxReferenceImages || 0)
    : 0
  const supportsReferenceImages = maxReferenceImages > 0
  const canGenerate = canUseImagegen && Boolean(selectedModel) && Boolean(prompt.trim()) && !generating
  const visibleHistory = canUseImagegen ? history : EMPTY_HISTORY
  const visibleHistoryError = canUseImagegen ? historyError : undefined
  const visibleReferenceAssets = canUseImagegen ? referenceAssets : EMPTY_REFERENCE_ASSETS
  const visibleReferenceAssetsError = canUseImagegen ? referenceAssetsError : undefined
  const referenceSlots = useMemo(() => Array.from({ length: maxReferenceImages }, (_, index) => storedReferenceSlots[index] || EMPTY_REFERENCE_SLOT), [maxReferenceImages, storedReferenceSlots])
  const selectedReferenceCount = referenceSlots.filter(slot => slot.kind !== 'empty').length
  const referenceAssetsById = useMemo(() => new Map(visibleReferenceAssets.map(asset => [asset.id, asset])), [visibleReferenceAssets])
  const galleryImages = useMemo<ImageAssetRecord[]>(() => visibleHistory.map(record => ({
    id: record.id,
    promptId: record.id,
    promptSnapshot: record.prompt,
    generationPromptSnapshot: record.generationPromptSnapshot,
    provider: record.provider,
    modelId: record.modelId,
    modelName: record.modelName,
    mimeType: record.mimeType || 'image/*',
    storageMode: record.storageMode,
    storageStatus: record.storageStatus,
    localAssetId: record.localAssetId,
    immichAssetId: record.immichAssetId,
    immichFilename: record.immichFilename,
    thumbnailUrl: record.thumbnailUrl || '',
    originalUrl: record.originalUrl || '',
    createdAt: record.createdAt,
    status: record.status,
    error: record.error,
  })), [visibleHistory])

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(undefined)
    try {
      setHistory(await imagegenClient.history())
    } catch (error) {
      setHistoryError(error instanceof ImagegenClientError ? error.message : '测试历史加载失败，请稍后重试。')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const refreshReferenceAssets = useCallback(async () => {
    setReferenceAssetsLoading(true)
    setReferenceAssetsError(undefined)
    try {
      setReferenceAssets(await imagegenClient.referenceAssets())
    } catch (error) {
      setReferenceAssetsError(error instanceof ImagegenClientError ? error.message : '参考图片加载失败，请稍后重试。')
    } finally {
      setReferenceAssetsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canUseImagegen) return
    const timeoutId = window.setTimeout(() => {
      void refreshHistory()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [canUseImagegen, refreshHistory])

  useEffect(() => {
    if (!canUseImagegen) return
    const timeoutId = window.setTimeout(() => {
      void refreshReferenceAssets()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [canUseImagegen, refreshReferenceAssets])

  useEffect(() => {
    setReferenceSlots(current => {
      current.slice(maxReferenceImages).forEach(slot => {
        if (slot.kind === 'file') URL.revokeObjectURL(slot.previewUrl)
      })
      return current.slice(0, maxReferenceImages)
    })
    setReferenceAssetTargetSlot(current => current !== undefined && current >= maxReferenceImages ? undefined : current)
  }, [maxReferenceImages])

  useEffect(() => {
    referenceSlotsRef.current = storedReferenceSlots
  }, [storedReferenceSlots])

  useEffect(() => () => {
    referenceSlotsRef.current.forEach(slot => {
      if (slot.kind === 'file') URL.revokeObjectURL(slot.previewUrl)
    })
  }, [])

  const replaceReferenceSlot = (slotIndex: number, nextSlot: ReferenceSlot) => {
    setReferenceSlots(current => {
      const currentSlot = current[slotIndex]
      if (currentSlot?.kind === 'file') URL.revokeObjectURL(currentSlot.previewUrl)
      const nextSlots = [...current]
      nextSlots[slotIndex] = nextSlot
      return nextSlots
    })
  }

  const handleReferenceFileSelection = (slotIndex: number, file: File | undefined) => {
    if (!file || !canUseImagegen || !supportsReferenceImages || generating) return

    const previewUrl = URL.createObjectURL(file)
    setReferenceSlots(current => {
      const currentSlot = current[slotIndex]
      if (currentSlot?.kind === 'file') URL.revokeObjectURL(currentSlot.previewUrl)
      const nextSlots = [...current]
      nextSlots[slotIndex] = { kind: 'file', file, previewUrl, assetId: undefined }
      return nextSlots
    })
    setReferenceAssetTargetSlot(undefined)
  }

  const handleReferenceFileRemoval = (slotIndex: number) => {
    if (!canUseImagegen || !supportsReferenceImages || generating) return

    replaceReferenceSlot(slotIndex, { kind: 'empty', file: undefined, previewUrl: undefined, assetId: undefined })
  }

  const handleReferenceAssetSelection = (slotIndex: number, assetId: string) => {
    if (!canUseImagegen || !supportsReferenceImages || generating) return

    replaceReferenceSlot(slotIndex, { kind: 'asset', file: undefined, previewUrl: undefined, assetId })
    setReferenceAssetTargetSlot(undefined)
  }

  const handleGenerate = async () => {
    if (!selectedModel || !canGenerate) return

    const selectedReferenceFiles: File[] = []
    const referenceInputs: ImagegenReferenceInput[] = []
    referenceSlots.forEach(slot => {
      switch (slot.kind) {
        case 'asset':
          referenceInputs.push({ kind: 'asset', id: slot.assetId })
          break
        case 'file': {
          const fileIndex = selectedReferenceFiles.length
          selectedReferenceFiles.push(slot.file)
          referenceInputs.push({ kind: 'file', index: fileIndex })
          break
        }
        case 'empty':
          break
      }
    })

    setGenerating(true)
    try {
      const generated = await imagegenClient.generate({
        prompt,
        modelId: selectedModel.id,
        ...(size ? { size } : {}),
        ...(quality ? { quality } : {}),
        ...(format ? { format } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        referenceInputs,
        referenceFiles: selectedReferenceFiles,
      })
      setHistory(current => [generated, ...current.filter(record => record.id !== generated.id)])
      message.success('测试图片已生成')
    } catch (error) {
      message.error(error instanceof ImagegenClientError ? error.message : '测试图片生成失败，请稍后重试。')
    } finally {
      setGenerating(false)
      void refreshHistory()
      void refreshReferenceAssets()
    }
  }

  let availabilityAlert: { message: string; description: string } | undefined
  if (!imageGenerationEnabled) {
    availabilityAlert = { message: '生图测试台已关闭', description: '请联系管理员在系统管理中开启生图功能。' }
  } else if (!canUseImagegen) {
    availabilityAlert = { message: '当前账号未授权生图', description: '请联系管理员为你的账号开启生图权限。' }
  } else if (enabledModels.length === 0) {
    availabilityAlert = { message: '暂无可用生图模型', description: '请联系管理员启用至少一个生图模型。' }
  }

  return (
    <main className="image-generation-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>生图测试</Title>
          <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
            直接测试已启用模型。测试结果只保存在当前账号的测试历史中，不会写入作品视觉资产。
          </Paragraph>
        </div>
        <Tag color={canUseImagegen ? 'blue' : 'default'}>{canUseImagegen ? '可用' : '不可用'}</Tag>
      </div>

      <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 16 }}>
        {availabilityAlert && <Alert type="warning" showIcon message={availabilityAlert.message} description={availabilityAlert.description} />}

        <div className="image-generation-layout">
          <Card className="image-generation-panel" size="small" title="生成设置">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Text strong>提示词</Text>
                <Input.TextArea
                  value={prompt}
                  onChange={event => setPrompt(event.target.value)}
                  disabled={!canUseImagegen || generating}
                  autoSize={{ minRows: 6, maxRows: 14 }}
                  placeholder="输入要测试的图片提示词"
                  style={{ marginTop: 8 }}
                />
              </div>
              <div>
                <Text strong>模型</Text>
                <div style={{ marginTop: 8 }}>
                  <ImageModelSelector
                    models={imageGenerationConfig.models}
                    value={selectedModelId || undefined}
                    onChange={setModelId}
                    disabled={!canUseImagegen || generating}
                  />
                </div>
              </div>
              {selectedModel?.capabilities.sizes.length ? (
                <Select
                  value={size}
                  onChange={value => setSize(value)}
                  allowClear
                  disabled={!canUseImagegen || generating}
                  placeholder="尺寸（可选）"
                  options={selectedModel.capabilities.sizes.map(value => ({ value, label: value }))}
                />
              ) : null}
              {selectedModel?.capabilities.qualities.length ? (
                <Select
                  value={quality}
                  onChange={value => setQuality(value)}
                  allowClear
                  disabled={!canUseImagegen || generating}
                  placeholder="质量（可选）"
                  options={selectedModel.capabilities.qualities.map(value => ({ value, label: value }))}
                />
              ) : null}
              {selectedModel?.capabilities.formats.length ? (
                <Select
                  value={format}
                  onChange={value => setFormat(value)}
                  allowClear
                  disabled={!canUseImagegen || generating}
                  placeholder="格式（可选）"
                  options={selectedModel.capabilities.formats.map(value => ({ value, label: value }))}
                />
              ) : null}
              {selectedModel?.capabilities.aspectRatios?.length ? (
                <Select
                  value={aspectRatio}
                  onChange={value => setAspectRatio(value)}
                  allowClear
                  disabled={!canUseImagegen || generating}
                  placeholder="比例（可选）"
                  options={selectedModel.capabilities.aspectRatios.map(value => ({ value, label: value }))}
                />
              ) : null}
              <div>
                <Text strong>参考图片</Text>
                <Paragraph type="secondary" style={{ margin: '4px 0 8px' }}>
                  {supportsReferenceImages
                    ? `最多 ${maxReferenceImages} 张，可选择本地图片或已保存图片（已选 ${selectedReferenceCount} 张）。`
                    : selectedModel ? '当前模型不支持参考图片。' : '请选择支持参考图片的模型。'}
                </Paragraph>
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  {supportsReferenceImages ? (
                    <div className="image-reference-slots">
                      {referenceSlots.map((slot, slotIndex) => {
                        const asset = slot.kind === 'asset' ? referenceAssetsById.get(slot.assetId) : undefined
                        const controlsDisabled = !canUseImagegen || generating
                        const slotContent = (() => {
                          switch (slot.kind) {
                            case 'file':
                              return <img className="image-reference-slot-preview" src={slot.previewUrl} alt={`本地参考图 ${slotIndex + 1}`} />
                            case 'asset':
                              return asset ? <img className="image-reference-slot-preview" src={getImagegenReferenceAssetUrl(asset)} alt={`已保存参考图 ${slotIndex + 1}`} /> : <div className="image-reference-slot-empty">已保存图片不可用</div>
                            case 'empty':
                              return <div className="image-reference-slot-empty">未选择图片</div>
                          }
                        })()
                        return (
                          <div key={slotIndex} className="image-reference-slot">
                            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                              <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Text strong>参考图 {slotIndex + 1}</Text>
                                <Tag>{slot.kind === 'file' ? '本地' : slot.kind === 'asset' ? '已保存' : '空槽'}</Tag>
                              </Space>
                              {slotContent}
                              {slot.kind === 'file' ? <Text className="image-reference-slot-file" type="secondary" ellipsis>{slot.file.name}</Text> : null}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                disabled={controlsDisabled}
                                onChange={event => {
                                  const file = event.target.files?.[0]
                                  event.target.value = ''
                                  handleReferenceFileSelection(slotIndex, file)
                                }}
                              />
                              <Space wrap>
                                <Button size="small" disabled={controlsDisabled} onClick={() => setReferenceAssetTargetSlot(slotIndex)}>选择已保存图片</Button>
                                {slot.kind !== 'empty' ? <Button size="small" danger icon={<DeleteOutlined />} disabled={controlsDisabled} onClick={() => handleReferenceFileRemoval(slotIndex)}>移除</Button> : null}
                              </Space>
                            </Space>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  {visibleReferenceAssetsError ? <Alert type="warning" showIcon message={visibleReferenceAssetsError} /> : null}
                  {referenceAssetsLoading ? <Spin size="small" /> : visibleReferenceAssets.length ? (
                    <div className="image-reference-asset-picker">
                      <Text type="secondary">{referenceAssetTargetSlot === undefined ? '选择一个参考图槽位后，可复用已保存图片。' : `正在选择参考图 ${referenceAssetTargetSlot + 1}。`}</Text>
                      <div className="image-reference-grid">
                      {visibleReferenceAssets.map(asset => {
                        const isSelected = referenceSlots.some(slot => slot.kind === 'asset' && slot.assetId === asset.id)
                        const isDisabled = !canUseImagegen || !supportsReferenceImages || generating || referenceAssetTargetSlot === undefined
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            className={`image-reference-option image-reference-asset-option${isSelected ? ' is-selected' : ''}${isDisabled ? ' is-disabled' : ''}`}
                            disabled={isDisabled}
                            aria-pressed={isSelected}
                            onClick={() => {
                              if (referenceAssetTargetSlot !== undefined) handleReferenceAssetSelection(referenceAssetTargetSlot, asset.id)
                            }}
                          >
                            <img src={getImagegenReferenceAssetUrl(asset)} alt="已上传参考图片" />
                            <span className="image-reference-label">{isSelected ? '已选用' : '选择图片'}</span>
                          </button>
                        )
                      })}
                      </div>
                    </div>
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已保存参考图片" />}
                </Space>
              </div>
              <Button type="primary" loading={generating} disabled={!canGenerate} onClick={handleGenerate}>
                生成测试图片
              </Button>
            </Space>
          </Card>

          <Card
            className="image-generation-panel image-generation-main"
            size="small"
            title="测试历史"
            extra={<Button size="small" loading={historyLoading} disabled={!canUseImagegen} onClick={() => void refreshHistory()}>刷新</Button>}
          >
            {visibleHistoryError ? <Alert type="warning" showIcon message={visibleHistoryError} /> : historyLoading && visibleHistory.length === 0 ? <Spin /> : visibleHistory.length ? (
              <ImageResultGallery images={galleryImages} showFailedPlaceholders />
            ) : <Empty description="暂无测试历史" />}
          </Card>
        </div>
      </Space>
    </main>
  )
}
