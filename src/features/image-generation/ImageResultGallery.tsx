import { useState } from 'react'
import { CopyOutlined, DeleteOutlined, LinkOutlined, LoadingOutlined, PictureOutlined, ReloadOutlined, ShareAltOutlined } from '@ant-design/icons'
import { Button, Card, Checkbox, Empty, Image, Input, Modal, message, Popconfirm, Space, Tag, Typography } from 'antd'
import type { ImageAssetRecord, ImagegenHistoryStatus, ImagegenReferenceImageSummary } from '@/core/types'
import { getImageAssetDisplayUrl } from './imageGenerationClient'

const { Paragraph, Text } = Typography

export type GalleryImage = Omit<ImageAssetRecord, 'status' | 'storageStatus'> & {
  readonly status: ImagegenHistoryStatus
  readonly storageStatus: ImagegenHistoryStatus
  readonly referenceImages?: readonly ImagegenReferenceImageSummary[]
}

export interface ImageShareResult {
  readonly publicUrl: string
  readonly expiresAt: string
}

function isImageAssetRecord(image: GalleryImage): image is ImageAssetRecord & GalleryImage {
  return image.status !== 'generating' && image.storageStatus !== 'generating'
}

function isShareableImmichImage(image: GalleryImage): image is ImageAssetRecord & GalleryImage {
  return image.storageMode === 'immich' && image.status === 'succeeded' && image.storageStatus === 'succeeded'
}

interface Props {
  images: readonly GalleryImage[]
  editable?: boolean
  onRetryUpload?: (image: ImageAssetRecord) => void
  onDelete?: (image: ImageAssetRecord) => void
  onShare?: (image: ImageAssetRecord) => Promise<ImageShareResult | undefined>
  deletingImageId?: string | null
  showGeneratingPlaceholders?: boolean
  showFailedPlaceholders?: boolean
  historySelection?: {
    readonly selectedIds: readonly string[]
    readonly onChange: (id: string, selected: boolean) => void
  }
  historyActions?: {
    readonly onDelete: (image: GalleryImage) => void
    readonly onRerun: (image: GalleryImage) => void
    readonly deletingId?: string | null
    readonly rerunningId?: string | null
  }
}

async function copyProviderPrompt(generationPromptSnapshot: string) {
  try {
    await navigator.clipboard.writeText(generationPromptSnapshot)
    message.success('已复制实际调用提示词')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制失败')
  }
}

async function copyPublicShareUrl(publicUrl: string) {
  await navigator.clipboard.writeText(publicUrl)
}

export default function ImageResultGallery({ images, editable, onRetryUpload, onDelete, onShare, deletingImageId, showGeneratingPlaceholders = false, showFailedPlaceholders = false, historySelection, historyActions }: Props) {
  const [loadFailures, setLoadFailures] = useState<Record<string, boolean>>({})
  const [selectedImage, setSelectedImage] = useState<GalleryImage>()
  const [sharingImageIds, setSharingImageIds] = useState<Record<string, boolean>>({})
  const [sharedLink, setSharedLink] = useState<ImageShareResult>()
  const visibleImages = images.filter((image) => (showGeneratingPlaceholders && image.status === 'generating' && !getImageAssetDisplayUrl(image)) || (showFailedPlaceholders && image.status === 'failed' && !getImageAssetDisplayUrl(image)) || (getImageAssetDisplayUrl(image) && !loadFailures[image.id]))
  const handleShareImage = async (image: ImageAssetRecord) => {
    if (!onShare) return
    setSharingImageIds((current) => ({ ...current, [image.id]: true }))
    try {
      const result = await onShare(image)
      if (!result) return
      setSharedLink(result)
      try {
        await copyPublicShareUrl(result.publicUrl)
        message.success('公开链接已复制')
      } catch (error) {
        message.warning(error instanceof Error ? `无法自动复制：${error.message}` : '无法自动复制，请手动复制链接')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建公开链接失败')
    } finally {
      setSharingImageIds((current) => ({ ...current, [image.id]: false }))
    }
  }
  const handleCopySharedLink = async () => {
    if (!sharedLink) return
    try {
      await copyPublicShareUrl(sharedLink.publicUrl)
      message.success('公开链接已复制')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '复制公开链接失败')
    }
  }
  if (!visibleImages.length) return <Empty description="暂无可展示的图片结果" />
  return (
    <>
      <div className="image-result-grid">
        {visibleImages.map((image) => {
          const displayUrl = getImageAssetDisplayUrl(image)
          const originalUrl = getImageAssetDisplayUrl(image, 'original')
          const isGeneratingWithoutImage = image.status === 'generating' && !displayUrl
          const isFailedWithoutImage = image.status === 'failed' && !displayUrl
          const cover = isGeneratingWithoutImage ? (
            <div className="image-result-generating-cover">
              <LoadingOutlined />
              <Text type="secondary">正在生成</Text>
            </div>
          ) : isFailedWithoutImage ? (
            <div className="image-result-failed-cover">
              <PictureOutlined />
              <Text type="secondary">未生成图片</Text>
            </div>
          ) : (
            <Image src={displayUrl} preview={originalUrl ? { src: originalUrl } : false} alt="生成图片" style={{ objectFit: 'cover', maxHeight: 260 }} onError={() => setLoadFailures((current) => ({ ...current, [image.id]: true }))} />
          )
          return (
            <Card key={image.id} size="small" cover={cover} className={isGeneratingWithoutImage ? 'image-result-generating-card' : isFailedWithoutImage ? 'image-result-failed-card' : undefined}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space wrap>
                  {historySelection && (
                    <Checkbox checked={historySelection.selectedIds.includes(image.id)} onChange={(event) => historySelection.onChange(image.id, event.target.checked)}>
                      选择
                    </Checkbox>
                  )}
                  <Tag>{image.modelName}</Tag>
                  {isGeneratingWithoutImage ? (
                    <Tag color="processing">生成中</Tag>
                  ) : isFailedWithoutImage ? (
                    <Tag color="error">生成失败</Tag>
                  ) : (
                    <>
                      <Tag>{image.mimeType}</Tag>
                      <Tag>{image.storageMode === 'immich' ? 'Immich' : '本地'}</Tag>
                    </>
                  )}
                </Space>
                <Button size="small" disabled={isGeneratingWithoutImage} onClick={() => setSelectedImage(image)}>
                  查看详情
                </Button>
                {onShare && isShareableImmichImage(image) && (
                  <Button size="small" icon={<ShareAltOutlined />} loading={Boolean(sharingImageIds[image.id])} onClick={() => void handleShareImage(image)}>
                    分享
                  </Button>
                )}
                {!isGeneratingWithoutImage && !isFailedWithoutImage && image.status !== 'succeeded' && <Text type="danger">{image.error || '图片存储未完成，可稍后重试'}</Text>}
                {!isGeneratingWithoutImage && !isFailedWithoutImage && image.generationPromptSnapshot && (
                  <div>
                    <Space align="center" style={{ marginBottom: 4 }}>
                      <Text type="secondary">实际调用提示词</Text>
                      <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copyProviderPrompt(image.generationPromptSnapshot || '')}>
                        复制
                      </Button>
                    </Space>
                    <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }} style={{ marginBottom: 0 }}>
                      {image.generationPromptSnapshot}
                    </Paragraph>
                  </div>
                )}
                {editable && (
                  <Space wrap>
                    {image.storageMode === 'immich' && isImageAssetRecord(image) && image.status !== 'succeeded' && (
                      <Button size="small" onClick={() => onRetryUpload?.(image)}>
                        重传到 Immich
                      </Button>
                    )}
                    <Popconfirm title="删除这张图片资产？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => isImageAssetRecord(image) && onDelete?.(image)}>
                      <Button size="small" danger icon={<DeleteOutlined />} loading={deletingImageId === image.id}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
                {historyActions && (
                  <Space wrap>
                    <Popconfirm title="删除这条测试历史？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => historyActions.onDelete(image)}>
                      <Button size="small" danger icon={<DeleteOutlined />} loading={historyActions.deletingId === image.id} disabled={historyActions.rerunningId === image.id}>
                        删除
                      </Button>
                    </Popconfirm>
                    <Button size="small" icon={<ReloadOutlined />} loading={historyActions.rerunningId === image.id} disabled={historyActions.deletingId === image.id || isGeneratingWithoutImage} onClick={() => historyActions.onRerun(image)}>
                      再次生成
                    </Button>
                  </Space>
                )}
                <Text type="secondary">{new Date(image.createdAt).toLocaleString('zh-CN')}</Text>
              </Space>
            </Card>
          )
        })}
      </div>
      <Modal title="图片详情" open={Boolean(selectedImage)} footer={null} onCancel={() => setSelectedImage(undefined)}>
        {selectedImage ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Text type="secondary">{new Date(selectedImage.createdAt).toLocaleString('zh-CN')}</Text>
            <div>
              <Text strong>提示词</Text>
              <Paragraph className="image-result-failed-detail">{selectedImage.generationPromptSnapshot || selectedImage.promptSnapshot}</Paragraph>
            </div>
            <div>
              <Text strong>错误信息</Text>
              <Paragraph className="image-result-failed-detail">{selectedImage.error || '无'}</Paragraph>
            </div>
            {selectedImage.referenceImages?.length ? (
              <div>
                <Text strong>参考图片</Text>
                <div className="image-result-reference-grid">
                  {selectedImage.referenceImages.map((referenceImage) => (
                    <Image key={referenceImage.id} alt="参考图片" preview={{ src: referenceImage.originalUrl }} src={referenceImage.thumbnailUrl} />
                  ))}
                </div>
              </div>
            ) : null}
          </Space>
        ) : null}
      </Modal>
      <Modal title="公开分享链接" open={Boolean(sharedLink)} footer={null} width={480} onCancel={() => setSharedLink(undefined)}>
        {sharedLink ? (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Input readOnly size="small" value={sharedLink.publicUrl} prefix={<LinkOutlined />} aria-label="公开分享链接" />
            <Text type="secondary">有效期至 {new Date(sharedLink.expiresAt).toLocaleString('zh-CN')}</Text>
            <Button size="small" type="primary" icon={<CopyOutlined />} onClick={() => void handleCopySharedLink()}>
              复制链接
            </Button>
          </Space>
        ) : null}
      </Modal>
    </>
  )
}
