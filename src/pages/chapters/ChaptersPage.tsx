import {
  Button,
  Space,
  Typography,
  Card,
  Tag,
  Empty,
  message,
  Popconfirm,
  Tooltip,
  Progress,
  Collapse,
} from 'antd'
import {
  ExperimentOutlined,
} from '@ant-design/icons'
import { useState, useCallback, useMemo } from 'react'
import type { Chapter } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generateStream } from '@/ai/client'
import { seedContext, worldContext, charactersContext, outlineContext, constraintsContext } from '@/ai/context'
import { autoMatchUnboundConstraints, getScope } from '@/utils/constraints'
import { CHAPTER_SYSTEM_PROMPT, buildChapterPrompt } from '@/ai/prompts/chapters'
import RichEditor from '@/components/editor/RichEditor'

const { Title, Text } = Typography

export default function ChaptersPage() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const readOnly = useStore((s) => s.readOnly)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [loading, setLoading] = useState(false)
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState<string | null>(null)

  const chapters = currentWork?.chapters ?? []
  const outline = currentWork?.outline ?? []
  const chapterOutlineNodes = outline.filter((n) => n.level === 'chapter')
  const activeChapter = chapters.find((c) => c.id === activeChapterId)

  // 持久化
  const persistChapters = useCallback(
    async (newChapters: Chapter[]) => {
      if (!currentWork) return
      const updated = { ...currentWork, chapters: newChapters, updatedAt: Date.now() }
      await db.works.update(currentWork.id, { chapters: newChapters })
      setCurrentWork(updated)
    },
    [currentWork, setCurrentWork],
  )

  // 为所有大纲节点生成章节（只创建还没有章节的大纲节点）
  const handleGenerateAll = async () => {
    if (!currentWork) return
    setLoading(true)
    await new Promise((r) => setTimeout(r, 600))

    const existingOutlineIds = new Set(chapters.map((c) => c.outlineId))
    const newNodes = chapterOutlineNodes.filter((node) => !existingOutlineIds.has(node.id))

    const newChapters: Chapter[] = newNodes.map((node) => ({
      id: generateId(),
      outlineId: node.id,
      title: node.title,
      content: '',
      wordCount: 0,
      scenes: [],
      versions: [],
    }))

    await persistChapters([...chapters, ...newChapters])
    setLoading(false)
    message.success(newChapters.length > 0
      ? `已创建 ${newChapters.length} 个新章节`
      : '所有大纲章节均已创建')
  }

  // 清空并重新生成所有章节
  const handleRegenerateAll = async () => {
    if (!currentWork) return
    setLoading(true)
    await new Promise((r) => setTimeout(r, 600))

    const newChapters: Chapter[] = chapterOutlineNodes.map((node) => ({
      id: generateId(),
      outlineId: node.id,
      title: node.title,
      content: '',
      wordCount: 0,
      scenes: [],
      versions: [],
    }))

    await persistChapters(newChapters)
    setActiveChapterId(null)
    setLoading(false)
    message.success(`已重新生成 ${newChapters.length} 个章节`)
  }

  // AI 生成当前章节正文（流式输出）
  const handleAIWrite = async (chapter: Chapter) => {
    if (!currentWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    setAIStream(true, '')
    try {
      // 自动匹配未绑定的局部约束
      let work = currentWork
      const matchResult = autoMatchUnboundConstraints(work.constraints, work.outline)
      if (matchResult.constraints !== work.constraints) {
        work = {
          ...work,
          constraints: matchResult.constraints,
          outline: matchResult.outline,
          updatedAt: Date.now(),
        }
        await db.works.update(work.id, {
          constraints: matchResult.constraints,
          outline: matchResult.outline,
        })
        setCurrentWork(work)
      }

      const outlineNode = outline.find((n) => n.id === chapter.outlineId)
      const chapterSummary = outlineNode?.summary || ''
      const prevChapter = chapters[chapters.findIndex((c) => c.id === chapter.id) - 1]
      const prevSummary = prevChapter ? prevChapter.content.slice(-500) : ''

      const prompt = buildChapterPrompt(
        seedContext(work),
        worldContext(work),
        charactersContext(work.characters),
        constraintsContext(work.constraints),
        chapter.title,
        chapterSummary,
        prevSummary,
      )
      const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, (chunk) => {
        setAIStream(true, chunk)
        setStreamingContent(chunk)
      })

      // 更新章节内容
      const wordCount = text.replace(/\s/g, '').length
      const updated = chapters.map((c) =>
        c.id === chapter.id ? { ...c, content: text, wordCount } : c,
      )
      await persistChapters(updated)
      setStreamingContent(null)
      setAIStream(false, text)
      message.success(`已生成「${chapter.title}」正文，${wordCount} 字`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
      setStreamingContent(null)
    } finally {
      setLoading(false)
    }
  }

  // 更新章节内容
  const handleContentChange = useCallback(
    async (chapterId: string, content: string) => {
      const wordCount = content.replace(/\s/g, '').length
      const updated = chapters.map((c) =>
        c.id === chapterId ? { ...c, content, wordCount } : c,
      )
      await persistChapters(updated)
    },
    [chapters, persistChapters],
  )

  // 找到大纲节点
  const getOutlineNode = (outlineId: string) =>
    outline.find((n) => n.id === outlineId)

  // 章节统计
  const stats = useMemo(() => {
    const total = chapters.length
    const withContent = chapters.filter((c) => c.wordCount > 0).length
    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0)
    const estWords = total * 3000
    const percent = estWords > 0 ? Math.min(100, Math.round((totalWords / estWords) * 100)) : 0
    return { total, withContent, totalWords, estWords, percent }
  }, [chapters])

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 160px)' }}>
      {/* 左侧：章节列表 */}
      <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 固定头部：按钮 + 统计 */}
        <div style={{ flexShrink: 0, marginBottom: 12 }}>
          <div style={{ marginBottom: 8 }}>
            {!readOnly && chapters.length === 0 && (
              <Button
                type="primary"
                icon={<ExperimentOutlined />}
                onClick={handleGenerateAll}
                loading={loading}
                size="small"
              >
                生成全部章节
              </Button>
            )}
          </div>
          {chapters.length > 0 && (
            <div>
              <Space style={{ marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  已写 {stats.withContent}/{stats.total} 章
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {stats.totalWords.toLocaleString()}/{stats.estWords.toLocaleString()} 字
                </Text>
              </Space>
              <Progress percent={stats.percent} size="small" showInfo={false} />
            </div>
          )}
        </div>

        {/* 可滚动章节列表 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {chapters.length === 0 && !loading ? (
            <Empty description="先在大纲中创建章节" />
          ) : (
            chapters.map((chapter) => {
              const node = getOutlineNode(chapter.outlineId)
              const isActive = chapter.id === activeChapterId
              return (
                <div
                  key={chapter.id}
                  style={{
                    cursor: 'pointer',
                    background: isActive ? '#e6f4ff' : undefined,
                    padding: '8px 12px',
                    borderRadius: 6,
                    marginBottom: 4,
                  }}
                  onClick={() => setActiveChapterId(chapter.id)}
                >
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong style={{ fontSize: 13 }}>{chapter.title}</Text>
                      {chapter.wordCount > 0 && (
                        <Tag color="blue" style={{ fontSize: 11 }}>
                          {chapter.wordCount}
                        </Tag>
                      )}
                    </div>
                    {node && (
                      <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                        {node.summary}
                      </Text>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* 清空所有正文 */}
        {!readOnly && chapters.length > 0 && (
          <div style={{ flexShrink: 0, paddingTop: 8, borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
            <Popconfirm
              title="确定清空所有已写正文？此操作不可恢复"
              onConfirm={handleRegenerateAll}
              okText="确认清空"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button type="link" size="small" danger style={{ fontSize: 12 }}>
                清空所有正文
              </Button>
            </Popconfirm>
          </div>
        )}
      </div>

      {/* 右侧：编辑区 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!activeChapter ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Empty description="选择左侧章节开始写作" />
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Title level={4} style={{ margin: 0 }}>{activeChapter.title}</Title>
              {!readOnly && (
                <Button
                  icon={<ExperimentOutlined />}
                  onClick={() => handleAIWrite(activeChapter)}
                  loading={loading}
                >
                  AI 生成正文
                </Button>
              )}
            </div>

            {/* 大纲摘要 */}
            {getOutlineNode(activeChapter.outlineId)?.summary && (
              <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  大纲摘要：{getOutlineNode(activeChapter.outlineId)!.summary}
                </Text>
              </Card>
            )}

            {/* 更多信息折叠面板 */}
            {(() => {
              const node = getOutlineNode(activeChapter.outlineId)
              if (!node) return null
              const nodeCharacters = (node.characterIds || [])
                .map((name) => currentWork?.characters.find((c) => c.name === name || c.id === name))
                .filter(Boolean)
              const nodeConstraints = (node.constraintIds || [])
                .map((cid) => currentWork?.constraints.find((c) => c.id === cid))
                .filter(Boolean)
              if (!nodeCharacters.length && !nodeConstraints.length) return null
              return (
                <Collapse
                  size="small"
                  style={{ marginBottom: 16 }}
                  items={[{
                    key: 'details',
                    label: <Text type="secondary" style={{ fontSize: 13 }}>查看更多</Text>,
                    children: (
                      <div>
                        {nodeCharacters.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>涉及人物</Text>
                            <Space wrap size={[4, 4]}>
                              {nodeCharacters.map((c) => (
                                <Tag key={c!.id} color="blue">{c!.name}</Tag>
                              ))}
                            </Space>
                          </div>
                        )}
                        {nodeConstraints.length > 0 && (
                          <div>
                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>核心约束</Text>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {nodeConstraints.map((c) => {
                                const scope = getScope(c!)
                                return (
                                  <div key={c!.id}>
                                    <Tag color={scope === 'global' ? 'cyan' : 'geekblue'} style={{ fontSize: 11 }}>
                                      {scope === 'global' ? '🌐' : '📌'} {c!.title}
                                    </Tag>
                                    <Text type="secondary" style={{ fontSize: 11 }}>{c!.description}</Text>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ),
                  }]}
                />
              )
            })()}

            {/* 正文编辑器 */}
            <Card styles={{ body: { padding: 0, minHeight: 400 } }}>
              <RichEditor
                content={streamingContent ?? activeChapter.content}
                onChange={(content) => handleContentChange(activeChapter.id, content)}
                editable={!readOnly && streamingContent === null}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
