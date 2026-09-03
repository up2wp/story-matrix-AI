import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, DatePicker, Empty, Input, Pagination, Popconfirm, Select, Space, Spin, Tag, Typography, message } from 'antd'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { canUseFeature } from '@/core/feature-permissions'
import type { FeaturePermissionSources } from '@/core/feature-permissions'
import ImageModelSelector from '@/features/image-generation/ImageModelSelector'
import ImageResultGallery from '@/features/image-generation/ImageResultGallery'
import type { GalleryImage } from '@/features/image-generation/ImageResultGallery'
import { ImagegenClientError, imagegenClient } from '@/features/imagegen/imagegenClient'
import type { ImagegenHistoryQuery, ImagegenHistoryResponse, ImagegenReferenceInput } from '@/features/imagegen/imagegenClient'

const { Paragraph, Text, Title } = Typography
const HISTORY_POLL_INTERVAL_MS = 3000
const DEFAULT_HISTORY_PAGE_SIZE = 10
const HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 50]

type ReferenceSlot = { readonly file: File; readonly previewUrl: string }
type RefreshHistoryOptions = ImagegenHistoryQuery & { readonly silent?: boolean }

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
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPromptInput, setHistoryPromptInput] = useState('')
  const [historyPrompt, setHistoryPrompt] = useState('')
  const [historyCreatedFrom, setHistoryCreatedFrom] = useState<number>()
  const [historyCreatedTo, setHistoryCreatedTo] = useState<number>()
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(DEFAULT_HISTORY_PAGE_SIZE)
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
  const historyRequestIdRef = useRef(0)
  const historyQueryRef = useRef<Required<Pick<ImagegenHistoryQuery, 'page' | 'pageSize'>> & Omit<ImagegenHistoryQuery, 'page' | 'pageSize'>>({
    page: 1,
    pageSize: DEFAULT_HISTORY_PAGE_SIZE,
    prompt: '',
    createdFrom: undefined,
    createdTo: undefined,
  })

  useEffect(() => {
    historyQueryRef.current = { page: historyPage, pageSize: historyPageSize, prompt: historyPrompt, createdFrom: historyCreatedFrom, createdTo: historyCreatedTo }
  }, [historyCreatedFrom, historyCreatedTo, historyPage, historyPageSize, historyPrompt])

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

  const refreshHistory = useCallback(async (options?: RefreshHistoryOptions) => {
    const currentQuery = historyQueryRef.current
    const page = options?.page ?? currentQuery.page
    const pageSize = options?.pageSize ?? currentQuery.pageSize
    const prompt = options && 'prompt' in options ? options.prompt : currentQuery.prompt
    const createdFrom = options && 'createdFrom' in options ? options.createdFrom : currentQuery.createdFrom
    const createdTo = options && 'createdTo' in options ? options.createdTo : currentQuery.createdTo
    historyQueryRef.current = { page, pageSize, prompt, createdFrom, createdTo }
    const requestId = historyRequestIdRef.current + 1
    historyRequestIdRef.current = requestId
    if (!options?.silent) setHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const nextHistory = await imagegenClient.history({ page, pageSize, prompt, createdFrom, createdTo })
      if (historyRequestIdRef.current !== requestId) return
      const visibleIds = new Set(nextHistory.items.map((record) => record.id))
      historyQueryRef.current = { ...historyQueryRef.current, page: nextHistory.page, pageSize: nextHistory.pageSize }
      setHistory([...nextHistory.items])
      setHistoryTotal(nextHistory.total)
      setHistoryPage(nextHistory.page)
      setHistoryPageSize(nextHistory.pageSize)
      setSelectedHistoryIds((current) => current.filter((id) => visibleIds.has(id)))
      if (nextHistory.items.some((record) => record.imageGenerationPermissionAutoDisabled)) await handleImageGenerationAutoDisabled()
    } catch (error) {
      if (historyRequestIdRef.current !== requestId) return
      setHistoryError(error instanceof ImagegenClientError ? error.message : '测试历史加载失败，请稍后重试。')
    } finally {
      if (historyRequestIdRef.current === requestId) setHistoryLoading(false)
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
    const intervalId = window.setInterval(() => {
      void refreshHistory({ silent: true })
    }, HISTORY_POLL_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
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
      await imagegenClient.generate({
        prompt,
        modelId: selectedModel.id,
        ...(size ? { size } : {}),
        ...(quality ? { quality } : {}),
        ...(format ? { format } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        referenceInputs,
        referenceFiles: selectedReferenceFiles,
      })
      setHistoryPage(1)
      void refreshHistory({ page: 1 })
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

  const handleHistoryPromptSearch = (value: string) => {
    const nextPrompt = value.trim()
    setHistoryPromptInput(nextPrompt)
    setHistoryPrompt(nextPrompt)
    setHistoryPage(1)
    void refreshHistory({ page: 1, prompt: nextPrompt })
  }

  const handleHistoryPromptInputChange = (value: string) => {
    setHistoryPromptInput(value)
    if (value || !historyPrompt) return
    setHistoryPrompt('')
    setHistoryPage(1)
    void refreshHistory({ page: 1, prompt: '' })
  }

  const handleHistoryRangeChange = (_dates: unknown, dateStrings: [string, string]) => {
    if (!dateStrings[0] || !dateStrings[1]) {
      setHistoryCreatedFrom(undefined)
      setHistoryCreatedTo(undefined)
      setHistoryPage(1)
      void refreshHistory({ page: 1, createdFrom: undefined, createdTo: undefined })
      return
    }

    const createdFrom = new Date(`${dateStrings[0]}T00:00:00.000`).getTime()
    const createdTo = new Date(`${dateStrings[1]}T23:59:59.999`).getTime()
    setHistoryCreatedFrom(createdFrom)
    setHistoryCreatedTo(createdTo)
    setHistoryPage(1)
    void refreshHistory({ page: 1, createdFrom, createdTo })
  }

  const handleHistoryPageChange = (page: number, pageSize: number) => {
    const nextPage = pageSize === historyPageSize ? page : 1
    setHistoryPage(nextPage)
    setHistoryPageSize(pageSize)
    void refreshHistory({ page: nextPage, pageSize })
  }

  const handleDeleteHistoryRecord = async (record: GalleryImage) => {
    setDeletingHistoryId(record.id)
    try {
      await imagegenClient.deleteHistory(record.id)
      setSelectedHistoryIds((current) => current.filter((historyId) => historyId !== record.id))
      const nextPage = visibleHistory.length === 1 && historyPage > 1 ? historyPage - 1 : historyPage
      setHistoryPage(nextPage)
      await refreshHistory({ page: nextPage })
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
      setSelectedHistoryIds([])
      const remainingVisibleCount = visibleHistory.filter((record) => !selectedIds.has(record.id)).length
      const nextPage = remainingVisibleCount === 0 && historyPage > 1 ? historyPage - 1 : historyPage
      setHistoryPage(nextPage)
      await refreshHistory({ page: nextPage })
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
      await imagegenClient.rerunHistory(record.id)
      setHistoryPage(1)
      void refreshHistory({ page: 1 })
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
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Space wrap size="small" style={{ width: '100%' }}>
                <Input.Search
                  value={historyPromptInput}
                  onChange={(event) => handleHistoryPromptInputChange(event.target.value)}
                  allowClear
                  placeholder="按提示词搜索测试历史"
                  onSearch={handleHistoryPromptSearch}
                  disabled={!canUseImagegen}
                />
                <DatePicker.RangePicker allowClear onChange={handleHistoryRangeChange} disabled={!canUseImagegen} />
              </Space>
              {visibleHistoryError ? (
                <Alert type="warning" showIcon message={visibleHistoryError} />
              ) : historyLoading && visibleHistory.length === 0 ? (
                <Spin />
              ) : visibleHistory.length ? (
                <ImageResultGallery images={galleryImages} showFailedPlaceholders showGeneratingPlaceholders
                  historySelection={{ selectedIds: selectedHistoryIds, onChange: handleHistorySelection }}
                  historyActions={{ onDelete: handleDeleteHistoryRecord, onRerun: handleRerunHistoryRecord, deletingId: deletingHistoryId, rerunningId: rerunningHistoryId }}
                  onShare={(record) => imagegenClient.shareHistory(record.id)}
                />
              ) : (
                <Empty description="暂无测试历史" />
              )}
              {historyTotal > 0 ? (
                <Pagination
                  current={historyPage}
                  pageSize={historyPageSize}
                  total={historyTotal}
                  showSizeChanger
                  pageSizeOptions={HISTORY_PAGE_SIZE_OPTIONS}
                  onChange={handleHistoryPageChange}
                  responsive
                />
              ) : null}
            </Space>
          </Card>
        </div>
      </Space>
    </main>
  )
}
