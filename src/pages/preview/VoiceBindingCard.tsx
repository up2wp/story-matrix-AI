import { useState } from 'react'
import { Button, Card, Input, Select, Space, Tag, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import type { VoiceBinding } from '@/core/types'
import type { VoiceboxProfile } from '@/features/audiobook/voiceboxClient'

const { Text } = Typography

interface Props {
  binding: VoiceBinding
  profiles: VoiceboxProfile[]
  ready: boolean
  onBindProfile: (binding: VoiceBinding, profile: VoiceboxProfile) => Promise<void>
  onSavePrompt: (binding: VoiceBinding) => Promise<void>
  onUploadReference: (binding: VoiceBinding, file: File, referenceText: string) => Promise<void>
}

function profileId(profile: VoiceboxProfile) {
  return profile.id || profile.profile_id || ''
}

function profileName(profile: VoiceboxProfile) {
  return profile.name || profile.display_name || profileId(profile)
}

export default function VoiceBindingCard({ binding, profiles, ready, onBindProfile, onSavePrompt, onUploadReference }: Props) {
  const [prompt, setPrompt] = useState(binding.prompt)
  const [referenceText, setReferenceText] = useState(binding.referenceText || '')
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [uploading, setUploading] = useState(false)

  const uploadFile = fileList[0]?.originFileObj

  const handleUpload = async () => {
    if (!uploadFile) {
      message.warning('请先选择参考音频')
      return
    }
    if (!referenceText.trim()) {
      message.warning('请填写参考音频文本')
      return
    }
    setUploading(true)
    try {
      await onUploadReference({ ...binding, prompt }, uploadFile, referenceText.trim())
      setFileList([])
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card size="small" title={binding.displayName} extra={<Tag color={ready ? 'green' : 'orange'}>{ready ? '已绑定' : '待绑定'}</Tag>}>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Select
          allowClear
          placeholder="选择 Voicebox 现有音色"
          value={binding.profileId}
          options={profiles.map((profile) => ({ value: profileId(profile), label: profileName(profile) }))}
          onChange={(value) => {
            const profile = profiles.find((item) => profileId(item) === value)
            if (profile) void onBindProfile(binding, profile)
          }}
        />
        <Input.TextArea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Story Matrix 语音提示词" />
        <Button size="small" onClick={() => onSavePrompt({ ...binding, prompt, updatedAt: Date.now() })}>保存提示词</Button>
        <Text type="secondary">上传参考音频会写入 Voicebox profile/sample，不会存入 Story Matrix。</Text>
        <Upload beforeUpload={() => false} maxCount={1} fileList={fileList} onChange={({ fileList: next }) => setFileList(next)}>
          <Button icon={<UploadOutlined />}>选择参考音频</Button>
        </Upload>
        <Input.TextArea rows={2} value={referenceText} onChange={(event) => setReferenceText(event.target.value)} placeholder="参考音频对应文本" />
        <Button loading={uploading} onClick={handleUpload}>上传到 Voicebox</Button>
      </Space>
    </Card>
  )
}
