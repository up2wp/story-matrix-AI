import { Button, Card, Empty, Space, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { AudiobookSegment, Chapter } from '@/core/types'
import { completedAudioSegments, downloadChapterAudioManifest } from '@/features/audiobook/audioUtils'
import { voiceboxClient } from '@/features/audiobook/voiceboxClient'

const { Text } = Typography

interface Props {
  chapter: Chapter
  segments: AudiobookSegment[]
}

export default function ChapterAudioPlayer({ chapter, segments }: Props) {
  const completed = completedAudioSegments(segments)
  if (!completed.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已完成音频" />

  return (
    <Card size="small" title="章节音频" extra={<Button icon={<DownloadOutlined />} onClick={() => downloadChapterAudioManifest(chapter, segments)}>下载章节清单</Button>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {completed.map((segment) => (
          <div key={segment.id}>
            <Text type="secondary">{segment.order + 1}. {segment.speakerName}</Text>
            <audio controls src={voiceboxClient.audioUrl(segment.generationId || '')} style={{ width: '100%', marginTop: 4 }} />
          </div>
        ))}
      </Space>
    </Card>
  )
}
