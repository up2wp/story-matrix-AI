import { useEffect, useState } from 'react'
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
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const createdUrls: string[] = []
    async function loadAudio() {
      const entries = await Promise.all(completed.map(async (segment) => {
        if (!segment.generationId) return undefined
        const url = await voiceboxClient.fetchMediaUrl(voiceboxClient.audioUrl(segment.generationId))
        createdUrls.push(url)
        return [segment.id, url] as const
      }))
      if (!cancelled) setAudioUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))))
    }
    void loadAudio()
    return () => {
      cancelled = true
      for (const url of createdUrls) URL.revokeObjectURL(url)
    }
  }, [completed])

  if (!completed.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已完成音频" />

  return (
    <Card size="small" title="章节音频" extra={<Button icon={<DownloadOutlined />} onClick={() => downloadChapterAudioManifest(chapter, segments)}>下载章节清单</Button>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {completed.map((segment) => (
          <div key={segment.id}>
            <Text type="secondary">{segment.order + 1}. {segment.speakerName}</Text>
            {audioUrls[segment.id]
              ? <audio controls src={audioUrls[segment.id]} style={{ width: '100%', marginTop: 4 }} />
              : <Text type="secondary">音频加载中...</Text>}
          </div>
        ))}
      </Space>
    </Card>
  )
}
