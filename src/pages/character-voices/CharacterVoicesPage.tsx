import { useEffect } from 'react'
import { Alert, Button, Card, Empty, Space, Typography } from 'antd'
import { CustomerServiceOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import { useStore } from '@/core/store'
import { useAudiobook } from '@/features/audiobook/useAudiobook'
import { useUserVoices } from '@/features/audiobook/useUserVoices'
import VoiceBindingCard from '@/pages/preview/VoiceBindingCard'

const { Title, Text } = Typography

export default function CharacterVoicesPage() {
  const navigate = useNavigate()
  const currentWork = useStore((state) => state.currentWork)
  const { voices } = useUserVoices()
  const {
    profiles,
    loadingProfiles,
    refreshProfiles,
    bindProfile,
    bindVoice,
    saveBinding,
    generatePromptTemplate,
    narratorBinding,
    bystanderBindings,
    characterBindings,
    isBindingReady,
  } = useAudiobook()

  useEffect(() => {
    if (!currentWork) return
    void refreshProfiles()
  }, [currentWork, refreshProfiles])

  if (!currentWork || !narratorBinding) {
    return <Empty description="请先选择作品" />
  }

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }} align="center">
        <Title level={4} style={{ margin: 0 }}><CustomerServiceOutlined /> 角色声音</Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loadingProfiles} onClick={refreshProfiles}>刷新 Voicebox 音色</Button>
          <Button onClick={() => navigate('/voices')}>添加声音</Button>
        </Space>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="声音设置按作品生效"
        description="旁白和角色声音会被本作品所有章节复用；修改声音或提示词后，相关章节音频需要重新生成。"
      />

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card size="small" title="旁白声音">
          <VoiceBindingCard
            binding={narratorBinding}
            profiles={profiles}
            voices={voices}
            ready={isBindingReady(narratorBinding)}
            onBindProfile={bindProfile}
            onBindVoice={bindVoice}
            onSavePrompt={saveBinding}
            addVoiceUrl="/voices"
          />
        </Card>

        {bystanderBindings && <Card size="small" title="路人声音">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <VoiceBindingCard
              binding={bystanderBindings.male}
              profiles={profiles}
              voices={voices}
              ready={isBindingReady(bystanderBindings.male)}
              onBindProfile={bindProfile}
              onBindVoice={bindVoice}
              onSavePrompt={saveBinding}
              addVoiceUrl="/voices"
              fixedPrompt
            />
            <VoiceBindingCard
              binding={bystanderBindings.female}
              profiles={profiles}
              voices={voices}
              ready={isBindingReady(bystanderBindings.female)}
              onBindProfile={bindProfile}
              onBindVoice={bindVoice}
              onSavePrompt={saveBinding}
              addVoiceUrl="/voices"
              fixedPrompt
            />
          </Space>
        </Card>}

        <Card size="small" title="角色声音" extra={<Text type="secondary">{currentWork.characters.length} 个角色</Text>}>
          {characterBindings.length ? (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {characterBindings.map((binding) => (
                <VoiceBindingCard
                  key={binding.id}
                  binding={binding}
                  profiles={profiles}
                  voices={voices}
                  ready={isBindingReady(binding)}
                  onBindProfile={bindProfile}
                  onBindVoice={bindVoice}
                  onSavePrompt={saveBinding}
                  addVoiceUrl="/voices"
                  onGeneratePrompt={generatePromptTemplate}
                />
              ))}
            </Space>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前作品暂无角色" />}
        </Card>
      </Space>
    </div>
  )
}
