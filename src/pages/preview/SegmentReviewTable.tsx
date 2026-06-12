import { Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AudiobookSegment, Character } from '@/core/types'

interface Props {
  segments: AudiobookSegment[]
  characters: Character[]
  onUpdate: (segmentId: string, changes: Partial<AudiobookSegment>) => Promise<void>
}

export default function SegmentReviewTable({ segments, characters, onUpdate }: Props) {
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
              ? { speakerKind: 'character', characterId: character.id, speakerName: character.name }
              : { speakerKind: 'narrator', characterId: undefined, speakerName: '旁白' })
          }}
        />
      ),
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
  ]

  return <Table size="small" rowKey="id" columns={columns} dataSource={segments} pagination={false} scroll={{ x: 900 }} />
}
