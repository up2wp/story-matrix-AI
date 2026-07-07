import { useState, useRef, useCallback, useEffect } from 'react'
import { Typography, Button, Input, Space, Empty, Divider } from 'antd'
import {
  SearchOutlined,
  BookOutlined,
  UpOutlined,
  DownOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { Navigate } from 'react-router'
import { useProofread } from '@/features/proofread/useProofread'

const { Title, Text } = Typography

export default function ProofreadPage() {
  const {
    currentWork,
    previewData,
    findText,
    setFindText,
    replaceText,
    setReplaceText,
    findOpen,
    setFindOpen,
    currentIdx,
    totalCount,
    scrollToChapter,
    saveContent,
    saveTitle,
    handleFind,
    findNext,
    findPrev,
    replaceCurrent,
    replaceAll,
  } = useProofread()

  if (!currentWork) return <Navigate to="/works" replace />

  const totalChapters = previewData.reduce((sum, v) => sum + v.chapters.length, 0)
  const totalWords = (currentWork.chapters ?? []).reduce((sum, c) => sum + (c.wordCount || 0), 0)

  return (
    <div className="proofread-page-layout" style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>
      {/* 左栏：章节树 */}
      <div
        className="proofread-page-toc"
        style={{
          width: 260,
          flexShrink: 0,
          overflow: 'auto',
          borderRight: '1px solid #f0f0f0',
          paddingRight: 16,
        }}
      >
        <Title level={5} style={{ marginBottom: 8 }}>
          <BookOutlined style={{ marginRight: 8 }} />
          {currentWork.title}
        </Title>

        <Space orientation="vertical" size={0} style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {totalChapters} 章 · 总字数 {totalWords.toLocaleString()}
          </Text>
        </Space>

        <Divider style={{ margin: '8px 0 12px' }} />

        {previewData.map((vol) => (
          <div key={vol.volume.id} style={{ marginBottom: 8 }}>
            <Text
              strong
              style={{ fontSize: 13, display: 'block', padding: '4px 0', cursor: 'default' }}
            >
              {vol.volume.title}
            </Text>
            {vol.chapters.map(({ outline, chapter }) => (
                <Text
                  key={outline.id}
                  style={{
                    cursor: 'pointer',
                    fontSize: 12,
                    display: 'block',
                    padding: '2px 0 2px 16px',
                    color: chapter?.content ? '#333' : '#bbb',
                  }}
                  onClick={() => scrollToChapter(outline.id)}
                >
                  {outline.title}
                </Text>
              ))}
          </div>
        ))}

        {previewData.length === 0 && (
          <Empty description="暂无大纲" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>

      {/* 右栏：正文区 */}
      <div className="proofread-page-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 工具栏 */}
        <div className="proofread-toolbar" style={{ flexShrink: 0, marginBottom: 8 }}>
          <Button
            icon={<SearchOutlined />}
            type={findOpen ? 'primary' : 'default'}
            onClick={() => setFindOpen(!findOpen)}
          >
            查找替换
          </Button>
        </div>

        {/* 查找替换面板 */}
        {findOpen && (
          <div style={{
            flexShrink: 0,
            marginBottom: 12,
            padding: '10px 14px',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            background: '#fafafa',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <Input
                size="small"
                placeholder="查找"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                onPressEnter={handleFind}
                style={{ width: 160 }}
                allowClear
              />
              <Input
                size="small"
                placeholder="替换为"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                style={{ width: 160 }}
                allowClear
              />
              <Button size="small" type="primary" onClick={handleFind} disabled={!findText}>
                查找
              </Button>
              {totalCount > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  第 {currentIdx + 1}/{totalCount} 个
                </Text>
              )}
              <div style={{ flex: 1 }} />
              <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => { setFindOpen(false); }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="small" icon={<DownOutlined />} onClick={findNext} disabled={totalCount === 0}>
                查找下一个
              </Button>
              <Button size="small" icon={<UpOutlined />} onClick={findPrev} disabled={totalCount === 0}>
                查找上一个
              </Button>
              <Button size="small" onClick={replaceCurrent} disabled={currentIdx < 0}>
                替换
              </Button>
              <Button size="small" danger onClick={replaceAll} disabled={totalCount === 0}>
                全部替换
              </Button>
            </div>
          </div>
        )}

        {/* 正文滚动区 */}
        <div style={{ flex: 1, overflow: 'auto', paddingRight: 8 }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {previewData.length === 0 ? (
              <Empty description="暂无大纲，请先创建大纲" />
            ) : (
              previewData.map((vol) => (
                <div key={vol.volume.id} id={`pr-vol-${vol.volume.id}`} style={{ marginBottom: 40 }}>
                  <Title level={2} style={{ marginBottom: 4 }}>{vol.volume.title}</Title>
                  {vol.volume.summary && (
                    <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                      {vol.volume.summary}
                    </Text>
                  )}

                  {vol.chapters.map(({ outline, chapter }) => (
                    <ChapterEditBlock
                      key={outline.id}
                      outlineId={outline.id}
                      title={outline.title}
                      content={chapter?.content ?? ''}
                      onSaveContent={(c) => saveContent(outline.id, c)}
                      onSaveTitle={(t) => saveTitle(outline.id, t)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 单章编辑块 */
function ChapterEditBlock({
  outlineId,
  title,
  content,
  onSaveContent,
  onSaveTitle,
}: {
  outlineId: string
  title: string
  content: string
  onSaveContent: (c: string) => void
  onSaveTitle: (t: string) => void
}) {
  const [editingTitle, setEditingTitle] = useState(title)
  const [editingContent, setEditingContent] = useState(content)
  const composing = useRef(false)
  const contentTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const titleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 立即保存标题
  const flushTitleSave = useCallback(() => {
    const trimmed = editingTitle.trim()
    if (trimmed && trimmed !== title) {
      onSaveTitle(trimmed)
    } else if (!trimmed) {
      setEditingTitle(title)
    }
  }, [editingTitle, title, onSaveTitle])

  // 标题变更时防抖自动保存
  const handleTitleChange = useCallback(
    (val: string) => {
      setEditingTitle(val)
      if (titleTimer.current) clearTimeout(titleTimer.current)
      titleTimer.current = setTimeout(() => {
        const trimmed = val.trim()
        if (trimmed && trimmed !== title) {
          onSaveTitle(trimmed)
        }
      }, 500)
    },
    [title, onSaveTitle],
  )

  // 自动撑开 textarea 高度
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    // 加 4px 缓冲，避免最后一行被截断
    el.style.height = `${el.scrollHeight + 4}px`
  }, [])

  const handleContentChange = useCallback(
    (val: string) => {
      setEditingContent(val)
      resizeTextarea()
      if (contentTimer.current) clearTimeout(contentTimer.current)
      contentTimer.current = setTimeout(() => {
        onSaveContent(val)
      }, 500)
    },
    [onSaveContent, resizeTextarea],
  )

  // 初始撑开高度
  useEffect(() => {
    resizeTextarea()
  }, [resizeTextarea])

  const displayWordCount = (editingContent || content).replace(/\s/g, '').length

  return (
    <div id={`pr-ch-${outlineId}`} style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 8 }}>
        <Input
          value={editingTitle}
          onChange={(e) => handleTitleChange(e.target.value)}
          onPressEnter={flushTitleSave}
          style={{ fontWeight: 600, fontSize: 18, border: 'none', borderBottom: '2px solid transparent', padding: '4px 0', borderRadius: 0, background: 'transparent', width: '100%' }}
          onFocus={(e) => { e.target.style.borderBottomColor = '#1677ff' }}
          onBlur={(e) => { e.target.style.borderBottomColor = 'transparent'; flushTitleSave() }}
        />
      </div>
      <textarea
        ref={textareaRef}
        defaultValue={content}
        onChange={(e) => handleContentChange(e.target.value)}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={(e) => {
          composing.current = false
          handleContentChange((e.target as HTMLTextAreaElement).value)
        }}
        placeholder="正文内容（支持 Markdown）"
        style={{
          width: '100%',
          padding: 12,
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
          fontSize: 14,
          lineHeight: 1.8,
          whiteSpace: 'pre-wrap',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      />
      <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
        {displayWordCount.toLocaleString()} 字
      </Text>
    </div>
  )
}
