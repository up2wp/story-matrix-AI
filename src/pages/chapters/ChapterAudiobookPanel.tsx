import { Alert, Button, Card, Empty, Space } from 'antd'
import { CustomerServiceOutlined, SoundOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import type { Chapter, Work } from '@/core/types'
import { useAudiobook } from '@/features/audiobook/useAudiobook'
import SegmentReviewTable from '@/pages/preview/SegmentReviewTable'
import ChapterAudioPlayer from '@/pages/preview/ChapterAudioPlayer'

interface Props {
  work: Work
  chapter: Chapter
  writing: boolean
}

export default function ChapterAudiobookPanel({ work, chapter, writing }: Props) {
  const navigate = useNavigate()
  const {
    audiobook,
    segmentChapter,
    updateSegment,
    generateChapterAudio,
    missingBindings,
    narratorBinding,
    segmentingChapterId,
    generatingChapterId,
  } = useAudiobook()

  const segments = audiobook?.segmentsByChapter[chapter.id] || []
  const missing = segments.length ? missingBindings(segments) : []

  if (!audiobook || !narratorBinding) return null
  if (!chapter.content.trim()) {
    return <Alert style={{ marginTop: 16 }} type="info" showIcon message="AI 生成正文后可配置有声读物" />
  }

  return (
    <Card size="small" style={{ marginTop: 16 }} title={<><CustomerServiceOutlined /> 有声读物</>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <Button onClick={() => navigate('/character-voices')}>配置角色声音</Button>
          <Button loading={segmentingChapterId === chapter.id} disabled={writing} onClick={() => segmentChapter(chapter)}>AI 分段</Button>
          <Button type="primary" icon={<SoundOutlined />} loading={generatingChapterId === chapter.id} disabled={writing || !segments.length || missing.length > 0} onClick={() => generateChapterAudio(chapter)}>生成章节音频</Button>
          {segments.some((segment) => segment.status === 'failed') && <Button loading={generatingChapterId === chapter.id} onClick={() => generateChapterAudio(chapter, true)}>重试失败片段</Button>}
        </Space>
        {writing && <Alert type="warning" showIcon message="正文生成中，音频操作暂时锁定" />}
        {missing.length > 0 && <Alert type="warning" showIcon message={`缺少音色绑定：${missing.join('、')}`} description="请先到「角色声音」配置旁白和角色音色。" />}
        {segments.length ? <SegmentReviewTable segments={segments} characters={work.characters} onUpdate={(segmentId, changes) => updateSegment(chapter.id, segmentId, changes)} /> : <Empty description="先点击 AI 分段" />}
        <ChapterAudioPlayer chapter={chapter} segments={segments} />
      </Space>
    </Card>
  )
}
