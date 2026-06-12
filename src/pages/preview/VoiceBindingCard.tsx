import { useState } from 'react'
import { Button, Card, Input, Modal, Select, Space, Tag, Typography, message } from 'antd'
import { ExperimentOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import type { VoiceBinding } from '@/core/types'
import type { UserVoiceAsset } from '@/core/types'
import type { VoiceboxProfile } from '@/features/audiobook/voiceboxClient'

const { Text } = Typography

interface Props {
  binding: VoiceBinding
  profiles: VoiceboxProfile[]
  voices?: UserVoiceAsset[]
  ready: boolean
  onBindProfile: (binding: VoiceBinding, profile: VoiceboxProfile) => Promise<void>
  onBindVoice?: (binding: VoiceBinding, voice: UserVoiceAsset) => Promise<void>
  onSavePrompt: (binding: VoiceBinding) => Promise<void>
  addVoiceUrl?: string
  onGeneratePrompt?: (characterId: string) => Promise<string>
}

function profileId(profile: VoiceboxProfile) {
  return profile.id || profile.profile_id || ''
}

function profileName(profile: VoiceboxProfile) {
  return profile.name || profile.display_name || profileId(profile)
}

export default function VoiceBindingCard({ binding, profiles, voices = [], ready, onBindProfile, onBindVoice, onSavePrompt, addVoiceUrl = '/voices', onGeneratePrompt }: Props) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState(binding.prompt)
  const [generating, setGenerating] = useState(false)

  const handleGeneratePrompt = async () => {
    if (!binding.characterId || !onGeneratePrompt) return
    if (prompt.trim()) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '覆盖当前未保存提示词？',
          content: 'AI 生成的模板会填入文本框，但不会自动保存。',
          okText: '覆盖',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      if (!confirmed) return
    }
    setGenerating(true)
    try {
      setPrompt(await onGeneratePrompt(binding.characterId))
      message.success('提示词模板已生成，请检查后保存')
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '生成失败'
      message.error(errMsg)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card size="small" title={binding.displayName} extra={<Tag color={ready ? 'green' : 'orange'}>{ready ? '已绑定' : '待绑定'}</Tag>}>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Select
          allowClear
          placeholder="选择已有音色"
          value={binding.soundId ? `voice:${binding.soundId}` : binding.profileId ? `profile:${binding.profileId}` : undefined}
          options={[
            {
              label: '我的声音',
              options: voices.map((voice) => ({ value: `voice:${voice.id}`, label: voice.displayName })),
            },
            {
              label: 'Voicebox 公共/预设',
              options: profiles.map((profile) => ({ value: `profile:${profileId(profile)}`, label: profileName(profile) })),
            },
          ]}
          onChange={(value) => {
            const selected = String(value || '')
            if (selected.startsWith('voice:')) {
              const voice = voices.find((item) => item.id === selected.slice(6))
              if (voice && onBindVoice) void onBindVoice(binding, voice)
              return
            }
            const profile = profiles.find((item) => profileId(item) === selected.replace(/^profile:/, ''))
            if (profile) void onBindProfile(binding, profile)
          }}
        />
        <Input.TextArea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="QwenTTS 提示词模板，需包含【上下文】和【文本】" />
        <Space wrap>
          {binding.speakerKind === 'character' && onGeneratePrompt && <Button size="small" icon={<ExperimentOutlined />} loading={generating} onClick={handleGeneratePrompt}>AI 生成提示词</Button>}
          <Button size="small" onClick={() => onSavePrompt({ ...binding, prompt, promptTemplate: prompt, updatedAt: Date.now() })}>保存提示词</Button>
        </Space>
        <Text type="secondary">参考音频上传已集中到「声音管理」，这里仅选择已有音色。</Text>
        <Button size="small" icon={<PlusOutlined />} onClick={() => navigate(addVoiceUrl)}>添加声音</Button>
      </Space>
    </Card>
  )
}
