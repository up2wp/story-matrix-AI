import {
  Button,
  Space,
  Typography,
  Card,
  Tag,
  Empty,
  Checkbox,
  Input,
  message,
  notification,
  Popconfirm,
  Progress,
  Collapse,
  Modal,
  List,
} from 'antd'
import {
  ExperimentOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  BookOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { Chapter } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generateStream } from '@/ai/client'
import { seedContext, worldContext, charactersContext, constraintsContext, eventLogContext } from '@/ai/context'
import { CHAPTER_SYSTEM_PROMPT, buildChapterPrompt, buildExtractEventsPrompt } from '@/ai/prompts/chapters'
import { DEFAULT_EVENT_LOG_CONFIG } from '@/features/seed/options'
import type { EventLogEntry, EventLogConfig } from '@/core/types'
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
  const [autoContinue, setAutoContinue] = useState(false)
  const [writingChapterId, setWritingChapterId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [eventLogOpen, setEventLogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelAutoRef = useRef(false)

  // 清理倒计时定时器
  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
      }
      notification.destroy('auto-continue')
    }
  }, [])

  const chapters = currentWork?.chapters ?? []
  const outline = currentWork?.outline ?? []
  const chapterOutlineNodes = outline.filter((n) => n.level === 'chapter')
  const activeChapter = chapters.find((c) => c.id === activeChapterId)

  // 持久化（始终从 store 取最新 currentWork）
  const persistChapters = useCallback(
    async (newChapters: Chapter[]) => {
      const work = useStore.getState().currentWork
      if (!work) return
      const updated = { ...work, chapters: newChapters, updatedAt: Date.now() }
      await db.works.update(work.id, { chapters: newChapters })
      setCurrentWork(updated)
    },
    [setCurrentWork],
  )

  // 确保章节存在（自动从大纲创建缺失的章节）
  const ensureChapter = useCallback(
    async (outlineId: string): Promise<Chapter> => {
      const work = useStore.getState().currentWork
      if (!work) throw new Error('无当前作品')
      const currentChapters = work.chapters ?? []
      const currentOutline = work.outline ?? []
      const existing = currentChapters.find((c) => c.outlineId === outlineId)
      if (existing) return existing

      const node = currentOutline.find((n) => n.id === outlineId)
      const newChapter: Chapter = {
        id: generateId(),
        outlineId,
        title: node?.title || '未命名章节',
        content: '',
        wordCount: 0,
        scenes: [],
        versions: [],
      }
      const updated = [...currentChapters, newChapter]
      await persistChapters(updated)
      return newChapter
    },
    [persistChapters],
  )

  // 清空所有章节（同时清空事件簿）
  const handleClearAll = async () => {
    await persistChapters([])
    setActiveChapterId(null)
    // 清空事件簿
    const work = useStore.getState().currentWork
    if (work?.eventLog?.length) {
      await db.works.update(work.id, { eventLog: [] })
      setCurrentWork({ ...work, eventLog: [], updatedAt: Date.now() })
    }
    message.success('已清空所有章节')
  }

  // 取消自动续写
  const cancelAutoContinue = () => {
    cancelAutoRef.current = true
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    setCountdown(0)
    setAutoContinue(false)
    notification.destroy('auto-continue')
  }

  // 显示完成通知（带倒计时）
  const showCompletionNotification = (title: string, wordCount: number, hasNext: boolean): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!hasNext || !autoContinue) {
        notification.success({
          title: '章节完成',
          description: `「${title}」已生成 ${wordCount} 字`,
          duration: 3,
        })
        resolve(false)
        return
      }

      cancelAutoRef.current = false
      let seconds = 10
      setCountdown(seconds)

      const tick = () => {
        if (cancelAutoRef.current) {
          resolve(false)
          return
        }
        seconds--
        setCountdown(seconds)

        if (seconds <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          notification.destroy('auto-continue')
          resolve(true)
          return
        }

        notification.open({
          key: 'auto-continue',
          title: '章节完成',
          description: (
            <div>
              <div>「{title}」已生成 {wordCount} 字</div>
              <div style={{ marginTop: 8 }}>
                {seconds} 秒后自动开始下一章
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    cancelAutoContinue()
                    resolve(false)
                  }}
                  style={{ marginLeft: 8 }}
                >
                  取消
                </Button>
              </div>
            </div>
          ),
          icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
          duration: 0,
          onClose: () => resolve(false),
        })
      }

      tick()
      countdownRef.current = setInterval(tick, 1000)
    })
  }

  // AI 生成当前章节正文（流式输出）
  const handleAIWrite = async (chapter: Chapter) => {
    // 每次调用时从 store 获取最新状态
    const latestWork = useStore.getState().currentWork
    if (!latestWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    setWritingChapterId(chapter.id)
    setActiveChapterId(chapter.id)
    setAIStream(true, '')
    try {
      const work = latestWork
      const currentChapters = work.chapters ?? []
      const currentOutline = work.outline ?? []
      const outlineNode = currentOutline.find((n) => n.id === chapter.outlineId)
      const chapterSummary = outlineNode?.summary || ''
      const prevChapter = currentChapters[currentChapters.findIndex((c) => c.id === chapter.id) - 1]
      const prevSummary = prevChapter ? prevChapter.content.slice(-500) : ''

      // 事件簿上下文
      const eventLog = work.eventLog ?? []
      const eventLogStr = eventLogContext(eventLog, chapter.id)

      const prompt = buildChapterPrompt(
        seedContext(work),
        worldContext(work),
        charactersContext(work.characters),
        constraintsContext(work.constraints),
        chapter.title,
        chapterSummary,
        prevSummary,
        eventLogStr,
      )
      const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
        setStreamingContent(fullText)
      })

      // 更新章节内容（使用最新数据）
      const wordCount = text.replace(/\s/g, '').length
      const latestChapters = useStore.getState().currentWork?.chapters ?? []
      const updated = latestChapters.map((c) =>
        c.id === chapter.id ? { ...c, content: text, wordCount } : c,
      )
      await persistChapters(updated)
      setStreamingContent(null)
      setWritingChapterId(null)
      setAIStream(false, text)

      // 提取事件到事件簿（需 await 避免并发流累积 fetch buffer）
      await extractEvents(chapter, text, work)

      // 显示完成通知，等待倒计时
      const currentOutlineNodes = currentOutline.filter((n) => n.level === 'chapter')
      const currentOutlineIndex = currentOutlineNodes.findIndex((n) => n.id === chapter.outlineId)
      const nextOutlineNode = currentOutlineNodes[currentOutlineIndex + 1]
      const shouldContinue = await showCompletionNotification(chapter.title, wordCount, !!nextOutlineNode)

      // 自动开始下一章
      if (shouldContinue && nextOutlineNode) {
        const nextChapter = await ensureChapter(nextOutlineNode.id)
        setActiveChapterId(nextChapter.id)
        await handleAIWrite(nextChapter)
      } else if (!nextOutlineNode && autoContinue) {
        message.info('已是最后一章，自动完成')
        setAutoContinue(false)
      }
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
      setStreamingContent(null)
      setWritingChapterId(null)
      setAutoContinue(false)
    } finally {
      setLoading(false)
    }
  }

  // 从章节内容提取事件
  const extractEvents = async (chapter: Chapter, content: string, work: NonNullable<typeof currentWork>) => {
    if (!work || !aiConfig.apiKey) return
    const config = work.eventLogConfig ?? DEFAULT_EVENT_LOG_CONFIG
    if (!config.enabled) return

    try {
      const prompt = buildExtractEventsPrompt(
        chapter.title,
        content,
        charactersContext(work.characters),
        config.extractPrompt,
      )
      const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, () => {})

      // 解析 JSON（兼容 AI 输出带多余内容的情况）
      let result: any[] = []
      try {
        const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
        // 找到第一个 [ 和最后一个 ]
        const start = cleaned.indexOf('[')
        const end = cleaned.lastIndexOf(']')
        if (start !== -1 && end > start) {
          let jsonStr = cleaned.slice(start, end + 1)
          // 尝试解析，如果失败则逐步截断末尾的 }
          for (let i = 0; i < 5; i++) {
            try {
              result = JSON.parse(jsonStr)
              break
            } catch {
              // 找到最后一个完整对象的位置
              const lastBrace = jsonStr.lastIndexOf('}')
              if (lastBrace > 0) {
                jsonStr = jsonStr.slice(0, lastBrace + 1) + ']'
              } else {
                break
              }
            }
          }
        }
      } catch {}

      if (!Array.isArray(result) || !result.length) return

      // 构建事件条目
      const newEntries: EventLogEntry[] = result
        .filter((item) => item.description && item.type)
        .map((item) => ({
          id: generateId(),
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          type: item.type,
          characters: Array.isArray(item.characters) ? item.characters : [],
          description: item.description.slice(0, 100),
          timestamp: Date.now(),
        }))

      if (!newEntries.length) return

      // 保存事件簿
      const latestWork = useStore.getState().currentWork
      if (!latestWork) return
      const updatedEventLog = [...(latestWork.eventLog ?? []), ...newEntries]
      await db.works.update(latestWork.id, { eventLog: updatedEventLog })
      setCurrentWork({ ...latestWork, eventLog: updatedEventLog, updatedAt: Date.now() })
    } catch {
      // 事件提取失败不影响主流程
    }
  }

  // 更新章节内容
  const handleContentChange = useCallback(
    async (chapterId: string, content: string) => {
      const wordCount = content.replace(/\s/g, '').length
      const currentChapters = useStore.getState().currentWork?.chapters ?? []
      const updated = currentChapters.map((c) =>
        c.id === chapterId ? { ...c, content, wordCount } : c,
      )
      await persistChapters(updated)
    },
    [persistChapters],
  )

  // 找到大纲节点
  const getOutlineNode = (outlineId: string) =>
    outline.find((n) => n.id === outlineId)

  // 章节统计（只统计有关联大纲节点的章节，排除孤儿）
  const stats = useMemo(() => {
    const validIds = new Set(chapterOutlineNodes.map((n) => n.id))
    const validChapters = chapters.filter((c) => validIds.has(c.outlineId))
    const total = chapterOutlineNodes.length
    const withContent = validChapters.filter((c) => c.wordCount > 0).length
    const totalWords = validChapters.reduce((sum, c) => sum + c.wordCount, 0)
    const estWords = total * 3000
    const percent = estWords > 0 ? Math.min(100, Math.round((totalWords / estWords) * 100)) : 0
    return { total, withContent, totalWords, estWords, percent }
  }, [chapters, chapterOutlineNodes])

  // 删除事件条目
  const handleDeleteEvent = async (eventId: string) => {
    const work = useStore.getState().currentWork
    if (!work) return
    const updatedEventLog = (work.eventLog ?? []).filter((e) => e.id !== eventId)
    await db.works.update(work.id, { eventLog: updatedEventLog })
    setCurrentWork({ ...work, eventLog: updatedEventLog, updatedAt: Date.now() })
  }

  // 按章节分组的事件簿
  const groupedEvents = useMemo(() => {
    const eventLog = currentWork?.eventLog ?? []
    const groups: { chapterTitle: string; events: typeof eventLog }[] = []
    const map = new Map<string, typeof eventLog>()
    for (const e of eventLog) {
      const key = e.chapterTitle
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    for (const [chapterTitle, events] of map) {
      groups.push({ chapterTitle, events })
    }
    return groups
  }, [currentWork?.eventLog])

  // 事件类型标签颜色
  const eventTypeColor: Record<string, string> = {
    combat: 'red',
    relationship: 'blue',
    revelation: 'purple',
    foreshadow: 'orange',
    death: 'magenta',
    item: 'green',
    progress: 'volcano',
    status: 'cyan',
    location: 'gold',
    other: 'default',
  }

  return (
    <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>
      {/* 左侧：章节列表 */}
      <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 固定头部：统计 */}
        <div style={{ flexShrink: 0, marginBottom: 12 }}>
          {chapterOutlineNodes.length > 0 && (
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
              <Button
                size="small"
                icon={<BookOutlined />}
                onClick={() => setEventLogOpen(true)}
                style={{ marginTop: 8, width: '100%' }}
              >
                📋 事件簿 ({(currentWork?.eventLog ?? []).length})
              </Button>
            </div>
          )}
        </div>

        {/* 可滚动章节列表 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {chapterOutlineNodes.length === 0 ? (
            <Empty description="先在大纲中创建章节" />
          ) : (
            chapterOutlineNodes.map((node) => {
              const chapter = chapters.find((c) => c.outlineId === node.id)
              const isActive = chapter?.id === activeChapterId
              const isWriting = chapter?.id === writingChapterId
              const hasContent = chapter && chapter.wordCount > 0
              return (
                <div
                  key={node.id}
                  style={{
                    cursor: 'pointer',
                    background: isActive ? '#e6f4ff' : undefined,
                    padding: '8px 12px',
                    borderRadius: 6,
                    marginBottom: 4,
                  }}
                  onClick={async () => {
                    const ch = await ensureChapter(node.id)
                    setActiveChapterId(ch.id)
                  }}
                >
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong style={{ fontSize: 13 }}>{node.title}</Text>
                      {isWriting ? (
                        <Tag color="processing" icon={<LoadingOutlined />} style={{ fontSize: 11 }}>
                          写作中
                        </Tag>
                      ) : hasContent ? (
                        <Tag color="blue" style={{ fontSize: 11 }}>
                          {chapter!.wordCount} 字
                        </Tag>
                      ) : null}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                      {node.summary}
                    </Text>
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
              onConfirm={handleClearAll}
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!activeChapter ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Empty description="选择左侧章节开始写作" />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
              <Space>
                <Title level={4} style={{ margin: 0 }}>{activeChapter.title}</Title>
                {writingChapterId === activeChapter.id && (
                  <Tag color="processing" icon={<LoadingOutlined />}>写作中</Tag>
                )}
              </Space>
              {!readOnly && (
                <Space>
                  {countdown > 0 && (
                    <Space>
                      <Text type="secondary">{countdown} 秒后开始下一章</Text>
                      <Button size="small" onClick={cancelAutoContinue}>取消</Button>
                    </Space>
                  )}
                  <Checkbox
                    checked={autoContinue}
                    onChange={(e) => setAutoContinue(e.target.checked)}
                    disabled={loading}
                  >
                    完成后自动开始下一章
                  </Checkbox>
                  <Button
                    icon={<ExperimentOutlined />}
                    onClick={() => handleAIWrite(activeChapter)}
                    loading={loading}
                  >
                    AI 生成正文
                  </Button>
                </Space>
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
              if (!nodeCharacters.length) return null
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
                          <div>
                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>涉及人物</Text>
                            <Space wrap size={[4, 4]}>
                              {nodeCharacters.map((c) => (
                                <Tag key={c!.id} color="blue">{c!.name}</Tag>
                              ))}
                            </Space>
                          </div>
                        )}
                      </div>
                    ),
                  }]}
                />
              )
            })()}

            {/* 正文编辑器 */}
            <Card styles={{ body: { padding: 0, flex: 1, display: 'flex', flexDirection: 'column' } }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <RichEditor
                content={writingChapterId === activeChapter.id ? (streamingContent ?? activeChapter.content) : activeChapter.content}
                onChange={(content) => handleContentChange(activeChapter.id, content)}
                editable={!readOnly && (writingChapterId !== activeChapter.id || streamingContent === null)}
                height="100%"
              />
            </Card>
          </div>
        )}
      </div>

      {/* 事件簿弹窗 */}
      <Modal
        title={`📋 事件簿 (${(currentWork?.eventLog ?? []).length} 条)`}
        open={eventLogOpen}
        onCancel={() => setEventLogOpen(false)}
        footer={null}
        width={600}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {/* 事件提取配置 */}
        <Card size="small" styles={{ body: { marginBottom: 16, background: '#fafafa', padding: 12 } }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
            ⚙️ 提取配置（修改后下次写作生效）：
          </Text>
          <Input.TextArea
            rows={6}
            value={editingPrompt ?? currentWork?.eventLogConfig?.extractPrompt ?? DEFAULT_EVENT_LOG_CONFIG.extractPrompt}
            onChange={(e) => setEditingPrompt(e.target.value)}
            onBlur={async () => {
              if (!currentWork || editingPrompt === null) return
              const newConfig = {
                ...currentWork.eventLogConfig,
                enabled: true,
                extractPrompt: editingPrompt,
              } as EventLogConfig
              await db.works.update(currentWork.id, { eventLogConfig: newConfig })
              setCurrentWork({ ...currentWork, eventLogConfig: newConfig })
              setEditingPrompt(null)
            }}
            style={{ fontSize: 12, fontFamily: 'monospace' }}
          />
          <Button
            size="small"
            style={{ marginTop: 8 }}
            onClick={async () => {
              if (!currentWork) return
              const newConfig = { ...DEFAULT_EVENT_LOG_CONFIG }
              await db.works.update(currentWork.id, { eventLogConfig: newConfig })
              setCurrentWork({ ...currentWork, eventLogConfig: newConfig })
              setEditingPrompt(null)
            }}
          >
            恢复默认
          </Button>
        </Card>

        {groupedEvents.length === 0 ? (
          <Empty description="暂无事件记录，AI 写作后会自动提取" />
        ) : (
          groupedEvents.map((group) => (
            <div key={group.chapterTitle} style={{ marginBottom: 16 }}>
              <Text strong style={{ fontSize: 13 }}>{group.chapterTitle}</Text>
              <List
                size="small"
                dataSource={group.events}
                renderItem={(event) => (
                  <List.Item
                    actions={[
                      <Popconfirm key="del" title="确定删除？" onConfirm={() => handleDeleteEvent(event.id)}>
                        <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space size={4}>
                          <Tag color={eventTypeColor[event.type] || 'default'} style={{ margin: 0 }}>
                            {event.type}
                          </Tag>
                          {event.characters.length > 0 && (
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              ({event.characters.join('、')})
                            </Text>
                          )}
                        </Space>
                      }
                      description={<Text style={{ fontSize: 12 }}>{event.description}</Text>}
                    />
                  </List.Item>
                )}
              />
            </div>
          ))
        )}
      </Modal>
    </div>
  )
}
