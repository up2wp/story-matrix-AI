import { useState } from 'react'
import { CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Image, message, Popconfirm, Space, Tag, Typography } from 'antd'
import type { ImageAssetRecord } from '@/core/types'
import { getImageAssetDisplayUrl } from './imageGenerationClient'

const { Paragraph, Text } = Typography

interface Props {
  images: ImageAssetRecord[]
  editable?: boolean
  onRetryUpload?: (image: ImageAssetRecord) => void
  onDelete?: (image: ImageAssetRecord) => void
  deletingImageId?: string | null
}

async function copyProviderPrompt(generationPromptSnapshot: string) {
  try {
    await navigator.clipboard.writeText(generationPromptSnapshot)
    message.success('已复制实际调用提示词')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制失败')
  }
}

export default function ImageResultGallery({ images, editable, onRetryUpload, onDelete, deletingImageId }: Props) {
  const [loadFailures, setLoadFailures] = useState<Record<string, boolean>>({})
  const visibleImages = images.filter(image => getImageAssetDisplayUrl(image) && !loadFailures[image.id])
  if (!visibleImages.length) return <Empty description="暂无可展示的图片结果" />
  return (
    <div className="image-result-grid">
      {visibleImages.map(image => {
        const displayUrl = getImageAssetDisplayUrl(image)
        const originalUrl = getImageAssetDisplayUrl(image, 'original')
        const cover = (
          <Image src={displayUrl} preview={originalUrl ? { src: originalUrl } : false} alt="生成图片" style={{ objectFit: 'cover', maxHeight: 260 }} onError={() => setLoadFailures(current => ({ ...current, [image.id]: true }))} />
        )
        return (
        <Card key={image.id} size="small" cover={cover}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space wrap><Tag>{image.modelName}</Tag><Tag>{image.mimeType}</Tag><Tag>{image.storageMode === 'immich' ? 'Immich' : '本地'}</Tag></Space>
            {image.status !== 'succeeded' && <Text type="danger">{image.error || '图片存储未完成，可稍后重试'}</Text>}
            {image.generationPromptSnapshot && (
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
  )
}
