import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AudiobookSegment, Character } from '@/core/types'

interface Props {
  segments: AudiobookSegment[]
  characters: Character[]
  onUpdate: (segmentId: string, changes: Partial<AudiobookSegment>, baseVersion?: number) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
  onGenerateTonePrompt?: (segmentId: string) => Promise<void>
  onGenerateTonePrompts?: () => Promise<void>
  onMergeSegments?: (segmentIds: string[]) => Promise<void>
  onRefineSegment?: (segmentId: string) => Promise<void>
  onRetryAttribution?: (segmentId: string) => Promise<void>
  onRegenerateSegmentAudio?: (segmentId: string) => Promise<void>
  onPlaySegmentAudio?: (segment: AudiobookSegment) => Promise<void>
  onDownloadSegmentAudio?: (segment: AudiobookSegment) => Promise<void>
  scrollY?: number
}

export default function SegmentReviewTable({ segments, characters, onUpdate, onDirtyChange, onGenerateTonePrompt, onGenerateTonePrompts, onMergeSegments, onRefineSegment, onRetryAttribution, onRegenerateSegmentAudio, onPlaySegmentAudio, onDownloadSegmentAudio, scrollY }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [generatingTonePrompts, setGeneratingTonePrompts] = useState(false)
  const [generatingTonePromptSegmentId, setGeneratingTonePromptSegmentId] = useState<string | null>(null)
  const [savingDrafts, setSavingDrafts] = useState(false)
  const [draftsBySegmentId, setDraftsBySegmentId] = useState<Record<string, Partial<AudiobookSegment>>>({})
  const dirtyIds = useMemo(() => Object.keys(draftsBySegmentId), [draftsBySegmentId])
  const hasDirtySegments = dirtyIds.length > 0
  const speakerOptions = [
    { value: 'narrator', label: '旁白' },
    { value: 'bystanderMale', label: '路人男声' },
    { value: 'bystanderFemale', label: '路人女声' },
    ...characters.map((character) => ({ value: character.id, label: character.name })),
  ]

  useEffect(() => {
    onDirtyChange?.(hasDirtySegments)
  }, [hasDirtySegments, onDirtyChange])

  const draftSegment = (segment: AudiobookSegment) => ({ ...segment, ...(draftsBySegmentId[segment.id] || {}) })

  const updateDraft = (segmentId: string, changes: Partial<AudiobookSegment>) => {
    setDraftsBySegmentId((drafts) => ({
      ...drafts,
      [segmentId]: { ...(drafts[segmentId] || {}), ...changes },
    }))
  }

  const saveDrafts = async () => {
    if (!dirtyIds.length) return
    setSavingDrafts(true)
    try {
      for (const segmentId of dirtyIds) {
        const segment = segments.find((item) => item.id === segmentId)
        if (segment) await onUpdate(segmentId, draftsBySegmentId[segmentId], segment.segmentVersion)
      }
      setDraftsBySegmentId({})
    } finally {
      setSavingDrafts(false)
    }
  }

  const columns: ColumnsType<AudiobookSegment> = [
    { title: '#', dataIndex: 'order', width: 48, render: (value: number) => value + 1 },
    {
      title: '说话人',
      width: 160,
      render: (_, segment) => {
        const current = draftSegment(segment)
        return (
        <Select
          style={{ width: '100%' }}
          value={current.speakerKind === 'character' ? current.characterId : current.speakerKind}
          options={speakerOptions}
          onChange={(value) => {
            const character = characters.find((item) => item.id === value)
            updateDraft(segment.id, character
              ? { speakerKind: 'character', characterId: character.id, speakerName: character.name, needsReview: false, retryable: false }
              : value === 'bystanderMale'
                ? { speakerKind: 'bystanderMale', characterId: undefined, speakerName: '路人男声', needsReview: false, retryable: false }
                : value === 'bystanderFemale'
                  ? { speakerKind: 'bystanderFemale', characterId: undefined, speakerName: '路人女声', needsReview: false, retryable: false }
                  : { speakerKind: 'narrator', characterId: undefined, speakerName: '旁白', needsReview: false, retryable: false })
          }}
        />
        )
      },
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
      render: (_, segment) => <Input.TextArea rows={2} value={draftSegment(segment).text} onChange={(event) => updateDraft(segment.id, { text: event.target.value })} />,
    },
    {
      title: '语气 / Prompt',
      render: (_, segment) => (
        <Input.TextArea rows={2} value={draftSegment(segment).prompt} onChange={(event) => updateDraft(segment.id, { prompt: event.target.value })} />
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, segment) => {
        const status = segment.status !== 'pending' ? segment.status : segment.needsReview || segment.attributionStatus === 'needs_review' ? '待复核' : segment.attributionStatus === 'attributed' || segment.attributionStatus === 'manual' ? '已确认' : '待生成'
        return <Space direction="vertical" size={4}>
          <Tag color={segment.status === 'completed' ? 'green' : segment.status === 'failed' ? 'red' : segment.status === 'generating' ? 'blue' : status === '待复核' ? 'gold' : status === '已确认' ? 'green' : 'default'}>{status}</Tag>
          {draftsBySegmentId[segment.id] && <Tag color="orange">未保存</Tag>}
        </Space>
      },
    },
    {
      title: '操作',
      width: 320,
      render: (_, segment) => <Space wrap size={4}>
        <Button size="small" disabled={hasDirtySegments || !onRefineSegment} onClick={() => void onRefineSegment?.(segment.id)}>AI 细分</Button>
        <Button size="small" disabled={hasDirtySegments || !onRetryAttribution || (!segment.retryable && segment.attributionStatus !== 'failed' && !segment.needsReview)} onClick={() => void onRetryAttribution?.(segment.id)}>重试归因</Button>
        <Button size="small" loading={generatingTonePromptSegmentId === segment.id} disabled={hasDirtySegments || !onGenerateTonePrompt} onClick={() => {
          setGeneratingTonePromptSegmentId(segment.id)
          void onGenerateTonePrompt?.(segment.id).finally(() => setGeneratingTonePromptSegmentId(null))
        }}>重新生成语气提示词</Button>
        <Button size="small" disabled={!onRegenerateSegmentAudio || hasDirtySegments} onClick={() => void onRegenerateSegmentAudio?.(segment.id)}>重新生成音频</Button>
        <Button size="small" disabled={segment.status !== 'completed' || !segment.generationId || !onPlaySegmentAudio} onClick={() => void onPlaySegmentAudio?.(segment)}>播放</Button>
        <Button size="small" disabled={segment.status !== 'completed' || !segment.generationId || !onDownloadSegmentAudio} onClick={() => void onDownloadSegmentAudio?.(segment)}>下载</Button>
      </Space>,
    },
  ]

  return <Space direction="vertical" style={{ width: '100%' }}>
    <Space wrap>
      <Button size="small" type="primary" loading={savingDrafts} disabled={!hasDirtySegments} onClick={() => void saveDrafts()}>保存修改</Button>
      <Button size="small" disabled={!hasDirtySegments || savingDrafts} onClick={() => setDraftsBySegmentId({})}>丢弃修改</Button>
      {onGenerateTonePrompts && <Button
        size="small"
        loading={generatingTonePrompts}
        disabled={hasDirtySegments}
        onClick={() => {
          setGeneratingTonePrompts(true)
          void onGenerateTonePrompts().finally(() => setGeneratingTonePrompts(false))
        }}
      >一键生成语气</Button>}
      {onMergeSegments && <Button size="small" disabled={selectedIds.length < 2 || hasDirtySegments} onClick={() => void onMergeSegments(selectedIds).then(() => setSelectedIds([]))}>合并选中连续分段</Button>}
    </Space>
    {hasDirtySegments && <Alert type="warning" showIcon message={`有 ${dirtyIds.length} 行分段修改未保存，请先保存分段修改再生成音频或执行批量操作。`} />}
    <Table
      size="small"
      rowKey="id"
      columns={columns}
      dataSource={segments}
      pagination={{ defaultPageSize: 20, pageSizeOptions: [20, 50, 100], showSizeChanger: true }}
      rowSelection={onMergeSegments ? { selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) } : undefined}
      scroll={{ x: 1240, y: scrollY }}
    />
  </Space>
}
