import { useState } from 'react'
import { CopyOutlined, DeleteOutlined, PictureOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Image, Modal, message, Popconfirm, Space, Tag, Typography } from 'antd'
import type { ImageAssetRecord } from '@/core/types'
import { getImageAssetDisplayUrl } from './imageGenerationClient'

const { Paragraph, Text } = Typography

interface Props {
  images: ImageAssetRecord[]
  editable?: boolean
  onRetryUpload?: (image: ImageAssetRecord) => void
  onDelete?: (image: ImageAssetRecord) => void
  deletingImageId?: string | null
  showFailedPlaceholders?: boolean
}

async function copyProviderPrompt(generationPromptSnapshot: string) {
  try {
    await navigator.clipboard.writeText(generationPromptSnapshot)
    message.success('已复制实际调用提示词')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制失败')
  }
}

export default function ImageResultGallery({ images, editable, onRetryUpload, onDelete, deletingImageId, showFailedPlaceholders = false }: Props) {
  const [loadFailures, setLoadFailures] = useState<Record<string, boolean>>({})
  const [selectedFailure, setSelectedFailure] = useState<ImageAssetRecord>()
  const visibleImages = images.filter(image => (showFailedPlaceholders && image.status === 'failed' && !getImageAssetDisplayUrl(image)) || (getImageAssetDisplayUrl(image) && !loadFailures[image.id]))
  if (!visibleImages.length) return <Empty description="暂无可展示的图片结果" />
  return (
    <>
      <div className="image-result-grid">
        {visibleImages.map(image => {
          const displayUrl = getImageAssetDisplayUrl(image)
          const originalUrl = getImageAssetDisplayUrl(image, 'original')
          const isFailedWithoutImage = image.status === 'failed' && !displayUrl
          const cover = isFailedWithoutImage ? (
            <div className="image-result-failed-cover">
              <PictureOutlined />
              <Text type="secondary">未生成图片</Text>
            </div>
          ) : (
            <Image src={displayUrl} preview={originalUrl ? { src: originalUrl } : false} alt="生成图片" style={{ objectFit: 'cover', maxHeight: 260 }} onError={() => setLoadFailures(current => ({ ...current, [image.id]: true }))} />
          )
          return (
          <Card key={image.id} size="small" cover={cover} className={isFailedWithoutImage ? 'image-result-failed-card' : undefined}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space wrap><Tag>{image.modelName}</Tag>{isFailedWithoutImage ? <Tag color="error">生成失败</Tag> : <><Tag>{image.mimeType}</Tag><Tag>{image.storageMode === 'immich' ? 'Immich' : '本地'}</Tag></>}</Space>
              {isFailedWithoutImage ? (
                <Button size="small" onClick={() => setSelectedFailure(image)}>查看失败详情</Button>
              ) : image.status !== 'succeeded' && <Text type="danger">{image.error || '图片存储未完成，可稍后重试'}</Text>}
              {!isFailedWithoutImage && image.generationPromptSnapshot && (
                <div>
                  <Space align="center" style={{ marginBottom: 4 }}>
                    <Text type="secondary">实际调用提示词</Text>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copyProviderPrompt(image.generationPromptSnapshot || '')}>复制</Button>
                  </Space>
                  <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }} style={{ marginBottom: 0 }}>
                    {image.generationPromptSnapshot}
                  </Paragraph>
                </div>
              )}
              {editable && (
                <Space wrap>
                  {image.storageMode === 'immich' && image.status !== 'succeeded' && <Button size="small" onClick={() => onRetryUpload?.(image)}>重传到 Immich</Button>}
                  <Popconfirm title="删除这张图片资产？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onDelete?.(image)}>
                    <Button size="small" danger icon={<DeleteOutlined />} loading={deletingImageId === image.id}>删除</Button>
                  </Popconfirm>
                </Space>
              )}
              <Text type="secondary">{new Date(image.createdAt).toLocaleString('zh-CN')}</Text>
            </Space>
          </Card>
          )
        })}
      </div>
      <Modal title="生成失败详情" open={Boolean(selectedFailure)} footer={null} onCancel={() => setSelectedFailure(undefined)}>
        {selectedFailure ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Text type="secondary">{new Date(selectedFailure.createdAt).toLocaleString('zh-CN')}</Text>
            <div>
              <Text strong>错误信息</Text>
              <Paragraph className="image-result-failed-detail">{selectedFailure.error || 'Provider 或存储未返回可展示图片。'}</Paragraph>
            </div>
            <div>
              <Text strong>实际调用提示词</Text>
              <Paragraph className="image-result-failed-detail">{selectedFailure.generationPromptSnapshot}</Paragraph>
            </div>
          </Space>
        ) : null}
      </Modal>
    </>
  )
}
