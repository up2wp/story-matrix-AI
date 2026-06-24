import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Button, List, Modal, Space, Tag, Typography, message } from 'antd'
import { FileTextOutlined, RobotOutlined, UploadOutlined } from '@ant-design/icons'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generate } from '@/ai/client'
import { buildImportBoundaryPrompt, IMPORT_BOUNDARY_SYSTEM_PROMPT } from '@/ai/prompts/import'
import {
  applyAiBoundarySuggestions,
  canImportNovelFile,
  createWorkFromImportDraft,
  parseAiBoundaryJson,
  parseNovelImportDraft,
  type NovelImportDraft,
} from '@/features/import/novelImport'

const { Text, Paragraph } = Typography

interface NovelImportModalProps {
  open: boolean
  ownerId: string
  onCancel: () => void
  onImported: () => void
}

export default function NovelImportModal({ open, ownerId, onCancel, onImported }: NovelImportModalProps) {
  const navigate = useNavigate()
  const setCurrentWork = useStore(s => s.setCurrentWork)
  const setReadOnly = useStore(s => s.setReadOnly)
  const aiConfig = useSystemConfigStore(s => s.aiConfig)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<NovelImportDraft | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [reading, setReading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [creating, setCreating] = useState(false)

  const errorIssues = useMemo(() => draft?.issues.filter(issue => issue.level === 'error') ?? [], [draft])
  const warningIssues = useMemo(() => draft?.issues.filter(issue => issue.level === 'warning') ?? [], [draft])
  const lowConfidenceChapters = useMemo(
    () => draft?.chapters.filter(chapter => chapter.needsReview || chapter.confidence < 0.8) ?? [],
    [draft],
  )
  const canCreate = Boolean(draft && draft.chapters.length > 0 && errorIssues.length === 0 && lowConfidenceChapters.length === 0)

  const reset = () => {
    setDraft(null)
    setSourceText('')
    setReading(false)
    setSuggesting(false)
    setCreating(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleCancel = () => {
    reset()
    onCancel()
  }

  const handleSelectFile = async (file: File) => {
    setReading(true)
    try {
      if (!canImportNovelFile(file.name)) {
        setDraft(parseNovelImportDraft(file.name, ''))
        message.warning('仅支持导入 .txt 或 .md 文件')
        return
      }
      const text = await file.text()
      setSourceText(text)
      setDraft(parseNovelImportDraft(file.name, text))
    } finally {
      setReading(false)
    }
  }

  const handleSuggestBoundaries = async () => {
    if (!draft || !sourceText.trim()) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI')
      return
    }
    setSuggesting(true)
    try {
      const result = await generate(buildImportBoundaryPrompt(sourceText), IMPORT_BOUNDARY_SYSTEM_PROMPT, { ...aiConfig, maxTokens: 1200 })
      const suggestions = parseAiBoundaryJson(result)
      setDraft(applyAiBoundarySuggestions(draft, suggestions))
      message.success(`AI 返回 ${suggestions.length} 个边界建议，请确认后再创建作品`)
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : 'AI 边界建议失败')
    } finally {
      setSuggesting(false)
    }
  }

  const handleConfirm = async () => {
    if (!draft || !canCreate) return
    setCreating(true)
    try {
      const work = createWorkFromImportDraft(draft, ownerId)
      await db.works.add(work)
      setCurrentWork(work)
      setReadOnly(false)
      message.success(`已导入「${work.title}」，可继续查看章节或进入阶段反推`)
      onImported()
      reset()
      onCancel()
      navigate('/backfill')
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '导入失败，请重试')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      title="导入本地小说"
      open={open}
      mask={{ closable: false }}
      width={720}
      onCancel={handleCancel}
      onOk={handleConfirm}
      okText="确认创建作品"
      cancelText="取消"
      confirmLoading={creating}
      okButtonProps={{ disabled: !canCreate }}
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          选择本地 .txt 或 .md 文件后，系统只在浏览器内解析章节，不会上传原文件。确认无阻断问题后才会创建新作品。
          创建后可根据已导入正文提出阶段反推候选，未确认不会写入作品。
        </Paragraph>

        <Space wrap>
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleSelectFile(file)
            }}
          />
          <Button icon={<UploadOutlined />} loading={reading} onClick={() => inputRef.current?.click()}>
            选择文件
          </Button>
          <Text type="secondary">支持 .txt / .md</Text>
        </Space>

        {draft && (
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Space wrap>
              <Tag icon={<FileTextOutlined />}>{draft.fileName}</Tag>
              <Tag color="blue">{draft.chapters.length} 章</Tag>
              <Tag color={draft.issues.length ? 'orange' : 'green'}>{draft.issues.length} 个问题</Tag>
            </Space>

            {errorIssues.length > 0 && (
              <Alert
                type="error"
                showIcon
                message="导入被阻止"
                description="存在错误问题，无法创建作品。请更换文件或调整文本后重新选择。"
              />
            )}
            {draft.chapters.length === 0 && (
              <Alert
                type="warning"
                showIcon
                message="未识别到章节"
                description="可以先在文本中补充明确章节标题，或使用 AI 对短摘录提出边界建议。AI 建议必须人工确认后才能创建作品。"
                action={sourceText.trim() && (
                  <Button size="small" icon={<RobotOutlined />} loading={suggesting} onClick={handleSuggestBoundaries}>
                    AI 建议边界
                  </Button>
                )}
              />
            )}
            {warningIssues.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="需要人工确认"
                description={warningIssues.map(issue => issue.message).join('；')}
              />
            )}
            {lowConfidenceChapters.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="存在低置信度章节"
                description={`${lowConfidenceChapters.length} 个章节需要确认。当前只支持确认导入，不支持在弹窗内编辑边界。`}
              />
            )}

            <List
              size="small"
              bordered
              header="检测到的章节"
              locale={{ emptyText: '暂无章节' }}
              dataSource={draft.chapters}
              style={{ maxHeight: 280, overflow: 'auto' }}
              renderItem={(chapter) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space wrap>
                      <Text strong>{chapter.title}</Text>
                      <Tag>{chapter.wordCount} 字</Tag>
                      <Tag color={chapter.source === 'ai' ? 'purple' : 'blue'}>{chapter.source === 'ai' ? 'AI 建议' : '规则识别'}</Tag>
                      <Tag color={chapter.confidence >= 0.8 && !chapter.needsReview ? 'green' : 'orange'}>
                        置信度 {Math.round(chapter.confidence * 100)}%
                      </Tag>
                    </Space>
                    {chapter.needsReview && <Text type="warning">需要确认章节内容或边界</Text>}
                  </Space>
                </List.Item>
              )}
            />
          </Space>
        )}
      </Space>
    </Modal>
  )
}
