import { useMemo } from 'react'
import { Button, Card, Empty, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { AudiobookSegment, Chapter } from '@/core/types'
import { completedAudioSegments, downloadChapterAudioManifest } from '@/features/audiobook/audioUtils'

const { Text } = Typography

interface Props {
  chapter: Chapter
  segments: AudiobookSegment[]
}

export default function ChapterAudioPlayer({ chapter, segments }: Props) {
  const completed = useMemo(() => completedAudioSegments(segments), [segments])

  if (!completed.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已完成音频" />

  return (
    <Card size="small" title="章节音频" extra={<Button icon={<DownloadOutlined />} onClick={() => downloadChapterAudioManifest(chapter, segments)}>合并章节音频</Button>}>
      <Text type="secondary">已生成 {completed.length} 个音频片段。可在分段列表中逐条试听、下载或重新生成；这里导出章节级音频清单用于后续合并。</Text>
    </Card>
  )
}
