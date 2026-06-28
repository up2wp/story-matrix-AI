import { useState } from 'react'
import { Button, Card, Empty, Image, Space, Tag, Typography } from 'antd'
import type { ImageAssetRecord } from '@/core/types'
import { getImageAssetDisplayUrl } from './imageGenerationClient'

const { Text } = Typography

interface Props {
  images: ImageAssetRecord[]
  editable?: boolean
  onRetryUpload?: (image: ImageAssetRecord) => void
}

export default function ImageResultGallery({ images, editable, onRetryUpload }: Props) {
  const [loadFailures, setLoadFailures] = useState<Record<string, string>>({})
  if (!images.length) return <Empty description="暂无图片结果" />
  return (
    <div className="image-result-grid">
      {images.map(image => {
        const displayUrl = getImageAssetDisplayUrl(image)
        const missingLocator = !displayUrl
        const loadFailure = loadFailures[image.id]
        return (
        <Card key={image.id} size="small" cover={missingLocator ? <Empty description="图片定位不完整" /> : <Image src={displayUrl} alt="生成图片" style={{ objectFit: 'cover', maxHeight: 260 }} onError={() => setLoadFailures(current => ({ ...current, [image.id]: image.storageMode === 'immich' ? 'Immich 缩略图加载失败，可稍后重试或打开原图。' : '本地图片加载失败。' }))} />}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space wrap><Tag>{image.modelName}</Tag><Tag>{image.mimeType}</Tag><Tag>{image.storageMode === 'immich' ? 'Immich' : '本地'}</Tag></Space>
            {missingLocator && <Text type="danger">历史图片定位不完整，无法展示。</Text>}
            {loadFailure && <Text type="warning">{loadFailure}</Text>}
            {image.status !== 'succeeded' && <Text type="danger">{image.error || '图片存储未完成，可稍后重试'}</Text>}
            {editable && image.storageMode === 'immich' && image.status !== 'succeeded' && <Button size="small" onClick={() => onRetryUpload?.(image)}>重传到 Immich</Button>}
            <Text type="secondary">{new Date(image.createdAt).toLocaleString('zh-CN')}</Text>
          </Space>
        </Card>
        )
      })}
    </div>
  )
}
