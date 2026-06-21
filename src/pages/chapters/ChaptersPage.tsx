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
  Spin,
} from 'antd'
import {
  ExperimentOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  BookOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { diffChars } from 'diff'
import type { Chapter } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generate, generateStream } from '@/ai/client'
import { seedContext, worldContext, charactersContext, constraintsContext, eventLogContext } from '@/ai/context'
import { CHAPTER_SYSTEM_PROMPT, buildChapterPrompt, buildExtractEventsPrompt, buildInspirationPrompt, buildInspirationChapterPrompt, buildIssueScanPrompt, buildChapterFixPrompt, buildRefinePrompt } from '@/ai/prompts/chapters'
import { DEFAULT_EVENT_LOG_CONFIG } from '@/features/seed/options'
import type { EventLogEntry, EventLogConfig } from '@/core/types'
import RichEditor from '@/components/editor/RichEditor'
import ChapterAudiobookPanel from './ChapterAudiobookPanel'

const { Title, Text } = Typography

export default function ChaptersPage() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const readOnly = useStore((s) => s.readOnly)
  const aiPanelOpen = useStore((s) => s.aiPanelOpen)
  const toggleAIPanel = useStore((s) => s.toggleAIPanel)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [loading, setLoading] = useState(false)
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [autoContinue, setAutoContinue] = useState(false)
  const [writingChapterId, setWritingChapterId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [eventLogOpen, setEventLogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const [directionOpen, setDirectionOpen] = useState(false)
  const [directionDraft, setDirectionDraft] = useState('')
  const directionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 快速续写
  const [qwOpen, setQwOpen] = useState(false)
  const [qwStep, setQwStep] = useState<'mode' | 'inspire'>('mode')
  const [qwMode, setQwMode] = useState<'newVolume' | 'continue'>('continue')
  const [qwInspirations, setQwInspirations] = useState<{ title: string; summary: string }[]>([])
  const [qwLoading, setQwLoading] = useState(false)
  // AI 微调
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineInstruction, setRefineInstruction] = useState('')
  const [refineOriginal, setRefineOriginal] = useState('')
  const [refineResult, setRefineResult] = useState('')
  const [refineLoading, setRefineLoading] = useState(false)
  const [refineDone, setRefineDone] = useState(false)
  const [refineDiffKey, setRefineDiffKey] = useState(0)
  const [refineEditing, setRefineEditing] = useState(false)
  // 全文检查
  const [checkStep, setCheckStep] = useState<'select' | 'scanning' | 'issues' | 'fixing' | null>(null)
  const [checkVolumes, setCheckVolumes] = useState<string[]>([])
  const [checkFocus, setCheckFocus] = useState('')
  const [checkIssues, setCheckIssues] = useState<{ chapterTitle: string; issue: string; findText: string; severity: string }[]>([])
  const [selectedIssueIdx, setSelectedIssueIdx] = useState<number[]>([])
  const [fixDraft, setFixDraft] = useState('')
  const [fixChanges, setFixChanges] = useState<string[]>([])
  const [fixChapterTitle, setFixChapterTitle] = useState('')
  const [fixQueue, setFixQueue] = useState<string[]>([]) // 按章节标题去重后的队列
  const [diffKey, setDiffKey] = useState(0)
  const [editingFix, setEditingFix] = useState(false)
  const [nextFixReady, setNextFixReady] = useState<{ content: string; changes: string[]; title: string } | null>(null)
  const diffLeftRef = useRef<HTMLDivElement>(null)
  const diffRightRef = useRef<HTMLDivElement>(null)
  const [leftScrollPercent, setLeftScrollPercent] = useState(0)
  const [rightScrollPercent, setRightScrollPercent] = useState(0)
  const diffEditorRef = useRef<any>(null)
  const diffScrollLock = useRef(false)
  // 微调弹窗独立 refs/state
  const refineDiffLeftRef = useRef<HTMLDivElement>(null)
  const refineDiffRightRef = useRef<HTMLDivElement>(null)
  const refineDiffEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const refineDiffScrollLock = useRef(false)
  const [refineLeftScrollPercent, setRefineLeftScrollPercent] = useState(0)
  const [refineRightScrollPercent, setRefineRightScrollPercent] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelAutoRef = useRef(false)

  // 编辑器滚动同步左侧
  useEffect(() => {
    if (!editingFix) return
    const ta = diffEditorRef.current
    if (!ta) return
    if (diffLeftRef.current) {
      ta.scrollTop = diffLeftRef.current.scrollTop
    }
    const onScroll = () => {
      if (diffScrollLock.current) return
      diffScrollLock.current = true
      if (diffLeftRef.current) {
        const maxScroll = ta.scrollHeight - ta.clientHeight
        if (maxScroll > 0) {
          const percent = ta.scrollTop / maxScroll
          const leftMax = diffLeftRef.current.scrollHeight - diffLeftRef.current.clientHeight
          diffLeftRef.current.scrollTop = percent * leftMax
          setLeftScrollPercent(percent)
          setRightScrollPercent(percent)
        }
      }
      requestAnimationFrame(() => { diffScrollLock.current = false })
    }
    ta.addEventListener('scroll', onScroll)
    return () => ta.removeEventListener('scroll', onScroll)
  }, [editingFix])

  // 微调编辑器滚动同步左侧
  useEffect(() => {
    if (!refineOpen || !refineEditing) return
    const ta = refineDiffEditorRef.current
    if (!ta) return
    if (refineDiffLeftRef.current) {
      ta.scrollTop = refineDiffLeftRef.current.scrollTop
    }
    const onScroll = () => {
      if (refineDiffScrollLock.current) return
      refineDiffScrollLock.current = true
      if (refineDiffLeftRef.current) {
        const maxScroll = ta.scrollHeight - ta.clientHeight
        if (maxScroll > 0) {
          const percent = ta.scrollTop / maxScroll
          const leftMax = refineDiffLeftRef.current.scrollHeight - refineDiffLeftRef.current.clientHeight
          refineDiffLeftRef.current.scrollTop = percent * leftMax
          setRefineLeftScrollPercent(percent)
          setRefineRightScrollPercent(percent)
        }
      }
      requestAnimationFrame(() => { refineDiffScrollLock.current = false })
    }
    ta.addEventListener('scroll', onScroll)
    return () => ta.removeEventListener('scroll', onScroll)
  }, [refineOpen, refineEditing])

  // 清理倒计时定时器
  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
      }
      notification.destroy('auto-continue')
    }
  }, [])

  useEffect(() => {
    const chapterId = searchParams.get('chapterId')
    if (chapterId) setActiveChapterId(chapterId)
  }, [searchParams])

  const chapters = currentWork?.chapters ?? []
  const outline = currentWork?.outline ?? []
  const chapterOutlineNodes = outline.filter((n) => n.level === 'chapter').sort((a, b) => a.order - b.order)
  const volumeNodes = outline.filter((n) => n.level === 'volume').sort((a, b) => a.order - b.order)
  const activeChapter = chapters.find((c) => c.id === activeChapterId)

  // 按卷分组的章节列表
  const chaptersByVolume = useMemo(() => {
    const grouped: { volume: typeof outline[0] | null; chapters: typeof chapterOutlineNodes }[] = []
    const orphans = chapterOutlineNodes.filter((ch) => !volumeNodes.some((v) => v.id === ch.parentId))
    for (const vol of volumeNodes) {
      grouped.push({
        volume: vol,
        chapters: chapterOutlineNodes.filter((ch) => ch.parentId === vol.id),
      })
    }
    if (orphans.length > 0) {
      grouped.push({ volume: null, chapters: orphans })
    }
    return grouped
  }, [chapterOutlineNodes, volumeNodes])

  // 切换章节时同步创作方向草稿
  useEffect(() => {
    setDirectionDraft(activeChapter?.userDirection || '')
    setDirectionOpen(false)
  }, [activeChapterId])

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

  // 确保章节存在（自动从大纲创建缺失的章节，并同步标题）
  const ensureChapter = useCallback(
    async (outlineId: string): Promise<Chapter> => {
      const work = useStore.getState().currentWork
      if (!work) throw new Error('无当前作品')
      const currentChapters = work.chapters ?? []
      const currentOutline = work.outline ?? []
      const node = currentOutline.find((n) => n.id === outlineId)
      const nodeTitle = node?.title || '未命名章节'
      const existing = currentChapters.find((c) => c.outlineId === outlineId)

      if (existing) {
        // 同步大纲标题
        if (existing.title !== nodeTitle) {
          const updated = currentChapters.map((c) =>
            c.id === existing.id ? { ...c, title: nodeTitle } : c,
          )
          await persistChapters(updated)
          return updated.find((c) => c.id === existing.id)!
        }
        return existing
      }

      const newChapter: Chapter = {
        id: generateId(),
        outlineId,
        title: nodeTitle,
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
      // 按大纲 order 找前一章（而非数组位置）
      const sortedOutline = currentOutline.filter((n) => n.level === 'chapter').sort((a, b) => a.order - b.order)
      const currentOutlineIdx = sortedOutline.findIndex((n) => n.id === chapter.outlineId)
      const prevOutlineNode = currentOutlineIdx > 0 ? sortedOutline[currentOutlineIdx - 1] : null
      const prevChapter = prevOutlineNode ? currentChapters.find((c) => c.outlineId === prevOutlineNode.id) : null
      const prevSummary = prevChapter ? prevChapter.content.slice(-500) : ''

      // 事件簿上下文（排除当前章及后续章节的事件，避免重写时泄漏未来信息）
      const allOutline = currentOutline.filter((n) => n.level === 'chapter')
      const currentIdx = allOutline.findIndex((n) => n.id === chapter.outlineId)
      const excludeOutlineIds = new Set(allOutline.slice(currentIdx).map((n) => n.id))
      // chapterId 存的是 chapter 对象 ID，需要通过 outlineId 关联
      const excludeChapterIds = new Set(
        currentChapters.filter((c) => excludeOutlineIds.has(c.outlineId)).map((c) => c.id)
      )
      const eventLog = (work.eventLog ?? []).filter((e) => !excludeChapterIds.has(e.chapterId))
      const eventLogStr = eventLogContext(eventLog)

      const prompt = buildChapterPrompt(
        seedContext(work),
        worldContext(work),
        charactersContext(work.characters),
        constraintsContext(work.constraints),
        chapter.title,
        chapterSummary,
        prevSummary,
        eventLogStr,
        chapter.userDirection,
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
      const eventLogConfig = work.eventLogConfig ?? DEFAULT_EVENT_LOG_CONFIG
      if (eventLogConfig.enabled) {
        message.loading({ content: '正在提取事件到事件簿…', key: 'extractEvents', duration: 0 })
      }
      await extractEvents(chapter, text, work)
      message.destroy('extractEvents')

      // 显示完成通知，等待倒计时
      const currentOutlineNodes = currentOutline.filter((n) => n.level === 'chapter').sort((a, b) => a.order - b.order)
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
      const text = await generate(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig)

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

      // 保存事件簿（先清除当前章旧事件，再写入新事件，按大纲顺序排）
      const latestWork = useStore.getState().currentWork
      if (!latestWork) return
      const curOutline = latestWork.outline ?? []
      const oldEventLog = (latestWork.eventLog ?? []).filter((e) => e.chapterId !== chapter.id)
      const merged = [...oldEventLog, ...newEntries]
      // 按章节在大纲中的 order 排序
      const getOrder = (chapterId: string) => {
        const ch = (latestWork.chapters ?? []).find((c) => c.id === chapterId)
        if (!ch) return Infinity
        const node = curOutline.find((n) => n.id === ch.outlineId)
        return node?.order ?? Infinity
      }
      merged.sort((a, b) => getOrder(a.chapterId) - getOrder(b.chapterId))
      await db.works.update(latestWork.id, { eventLog: merged })
      setCurrentWork({ ...latestWork, eventLog: merged, updatedAt: Date.now() })
    } catch {
      // 事件提取失败不影响主流程
    }
  }

  // 重新提取单章事件
  const regenerateChapterEvents = async (chapterId: string) => {
    const work = useStore.getState().currentWork
    if (!work || !aiConfig.apiKey) return

    const chapter = (work.chapters ?? []).find((c) => c.id === chapterId)
    if (!chapter || !chapter.content) return

    message.loading({ content: `正在重新提取「${chapter.title}」的事件…`, key: 'regenEvents', duration: 0 })
    await extractEvents(chapter, chapter.content, work)
    message.destroy('regenEvents')
    message.success(`「${chapter.title}」事件簿已更新`)
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

  // === 全文逻辑检查 ===
  const checkVolumeNodes = useMemo(() => {
    if (!currentWork) return []
    return (currentWork.outline ?? [])
      .filter((n) => n.level === 'volume')
      .sort((a, b) => a.order - b.order)
  }, [currentWork])

  // 打开卷选择弹窗
  const handleOpenCheck = () => {
    setCheckVolumes(checkVolumeNodes.map((v) => v.id))
    setCheckStep('select')
  }

  // 开始扫描问题
  const handleScanIssues = async () => {
    if (!currentWork || checkVolumes.length === 0) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    const work = useStore.getState().currentWork
    if (!work) return

    setCheckStep('scanning')
    const setAIS = useStore.getState().setAIStream
    if (!aiPanelOpen) toggleAIPanel()

    try {
      const curOutline = work.outline ?? []
      const curChapters = work.chapters ?? []
      const eventLog = work.eventLog ?? []
      const selectedVols = checkVolumeNodes.filter((v) => checkVolumes.includes(v.id))
      const allIssues: { chapterTitle: string; issue: string; findText: string; severity: string }[] = []

      // 构建所有卷的章节内容索引，用于取上一卷正文
      const allVolumeChs = new Map<string, { title: string; content: string; wordCount: number }[]>()
      for (const vol of checkVolumeNodes) {
        const chs = curOutline
          .filter((n) => n.level === 'chapter' && n.parentId === vol.id)
          .sort((a, b) => a.order - b.order)
          .map((n) => {
            const ch = curChapters.find((c) => c.outlineId === n.id)
            return { title: n.title, content: ch?.content || '', wordCount: ch?.wordCount || 0 }
          })
          .filter((c) => c.wordCount > 0)
        allVolumeChs.set(vol.id, chs)
      }

      for (let vi = 0; vi < selectedVols.length; vi++) {
        const vol = selectedVols[vi]
        const chs = allVolumeChs.get(vol.id) || []
        if (chs.length === 0) continue

        // 上一卷正文（向前多查一卷）
        let prevVolumeText = ''
        if (vi > 0) {
          const prevVol = selectedVols[vi - 1]
          const prevChs = allVolumeChs.get(prevVol.id) || []
          if (prevChs.length > 0) {
            prevVolumeText = prevChs.map((c) => `【${c.title}】\n${c.content}`).join('\n\n')
          }
        } else {
          // 如果是第一卷，尝试从 checkVolumeNodes 中找它前面的卷
          const volIdx = checkVolumeNodes.findIndex((v) => v.id === vol.id)
          if (volIdx > 0) {
            const prevVol = checkVolumeNodes[volIdx - 1]
            const prevChs = allVolumeChs.get(prevVol.id) || []
            if (prevChs.length > 0) {
              prevVolumeText = prevChs.map((c) => `【${c.title}】\n${c.content}`).join('\n\n')
            }
          }
        }

        // 更早卷的事件簿（上一卷之前的所有卷）
        let earlierEvents = ''
        const volIdx = checkVolumeNodes.findIndex((v) => v.id === vol.id)
        for (let i = 0; i < volIdx - 1; i++) {
          const earlierVol = checkVolumeNodes[i]
          const earlierChIds = new Set(
            curChapters.filter((c) => {
              const node = curOutline.find((n) => n.id === c.outlineId)
              return node?.parentId === earlierVol.id
            }).map((c) => c.id)
          )
          const volEvents = eventLog.filter((e) => earlierChIds.has(e.chapterId))
          if (volEvents.length > 0) {
            earlierEvents += `\n【${earlierVol.title}】\n`
            earlierEvents += volEvents.map((e) => `【${e.chapterTitle}】${e.description}`).join('\n')
          }
        }

        const chaptersText = chs.map((c) => `【${c.title}】\n${c.content}`).join('\n\n')
        setAIS(true, `正在扫描 ${vol.title}（${vi + 1}/${selectedVols.length}）...`)

        const prompt = buildIssueScanPrompt(chaptersText, prevVolumeText, earlierEvents, vol.title, checkFocus)
        const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
          setAIS(true, `正在扫描 ${vol.title}...\n\n${fullText}`)
        })

        try {
          let cleaned = text.trim()
          cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            if (Array.isArray(parsed.issues)) {
              allIssues.push(...parsed.issues.filter((item: any) => item.chapterTitle && item.findText))
            }
          }
        } catch {}
      }

      setCheckIssues(allIssues)
      setSelectedIssueIdx(allIssues.map((_, i) => i)) // 默认全选
      setCheckStep('issues')
      setAIS(false, `扫描完成，共发现 ${allIssues.length} 个问题`)
    } catch (err: any) {
      message.error('扫描失败：' + err.message)
      setCheckStep(null)
    }
  }

  // 按章节合并问题，生成修复队列
  const handleGenerateFixes = async () => {
    if (!currentWork || selectedIssueIdx.length === 0) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    // 按章节标题分组，去重
    const selectedIssues = selectedIssueIdx.map((i) => checkIssues[i]).filter(Boolean)
    const chapterTitles = [...new Set(selectedIssues.map((item) => item.chapterTitle.replace(/^【|】$/g, '')))]

    if (!aiPanelOpen) toggleAIPanel()
    setCheckStep('fixing')
    setFixQueue(chapterTitles)
    await generateChapterFix(chapterTitles)
  }

  const generateChapterFix = async (queue: string[]) => {
    if (queue.length === 0) {
      setCheckStep('issues')
      setFixDraft('')
      setFixChanges([])
      setFixChapterTitle('')
      return
    }

    const work = useStore.getState().currentWork
    if (!work) return

    const title = queue[0]
    const setAIS = useStore.getState().setAIStream
    setAIS(true, `正在修复：${title}`)

    // 找到该章的所有问题
    const chapterIssues = checkIssues.filter((item) => {
      const clean = item.chapterTitle.replace(/^【|】$/g, '')
      return clean === title || clean.includes(title) || title.includes(clean)
    })

    // 找到章节内容
    const curChapters = work.chapters ?? []
    const curOutline = work.outline ?? []
    const chapter = curChapters.find((c) => {
      const node = curOutline.find((n) => n.id === c.outlineId)
      return node?.title === title || node?.title.includes(title) || title.includes(node?.title || '')
    })

    if (!chapter || !chapter.content) {
      console.log('[修复] 未找到章节:', title)
      setFixQueue(queue.slice(1))
      await generateChapterFix(queue.slice(1))
      return
    }

    const prompt = buildChapterFixPrompt(title, chapter.content, chapterIssues)
    console.log('[修复] 章节:', title, '问题数:', chapterIssues.length, '提示词长度:', prompt.length)

    try {
      const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIS(true, `正在修复 ${title}...\n\n${fullText}`)
      })

      let parsed: any = null
      try {
        let cleaned = text.trim()
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
      } catch {}

      if (parsed?.content && parsed.content !== chapter.content) {
        setFixDraft(parsed.content)
        setFixChanges(parsed.changes || [])
        setFixChapterTitle(title)
        setEditingFix(false)
        setAIS(false, '')
        // 后台预生成下一章的修复
        if (queue.length > 1) {
          preGenerateNextFix(queue.slice(1))
        }
      } else {
        console.log('[修复] 无修改或解析失败，跳过:', title)
        setFixQueue(queue.slice(1))
        await generateChapterFix(queue.slice(1))
      }
    } catch (e) {
      console.log('[修复] AI 调用失败:', e)
      setFixQueue(queue.slice(1))
      await generateChapterFix(queue.slice(1))
    }
  }

  // 后台预生成下一章修复（不阻塞UI）
  const preGenerateNextFix = async (queue: string[]) => {
    if (queue.length === 0) return
    const work = useStore.getState().currentWork
    if (!work) return

    const title = queue[0]
    const chapterIssues = checkIssues.filter((item) => {
      const clean = item.chapterTitle.replace(/^【|】$/g, '')
      return clean === title || clean.includes(title) || title.includes(clean)
    })
    const curChapters = work.chapters ?? []
    const curOutline = work.outline ?? []
    const chapter = curChapters.find((c) => {
      const node = curOutline.find((n) => n.id === c.outlineId)
      return node?.title === title || node?.title.includes(title) || title.includes(node?.title || '')
    })
    if (!chapter?.content) return

    try {
      const prompt = buildChapterFixPrompt(title, chapter.content, chapterIssues)
      const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, () => {})
      let parsed: any = null
      try {
        let cleaned = text.trim()
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
      } catch {}
      if (parsed?.content && parsed.content !== chapter.content) {
        setNextFixReady({ content: parsed.content, changes: parsed.changes || [], title })
        console.log('[预生成] 下一章修复已就绪:', title)
      }
    } catch {
      // 静默失败，不影响当前操作
    }
  }

  // 应用当前章节修复
  const handleApplyCurrentFix = async () => {
    const work = useStore.getState().currentWork
    if (!work || !fixDraft || !fixChapterTitle) return

    const curChapters = work.chapters ?? []
    const curOutline = work.outline ?? []
    const chapterIdx = curChapters.findIndex((c) => {
      const node = curOutline.find((n) => n.id === c.outlineId)
      return node?.title === fixChapterTitle || node?.title.includes(fixChapterTitle) || fixChapterTitle.includes(node?.title || '')
    })
    if (chapterIdx < 0) { message.warning('未找到对应章节'); return }

    const chapter = curChapters[chapterIdx]
    const updated = [...curChapters]
    updated[chapterIdx] = { ...chapter, content: fixDraft, wordCount: fixDraft.replace(/\s/g, '').length }
    await persistChapters(updated)

    message.success(`已应用修改：${fixChapterTitle}`)
    // 异步更新事件簿（不阻塞）
    regenerateChapterEvents(chapter.id)
    const nextQueue = fixQueue.slice(1)
    setFixQueue(nextQueue)
    setFixDraft('')
    setFixChanges([])
    setFixChapterTitle('')
    setEditingFix(false)

    if (nextQueue.length > 0) {
      // 优先使用预生成的结果
      if (nextFixReady && nextFixReady.title === nextQueue[0]) {
        setFixDraft(nextFixReady.content)
        setFixChanges(nextFixReady.changes)
        setFixChapterTitle(nextFixReady.title)
        setNextFixReady(null)
        // 继续预生成再下一章
        if (nextQueue.length > 1) preGenerateNextFix(nextQueue.slice(1))
      } else {
        setNextFixReady(null)
        await generateChapterFix(nextQueue)
      }
    } else {
      setCheckStep('issues')
    }
  }

  // 跳过当前章节
  const handleSkipFix = async () => {
    const nextQueue = fixQueue.slice(1)
    setFixQueue(nextQueue)
    setFixDraft('')
    setFixChanges([])
    setFixChapterTitle('')
    setEditingFix(false)
    if (nextQueue.length > 0) {
      if (nextFixReady && nextFixReady.title === nextQueue[0]) {
        setFixDraft(nextFixReady.content)
        setFixChanges(nextFixReady.changes)
        setFixChapterTitle(nextFixReady.title)
        setNextFixReady(null)
        if (nextQueue.length > 1) preGenerateNextFix(nextQueue.slice(1))
      } else {
        setNextFixReady(null)
        await generateChapterFix(nextQueue)
      }
    } else {
      setCheckStep('issues')
    }
  }

  // === 快速续写 ===
  // === AI 微调 ===
  const handleOpenRefine = () => {
    if (!activeChapter) return
    setRefineOriginal(activeChapter.content || '')
    setRefineResult('')
    setRefineInstruction('')
    setRefineDone(false)
    setRefineEditing(false)
    setRefineOpen(true)
  }

  const handleRefine = async () => {
    if (!activeChapter || !refineInstruction.trim()) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    setRefineLoading(true)
    setRefineResult('')
    setRefineEditing(false)
    try {
      // 构建当前卷前文
      const work = useStore.getState().currentWork
      let prevChaptersText = ''
      if (work) {
        const outline = work.outline ?? []
        const chapters = work.chapters ?? []
        const currentOutlineNode = outline.find((n) => n.id === activeChapter.outlineId)
        if (currentOutlineNode) {
          const parentVolume = outline.find((n) => n.id === currentOutlineNode.parentId)
          if (parentVolume) {
            const siblingNodes = outline
              .filter((n) => n.parentId === parentVolume.id && n.level === 'chapter' && n.order < currentOutlineNode.order)
              .sort((a, b) => a.order - b.order)
            const parts: string[] = []
            for (const node of siblingNodes) {
              const ch = chapters.find((c) => c.outlineId === node.id)
              if (ch?.content) {
                parts.push(`【${node.title}】\n${ch.content}`)
              }
            }
            prevChaptersText = parts.join('\n\n')
          }
        }
      }
      const prompt = buildRefinePrompt(refineOriginal, refineInstruction, prevChaptersText || undefined)
      const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setRefineResult(fullText)
      })
      if (text && text !== refineOriginal) {
        setRefineResult(text)
        setRefineDone(true)
      } else {
        message.warning('AI 未产生修改')
      }
    } catch (err: any) {
      message.error('微调失败：' + err.message)
    } finally {
      setRefineLoading(false)
    }
  }

  const handleApplyRefine = async () => {
    if (!activeChapter || !refineResult) return
    const wordCount = refineResult.replace(/\s/g, '').length
    const updated = (useStore.getState().currentWork?.chapters ?? []).map((c) =>
      c.id === activeChapter.id ? { ...c, content: refineResult, wordCount } : c,
    )
    await persistChapters(updated)
    message.success('微调已应用')
    setRefineOpen(false)
    const work = useStore.getState().currentWork
    if (work) {
      const ch = (work.chapters ?? []).find((c) => c.id === activeChapter.id)
      if (ch) regenerateChapterEvents(ch.id)
    }
  }

  const handleQuickWrite = async (mode: 'newVolume' | 'continue') => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    setQwMode(mode)
    setQwLoading(true)
    setQwStep('inspire')
    setQwInspirations([])
    const setAIStream = useStore.getState().setAIStream
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')

    try {
      const seed = seedContext(currentWork)
      const world = worldContext(currentWork)
      const chars = charactersContext(currentWork.characters, 'major')
      const eventLog = eventLogContext(currentWork.eventLog ?? [])

      // 前文摘要：取最后一章的内容前500字
      const sortedChapters = [...chapters].sort((a, b) => {
        const aNode = outline.find((n) => n.id === a.outlineId)
        const bNode = outline.find((n) => n.id === b.outlineId)
        return (aNode?.order ?? 0) - (bNode?.order ?? 0)
      })
      const lastChapter = sortedChapters[sortedChapters.length - 1]
      const prevSummary = lastChapter?.content?.slice(0, 500) || ''

      const prompt = buildInspirationPrompt(mode, seed, world, chars, prevSummary, eventLog)
      const text = await generateStream(prompt, CHAPTER_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      // 解析 JSON 数组
      let cleaned = text.trim()
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      const arrMatch = cleaned.match(/\[[\s\S]*\]/)
      if (arrMatch) cleaned = arrMatch[0]
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed) && parsed.length > 0) {
        setQwInspirations(parsed.map((item: any) => ({
          title: item.title || '未命名灵感',
          summary: item.summary || '',
        })))
      } else {
        throw new Error('AI 返回格式不正确')
      }
      setAIStream(false, '')
    } catch (err: any) {
      message.error('灵感生成失败：' + err.message)
      setAIStream(false, '灵感生成失败：' + err.message)
      setQwOpen(false)
    } finally {
      setQwLoading(false)
    }
  }

  const handlePickInspiration = async (insp: { title: string; summary: string }) => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    const work = useStore.getState().currentWork
    if (!work) return

    const setAIStream = useStore.getState().setAIStream
    setQwOpen(false)
    setQwLoading(true)
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')

    try {
      const currentOutline = work.outline ?? []
      const currentChapters = work.chapters ?? []
      let newNodeId = generateId()

      if (qwMode === 'newVolume') {
        // 新建卷 + 章
        const volId = generateId()
        const volOrder = currentOutline.filter((n) => n.level === 'volume').length
        const volNode = {
          id: volId,
          title: insp.title,
          summary: insp.summary,
          order: volOrder,
          level: 'volume' as const,
          characterIds: [],
          storylineIds: [],
        }
        const chNode = {
          id: newNodeId,
          parentId: volId,
          title: insp.title,
          summary: insp.summary,
          order: volOrder + 1,
          level: 'chapter' as const,
          characterIds: [],
          storylineIds: [],
        }
        await persistChapters([...currentChapters])
        const newOutline = [...currentOutline, volNode, chNode]
        await db.works.update(work.id, { outline: newOutline })
        setCurrentWork({ ...work, outline: newOutline, updatedAt: Date.now() })
      } else {
        // 续写：在最后一个卷下新增章
        const volumes = currentOutline.filter((n) => n.level === 'volume').sort((a, b) => a.order - b.order)
        const lastVol = volumes[volumes.length - 1]
        if (!lastVol) {
          message.warning('请先在大纲中创建一个卷')
          setQwLoading(false)
          return
        }
        const siblings = currentOutline.filter((n) => n.level === 'chapter' && n.parentId === lastVol.id)
        const chOrder = lastVol.order + siblings.length + 1
        const chNode = {
          id: newNodeId,
          parentId: lastVol.id,
          title: insp.title,
          summary: insp.summary,
          order: chOrder,
          level: 'chapter' as const,
          characterIds: [],
          storylineIds: [],
        }
        const newOutline = [...currentOutline, chNode]
        await db.works.update(work.id, { outline: newOutline })
        setCurrentWork({ ...work, outline: newOutline, updatedAt: Date.now() })
      }

      // 创建章节对象
      const newChapter: Chapter = {
        id: generateId(),
        outlineId: newNodeId,
        title: insp.title,
        content: '',
        wordCount: 0,
        scenes: [],
        versions: [],
      }
      const updatedChapters = [...(work.chapters ?? []), newChapter]
      await persistChapters(updatedChapters)

      // 刷新 outline
      const freshWork = useStore.getState().currentWork
      if (freshWork) {
        const freshOutline = freshWork.outline ?? []
        const sorted = [...freshOutline].sort((a, b) => a.order - b.order)
        const vols = sorted.filter((n) => n.level === 'volume')
        let idx = 0
        const reindexed: typeof sorted = []
        for (const vol of vols) {
          reindexed.push({ ...vol, order: idx++ })
          const chs = sorted.filter((n) => n.level === 'chapter' && n.parentId === vol.id).sort((a, b) => a.order - b.order)
          for (const ch of chs) {
            reindexed.push({ ...ch, order: idx++ })
          }
        }
        await db.works.update(freshWork.id, { outline: reindexed })
        setCurrentWork({ ...freshWork, outline: reindexed, updatedAt: Date.now() })
      }

      // 自动写正文
      setActiveChapterId(newChapter.id)
      message.success(`已创建「${insp.title}」，开始写作...`)

      // 重新取 work 用于写作
      const writeWork = useStore.getState().currentWork
      if (!writeWork) return
      const prevChapters = writeWork.chapters ?? []
      const sortedChs = [...prevChapters].sort((a, b) => {
        const aNode = (writeWork.outline ?? []).find((n) => n.id === a.outlineId)
        const bNode = (writeWork.outline ?? []).find((n) => n.id === b.outlineId)
        return (aNode?.order ?? 0) - (bNode?.order ?? 0)
      })
      const chIdx = sortedChs.findIndex((c) => c.id === newChapter.id)
      const prevCh = chIdx > 0 ? sortedChs[chIdx - 1] : null
      const prevContent = prevCh?.content?.slice(-500) || ''

      const filteredEvents = (writeWork.eventLog ?? []).filter((e) => {
        const ch = sortedChs.find((c) => c.id === e.chapterId)
        if (!ch) return true
        const chNode = (writeWork.outline ?? []).find((n) => n.id === ch.outlineId)
        const targetNode = (writeWork.outline ?? []).find((n) => n.id === newChapter.outlineId)
        return chNode && targetNode && chNode.order < targetNode.order
      })
      const eventLogStr = eventLogContext(filteredEvents)

      const writePrompt = buildInspirationChapterPrompt(
        seedContext(writeWork),
        worldContext(writeWork),
        charactersContext(writeWork.characters, 'major'),
        constraintsContext(writeWork.constraints),
        insp.title,
        insp.summary,
        prevContent,
        eventLogStr,
      )

      setWritingChapterId(newChapter.id)
      setStreamingContent('')

      const text = await generateStream(writePrompt, CHAPTER_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setStreamingContent(fullText)
        setAIStream(true, fullText)
      })

      // 保存正文
      const wordCount = text.length
      const finalChapters = (useStore.getState().currentWork?.chapters ?? []).map((c) =>
        c.id === newChapter.id ? { ...c, title: insp.title, content: text, wordCount } : c,
      )
      await persistChapters(finalChapters)

      // 事件提取
      if ((writeWork.eventLogConfig ?? DEFAULT_EVENT_LOG_CONFIG).enabled) {
        message.loading({ content: '正在提取事件到事件簿…', key: 'extractEvents', duration: 0 })
        await extractEvents({ ...newChapter, title: insp.title }, text, writeWork)
        message.destroy('extractEvents')
      }

      setStreamingContent(null)
      setWritingChapterId(null)
      setAIStream(false, text)
      message.success(`「${insp.title}」写作完成（${wordCount}字）`)
    } catch (err: any) {
      message.error('写作失败：' + err.message)
      setAIStream(false, '写作失败：' + err.message)
      setStreamingContent(null)
      setWritingChapterId(null)
    } finally {
      setQwLoading(false)
    }
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
            chaptersByVolume.map((group, gi) => (
              <div key={group.volume?.id || 'orphan'} style={{ marginBottom: gi < chaptersByVolume.length - 1 ? 12 : 0 }}>
                {group.volume && (
                  <div style={{ padding: '4px 12px', marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>{group.volume.title}</Text>
                  </div>
                )}
                {group.chapters.map((node) => {
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
                })}
              </div>
            ))
          )}
        </div>

        {/* 快速续写 */}
        {!readOnly && (
          <div style={{ flexShrink: 0, paddingTop: 8, borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              block
              onClick={() => { setQwStep('mode'); setQwInspirations([]); setQwOpen(true) }}
            >
              快速续写
            </Button>
          </div>
        )}

        {/* 全文逻辑检查 */}
        {chapters.some((c) => c.wordCount > 0) && (
          <div style={{ flexShrink: 0, paddingTop: 8, borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
            <Button
              icon={<ExperimentOutlined />}
              block
              loading={checkStep === 'scanning' || checkStep === 'fixing'}
              onClick={handleOpenCheck}
            >
              全文逻辑检查
            </Button>
          </div>
        )}

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
                  {activeChapter.wordCount > 0 && (
                    <Button
                      icon={<ExperimentOutlined />}
                      onClick={handleOpenRefine}
                    >
                      AI 微调
                    </Button>
                  )}
                </Space>
              )}
            </div>

            {/* 创作方向 */}
            {!readOnly && (
              <div style={{ marginBottom: 12 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 13, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => setDirectionOpen(!directionOpen)}
                >
                  {directionOpen ? '▾' : '▸'} 创作方向（可选）
                  {directionDraft && !directionOpen && <Tag color="blue" style={{ marginLeft: 8 }}>已填写</Tag>}
                </Text>
                {directionOpen && (
                  <Input.TextArea
                    value={directionDraft}
                    onChange={(e) => {
                      const val = e.target.value
                      setDirectionDraft(val)
                      // 防抖持久化
                      if (directionTimerRef.current) clearTimeout(directionTimerRef.current)
                      directionTimerRef.current = setTimeout(() => {
                        const updated = (useStore.getState().currentWork?.chapters ?? []).map((c) =>
                          c.id === activeChapter.id ? { ...c, userDirection: val } : c,
                        )
                        persistChapters(updated)
                      }, 500)
                    }}
                    onBlur={() => {
                      // 失焦时立即保存
                      if (directionTimerRef.current) clearTimeout(directionTimerRef.current)
                      const updated = (useStore.getState().currentWork?.chapters ?? []).map((c) =>
                        c.id === activeChapter.id ? { ...c, userDirection: directionDraft } : c,
                      )
                      persistChapters(updated)
                    }}
                    placeholder="描述你想要的剧情走向、具体场景、角色互动等，AI 会严格遵循。留空则按大纲自由发挥。"
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    style={{ marginTop: 8 }}
                    allowClear
                  />
                )}
              </div>
            )}

            {/* 大纲摘要 */}
            {getOutlineNode(activeChapter.outlineId)?.summary && (
              <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
                <div style={{ maxHeight: 120, overflow: 'auto' }}>
                  <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                    大纲摘要：{getOutlineNode(activeChapter.outlineId)!.summary}
                  </Text>
                </div>
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
              style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', minHeight: 240 }}
            >
              <RichEditor
                content={writingChapterId === activeChapter.id ? (streamingContent ?? activeChapter.content) : activeChapter.content}
                onChange={(content) => handleContentChange(activeChapter.id, content)}
                editable={!readOnly && (writingChapterId !== activeChapter.id || streamingContent === null)}
                height="100%"
              />
            </Card>

            {currentWork && !readOnly && (
              <ChapterAudiobookPanel
                work={currentWork}
                chapter={activeChapter}
                writing={writingChapterId === activeChapter.id}
              />
            )}
          </div>
        )}
      </div>

      {/* 卷选择弹窗 */}
      <Modal
        title="全文逻辑检查 - 选择检查范围"
        open={checkStep === 'select'}
        onCancel={() => setCheckStep(null)}
        onOk={handleScanIssues}
        okText="开始扫描"
        cancelText="取消"
        width={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>选择要检查的卷：</Text>
            <Checkbox.Group
              value={checkVolumes}
              onChange={(vals) => setCheckVolumes(vals as string[])}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {checkVolumeNodes.map((vol) => {
                const chCount = (currentWork?.outline ?? []).filter(
                  (n) => n.level === 'chapter' && n.parentId === vol.id
                ).length
                return (
                  <Checkbox key={vol.id} value={vol.id}>
                    {vol.title}（{chCount} 章）
                  </Checkbox>
                )
              })}
            </Checkbox.Group>
          </div>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>重点检查项（可选，留空按默认检查）：</Text>
            <Input.TextArea
              value={checkFocus}
              onChange={(e) => setCheckFocus(e.target.value)}
              placeholder="例如：角色性格前后是否一致、某个伏笔是否回收、时间线是否连贯"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </div>
        </div>
      </Modal>

      {/* 问题清单弹窗 */}
      <Modal
        title={`发现 ${checkIssues.length} 个问题`}
        open={checkStep === 'issues'}
        onCancel={() => setCheckStep(null)}
        footer={
          <Space>
            <Button onClick={() => setCheckStep(null)}>关闭</Button>
            <Button
              type="primary"
              disabled={selectedIssueIdx.length === 0}
              onClick={handleGenerateFixes}
            >
              修复选中（{selectedIssueIdx.length}）
            </Button>
          </Space>
        }
        width={700}
      >
        {checkIssues.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#52c41a' }}>
            ✅ 未发现问题，全文逻辑完整
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>
              <Checkbox
                checked={selectedIssueIdx.length === checkIssues.length}
                indeterminate={selectedIssueIdx.length > 0 && selectedIssueIdx.length < checkIssues.length}
                onChange={(e) => setSelectedIssueIdx(e.target.checked ? checkIssues.map((_, i) => i) : [])}
              >
                全选
              </Checkbox>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflow: 'auto' }}>
              {checkIssues.map((issue, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
                  <Checkbox
                    checked={selectedIssueIdx.includes(i)}
                    onChange={(e) => {
                      setSelectedIssueIdx((prev) =>
                        e.target.checked ? [...prev, i] : prev.filter((x) => x !== i)
                      )
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ flex: 1 }}>
                    <Space size={4}>
                      <Text strong style={{ fontSize: 13 }}>{issue.chapterTitle}</Text>
                      <Tag color={issue.severity === 'high' ? 'red' : issue.severity === 'medium' ? 'orange' : 'default'} style={{ fontSize: 11 }}>
                        {issue.severity === 'high' ? '严重' : issue.severity === 'medium' ? '中等' : '轻微'}
                      </Tag>
                    </Space>
                    <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{issue.issue}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* 修复对比弹窗 */}
      <Modal
        title={fixChapterTitle ? `修复：${fixChapterTitle}（${fixQueue.length} 章待处理）` : '修复中...'}
        open={checkStep === 'fixing'}
        onCancel={handleSkipFix}
        width={1000}
        styles={{ body: { height: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
        footer={
          <Space>
            <Button onClick={handleSkipFix}>跳过本章</Button>
            <Button type="primary" onClick={handleApplyCurrentFix} disabled={!fixDraft}>
              应用修改
            </Button>
          </Space>
        }
      >
        {fixDraft && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
            {/* 该章的问题列表 */}
            {fixChanges.length > 0 && (
              <div style={{ padding: '8px 12px', background: '#fff7e6', borderRadius: 6, fontSize: 13 }}>
                <Text type="secondary" style={{ fontWeight: 600 }}>修改说明：</Text>
                <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
                  {fixChanges.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {/* 左右对比视图 */}
            {(() => {
              void diffKey
              void refineDiffKey
              const work = useStore.getState().currentWork
              const ch = (work?.chapters ?? []).find((c) => {
                const node = (work?.outline ?? []).find((n) => n.id === c.outlineId)
                return node?.title === fixChapterTitle || node?.title.includes(fixChapterTitle)
              })
              const originalText = ch?.content || ''
              const charParts = diffChars(originalText, fixDraft)

              const leftItems: { text: string; type: 'same' | 'removed' }[] = []
              const rightItems: { text: string; type: 'same' | 'added' }[] = []
              for (const part of charParts) {
                if (!part.added && !part.removed) {
                  leftItems.push({ text: part.value, type: 'same' })
                  rightItems.push({ text: part.value, type: 'same' })
                } else if (part.removed) {
                  leftItems.push({ text: part.value, type: 'removed' })
                  rightItems.push({ text: '', type: 'same' })
                } else if (part.added) {
                  leftItems.push({ text: '', type: 'same' })
                  rightItems.push({ text: part.value, type: 'added' })
                }
              }

              const renderHighlight = (items: { text: string; type: string }[], highlightType: string, color: string) => {
                const paragraphs: { text: string; type: string }[][] = []
                let current: { text: string; type: string }[] = []
                for (const item of items) {
                  const ls = item.text.split('\n')
                  for (let i = 0; i < ls.length; i++) {
                    if (i > 0) { paragraphs.push(current); current = [] }
                    current.push({ text: ls[i], type: item.type })
                  }
                }
                if (current.length) paragraphs.push(current)
                return paragraphs.map((para, pi) => (
                  <div key={pi} style={{ minHeight: 22, padding: '2px 8px', lineHeight: 1.8, fontSize: 13 }}>
                    {para.map((item, ii) => (
                      <span key={ii} style={{
                        background: item.type === highlightType ? (highlightType === 'removed' ? '#fff1f0' : '#f6ffed') : undefined,
                        borderBottom: item.type === highlightType ? `2px solid ${color}` : undefined,
                      }}>{item.text || '\u00a0'}</span>
                    ))}
                  </div>
                ))
              }

              const leftTotal = leftItems.reduce((s, item) => s + (item.text.split('\n').length || 1), 0)
              const rightTotal = rightItems.reduce((s, item) => s + (item.text.split('\n').length || 1), 0)
              const totalLines = Math.max(leftTotal, rightTotal, 1)
              const removedRanges: { start: number; end: number }[] = []
              const addedRanges: { start: number; end: number }[] = []
              let lp = 0
              for (const item of leftItems) { const lc = item.text.split('\n').length || 1; if (item.type === 'removed') removedRanges.push({ start: lp / totalLines * 100, end: (lp + lc) / totalLines * 100 }); lp += lc }
              lp = 0
              for (const item of rightItems) { const lc = item.text.split('\n').length || 1; if (item.type === 'added') addedRanges.push({ start: lp / totalLines * 100, end: (lp + lc) / totalLines * 100 }); lp += lc }

              const renderMinimap = (ranges: { start: number; end: number }[], color: string) => (
                <div style={{ width: 10, background: '#f5f5f5', borderLeft: '1px solid #e8e8e8', position: 'relative', flexShrink: 0 }}>
                  {ranges.map((r, i) => (
                    <div key={i} style={{ position: 'absolute', left: 1, right: 1, top: `${r.start}%`, height: `${Math.max(r.end - r.start, 1.5)}%`, background: color, borderRadius: 2, opacity: 0.8 }} />
                  ))}
                </div>
              )

              const getStats = (text: string, scrollPercent: number) => {
                const ls = text.split('\n')
                const total = ls.length
                const chars = text.replace(/\s/g, '').length
                const currentLine = Math.min(Math.ceil(scrollPercent * total) + 1, total)
                return { chars, total, currentLine }
              }

              const handleDiffScroll = (source: 'left' | 'right') => () => {
                if (diffScrollLock.current) return
                diffScrollLock.current = true
                const src = source === 'left' ? diffLeftRef.current : (editingFix ? diffEditorRef.current : diffRightRef.current)
                const tgt = source === 'left' ? (editingFix ? diffEditorRef.current : diffRightRef.current) : diffLeftRef.current
                if (src && tgt) {
                  const maxScroll = src.scrollHeight - src.clientHeight
                  if (maxScroll > 0) {
                    const percent = src.scrollTop / maxScroll
                    const tgtMax = tgt.scrollHeight - tgt.clientHeight
                    tgt.scrollTop = percent * tgtMax
                    setLeftScrollPercent(percent)
                    setRightScrollPercent(percent)
                  }
                }
                requestAnimationFrame(() => { diffScrollLock.current = false })
              }

              const leftStats = getStats(originalText, leftScrollPercent)
              const rightStats = getStats(fixDraft, rightScrollPercent)

              return (
                <div style={{ display: 'flex', gap: 2, flex: 1, border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden', minHeight: 0 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 12, color: '#999', flexShrink: 0 }}>
                      {editingFix ? '原文（高亮标记修改位置）' : '原文（红色 = 将被删除）'}
                    </div>
                    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                      <div ref={diffLeftRef} style={{ flex: 1, overflow: 'auto', background: '#fafafa' }} onScroll={handleDiffScroll('left')}>
                        {renderHighlight(leftItems, 'removed', '#ff4d4f')}
                      </div>
                      {renderMinimap(removedRanges, '#ff4d4f')}
                    </div>
                    <div style={{ padding: '2px 8px', borderTop: '1px solid #f0f0f0', fontSize: 11, color: '#999', flexShrink: 0, display: 'flex', gap: 12 }}>
                      <span>字数: {leftStats.chars}</span>
                      <span>行数: {leftStats.total}</span>
                      <span>当前: {leftStats.currentLine}/{leftStats.total}</span>
                    </div>
                  </div>
                  <div style={{ width: 1, background: '#d9d9d9' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 12, color: '#999', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{editingFix ? '修改后（可编辑）' : '修改后（绿色 = 新增）'}</span>
                      <Space size={4}>
                        <Button size="small" type="link" onClick={() => setDiffKey((k) => k + 1)}>重新对比</Button>
                        <Button size="small" type="link" onClick={() => setEditingFix(!editingFix)}>
                          {editingFix ? '确认并对比' : '编辑'}
                        </Button>
                      </Space>
                    </div>
                    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                      {editingFix ? (
                        <textarea
                          ref={diffEditorRef as any}
                          value={fixDraft}
                          onChange={(e) => setFixDraft(e.target.value)}
                          style={{ flex: 1, border: 'none', borderRadius: 0, fontSize: 13, resize: 'none', lineHeight: 1.8, padding: '2px 8px', fontFamily: 'inherit' }}
                          autoFocus
                        />
                      ) : (
                        <>
                          <div ref={diffRightRef} style={{ flex: 1, overflow: 'auto', background: '#fafafa' }} onScroll={handleDiffScroll('right')}>
                            {renderHighlight(rightItems, 'added', '#52c41a')}
                          </div>
                          {renderMinimap(addedRanges, '#52c41a')}
                        </>
                      )}
                    </div>
                    <div style={{ padding: '2px 8px', borderTop: '1px solid #f0f0f0', fontSize: 11, color: '#999', flexShrink: 0, display: 'flex', gap: 12 }}>
                      <span>字数: {rightStats.chars}</span>
                      <span>行数: {rightStats.total}</span>
                      <span>当前: {rightStats.currentLine}/{rightStats.total}</span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
        {!fixDraft && checkStep === 'fixing' && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Spin description={`正在生成 ${fixQueue[0] || ''} 的修改建议...`} />
          </div>
        )}
      </Modal>

      {/* 快速续写弹窗 */}
      <Modal
        title={qwStep === 'mode' ? '快速续写 - 选择模式' : '快速续写 - 选择灵感'}
        open={qwOpen}
        onCancel={() => setQwOpen(false)}
        footer={null}
        width={qwStep === 'mode' ? 420 : 680}
        mask={{ closable: false }}
      >
        {qwStep === 'mode' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
            <Text type="secondary">选择创作模式，AI 将根据你的选择生成灵感方向：</Text>
            <Button
              size="large"
              icon={<PlusOutlined />}
              block
              onClick={() => handleQuickWrite('newVolume')}
              loading={qwLoading}
            >
              新卷 + 1章
            </Button>
            <Button
              size="large"
              icon={<ThunderboltOutlined />}
              block
              onClick={() => handleQuickWrite('continue')}
              loading={qwLoading}
            >
              续写 1 章
            </Button>
          </div>
        )}
        {qwStep === 'inspire' && (
          <div>
            {qwLoading && qwInspirations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin description="AI 正在构思灵感..." />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {qwInspirations.map((insp, i) => (
                  <Card
                    key={i}
                    size="small"
                    hoverable
                    style={{ cursor: 'pointer' }}
                    onClick={() => handlePickInspiration(insp)}
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Text strong>{insp.title}</Text>
                      <Text type="secondary" style={{ fontSize: 13 }}>{insp.summary}</Text>
                    </Space>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

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
          groupedEvents.map((group) => {
            // 找到对应的 chapterId
            const eventChapterId = group.events[0]?.chapterId
            return (
            <div key={group.chapterTitle} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong style={{ fontSize: 13 }}>{group.chapterTitle}</Text>
                {eventChapterId && (
                  <Button size="small" type="link" onClick={() => regenerateChapterEvents(eventChapterId)}>
                    重新提取
                  </Button>
                )}
              </div>
              <List
                size="small"
                dataSource={group.events}
                renderItem={(event) => (
                  <List.Item
                    actions={[
                      <Popconfirm key="del" title="确定删除？" onConfirm={() => handleDeleteEvent(event.id)} okButtonProps={{ autoFocus: true }} okText="确认" cancelText="取消"
                        onOpenChange={(open) => {
                          if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100)
                        }}
                      >
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
            )
          })
        )}
      </Modal>

      {/* AI 微调弹窗 */}
      <Modal
        title="AI 微调"
        open={refineOpen}
        onCancel={() => setRefineOpen(false)}
        width={1000}
        styles={{ body: { height: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
        footer={
          <Space>
            <Button onClick={() => setRefineOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleApplyRefine} disabled={!refineDone || !refineResult}>
              应用修改
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
            {/* 微调指令 */}
            <div style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input.TextArea
                  rows={2}
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  placeholder="例如：让对话更自然、增加环境描写、调整节奏..."
                  disabled={refineLoading}
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  icon={<ExperimentOutlined />}
                  loading={refineLoading}
                  disabled={!refineInstruction.trim()}
                  onClick={handleRefine}
                  style={{ alignSelf: 'flex-end' }}
                >
                  {refineLoading ? '微调中...' : '微调'}
                </Button>
              </div>
            </div>
            {/* 左右对比视图 */}
            {(() => {
              void refineDiffKey
              const charParts = refineResult ? diffChars(refineOriginal, refineResult) : []
              const leftItems: { text: string; type: 'same' | 'removed' }[] = []
              const rightItems: { text: string; type: 'same' | 'added' }[] = []
              if (refineResult) {
                for (const part of charParts) {
                  if (!part.added && !part.removed) {
                    leftItems.push({ text: part.value, type: 'same' })
                    rightItems.push({ text: part.value, type: 'same' })
                  } else if (part.removed) {
                    leftItems.push({ text: part.value, type: 'removed' })
                    rightItems.push({ text: '', type: 'same' })
                  } else if (part.added) {
                    leftItems.push({ text: '', type: 'same' })
                    rightItems.push({ text: part.value, type: 'added' })
                  }
                }
              } else {
                // 无结果时，左侧显示原文，右侧也显示原文（无高亮）
                leftItems.push({ text: refineOriginal, type: 'same' })
                rightItems.push({ text: '', type: 'same' })
              }

              const renderHighlight = (items: { text: string; type: string }[], highlightType: string, color: string) => {
                const paragraphs: { text: string; type: string }[][] = []
                let current: { text: string; type: string }[] = []
                for (const item of items) {
                  const lines = item.text.split('\n')
                  for (let i = 0; i < lines.length; i++) {
                    if (i > 0) { paragraphs.push(current); current = [] }
                    current.push({ text: lines[i], type: item.type })
                  }
                }
                if (current.length) paragraphs.push(current)
                return paragraphs.map((para, pi) => (
                  <div key={pi} style={{ minHeight: 22, padding: '2px 8px', lineHeight: 1.8, fontSize: 13 }}>
                    {para.map((item, ii) => (
                      <span key={ii} style={{
                        background: item.type === highlightType ? (highlightType === 'removed' ? '#fff1f0' : '#f6ffed') : undefined,
                        borderBottom: item.type === highlightType ? `2px solid ${color}` : undefined,
                      }}>{item.text || ' '}</span>
                    ))}
                  </div>
                ))
              }

              const leftTotal = leftItems.reduce((s, item) => s + (item.text.split('\n').length || 1), 0)
              const rightTotal = rightItems.reduce((s, item) => s + (item.text.split('\n').length || 1), 0)
              const totalLines = Math.max(leftTotal, rightTotal, 1)
              const removedRanges: { start: number; end: number }[] = []
              const addedRanges: { start: number; end: number }[] = []
              let lp = 0
              for (const item of leftItems) { const lc = item.text.split('\n').length || 1; if (item.type === 'removed') removedRanges.push({ start: lp / totalLines * 100, end: (lp + lc) / totalLines * 100 }); lp += lc }
              lp = 0
              for (const item of rightItems) { const lc = item.text.split('\n').length || 1; if (item.type === 'added') addedRanges.push({ start: lp / totalLines * 100, end: (lp + lc) / totalLines * 100 }); lp += lc }

              const renderMinimap = (ranges: { start: number; end: number }[], color: string) => (
                <div style={{ width: 10, background: '#f5f5f5', borderLeft: '1px solid #e8e8e8', position: 'relative', flexShrink: 0 }}>
                  {ranges.map((r, i) => (
                    <div key={i} style={{ position: 'absolute', left: 1, right: 1, top: `${r.start}%`, height: `${Math.max(r.end - r.start, 1.5)}%`, background: color, borderRadius: 2, opacity: 0.8 }} />
                  ))}
                </div>
              )

              const getStats = (text: string, scrollPercent: number) => {
                const lines = text.split('\n')
                const total = lines.length
                const chars = text.replace(/\s/g, '').length
                const currentLine = Math.min(Math.ceil(scrollPercent * total) + 1, total)
                return { chars, total, currentLine }
              }

              const handleRefineDiffScroll = (source: 'left' | 'right') => () => {
                if (refineDiffScrollLock.current) return
                refineDiffScrollLock.current = true
                const src = source === 'left' ? refineDiffLeftRef.current : (refineEditing ? refineDiffEditorRef.current : refineDiffRightRef.current)
                const tgt = source === 'left' ? (refineEditing ? refineDiffEditorRef.current : refineDiffRightRef.current) : refineDiffLeftRef.current
                if (src && tgt) {
                  const maxScroll = src.scrollHeight - src.clientHeight
                  if (maxScroll > 0) {
                    const percent = src.scrollTop / maxScroll
                    const tgtMax = tgt.scrollHeight - tgt.clientHeight
                    tgt.scrollTop = percent * tgtMax
                    setRefineLeftScrollPercent(percent)
                    setRefineRightScrollPercent(percent)
                  }
                }
                requestAnimationFrame(() => { refineDiffScrollLock.current = false })
              }

              const leftStats = getStats(refineOriginal, refineLeftScrollPercent)
              const rightStats = getStats(refineResult, refineRightScrollPercent)

              return (
                <div style={{ display: 'flex', gap: 2, flex: 1, border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden', minHeight: 0 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 12, color: '#999', flexShrink: 0 }}>
                      {refineEditing ? '原文（高亮标记修改位置）' : '原文（红色 = 将被删除）'}
                    </div>
                    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                      <div ref={refineDiffLeftRef} style={{ flex: 1, overflow: 'auto', background: '#fafafa' }} onScroll={handleRefineDiffScroll('left')}>
                        {renderHighlight(leftItems, 'removed', '#ff4d4f')}
                      </div>
                      {renderMinimap(removedRanges, '#ff4d4f')}
                    </div>
                    <div style={{ padding: '2px 8px', borderTop: '1px solid #f0f0f0', fontSize: 11, color: '#999', flexShrink: 0, display: 'flex', gap: 12 }}>
                      <span>字数: {leftStats.chars}</span>
                      <span>行数: {leftStats.total}</span>
                      <span>当前: {leftStats.currentLine}/{leftStats.total}</span>
                    </div>
                  </div>
                  <div style={{ width: 1, background: '#d9d9d9' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 12, color: '#999', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{refineResult ? (refineEditing ? '修改后（可编辑）' : '修改后（绿色 = 新增）') : '修改后（等待 AI 输出）'}</span>
                      {refineResult && (
                        <Space size={4}>
                          <Button size="small" type="link" onClick={() => setRefineDiffKey((k) => k + 1)}>重新对比</Button>
                          <Button size="small" type="link" onClick={() => setRefineEditing(!refineEditing)}>
                            {refineEditing ? '确认并对比' : '编辑'}
                          </Button>
                        </Space>
                      )}
                    </div>
                    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                      {refineEditing && refineResult ? (
                        <textarea
                          ref={refineDiffEditorRef as any}
                          value={refineResult}
                          onChange={(e) => setRefineResult(e.target.value)}
                          style={{ flex: 1, border: 'none', borderRadius: 0, fontSize: 13, resize: 'none', lineHeight: 1.8, padding: '2px 8px', fontFamily: 'inherit' }}
                          autoFocus
                        />
                      ) : refineResult ? (
                        <>
                          <div ref={refineDiffRightRef} style={{ flex: 1, overflow: 'auto', background: '#fafafa' }} onScroll={handleRefineDiffScroll('right')}>
                            {renderHighlight(rightItems, 'added', '#52c41a')}
                          </div>
                          {renderMinimap(addedRanges, '#52c41a')}
                        </>
                      ) : (
                        <div ref={refineDiffRightRef} style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>
                          点击「微调」后 AI 将在此显示修改结果
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '2px 8px', borderTop: '1px solid #f0f0f0', fontSize: 11, color: '#999', flexShrink: 0, display: 'flex', gap: 12 }}>
                      <span>字数: {rightStats.chars}</span>
                      <span>行数: {rightStats.total}</span>
                      <span>当前: {rightStats.currentLine}/{rightStats.total}</span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
      </Modal>
    </div>
  )
}
