import { useState } from 'react'
import { Button, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AudiobookSegment, Character } from '@/core/types'

interface Props {
  segments: AudiobookSegment[]
  characters: Character[]
  onUpdate: (segmentId: string, changes: Partial<AudiobookSegment>) => Promise<void>
  onGenerateTonePrompts?: () => Promise<void>
  onMergeSegments?: (segmentIds: string[]) => Promise<void>
  onRetryAttribution?: (segmentId: string) => Promise<void>
  scrollY?: number
}

export default function SegmentReviewTable({ segments, characters, onUpdate, onGenerateTonePrompts, onMergeSegments, onRetryAttribution, scrollY }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [generatingTonePrompts, setGeneratingTonePrompts] = useState(false)
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
      render: (_, segment) => {
        const status = segment.status !== 'pending' ? segment.status : segment.needsReview || segment.attributionStatus === 'needs_review' ? '待复核' : segment.attributionStatus === 'attributed' || segment.attributionStatus === 'manual' ? '已确认' : '待生成'
        return <Tag color={segment.status === 'completed' ? 'green' : segment.status === 'failed' ? 'red' : segment.status === 'generating' ? 'blue' : status === '待复核' ? 'gold' : status === '已确认' ? 'green' : 'default'}>{status}</Tag>
      },
    },
    {
      title: '操作',
      width: 120,
      render: (_, segment) => <Button size="small" disabled={!onRetryAttribution || (!segment.retryable && segment.attributionStatus !== 'failed' && !segment.needsReview)} onClick={() => void onRetryAttribution?.(segment.id)}>重试归因</Button>,
    },
  ]

  return <Space direction="vertical" style={{ width: '100%' }}>
    <Space wrap>
      {onGenerateTonePrompts && <Button
        size="small"
        loading={generatingTonePrompts}
        onClick={() => {
          setGeneratingTonePrompts(true)
          void onGenerateTonePrompts().finally(() => setGeneratingTonePrompts(false))
        }}
      >一键生成语气</Button>}
      {onMergeSegments && <Button size="small" disabled={selectedIds.length < 2} onClick={() => void onMergeSegments(selectedIds).then(() => setSelectedIds([]))}>合并选中连续分段</Button>}
    </Space>
    <Table
      size="small"
      rowKey="id"
      columns={columns}
      dataSource={segments}
      pagination={{ defaultPageSize: 20, pageSizeOptions: [20, 50, 100], showSizeChanger: true }}
      rowSelection={onMergeSegments ? { selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) } : undefined}
      scroll={{ x: 1100, y: scrollY }}
    />
  </Space>
}
