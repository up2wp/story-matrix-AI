import { Button, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AudiobookSegment, Character } from '@/core/types'

interface Props {
  segments: AudiobookSegment[]
  characters: Character[]
  onUpdate: (segmentId: string, changes: Partial<AudiobookSegment>) => Promise<void>
  onRetryAttribution?: (segmentId: string) => Promise<void>
}

export default function SegmentReviewTable({ segments, characters, onUpdate, onRetryAttribution }: Props) {
  const speakerOptions = [
    { value: 'narrator', label: '旁白' },
    ...characters.map((character) => ({ value: character.id, label: character.name })),
  ]

  const columns: ColumnsType<AudiobookSegment> = [
    { title: '#', dataIndex: 'order', width: 48, render: (value: number) => value + 1 },
    {
      title: '说话人',
      width: 160,
      render: (_, segment) => (
        <Select
          style={{ width: '100%' }}
          value={segment.speakerKind === 'narrator' ? 'narrator' : segment.characterId}
          options={speakerOptions}
          onChange={(value) => {
            const character = characters.find((item) => item.id === value)
            void onUpdate(segment.id, character
              ? { speakerKind: 'character', characterId: character.id, speakerName: character.name, needsReview: false, retryable: false }
              : { speakerKind: 'narrator', characterId: undefined, speakerName: '旁白', needsReview: false, retryable: false })
          }}
        />
      ),
    },
    {
      title: '归因',
      width: 160,
      render: (_, segment) => {
        const color = segment.attributionStatus === 'failed' ? 'red' : segment.needsReview ? 'gold' : segment.attributionStatus === 'manual' ? 'purple' : 'green'
        const label = segment.attributionStatus === 'failed' ? '归因失败' : segment.needsReview ? '需复核' : segment.attributionStatus === 'manual' ? '手动' : segment.attributionSource || '已归因'
        return <Space direction="vertical" size={4}>
          <Tooltip title={segment.attributionError}><Tag color={color}>{label}</Tag></Tooltip>
          {typeof segment.attributionConfidence === 'number' && <Tag>{Math.round(segment.attributionConfidence * 100)}%</Tag>}
        </Space>
      },
    },
    {
      title: '文本',
      render: (_, segment) => <Input.TextArea rows={2} value={segment.text} onChange={(event) => void onUpdate(segment.id, { text: event.target.value })} />,
    },
    {
      title: '语气 / Prompt',
      render: (_, segment) => (
        <Input.TextArea rows={2} value={segment.prompt} onChange={(event) => void onUpdate(segment.id, { prompt: event.target.value })} />
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, segment) => <Tag color={segment.status === 'completed' ? 'green' : segment.status === 'failed' ? 'red' : segment.status === 'generating' ? 'blue' : 'default'}>{segment.status}</Tag>,
    },
    {
      title: '操作',
      width: 120,
      render: (_, segment) => <Button size="small" disabled={!onRetryAttribution || (!segment.retryable && segment.attributionStatus !== 'failed' && !segment.needsReview)} onClick={() => void onRetryAttribution?.(segment.id)}>重试归因</Button>,
    },
  ]

  return <Table size="small" rowKey="id" columns={columns} dataSource={segments} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1100 }} />
}
