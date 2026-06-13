import { Alert, Button, Card, Empty, Progress, Space, Typography } from 'antd'
import { CustomerServiceOutlined, SoundOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import type { Chapter, Work } from '@/core/types'
import { useAudiobook } from '@/features/audiobook/useAudiobook'
import SegmentReviewTable from '@/pages/preview/SegmentReviewTable'
import ChapterAudioPlayer from '@/pages/preview/ChapterAudioPlayer'

const { Text } = Typography

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
    approveReviewSegments,
    generateSegmentTonePrompts,
    mergeSegments,
    generateChapterAudio,
    missingBindings,
    narratorBinding,
    segmentingChapterId,
    generatingChapterId,
    segmentationProgress,
    retrySegmentAttribution,
  } = useAudiobook()

  const segments = audiobook?.segmentsByChapter[chapter.id] || []
  const missing = segments.length ? missingBindings(segments, chapter.id) : []
  const progress = segmentationProgress?.chapterId === chapter.id ? segmentationProgress : null
  const unresolvedCount = segments.filter((segment) => segment.attributionStatus === 'failed' || segment.needsReview).length

  if (!audiobook || !narratorBinding) return null
  if (!chapter.content.trim()) {
    return <Alert style={{ marginTop: 16 }} type="info" showIcon message="AI 生成正文后可配置有声读物" />
  }

  return (
    <Card
      size="small"
      style={{ marginTop: 16, flexShrink: 0, maxHeight: 'min(42vh, 560px)', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { overflowY: 'auto', overflowX: 'hidden', minHeight: 0 } }}
      title={<><CustomerServiceOutlined /> 有声读物</>}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <Button onClick={() => navigate('/character-voices')}>配置角色声音</Button>
          <Button loading={segmentingChapterId === chapter.id} disabled={writing || generatingChapterId === chapter.id} onClick={() => segmentChapter(chapter)}>AI 分段</Button>
          {unresolvedCount > 0 && <Button disabled={writing || segmentingChapterId === chapter.id || generatingChapterId === chapter.id} onClick={() => approveReviewSegments(chapter.id)}>确认复核无误</Button>}
          <Button type="primary" icon={<SoundOutlined />} loading={generatingChapterId === chapter.id} disabled={writing || segmentingChapterId === chapter.id || !segments.length || missing.length > 0 || segments.some((segment) => segment.attributionStatus === 'failed')} onClick={() => generateChapterAudio(chapter)}>生成章节音频</Button>
          {segments.some((segment) => segment.status === 'failed') && <Button loading={generatingChapterId === chapter.id} onClick={() => generateChapterAudio(chapter, true)}>重试失败片段</Button>}
        </Space>
        {progress && <Card size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>{progress.message}</Text>
            <Progress percent={progress.total ? Math.round((progress.completed / progress.total) * 100) : progress.stage === 'completed' ? 100 : 20} status={progress.stage === 'failed' || progress.stage === 'partial_failed' ? 'exception' : progress.stage === 'completed' ? 'success' : 'active'} />
            <Text type="secondary">完成 {progress.completed}/{progress.total || 1}，失败 {progress.failed}，待复核 {unresolvedCount}</Text>
          </Space>
        </Card>}
        {writing && <Alert type="warning" showIcon message="正文生成中，音频操作暂时锁定" />}
        {missing.length > 0 && <Alert type="warning" showIcon message={`缺少音色绑定：${missing.join('、')}`} description="请先到「角色声音」配置旁白和角色音色。" />}
        {unresolvedCount > 0 && <Alert type="info" showIcon message={`${unresolvedCount} 个分段需要复核或重试归因`} description="低置信度不会丢失原文；修正说话人后即可继续生成音频。" />}
        {segments.length ? <SegmentReviewTable segments={segments} characters={work.characters} onUpdate={(segmentId, changes) => updateSegment(chapter.id, segmentId, changes)} onGenerateTonePrompts={() => generateSegmentTonePrompts(chapter.id)} onMergeSegments={(segmentIds) => mergeSegments(chapter.id, segmentIds)} onRetryAttribution={(segmentId) => retrySegmentAttribution(chapter, segmentId)} scrollY={280} /> : <Empty description="先点击 AI 分段" />}
        <ChapterAudioPlayer chapter={chapter} segments={segments} />
      </Space>
    </Card>
  )
}
