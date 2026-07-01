import type { ReactNode } from 'react'
import { Alert, Button, Input, Space, Typography } from 'antd'
import type { VisualPromptRecord } from '@/core/types'

const { Text } = Typography

interface Props {
  record?: VisualPromptRecord
  value: string
  editable: boolean
  generatingPrompt: boolean
  generatingImage: boolean
  draftDisabled?: boolean
  saveDisabled?: boolean
  generateDisabled?: boolean
  generateDisabledReason?: string
  generationControls?: ReactNode
  onChange: (value: string) => void
  onGenerateDraft: () => void
  onSave: () => void
  onCopy: () => void
  onGenerateImage: () => void
}

export default function ImagePromptEditor({ record, value, editable, generatingPrompt, generatingImage, draftDisabled, saveDisabled, generateDisabled, generateDisabledReason, generationControls, onChange, onGenerateDraft, onSave, onCopy, onGenerateImage }: Props) {
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Input.TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={!editable}
        autoSize={{ minRows: 8, maxRows: 18 }}
        placeholder="生成或手写视觉提示词，可保存后用于图片生成。"
      />
      {record?.error && <Text type="danger">{record.error}</Text>}
      {generationControls}
      {generateDisabledReason && <Alert type="warning" showIcon message={generateDisabledReason} />}
      <Space wrap>
        {editable && <Button loading={generatingPrompt} disabled={draftDisabled} onClick={onGenerateDraft}>生成草稿</Button>}
        {editable && <Button type="primary" disabled={!value.trim() || saveDisabled} onClick={onSave}>保存提示词</Button>}
        <Button disabled={!value.trim()} onClick={onCopy}>复制</Button>
        {editable && <Button loading={generatingImage} disabled={!record?.prompt?.trim() || generateDisabled} onClick={onGenerateImage}>生成图片</Button>}
      </Space>
    </Space>
  )
}
