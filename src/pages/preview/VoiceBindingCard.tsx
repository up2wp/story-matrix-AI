import { useState } from 'react'
import { Button, Card, Input, Modal, Select, Space, Tag, Typography, message } from 'antd'
import { ExperimentOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import type { VoiceBinding } from '@/core/types'
import type { UserVoiceAsset } from '@/core/types'
import type { VoiceboxProfile } from '@/features/audiobook/voiceboxClient'

const { Text } = Typography
const MIN_VOICE_SELECT_WIDTH = 240
const MAX_VOICE_SELECT_WIDTH = 520
const SELECT_HORIZONTAL_PADDING = 96
const OPTION_CHARACTER_WIDTH = 14

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
  fixedPrompt?: boolean
}

function profileId(profile: VoiceboxProfile) {
  return profile.id || profile.profile_id || ''
}

function profileName(profile: VoiceboxProfile) {
  return profile.name || profile.display_name || profileId(profile)
}

export function getVoiceSelectWidth(optionLabels: string[], viewportWidth: number) {
  const longestLabelLength = optionLabels.reduce((max, label) => Math.max(max, label.length), 0)
  const contentWidth = Math.max(MIN_VOICE_SELECT_WIDTH, longestLabelLength * OPTION_CHARACTER_WIDTH + SELECT_HORIZONTAL_PADDING)
  const viewportLimit = Math.max(MIN_VOICE_SELECT_WIDTH, viewportWidth - 64)
  return Math.min(contentWidth, MAX_VOICE_SELECT_WIDTH, viewportLimit)
}

export default function VoiceBindingCard({ binding, profiles, voices = [], ready, onBindProfile, onBindVoice, onSavePrompt, addVoiceUrl = '/voices', onGeneratePrompt, fixedPrompt = false }: Props) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState(binding.prompt)
  const [generating, setGenerating] = useState(false)
  const voiceOptions = voices.map((voice) => ({ value: `voice:${voice.id}`, label: voice.displayName }))
  const profileOptions = profiles.map((profile) => ({ value: `profile:${profileId(profile)}`, label: profileName(profile) }))
  const selectWidth = getVoiceSelectWidth([...voiceOptions, ...profileOptions].map((option) => option.label), typeof window === 'undefined' ? MAX_VOICE_SELECT_WIDTH : window.innerWidth)

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
      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        <Select
          allowClear
          placeholder="选择已有音色"
          popupMatchSelectWidth={selectWidth}
          style={{ width: selectWidth, maxWidth: '100%' }}
          value={binding.soundId ? `voice:${binding.soundId}` : binding.profileId ? `profile:${binding.profileId}` : undefined}
          options={[
            {
              label: '我的声音',
              options: voiceOptions,
            },
            {
              label: 'Voicebox 公共/预设',
              options: profileOptions,
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
        <Input.TextArea rows={fixedPrompt ? 2 : 4} value={fixedPrompt ? binding.prompt : prompt} disabled={fixedPrompt} onChange={(event) => setPrompt(event.target.value)} placeholder="QwenTTS 朗读指导，需包含【上下文】；正文会单独传给 Voicebox text" />
        {!fixedPrompt && <Space wrap>
          {binding.speakerKind === 'character' && onGeneratePrompt && <Button size="small" icon={<ExperimentOutlined />} loading={generating} onClick={handleGeneratePrompt}>AI 生成提示词</Button>}
          <Button size="small" onClick={() => onSavePrompt({ ...binding, prompt, promptTemplate: prompt, updatedAt: Date.now() })}>保存提示词</Button>
        </Space>}
        <Text type="secondary">参考音频上传已集中到「声音管理」，这里仅选择已有音色。</Text>
        <Button size="small" icon={<PlusOutlined />} onClick={() => navigate(addVoiceUrl)}>添加声音</Button>
      </Space>
    </Card>
  )
}
