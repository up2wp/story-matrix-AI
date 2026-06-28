import { Select, Space, Tag, Typography } from 'antd'
import type { ImageGenerationModelConfig } from '@/core/types'

const { Text } = Typography

interface Props {
  models: ImageGenerationModelConfig[]
  value?: string
  onChange: (modelId: string) => void
}

export default function ImageModelSelector({ models, value, onChange }: Props) {
  const enabledModels = models.filter(model => model.enabled)
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select
        value={value}
        onChange={onChange}
        disabled={!enabledModels.length}
        placeholder={enabledModels.length ? '选择生图模型' : '暂无可用模型'}
        options={enabledModels.map(model => ({ value: model.id, label: model.label }))}
      />
      {enabledModels.length ? (
        <Space wrap>
          {enabledModels.find(model => model.id === value)?.capabilities.sizes.map(size => <Tag key={size}>{size}</Tag>)}
          {enabledModels.find(model => model.id === value)?.capabilities.qualities.map(quality => <Tag key={quality}>{quality}</Tag>)}
          {enabledModels.find(model => model.id === value)?.capabilities.formats.map(format => <Tag key={format}>{format}</Tag>)}
        </Space>
      ) : (
        <Text type="secondary">请联系管理员启用生图模型。</Text>
      )}
    </Space>
  )
}
