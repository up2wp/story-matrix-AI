import { useEffect, useMemo } from 'react'
import { Alert, Button, Card, Collapse, Empty, Space, Tag, Typography } from 'antd'
import { CustomerServiceOutlined, ReloadOutlined, SoundOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router'
import type { Chapter, Work } from '@/core/types'
import { useAudiobook } from '@/features/audiobook/useAudiobook'
import { useUserVoices } from '@/features/audiobook/useUserVoices'
import VoiceBindingCard from '@/pages/preview/VoiceBindingCard'
import SegmentReviewTable from '@/pages/preview/SegmentReviewTable'
import ChapterAudioPlayer from '@/pages/preview/ChapterAudioPlayer'

const { Text } = Typography

interface Props {
  work: Work
  chapter: Chapter
  involvedCharacterIds: string[]
  writing: boolean
}

export default function ChapterAudiobookPanel({ work, chapter, involvedCharacterIds, writing }: Props) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { voices } = useUserVoices()
  const {
    audiobook,
    profiles,
    loadingProfiles,
    refreshProfiles,
    bindProfile,
    bindChapterProfile,
    bindChapterVoice,
    saveBinding,
    saveChapterBinding,
    segmentChapter,
    updateSegment,
    generateChapterAudio,
    generatePromptTemplate,
    missingBindings,
    narratorBinding,
    chapterCharacterBindings,
    isBindingReady,
    segmentingChapterId,
    generatingChapterId,
  } = useAudiobook()

  const segments = audiobook?.segmentsByChapter[chapter.id] || []
  const missing = segments.length ? missingBindings(segments) : []
  const chapterCharacterIds = useMemo(() => {
    const ids = new Set(involvedCharacterIds)
    for (const segment of segments) if (segment.characterId) ids.add(segment.characterId)
    return [...ids]
  }, [involvedCharacterIds, segments])
  const scopedBindings = chapterCharacterBindings(chapter.id, chapterCharacterIds)
  const returnTo = `/chapters?chapterId=${encodeURIComponent(chapter.id)}`

  useEffect(() => {
    const soundId = searchParams.get('soundId')
    const characterId = searchParams.get('characterId')
    if (!soundId || !characterId) return
    const voice = voices.find((item) => item.id === soundId)
    const binding = scopedBindings.find((item) => item.characterId === characterId)
    if (voice && binding && binding.soundId !== voice.id) void bindChapterVoice(chapter.id, binding, voice)
  }, [bindChapterVoice, chapter.id, scopedBindings, searchParams, voices])

  if (!audiobook || !narratorBinding) return null
  if (!chapter.content.trim()) {
    return <Alert style={{ marginTop: 16 }} type="info" showIcon message="AI 生成正文后可配置有声读物" />
  }

  return (
    <Card size="small" style={{ marginTop: 16 }} title={<><CustomerServiceOutlined /> 有声读物</>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="info" showIcon message="旁白是作品级全局设置" description="修改旁白音色或提示词会让所有章节音频需要重新生成；角色设置只影响当前章节。" />
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loadingProfiles} onClick={refreshProfiles}>刷新 Voicebox 音色</Button>
          <Button onClick={() => navigate(`/voices?returnTo=${encodeURIComponent(returnTo)}`)}>添加声音</Button>
          <Text type="secondary">自建声音 {voices.length} 个 · Voicebox profiles {profiles.length} 个</Text>
        </Space>
        <Collapse
          size="small"
          defaultActiveKey={[]}
          items={[
            {
              key: 'narrator',
              label: <Space>旁白配置<Tag color={isBindingReady(narratorBinding) ? 'green' : 'orange'}>{isBindingReady(narratorBinding) ? '已绑定' : '待绑定'}</Tag></Space>,
              children: (
                <VoiceBindingCard
                  binding={narratorBinding}
                  profiles={profiles}
                  voices={voices}
                  ready={isBindingReady(narratorBinding)}
                  onBindProfile={bindProfile}
                  onSavePrompt={saveBinding}
                  addVoiceUrl={`/voices?returnTo=${encodeURIComponent(returnTo)}`}
                />
              ),
            },
            {
              key: 'roles',
              label: '本章角色音色',
              children: scopedBindings.length ? (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {scopedBindings.map((binding) => (
                    <VoiceBindingCard
                      key={binding.id}
                      binding={binding}
                      profiles={profiles}
                      voices={voices}
                      ready={isBindingReady(binding)}
                      onBindProfile={(nextBinding, profile) => bindChapterProfile(chapter.id, nextBinding, profile)}
                      onBindVoice={(nextBinding, voice) => bindChapterVoice(chapter.id, nextBinding, voice)}
                      onSavePrompt={(nextBinding) => saveChapterBinding(chapter.id, nextBinding)}
                      addVoiceUrl={`/voices?returnTo=${encodeURIComponent(`${returnTo}&characterId=${binding.characterId || binding.id}`)}`}
                      onGeneratePrompt={generatePromptTemplate}
                    />
                  ))}
                </Space>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本章暂未识别到角色，可先 AI 分段" />,
            },
            {
              key: 'segments',
              label: '章节分段与生成',
              children: (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Space wrap>
                    <Button loading={segmentingChapterId === chapter.id} disabled={writing} onClick={() => segmentChapter(chapter)}>AI 分段</Button>
                    <Button type="primary" icon={<SoundOutlined />} loading={generatingChapterId === chapter.id} disabled={writing || !segments.length || missing.length > 0} onClick={() => generateChapterAudio(chapter)}>生成章节音频</Button>
                    {segments.some((segment) => segment.status === 'failed') && <Button loading={generatingChapterId === chapter.id} onClick={() => generateChapterAudio(chapter, true)}>重试失败片段</Button>}
                  </Space>
                  {writing && <Alert type="warning" showIcon message="正文生成中，音频操作暂时锁定" />}
                  {missing.length > 0 && <Alert type="warning" showIcon message={`缺少音色绑定：${missing.join('、')}`} />}
                  {segments.length ? <SegmentReviewTable segments={segments} characters={work.characters} onUpdate={(segmentId, changes) => updateSegment(chapter.id, segmentId, changes)} /> : <Empty description="先点击 AI 分段" />}
                  <ChapterAudioPlayer chapter={chapter} segments={segments} />
                </Space>
              ),
            },
          ]}
        />
      </Space>
    </Card>
  )
}
