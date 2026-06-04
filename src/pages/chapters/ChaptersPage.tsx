import {
  Button,
  Space,
  Typography,
  Card,
  Tag,
  Empty,
  Checkbox,
  message,
  notification,
  Popconfirm,
  Tooltip,
  Progress,
  Collapse,
} from 'antd'
import {
  ExperimentOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
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
  const [autoContinue, setAutoContinue] = useState(false)
  const [writingChapterId, setWritingChapterId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
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
      const existing = chapters.find((c) => c.outlineId === outlineId)
      if (existing) return existing

      const node = outline.find((n) => n.id === outlineId)
      const newChapter: Chapter = {
        id: generateId(),
        outlineId,
        title: node?.title || '未命名章节',
        content: '',
        wordCount: 0,
        scenes: [],
        versions: [],
      }
      const updated = [...chapters, newChapter]
      await persistChapters(updated)
      return newChapter
    },
    [chapters, outline, persistChapters],
  )

  // 清空所有章节
  const handleClearAll = async () => {
    await persistChapters([])
    setActiveChapterId(null)
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
      // 自动匹配未绑定的局部约束
      let work = latestWork
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

      const currentChapters = work.chapters ?? []
      const currentOutline = work.outline ?? []
      const outlineNode = currentOutline.find((n) => n.id === chapter.outlineId)
      const chapterSummary = outlineNode?.summary || ''
      const prevChapter = currentChapters[currentChapters.findIndex((c) => c.id === chapter.id) - 1]
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
    const total = chapterOutlineNodes.length
    const withContent = chapters.filter((c) => c.wordCount > 0).length
    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0)
    const estWords = total * 3000
    const percent = estWords > 0 ? Math.min(100, Math.round((totalWords / estWords) * 100)) : 0
    return { total, withContent, totalWords, estWords, percent }
  }, [chapters, chapterOutlineNodes])

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
    </div>
  )
}
