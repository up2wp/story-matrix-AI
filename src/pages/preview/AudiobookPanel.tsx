import { useMemo, useState } from 'react'
import { Alert, Button, Card, Collapse, Empty, Select, Space, Typography } from 'antd'
import { CustomerServiceOutlined, ReloadOutlined, SoundOutlined } from '@ant-design/icons'
import type { Work } from '@/core/types'
import { useAudiobook } from '@/features/audiobook/useAudiobook'
import VoiceBindingCard from './VoiceBindingCard'
import SegmentReviewTable from './SegmentReviewTable'
import ChapterAudioPlayer from './ChapterAudioPlayer'

const { Text, Title } = Typography

interface Props {
  work: Work
}

export default function AudiobookPanel({ work }: Props) {
  const {
    audiobook,
    profiles,
    loadingProfiles,
    refreshProfiles,
    bindProfile,
    saveBinding,
    uploadReference,
    segmentChapter,
    updateSegment,
    generateChapterAudio,
    missingBindings,
    narratorBinding,
    characterBindings,
    isBindingReady,
    segmentingChapterId,
    generatingChapterId,
  } = useAudiobook()
  const writtenChapters = useMemo(() => work.chapters.filter((chapter) => chapter.content.trim()), [work.chapters])
  const [chapterId, setChapterId] = useState(writtenChapters[0]?.id)
  const activeChapter = writtenChapters.find((chapter) => chapter.id === chapterId) || writtenChapters[0]
  const segments = activeChapter && audiobook ? audiobook.segmentsByChapter[activeChapter.id] || [] : []
  const missing = segments.length ? missingBindings(segments) : []

  if (!audiobook || !narratorBinding) return null

  return (
    <Card style={{ marginBottom: 16 }} title={<><CustomerServiceOutlined /> 有声读物</>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="有声读物是成稿后的增强导出能力"
          description="Story Matrix 负责角色语音提示词和章节分段；Voicebox 负责音色、参考音频和 TTS 生成。"
        />

        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loadingProfiles} onClick={refreshProfiles}>刷新 Voicebox 音色</Button>
          <Text type="secondary">已读取 {profiles.length} 个 profiles</Text>
        </Space>

        <Collapse
          items={[
            {
              key: 'bindings',
              label: '1. 绑定旁白和角色音色',
              children: (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <VoiceBindingCard
                    binding={narratorBinding}
                    profiles={profiles}
                    ready={isBindingReady(narratorBinding)}
                    onBindProfile={bindProfile}
                    onSavePrompt={saveBinding}
                    onUploadReference={uploadReference}
                  />
                  {characterBindings.map((binding) => (
                    <VoiceBindingCard
                      key={binding.id}
                      binding={binding}
                      profiles={profiles}
                      ready={isBindingReady(binding)}
                      onBindProfile={bindProfile}
                      onSavePrompt={saveBinding}
                      onUploadReference={uploadReference}
                    />
                  ))}
                </Space>
              ),
            },
            {
              key: 'segments',
              label: '2. 章节分段与生成',
              children: writtenChapters.length ? (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Space wrap>
                    <Select
                      style={{ minWidth: 260 }}
                      value={activeChapter?.id}
                      options={writtenChapters.map((chapter) => ({ value: chapter.id, label: chapter.title }))}
                      onChange={setChapterId}
                    />
                    {activeChapter && (
                      <Button loading={segmentingChapterId === activeChapter.id} onClick={() => segmentChapter(activeChapter)}>
                        AI 分段
                      </Button>
                    )}
                    {activeChapter && (
                      <Button
                        type="primary"
                        icon={<SoundOutlined />}
                        loading={generatingChapterId === activeChapter.id}
                        disabled={!segments.length || missing.length > 0}
                        onClick={() => generateChapterAudio(activeChapter)}
                      >
                        生成章节音频
                      </Button>
                    )}
                    {activeChapter && segments.some((segment) => segment.status === 'failed') && (
                      <Button loading={generatingChapterId === activeChapter.id} onClick={() => generateChapterAudio(activeChapter, true)}>
                        重试失败片段
                      </Button>
                    )}
                  </Space>
                  {missing.length > 0 && <Alert type="warning" showIcon message={`缺少音色绑定：${missing.join('、')}`} />}
                  {segments.length ? (
                    <SegmentReviewTable segments={segments} characters={work.characters} onUpdate={(segmentId, changes) => activeChapter ? updateSegment(activeChapter.id, segmentId, changes) : Promise.resolve()} />
                  ) : (
                    <Empty description="先选择章节并点击 AI 分段" />
                  )}
                  {activeChapter && <ChapterAudioPlayer chapter={activeChapter} segments={segments} />}
                </Space>
              ) : (
                <Empty description="暂无已完成正文的章节" />
              ),
            },
          ]}
        />

        <Title level={5}>v1 边界</Title>
        <Text type="secondary">当前版本按章节生成和交付音频，不做整本拼接、发布级混音或 Story Matrix 自建音色库。</Text>
      </Space>
    </Card>
  )
}
