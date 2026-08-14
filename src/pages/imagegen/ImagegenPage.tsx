import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Popconfirm, Select, Space, Spin, Tag, Typography, message } from 'antd'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { canUseFeature } from '@/core/feature-permissions'
import type { FeaturePermissionSources } from '@/core/feature-permissions'
import ImageModelSelector from '@/features/image-generation/ImageModelSelector'
import ImageResultGallery from '@/features/image-generation/ImageResultGallery'
import type { GalleryImage } from '@/features/image-generation/ImageResultGallery'
import { ImagegenClientError, imagegenClient } from '@/features/imagegen/imagegenClient'
import type { ImagegenHistoryResponse, ImagegenReferenceInput } from '@/features/imagegen/imagegenClient'

const { Paragraph, Text, Title } = Typography
const HISTORY_POLL_INTERVAL_MS = 3000

type ReferenceSlot = { readonly file: File; readonly previewUrl: string }

export default function ImagegenPage() {
  const user = useAuthStore((state) => state.user)
  const novelImportConfig = useSystemConfigStore((state) => state.novelImportConfig)
  const imageGenerationConfig = useSystemConfigStore((state) => state.imageGenerationConfig)
  const loadConfig = useSystemConfigStore((state) => state.loadConfig)
  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [size, setSize] = useState<string>()
  const [quality, setQuality] = useState<string>()
  const [format, setFormat] = useState<string>()
  const [aspectRatio, setAspectRatio] = useState<string>()
  const [history, setHistory] = useState<ImagegenHistoryResponse[]>([])
  const [historyError, setHistoryError] = useState<string>()
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<readonly string[]>([])
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null)
  const [deletingSelectedHistory, setDeletingSelectedHistory] = useState(false)
  const [rerunningHistoryId, setRerunningHistoryId] = useState<string | null>(null)
  const [storedReferenceSlots, setReferenceSlots] = useState<readonly ReferenceSlot[]>([])
  const [submitting, setSubmitting] = useState(false)
  const referenceSlotsRef = useRef<readonly ReferenceSlot[]>([])
  const autoDisabledNotifiedRef = useRef(false)

  const permissionSources: FeaturePermissionSources = {
    novelImportConfig,
    imageGenerationConfig: { enabled: imageGenerationConfig.enabled },
  }
  const imageGenerationEnabled = imageGenerationConfig.enabled
  const canUseImagegen = imageGenerationEnabled && canUseFeature(user, permissionSources, 'imageGeneration')
  const enabledModels = useMemo(() => imageGenerationConfig.models.filter((model) => model.enabled), [imageGenerationConfig.models])
  const selectedModelId = modelId || imageGenerationConfig.defaultModelId
  const selectedModel = useMemo(() => enabledModels.find((model) => model.id === selectedModelId), [enabledModels, selectedModelId])
  const maxReferenceImages = selectedModel?.capabilities.referenceImages ? Math.min(3, selectedModel.capabilities.maxReferenceImages || 0) : 0
  const supportsReferenceImages = maxReferenceImages > 0
  const canGenerate = canUseImagegen && Boolean(selectedModel) && Boolean(prompt.trim()) && !submitting
  const visibleHistory = history
  const visibleHistoryError = historyError
  const hasGeneratingHistory = visibleHistory.some((record) => record.status === 'generating')
  const selectedReferenceSlots = useMemo(() => storedReferenceSlots.slice(0, maxReferenceImages), [maxReferenceImages, storedReferenceSlots])
  const selectedReferenceCount = selectedReferenceSlots.length
  const galleryImages = useMemo<GalleryImage[]>(
    () =>
      visibleHistory.map((record) => ({
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
        referenceImages: record.referenceImages,
      })),
    [visibleHistory],
  )

  const handleImageGenerationAutoDisabled = useCallback(async () => {
    await loadConfig()
    if (autoDisabledNotifiedRef.current) return
    autoDisabledNotifiedRef.current = true
    message.warning('多次非超时生图失败后，当前账号的生图权限已自动关闭，请联系管理员恢复。')
  }, [loadConfig])

  const refreshHistory = useCallback(async (options?: { readonly silent?: boolean }) => {
    if (!options?.silent) setHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const nextHistory = await imagegenClient.history()
      setHistory(nextHistory)
      if (nextHistory.some((record) => record.imageGenerationPermissionAutoDisabled)) await handleImageGenerationAutoDisabled()
    } catch (error) {
      setHistoryError(error instanceof ImagegenClientError ? error.message : '测试历史加载失败，请稍后重试。')
    } finally {
      if (!options?.silent) setHistoryLoading(false)
    }
  }, [handleImageGenerationAutoDisabled])

  useEffect(() => {
    if (canUseImagegen) autoDisabledNotifiedRef.current = false
  }, [canUseImagegen])

  useEffect(() => {
    if (!canUseImagegen) return
    const timeoutId = window.setTimeout(() => {
      void refreshHistory()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [canUseImagegen, refreshHistory])

  useEffect(() => {
    if (!canUseImagegen || !hasGeneratingHistory) return
    const timeoutId = window.setTimeout(() => {
      void refreshHistory({ silent: true })
    }, HISTORY_POLL_INTERVAL_MS)
    return () => window.clearTimeout(timeoutId)
  }, [canUseImagegen, hasGeneratingHistory, refreshHistory])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setReferenceSlots((current) => {
        current.slice(maxReferenceImages).forEach((slot) => {
          URL.revokeObjectURL(slot.previewUrl)
        })
        return current.slice(0, maxReferenceImages)
      })
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [maxReferenceImages])

  useEffect(() => {
    referenceSlotsRef.current = storedReferenceSlots
  }, [storedReferenceSlots])

  useEffect(
    () => () => {
      referenceSlotsRef.current.forEach((slot) => {
        URL.revokeObjectURL(slot.previewUrl)
      })
    },
    [],
  )

  const handleReferenceFileSelection = (file: File | undefined) => {
    if (!file || !canUseImagegen || !supportsReferenceImages) return

    const previewUrl = URL.createObjectURL(file)
    setReferenceSlots((current) => {
      if (current.length >= maxReferenceImages) {
        URL.revokeObjectURL(previewUrl)
        return current
      }
      return [...current, { file, previewUrl }]
    })
  }

  const handleReferenceFileRemoval = (slotIndex: number) => {
    if (!canUseImagegen || !supportsReferenceImages) return

    setReferenceSlots((current) => {
      const removedSlot = current[slotIndex]
      if (!removedSlot) return current
      URL.revokeObjectURL(removedSlot.previewUrl)
      return current.filter((_, index) => index !== slotIndex)
    })
  }

  const handleGenerate = async () => {
    if (!selectedModel || !canGenerate) return

    const selectedReferenceFiles = selectedReferenceSlots.map((slot) => slot.file)
    const referenceInputs: ImagegenReferenceInput[] = selectedReferenceFiles.map((_, index) => ({ kind: 'file', index }))

    setSubmitting(true)
    try {
      const queued = await imagegenClient.generate({
        prompt,
        modelId: selectedModel.id,
        ...(size ? { size } : {}),
        ...(quality ? { quality } : {}),
        ...(format ? { format } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        referenceInputs,
        referenceFiles: selectedReferenceFiles,
      })
      setHistory((current) => [queued, ...current.filter((record) => record.id !== queued.id)])
      message.success('测试图片已开始生成')
    } catch (error) {
      if (error instanceof ImagegenClientError) {
        if (error.imageGenerationPermissionAutoDisabled) await handleImageGenerationAutoDisabled()
        else {
          if (error.status === 403) await loadConfig()
          message.error(error.message)
        }
      } else {
        message.error('测试图片生成失败，请稍后重试。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleHistorySelection = (id: string, selected: boolean) => {
    setSelectedHistoryIds((current) => selected ? [...current, id] : current.filter((historyId) => historyId !== id))
  }

  const handleDeleteHistoryRecord = async (record: GalleryImage) => {
    setDeletingHistoryId(record.id)
    try {
      await imagegenClient.deleteHistory(record.id)
      setHistory((current) => current.filter((historyRecord) => historyRecord.id !== record.id))
      setSelectedHistoryIds((current) => current.filter((historyId) => historyId !== record.id))
      message.success('测试历史已删除')
    } catch (error) {
      message.error(error instanceof ImagegenClientError ? error.message : '测试历史删除失败，请稍后重试。')
    } finally {
      setDeletingHistoryId(null)
    }
  }

  const handleDeleteSelectedHistory = async () => {
    if (!selectedHistoryIds.length) return

    setDeletingSelectedHistory(true)
    try {
      await imagegenClient.deleteHistoryBatch(selectedHistoryIds)
      const selectedIds = new Set(selectedHistoryIds)
      setHistory((current) => current.filter((record) => !selectedIds.has(record.id)))
      setSelectedHistoryIds([])
      message.success('已删除选中的测试历史')
    } catch (error) {
      message.error(error instanceof ImagegenClientError ? error.message : '批量删除测试历史失败，请稍后重试。')
    } finally {
      setDeletingSelectedHistory(false)
    }
  }

  const handleRerunHistoryRecord = async (record: GalleryImage) => {
    setRerunningHistoryId(record.id)
    try {
      const rerun = await imagegenClient.rerunHistory(record.id)
      setHistory((current) => [rerun, ...current.filter((record) => record.id !== rerun.id)])
      message.success('已按历史记录再次生成')
    } catch (error) {
      if (error instanceof ImagegenClientError) {
        if (error.imageGenerationPermissionAutoDisabled) await handleImageGenerationAutoDisabled()
        else {
          if (error.status === 403) await loadConfig()
          message.error(error.message)
        }
      } else {
        message.error('再次生成失败，请稍后重试。')
      }
    } finally {
      setRerunningHistoryId(null)
    }
  }

  let availabilityAlert: { message: string; description: string } | undefined
  if (!imageGenerationEnabled) {
    availabilityAlert = {
      message: '生图测试台已关闭',
      description: '请联系管理员在系统管理中开启生图功能。',
    }
  } else if (!canUseImagegen) {
    availabilityAlert = {
      message: '当前账号未授权生图',
      description: '请联系管理员为你的账号开启或恢复生图权限。',
    }
  } else if (enabledModels.length === 0) {
    availabilityAlert = {
      message: '暂无可用生图模型',
      description: '请联系管理员启用至少一个生图模型。',
    }
  }

  return (
    <main className="image-generation-page">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            生图测试
          </Title>
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
                  onChange={(event) => setPrompt(event.target.value)}
                  disabled={!canUseImagegen}
                  autoSize={{ minRows: 6, maxRows: 14 }}
                  placeholder="输入要测试的图片提示词"
                  style={{ marginTop: 8 }}
                />
              </div>
              <div>
                <Text strong>模型</Text>
                <div style={{ marginTop: 8 }}>
                  <ImageModelSelector models={imageGenerationConfig.models} value={selectedModelId || undefined} onChange={setModelId} disabled={!canUseImagegen} />
                </div>
              </div>
              {selectedModel?.capabilities.sizes.length ? (
                <Select
                  value={size}
                  onChange={(value) => setSize(value)}
                  allowClear
                  disabled={!canUseImagegen}
                  placeholder="尺寸（可选）"
                  options={selectedModel.capabilities.sizes.map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              ) : null}
              {selectedModel?.capabilities.qualities.length ? (
                <Select
                  value={quality}
                  onChange={(value) => setQuality(value)}
                  allowClear
                  disabled={!canUseImagegen}
                  placeholder="质量（可选）"
                  options={selectedModel.capabilities.qualities.map((value) => ({ value, label: value }))}
                />
              ) : null}
              {selectedModel?.capabilities.formats.length ? (
                <Select
                  value={format}
                  onChange={(value) => setFormat(value)}
                  allowClear
                  disabled={!canUseImagegen}
                  placeholder="格式（可选）"
                  options={selectedModel.capabilities.formats.map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              ) : null}
              {selectedModel?.capabilities.aspectRatios?.length ? (
                <Select
                  value={aspectRatio}
                  onChange={(value) => setAspectRatio(value)}
                  allowClear
                  disabled={!canUseImagegen}
                  placeholder="比例（可选）"
                  options={selectedModel.capabilities.aspectRatios.map((value) => ({ value, label: value }))}
                />
              ) : null}
              <div>
                <Text strong>参考图片</Text>
                <Paragraph type="secondary" style={{ margin: '4px 0 8px' }}>
                  {supportsReferenceImages ? `最多 ${maxReferenceImages} 张，已选 ${selectedReferenceCount} 张。` : selectedModel ? '当前模型不支持参考图片。' : '请选择支持参考图片的模型。'}
                </Paragraph>
                {supportsReferenceImages ? (
                  <div className="image-reference-upload-grid">
                    {selectedReferenceSlots.map((slot, slotIndex) => (
                      <div key={slot.previewUrl} className="image-reference-upload-tile">
                        <img src={slot.previewUrl} alt={`本地参考图 ${slotIndex + 1}`} />
                        <Button
                          aria-label={`移除参考图 ${slotIndex + 1}`}
                          className="image-reference-remove-button"
                          danger
                          disabled={!canUseImagegen}
                          icon={<DeleteOutlined />}
                          onClick={() => handleReferenceFileRemoval(slotIndex)}
                          shape="circle"
                          size="small"
                          type="primary"
                        />
                      </div>
                    ))}
                    {selectedReferenceCount < maxReferenceImages ? (
                      <label className="image-reference-upload-tile image-reference-add-tile">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={!canUseImagegen}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            event.target.value = ''
                            handleReferenceFileSelection(file)
                          }}
                        />
                        <PlusOutlined />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Button type="primary" loading={submitting} disabled={!canGenerate} onClick={handleGenerate}>
                生成测试图片
              </Button>
            </Space>
          </Card>

          <Card
            className="image-generation-panel image-generation-main"
            size="small"
            title="测试历史"
            extra={
              <Space size="small">
                {selectedHistoryIds.length ? (
                  <Popconfirm title={`删除已选 ${selectedHistoryIds.length} 条测试历史?`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={handleDeleteSelectedHistory}>
                    <Button size="small" danger loading={deletingSelectedHistory}>
                      删除已选
                    </Button>
                  </Popconfirm>
                ) : null}
                <Button size="small" loading={historyLoading} disabled={!canUseImagegen} onClick={() => void refreshHistory()}>
                  刷新
                </Button>
              </Space>
            }
          >
            {visibleHistoryError ? (
              <Alert type="warning" showIcon message={visibleHistoryError} />
            ) : historyLoading && visibleHistory.length === 0 ? (
              <Spin />
            ) : visibleHistory.length ? (
              <ImageResultGallery images={galleryImages} showFailedPlaceholders showGeneratingPlaceholders
                historySelection={{ selectedIds: selectedHistoryIds, onChange: handleHistorySelection }}
                historyActions={{ onDelete: handleDeleteHistoryRecord, onRerun: handleRerunHistoryRecord, deletingId: deletingHistoryId, rerunningId: rerunningHistoryId }}
              />
            ) : (
              <Empty description="暂无测试历史" />
            )}
          </Card>
        </div>
      </Space>
    </main>
  )
}
