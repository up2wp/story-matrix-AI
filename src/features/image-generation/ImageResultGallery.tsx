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
  if (!images.length) return <Empty description="暂无图片结果" />
  return (
    <div className="image-result-grid">
      {images.map(image => (
        <Card key={image.id} size="small" cover={<Image src={getImageAssetDisplayUrl(image)} alt="生成图片" style={{ objectFit: 'cover', maxHeight: 260 }} />}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space wrap><Tag>{image.modelName}</Tag><Tag>{image.mimeType}</Tag><Tag>{image.storageMode === 'immich' ? 'Immich' : '本地'}</Tag></Space>
            {image.status !== 'succeeded' && <Text type="danger">{image.error || '图片存储未完成，可稍后重试'}</Text>}
            {editable && image.storageMode === 'immich' && image.status !== 'succeeded' && <Button size="small" onClick={() => onRetryUpload?.(image)}>重传到 Immich</Button>}
            <Text type="secondary">{new Date(image.createdAt).toLocaleString('zh-CN')}</Text>
          </Space>
        </Card>
      ))}
    </div>
  )
}
