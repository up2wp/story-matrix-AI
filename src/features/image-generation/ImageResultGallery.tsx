import { Card, Empty, Image, Space, Tag, Typography } from 'antd'
import type { ImageAssetRecord } from '@/core/types'

const { Text } = Typography

interface Props {
  images: ImageAssetRecord[]
}

export default function ImageResultGallery({ images }: Props) {
  if (!images.length) return <Empty description="暂无图片结果" />
  return (
    <div className="image-result-grid">
      {images.map(image => (
        <Card key={image.id} size="small" cover={<Image src={image.assetUrl} alt="生成图片" style={{ objectFit: 'cover', maxHeight: 260 }} />}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space wrap><Tag>{image.modelName}</Tag><Tag>{image.mimeType}</Tag></Space>
            <Text type="secondary">{new Date(image.createdAt).toLocaleString('zh-CN')}</Text>
          </Space>
        </Card>
      ))}
    </div>
  )
}
