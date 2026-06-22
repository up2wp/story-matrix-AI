import { useMemo, useState } from 'react'
import { Button, Card, Empty, Progress, Space, Typography, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { AudiobookSegment, Chapter } from '@/core/types'
import { completedAudioSegments, downloadBlobUrl } from '@/features/audiobook/audioUtils'
import { voiceboxClient } from '@/features/audiobook/voiceboxClient'

const { Text } = Typography

interface Props {
  chapter: Chapter
  segments: AudiobookSegment[]
}

export default function ChapterAudioPlayer({ chapter, segments }: Props) {
  const completed = useMemo(() => completedAudioSegments(segments), [segments])
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthesisProgress, setSynthesisProgress] = useState<{ completedSegments: number; totalSegments: number; message: string } | null>(null)

  const synthesizeChapterAudio = async () => {
    setSynthesizing(true)
    setSynthesisProgress({ completedSegments: 0, totalSegments: completed.length, message: '正在提交章节音频合成任务' })
    try {
      const job = await voiceboxClient.synthesizeChapterAudio({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        segments: completed.map((segment) => ({ order: segment.order, generationId: segment.generationId || '' })),
      })
      let status = job
      while (status.status === 'pending' || status.status === 'generating') {
        setSynthesisProgress({ completedSegments: status.completedSegments, totalSegments: status.totalSegments, message: '正在后台拼接章节音频' })
        await new Promise((resolve) => setTimeout(resolve, 1000))
        status = await voiceboxClient.chapterAudioStatus(job.jobId)
      }
      if (status.status === 'failed') throw new Error(status.error || '章节音频合成失败')
      setSynthesisProgress({ completedSegments: status.totalSegments, totalSegments: status.totalSegments, message: '章节音频合成完成，正在下载' })
      const url = await voiceboxClient.downloadChapterAudio(job.jobId)
      downloadBlobUrl(url, chapter)
      message.success('章节音频已合成并开始下载')
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '章节音频合成失败'
      setSynthesisProgress({ completedSegments: 0, totalSegments: completed.length, message: errMsg })
      message.error(errMsg)
    } finally {
      setSynthesizing(false)
    }
  }

  if (!completed.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已完成音频" />

  return (
    <Card size="small" title="章节音频" extra={<Button icon={<DownloadOutlined />} loading={synthesizing} onClick={synthesizeChapterAudio}>合成章节音频</Button>}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Text type="secondary">已生成 {completed.length} 个音频片段。可在分段列表中逐条试听、下载或重新生成；这里会在后台拼接章节音频并自动下载。</Text>
        {synthesisProgress && <div>
          <Text type="secondary">合成进度：{synthesisProgress.message}</Text>
          <Progress percent={synthesisProgress.totalSegments ? Math.round((synthesisProgress.completedSegments / synthesisProgress.totalSegments) * 100) : 0} status={synthesizing ? 'active' : synthesisProgress.completedSegments === synthesisProgress.totalSegments ? 'success' : 'exception'} />
        </div>}
      </Space>
    </Card>
  )
}
