import {
  Button,
  Space,
  Typography,
  Empty,
  Spin,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Card,
  Tag,
  Tooltip,
  Radio,
  Checkbox,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  BookOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useState, useMemo, useCallback } from 'react'
import type { OutlineNode, Storyline } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generateStream } from '@/ai/client'
import { seedContext, worldContext, charactersContext, constraintsContext } from '@/ai/context'
import { OUTLINE_SYSTEM_PROMPT, buildOutlinePrompt, buildOutlineNodePolishPrompt, buildAddChaptersPrompt, buildMultiVolumeChaptersPrompt, buildStorylineRecommendPrompt, buildStorylinePolishPrompt, buildFixStorylineBindingPrompt, buildOutlineCheckPrompt } from '@/ai/prompts/outline'

const { Title, Text } = Typography
const { TextArea } = Input

export default function OutlinePage() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const readOnly = useStore((s) => s.readOnly)
  const setAIStream = useStore((s) => s.setAIStream)
  const toggleAIPanel = useStore((s) => s.toggleAIPanel)
  const aiPanelOpen = useStore((s) => s.aiPanelOpen)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [loading, setLoading] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set())
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [genModalOpen, setGenModalOpen] = useState(false)
  const [addChaptersModalOpen, setAddChaptersModalOpen] = useState(false)
  const [addChaptersVolume, setAddChaptersVolume] = useState<OutlineNode | null>(null)
  const [editing, setEditing] = useState<OutlineNode | null>(null)
  const [form] = Form.useForm()
  const [genForm] = Form.useForm()
  const [addChaptersForm] = Form.useForm()
  const storylineIds = Form.useWatch('storylineIds', form) || []

  // --- 故事线 ---
  const [slModalOpen, setSlModalOpen] = useState(false)
  const [editingSl, setEditingSl] = useState<Storyline | null>(null)
  const [slColor, setSlColor] = useState<string>('blue')
  const [slForm] = Form.useForm()
  const [slRecommending, setSlRecommending] = useState(false)
  const [slPolishing, setSlPolishing] = useState(false)
  const [slFixing, setSlFixing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [multiGenModalOpen, setMultiGenModalOpen] = useState(false)
  const [multiGenForm] = Form.useForm()
  const [multiGenerating, setMultiGenerating] = useState(false)

  const storylines = currentWork?.storylines ?? []
  const outline = currentWork?.outline ?? []

  const SL_COLORS = [
    { value: 'red', label: '红' },
    { value: 'orange', label: '橙' },
    { value: 'gold', label: '金' },
    { value: 'green', label: '绿' },
    { value: 'cyan', label: '青' },
    { value: 'blue', label: '蓝' },
    { value: 'purple', label: '紫' },
    { value: 'magenta', label: '粉' },
  ]

  // 持久化
  const persistOutline = useCallback(
    async (newOutline: OutlineNode[]) => {
      if (!currentWork) return
      // 按卷>章层级重编号 order，确保连续
      const volumes = newOutline.filter((n) => n.level === 'volume').sort((a, b) => a.order - b.order)
      const orphans = newOutline.filter((n) => n.level === 'chapter' && !volumes.some((v) => v.id === n.parentId))
      let idx = 0
      const reindexed: OutlineNode[] = []
      for (const vol of volumes) {
        reindexed.push({ ...vol, order: idx++ })
        const chapters = newOutline.filter((n) => n.level === 'chapter' && n.parentId === vol.id).sort((a, b) => a.order - b.order)
        for (const ch of chapters) {
          reindexed.push({ ...ch, order: idx++ })
        }
      }
      for (const ch of orphans) {
        reindexed.push({ ...ch, order: idx++ })
      }
      const updated = { ...currentWork, outline: reindexed, updatedAt: Date.now() }
      await db.works.update(currentWork.id, { outline: reindexed })
      setCurrentWork(updated)
    },
    [currentWork, setCurrentWork],
  )

  // 构建层级大纲文本（卷下缩进列章）
  const buildOutlineHierarchyStr = useCallback(
    (outlineData: typeof outline, storylinesData: typeof storylines) => {
      const sorted = [...outlineData].sort((a, b) => a.order - b.order)
      const volumeNodes = sorted.filter((n) => n.level === 'volume')
      const lines: string[] = []
      for (const vol of volumeNodes) {
        lines.push(`【卷】${vol.title}：${vol.summary}`)
        const chapters = sorted.filter((n) => n.level === 'chapter' && n.parentId === vol.id)
        for (const ch of chapters) {
          const storylineTag = ch.storylineIds?.length ? ` [线索: ${ch.storylineIds.map((id) => storylinesData.find((s) => s.id === id)?.name || id).join(', ')}]` : ''
          lines.push(`  【章】${ch.title}：${ch.summary}${storylineTag}`)
        }
      }
      const orphans = sorted.filter((n) => n.level === 'chapter' && !volumeNodes.some((v) => v.id === n.parentId))
      for (const ch of orphans) {
        const storylineTag = ch.storylineIds?.length ? ` [线索: ${ch.storylineIds.map((id) => storylinesData.find((s) => s.id === id)?.name || id).join(', ')}]` : ''
        lines.push(`【章】${ch.title}：${ch.summary}${storylineTag}`)
      }
      return lines.join('\n')
    },
    [],
  )

  // 章节编号/格式工具
  const numToChinese = (n: number): string => {
    const chars = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
    if (n <= 10) return chars[n]
    if (n < 20) return '十' + (n % 10 === 0 ? '' : chars[n % 10])
    if (n < 100) {
      const tens = Math.floor(n / 10)
      const ones = n % 10
      return chars[tens] + '十' + (ones === 0 ? '' : chars[ones])
    }
    return String(n)
  }

  const makeTitleNormalizer = () => {
    const existingTitles = outline.filter((n) => n.level === 'chapter').map((n) => n.title)
    const useChinese = existingTitles.some((t) => /[一二三四五六七八九十百]+/.test(t.match(/第[一二三四五六七八九十百\d]+章/)?.[0] || ''))
    const useColon = existingTitles.some((t) => /第[^\s]+章[：:]/.test(t))
    return (title: string, chapterNum: number): string => {
      const match = title.match(/第[^\s]+章[：:\s]*(.*)/)
      const content = match?.[1]?.trim() || title
      const numStr = useChinese ? numToChinese(chapterNum) : String(chapterNum)
      const sep = useColon ? '：' : ' '
      return `第${numStr}章${sep}${content}`
    }
  }

  // 持久化故事线
  const persistStorylines = useCallback(
    async (updated: Storyline[]) => {
      if (!currentWork) return
      await db.works.update(currentWork.id, { storylines: updated })
      setCurrentWork({ ...currentWork, storylines: updated, updatedAt: Date.now() })
    },
    [currentWork, setCurrentWork],
  )

  // 新增/编辑故事线
  const openSlModal = (sl?: Storyline) => {
    setEditingSl(sl || null)
    const color = sl?.color || 'blue'
    setSlColor(color)
    slForm.setFieldsValue(sl ? { name: sl.name, color: sl.color, description: sl.description } : { name: '', color: 'blue', description: '' })
    setSlModalOpen(true)
  }

  const handleSaveSl = async () => {
    const values = slForm.getFieldsValue()
    if (!values.name?.trim()) { message.warning('请输入线索名称'); return }
    if (editingSl) {
      const updated = storylines.map((s) => s.id === editingSl.id ? { ...s, ...values } : s)
      await persistStorylines(updated)
      message.success('已更新')
    } else {
      const newSl: Storyline = { id: generateId(), name: values.name.trim(), color: values.color || 'blue', description: values.description || '', chapterLinks: [] }
      await persistStorylines([...storylines, newSl])
      message.success('已添加')
    }
    setSlModalOpen(false)
    setEditingSl(null)
  }

  const handleDeleteSl = async (id: string) => {
    // 清理大纲节点中的引用
    const newOutline = outline.map((n) => ({
      ...n,
      storylineIds: n.storylineIds.filter((sid) => sid !== id),
    }))
    await persistOutline(newOutline)
    await persistStorylines(storylines.filter((s) => s.id !== id))
    message.success('已删除')
  }

  // AI 推荐线索
  const handleRecommendStorylines = async () => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    setSlRecommending(true)
    // 打开 AI 面板并初始化流式状态
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')

    try {
      const seed = seedContext(currentWork)
      const chars = charactersContext(currentWork.characters)
      const outlineStr = buildOutlineHierarchyStr(outline, storylines)
      const existingStr = storylines.map((s) => `${s.name}：${s.description}`).join('\n')

      const prompt = buildStorylineRecommendPrompt(seed, chars, outlineStr, existingStr)
      let result: any = null
      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        // 更新 AI 面板流式输出
        setAIStream(true, fullText)
        try {
          const cleaned = fullText.replace(/```json\s*/g, '').replace(/```\s*/g, '')
          const match = cleaned.match(/[\s\S]*[}\]]/)
          if (match) result = JSON.parse(match[0])
        } catch {}
      })

      if (!result || !Array.isArray(result)) {
        // 尝试解析完整文本
        try {
          const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
          const match = cleaned.match(/[\s\S]*[}\]]/)
          if (match) result = JSON.parse(match[0])
        } catch {}
      }

      if (!result || !Array.isArray(result)) {
        message.error('AI 返回格式错误')
        return
      }

      // 合法的颜色名称
      const validColors = ['red', 'orange', 'gold', 'green', 'cyan', 'blue', 'purple', 'magenta']

      const newStorylines: Storyline[] = result.map((item: any) => ({
        id: generateId(),
        name: item.name || '未命名',
        color: validColors.includes(item.color) ? item.color : 'blue',
        description: item.description || '',
        chapterLinks: [],
      }))

      await persistStorylines([...storylines, ...newStorylines])
      message.success(`已推荐 ${newStorylines.length} 条线索`)
    } catch (e: any) {
      message.error('推荐失败：' + e.message)
    } finally {
      setSlRecommending(false)
      setAIStream(false)
    }
  }

  // AI 润色线索
  const handlePolishStoryline = async () => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    const values = slForm.getFieldsValue()
    if (!values.description?.trim()) { message.warning('请先输入线索描述'); return }

    setSlPolishing(true)
    // 打开 AI 面板并初始化流式状态
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')

    try {
      const seed = seedContext(currentWork)
      const chars = charactersContext(currentWork.characters)
      const outlineStr = buildOutlineHierarchyStr(outline, storylines)

      const prompt = buildStorylinePolishPrompt(
        { name: values.name || '', description: values.description },
        seed,
        chars,
        outlineStr,
      )
      let result: any = null
      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        // 更新 AI 面板流式输出
        setAIStream(true, fullText)
        try {
          const cleaned = fullText.replace(/```json\s*/g, '').replace(/```\s*/g, '')
          const match = cleaned.match(/[\s\S]*[}\]]/)
          if (match) result = JSON.parse(match[0])
        } catch {}
      })

      if (!result?.description) {
        // 尝试解析完整文本
        try {
          const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
          const match = cleaned.match(/[\s\S]*[}\]]/)
          if (match) result = JSON.parse(match[0])
        } catch {}
      }

      if (!result?.description) {
        message.error('AI 返回格式错误')
        return
      }

      slForm.setFieldValue('description', result.description)
      message.success('已润色')
    } catch (e: any) {
      message.error('润色失败：' + e.message)
    } finally {
      setSlPolishing(false)
      setAIStream(false)
    }
  }

  // AI 修复故事线关联
  const handleFixStorylineBinding = async () => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }
    if (!storylines.length) { message.warning('请先创建故事线'); return }

    const chapterNodes = outline.filter((n) => n.level === 'chapter')
    if (!chapterNodes.length) { message.warning('暂无章节'); return }

    setSlFixing(true)
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')

    try {
      const prompt = buildFixStorylineBindingPrompt(
        chapterNodes.map((n) => ({ id: n.id, title: n.title, summary: n.summary })),
        storylines.map((s) => ({ id: s.id, name: s.name, description: s.description })),
      )

      let result: any[] = []
      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
        try {
          const cleaned = fullText.replace(/```json\s*/g, '').replace(/```\s*/g, '')
          const match = cleaned.match(/\[[\s\S]*\]/)
          if (match) result = JSON.parse(match[0])
        } catch {}
      })

      if (!result.length) {
        try {
          const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
          const match = cleaned.match(/\[[\s\S]*\]/)
          if (match) result = JSON.parse(match[0])
        } catch {}
      }

      if (!result.length) {
        message.error('AI 返回格式错误')
        return
      }

      // 构建映射并更新
      const validStorylineIds = new Set(storylines.map((s) => s.id))
      const bindingMap = new Map<string, string[]>()
      for (const item of result) {
        if (item.id && Array.isArray(item.storylineIds)) {
          bindingMap.set(item.id, item.storylineIds.filter((id: string) => validStorylineIds.has(id)))
        }
      }

      const newOutline = outline.map((n) => {
        if (n.level === 'chapter' && bindingMap.has(n.id)) {
          return { ...n, storylineIds: bindingMap.get(n.id)! }
        }
        return n
      })

      await persistOutline(newOutline)
      message.success(`已修复 ${bindingMap.size} 个章节的故事线关联`)
    } catch (e: any) {
      message.error('修复失败：' + e.message)
    } finally {
      setSlFixing(false)
      setAIStream(false)
    }
  }

  // AI 检查大纲逻辑完整性
  const handleCheckOutline = async () => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }
    if (!outline.length) { message.warning('大纲为空'); return }

    setChecking(true)
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')

    try {
      const outlineStr = buildOutlineHierarchyStr(outline, storylines)

      const storylinesStr = storylines.map((s) => `- ${s.name}：${s.description}`).join('\n')

      const prompt = buildOutlineCheckPrompt(
        seedContext(currentWork),
        worldContext(currentWork),
        charactersContext(currentWork.characters, 'major'),
        constraintsContext(currentWork.constraints),
        outlineStr,
        storylinesStr,
      )
      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })
      setAIStream(false, text)
    } catch (e: any) {
      message.error('检查失败：' + e.message)
      setAIStream(false, '检查失败：' + e.message)
    } finally {
      setChecking(false)
    }
  }

  // AI 连续生成多卷章节
  const handleMultiVolumeGenerate = async () => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) { message.warning('请先配置 AI API Key'); return }

    const values = multiGenForm.getFieldsValue()
    const selectedIds: string[] = values.volumeIds || []
    const countPerVolume: number = values.countPerVolume || 5
    const allowReshuffle: boolean = values.allowReshuffle ?? false
    if (selectedIds.length < 2) { message.warning('请至少选择 2 卷'); return }

    setMultiGenModalOpen(false)
    setMultiGenerating(true)
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')

    try {
      const allVolumeNodes = outline.filter((n) => n.level === 'volume').sort((a, b) => a.order - b.order)
      const allVolumeSummaries = allVolumeNodes.map((n) => ({ title: n.title, summary: n.summary }))

      // 为每个选中的卷计算参数
      const volumesParam = selectedIds.map((id, _i, arr) => {
        const volIdx = allVolumeNodes.findIndex((v) => v.id === id)
        const vol = allVolumeNodes[volIdx]
        const existingChapters = outline
          .filter((n) => n.parentId === id)
          .sort((a, b) => a.order - b.order)
          .map((n) => ({ title: n.title, summary: n.summary }))

        // 起始编号 = 所有前序卷的正式章节数（已有 + 本次批量中前面卷要生成的），跳过"第X卷终"
        let nextNum = 1
        for (let i = 0; i < volIdx; i++) {
          const prevVolId = allVolumeNodes[i].id
          // 已有章节（只认"第X章"格式）
          nextNum += outline.filter(
            (n) => n.level === 'chapter' && n.parentId === prevVolId && /第\d+章/.test(n.title)
          ).length
          // 如果前面的卷也在本次选中，加上要生成的章节数
          if (arr.includes(prevVolId)) {
            nextNum += countPerVolume
          }
        }
        // 如果当前卷已有章节，从已有最大编号 +1 继续
        if (existingChapters.length > 0) {
          let maxInVol = 0
          for (const ch of outline.filter((n) => n.parentId === id)) {
            const m = ch.title.match(/第(\d+)章/)
            if (m) maxInVol = Math.max(maxInVol, parseInt(m[1], 10))
          }
          if (maxInVol > 0) nextNum = maxInVol + 1
        }

        return {
          index: volIdx,
          title: vol.title,
          summary: vol.summary,
          existingChapters,
          count: countPerVolume,
          nextChapterNumber: nextNum,
        }
      })

      const prompt = buildMultiVolumeChaptersPrompt(
        volumesParam,
        allVolumeSummaries,
        worldContext(currentWork),
        charactersContext(currentWork.characters, 'major'),
        constraintsContext(currentWork.constraints),
        storylines.map((s) => ({ id: s.id, name: s.name, description: s.description })),
        allowReshuffle,
      )

      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      // 解析 JSON
      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) jsonStr = codeBlockMatch[1]
      // 兼容两种格式：纯数组 或 { chapters, updatedVolumes }
      const objMatch = jsonStr.match(/\{[\s\S]*"chapters"[\s\S]*\}/)
      let parsed: any[]
      let updatedVolumes: { index: number; newSummary: string }[] | null = null
      if (objMatch) {
        const obj = JSON.parse(objMatch[0])
        parsed = obj.chapters || []
        updatedVolumes = obj.updatedVolumes || null
      } else {
        const arrMatch = jsonStr.match(/\[[\s\S]*\]/)
        if (!arrMatch) {
          message.error('AI 返回格式异常，请重试')
          setAIStream(false, '生成失败')
          return
        }
        parsed = JSON.parse(arrMatch[0]) as Array<any>
      }
      const normalizeTitle = makeTitleNormalizer()

      // 构建 volumeIndex → volumeId 映射
      const volumeIdMap = new Map<number, string>()
      selectedIds.forEach((id) => {
        const idx = allVolumeNodes.findIndex((v) => v.id === id)
        volumeIdMap.set(idx, id)
      })

      // 按卷分组并生成节点
      const newNodes: OutlineNode[] = []
      const volumeCounters = new Map<number, number>() // volumeIndex → 当前编号

      // 初始化计数器
      for (const vp of volumesParam) {
        volumeCounters.set(vp.index, vp.nextChapterNumber)
      }

      for (const item of parsed) {
        const volIdx = item.volumeIndex ?? 0
        const volId = volumeIdMap.get(volIdx)
        if (!volId) continue

        const chapterNum = volumeCounters.get(volIdx) ?? 1
        volumeCounters.set(volIdx, chapterNum + 1)

        const rawTitle = item.title || `新章节`
        newNodes.push({
          id: generateId(),
          parentId: volId,
          title: normalizeTitle(rawTitle, chapterNum),
          summary: item.summary || '',
          order: outline.length + newNodes.length,
          level: 'chapter',
          characterIds: [],
          storylineIds: Array.isArray(item.storylineIds) ? item.storylineIds : [],
        })
      }

      let finalOutline = [...outline, ...newNodes]

      // 如果 AI 调整了卷摘要，更新对应卷节点
      if (updatedVolumes?.length) {
        finalOutline = finalOutline.map((n) => {
          const update = updatedVolumes.find((u) => volumeIdMap.has(u.index) && n.id === volumeIdMap.get(u.index))
          if (update) return { ...n, summary: update.newSummary }
          return n
        })
      }

      await persistOutline(finalOutline)

      // 修正后的摘要
      let summaryText = `已为 ${selectedIds.length} 卷生成 ${newNodes.length} 个章节：\n\n${newNodes.map((n) => `${n.title}\n${n.summary}`).join('\n\n')}`
      if (updatedVolumes?.length) {
        summaryText += `\n\n---\nAI 调整了以下卷的摘要：\n${updatedVolumes.map((u) => {
          const volTitle = allVolumeNodes.find((v) => v.id === volumeIdMap.get(u.index))?.title || ''
          return `第${u.index + 1}卷「${volTitle}」：${u.newSummary}`
        }).join('\n')}`
      }
      setAIStream(false, summaryText)
      message.success(`已为 ${selectedIds.length} 卷生成 ${newNodes.length} 个章节`)
    } catch (e: any) {
      message.error('生成失败：' + e.message)
      setAIStream(false, '生成失败：' + e.message)
    } finally {
      setMultiGenerating(false)
    }
  }

  // 切换节点的故事线关联
  const toggleStorylineOnNode = useCallback(
    async (nodeId: string, storylineId: string) => {
      if (!currentWork) return
      const node = outline.find((n) => n.id === nodeId)
      if (!node) return
      const has = node.storylineIds.includes(storylineId)
      const newIds = has
        ? node.storylineIds.filter((sid) => sid !== storylineId)
        : [...node.storylineIds, storylineId]
      const newOutline = outline.map((n) => n.id === nodeId ? { ...n, storylineIds: newIds } : n)
      await persistOutline(newOutline)
    },
    [currentWork, outline, persistOutline],
  )

  // 打开生成设置弹窗
  const openGenModal = () => {
    genForm.setFieldsValue({ volumes: 3, chaptersPerVolume: 5 })
    setGenModalOpen(true)
  }

  // AI 生成大纲
  const handleGenerate = async () => {
    if (!currentWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const values = genForm.getFieldsValue()
    const volumes = values.volumes || 3
    const chaptersPerVolume = values.genMode === 'volumeOnly' ? 0 : (values.chaptersPerVolume || 5)
    setGenModalOpen(false)

    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')
    try {
      const basePrompt = buildOutlinePrompt(
        seedContext(currentWork),
        worldContext(currentWork),
        charactersContext(currentWork.characters, 'major'),
        constraintsContext(currentWork.constraints),
        storylines.map((s) => ({ id: s.id, name: s.name, description: s.description })),
        chaptersPerVolume,
      )
      const prompt = chaptersPerVolume > 0
        ? `${basePrompt}\n\n要求：生成 ${volumes} 卷，每卷 ${chaptersPerVolume} 章。`
        : `${basePrompt}\n\n要求：生成 ${volumes} 卷，每卷 0 章（只生成卷，不生成章）。`

      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      // 解析 AI 返回的 JSON（兼容 markdown 代码块）
      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1]
      }
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.error('AI 返回内容：', text)
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '生成失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<any>
      // 构建名称→ID 映射
      const nameToId = new Map<string, string>()
      for (const s of storylines) {
        nameToId.set(s.name, s.id)
        nameToId.set(s.name.toLowerCase(), s.id)
      }
      const validStorylineIds = new Set(storylines.map((s) => s.id))
      const resolveStorylineIds = (ids: string[] | undefined): string[] => {
        if (!ids || !ids.length) return []
        return ids
          .map((id) => {
            if (validStorylineIds.has(id)) return id
            return nameToId.get(id) || nameToId.get(id.trim()) || null
          })
          .filter((id): id is string => id !== null)
      }

      const nodes: OutlineNode[] = []
      let order = 0
      let currentVolumeId: string | undefined

      for (const item of parsed) {
        const id = generateId()
        if (item.level === 'volume') {
          currentVolumeId = id
        }
        const node: OutlineNode = {
          id,
          parentId: item.level === 'chapter' ? currentVolumeId : undefined,
          title: item.title,
          summary: item.summary || '',
          order: order++,
          level: item.level || 'chapter',
          characterIds: item.characters || [],
          storylineIds: item.level === 'chapter' ? resolveStorylineIds(item.storylineIds) : [],
        }
        nodes.push(node)
      }

      await persistOutline(nodes)
      // 清理孤儿章节（outlineId 不在新大纲中的章节）
      const validOutlineIds = new Set(nodes.map((n) => n.id))
      const orphanedChapters = currentWork.chapters.filter((c) => !validOutlineIds.has(c.outlineId))
      let finalChapters = currentWork.chapters
      if (orphanedChapters.length > 0) {
        finalChapters = currentWork.chapters.filter((c) => validOutlineIds.has(c.outlineId))
        await db.works.update(currentWork.id, { chapters: finalChapters })
      }
      setCurrentWork({
        ...currentWork,
        outline: nodes,
        chapters: finalChapters,
        updatedAt: Date.now(),
      })
      setAIStream(false, text)
      message.success(`已生成 ${nodes.filter((n) => n.level === 'volume').length} 卷 ${nodes.filter((n) => n.level === 'chapter').length} 章的大纲`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 清空大纲（同时清理关联的章节内容和事件簿）
  const handleClear = async () => {
    const work = currentWork
    if (!work) return
    await db.works.update(work.id, { outline: [], chapters: [], eventLog: [] })
    setCurrentWork({ ...work, outline: [], chapters: [], eventLog: [], updatedAt: Date.now() })
    message.success('已清空大纲')
  }


  // 卷列表（卡片式）
  const volumes = useMemo(() => {
    return outline
      .filter((n) => n.level === 'volume')
      .sort((a, b) => a.order - b.order)
  }, [outline])

  // 获取某卷下的章节
  const getChapters = (volumeId: string) => {
    return outline
      .filter((n) => n.parentId === volumeId)
      .sort((a, b) => a.order - b.order)
  }

  // 打开编辑
  const openEdit = (node: OutlineNode) => {
    setEditing(node)
    form.setFieldsValue({ title: node.title, summary: node.summary, storylineIds: node.storylineIds || [] })
    setEditModalOpen(true)
  }

  // 保存编辑
  const handleSave = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const newOutline = outline.map((n) =>
      n.id === editing.id ? { ...n, ...values } : n,
    )
    await persistOutline(newOutline)
    setEditModalOpen(false)
    setEditing(null)
  }

  // 删除节点（含子节点 + 关联章节 + 事件簿）
  const removeNode = async (id: string) => {
    const work = useStore.getState().currentWork
    if (!work) return
    const curOutline = work.outline ?? []
    const toRemove = new Set<string>()
    const collect = (nodeId: string) => {
      toRemove.add(nodeId)
      curOutline.filter((n) => n.parentId === nodeId).forEach((n) => collect(n.id))
    }
    collect(id)
    const newOutline = curOutline.filter((n) => !toRemove.has(n.id))
    // 同步清理关联的章节内容和事件簿
    const removedChapters = (work.chapters ?? []).filter((c) => toRemove.has(c.outlineId))
    const removedChapterIds = new Set(removedChapters.map((c) => c.id))
    const keptChapters = (work.chapters ?? []).filter((c) => !toRemove.has(c.outlineId))
    const keptEvents = (work.eventLog ?? []).filter((e) => !removedChapterIds.has(e.chapterId))
    await db.works.update(work.id, { outline: newOutline, chapters: keptChapters, eventLog: keptEvents })
    setCurrentWork({ ...work, outline: newOutline, chapters: keptChapters, eventLog: keptEvents, updatedAt: Date.now() })
  }

  // 修复章节编号连续性（只改"第X章"格式，其他标题不动）
  const handleRenumberChapters = async () => {
    if (!currentWork) return
    const sorted = [...outline].sort((a, b) => a.order - b.order)

    // 检测现有格式
    const chapterTitles = sorted.filter((n) => n.level === 'chapter' && /第.+章/.test(n.title)).map((n) => n.title)
    const useChinese = chapterTitles.some((t) => /[一二三四五六七八九十百]+/.test(t.match(/第[一二三四五六七八九十百\d]+章/)?.[0] || ''))
    const useColon = chapterTitles.some((t) => /第[^\s]+章[：:]/.test(t))

    let num = 0
    const updated = sorted.map((n) => {
      if (n.level !== 'chapter') return n
      const match = n.title.match(/第[一二三四五六七八九十百\d]+章[：:\s]*(.*)/)
      if (!match) return n // 非"第X章"格式，不动
      num++
      const numStr = useChinese ? numToChinese(num) : String(num)
      const sep = useColon ? '：' : ' '
      const content = match[1]?.trim()
      const newTitle = content ? `第${numStr}章${sep}${content}` : `第${numStr}章`
      return { ...n, title: newTitle }
    })

    // 同步更新 chapters 中的 title
    const chapters = currentWork.chapters ?? []
    const updatedChapters = chapters.map((ch) => {
      const node = updated.find((n) => n.id === ch.outlineId)
      if (node && node.title !== ch.title) return { ...ch, title: node.title }
      return ch
    })

    await persistOutline(updated)
    if (updatedChapters.some((c, i) => c !== chapters[i])) {
      await db.works.update(currentWork.id, { chapters: updatedChapters })
      setCurrentWork({ ...useStore.getState().currentWork!, chapters: updatedChapters })
    }
    message.success(`已修复 ${num} 个章节编号`)
  }

  // AI 润色当前编辑的节点
  const handleAIPolish = async () => {
    if (!editing || !currentWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const setAIStream = useStore.getState().setAIStream
    setPolishing(true)
    setAIStream(true, '')
    try {
      const isVolume = editing.level === 'volume'
      // 找到所属卷
      const parentVolume = isVolume ? editing : outline.find((n) => n.id === editing.parentId)
      // 同级节点（不含自身）
      const siblings = outline.filter(
        (n) => n.id !== editing.id && (
          isVolume ? n.level === 'volume' : n.parentId === editing.parentId
        )
      ).sort((a, b) => a.order - b.order)

      const parentContext = parentVolume
        ? `${parentVolume.title}：${parentVolume.summary || '（无简述）'}`
        : '（无所属卷）'
      const siblingContext = siblings.length
        ? siblings.map((n) => `- ${n.title}：${n.summary || '（无简述）'}`).join('\n')
        : '（无同级章节）'

      const prompt = buildOutlineNodePolishPrompt(
        { title: editing.title, summary: editing.summary, level: editing.level },
        parentContext,
        siblingContext,
        worldContext(currentWork),
        charactersContext(currentWork.characters),
      )

      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) jsonStr = codeBlockMatch[1]
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '润色失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0])
      form.setFieldsValue({
        title: parsed.title || editing.title,
        summary: parsed.summary || editing.summary,
      })
      setEditing({ ...editing, title: parsed.title || editing.title, summary: parsed.summary || editing.summary })
      setAIStream(false, text)
      message.success('AI 润色完成')
    } catch (err: any) {
      message.error(`润色失败：${err.message}`)
      setAIStream(false, `润色失败：${err.message}`)
    } finally {
      setPolishing(false)
    }
  }

  // 打开 AI 添加章节弹窗
  const openAddChapters = (volume: OutlineNode) => {
    setAddChaptersVolume(volume)
    addChaptersForm.setFieldsValue({ count: 3 })
    setAddChaptersModalOpen(true)
  }

  // AI 为指定卷添加章节
  const handleAIAddChapters = async () => {
    if (!addChaptersVolume || !currentWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const count = addChaptersForm.getFieldValue('count') || 3
    setAddChaptersModalOpen(false)
    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    if (!aiPanelOpen) toggleAIPanel()
    setAIStream(true, '')
    try {
      const existingChapters = outline
        .filter((n) => n.parentId === addChaptersVolume.id)
        .sort((a, b) => a.order - b.order)
        .map((n) => ({ title: n.title, summary: n.summary }))

      // 构建全卷结构，计算当前卷的起始章节编号
      const allVolumes = outline
        .filter((n) => n.level === 'volume')
        .sort((a, b) => a.order - b.order)
      const volumeIndex = allVolumes.findIndex((v) => v.id === addChaptersVolume.id)

      // 起始编号 = 前面所有卷的正式章节数 + 1（跳过"第X卷终"等非正式章节）
      let nextChapterNumber = 1
      for (let i = 0; i < volumeIndex; i++) {
        nextChapterNumber += outline.filter(
          (n) => n.level === 'chapter' && n.parentId === allVolumes[i].id && /第\d+章/.test(n.title)
        ).length
      }

      // 如果当前卷已有章节，从已有最大编号 +1 续编（只认"第X章"格式）
      if (existingChapters.length > 0) {
        let maxInVolume = 0
        for (const ch of outline.filter((n) => n.parentId === addChaptersVolume.id)) {
          const m = ch.title.match(/第(\d+)章/)
          if (m) maxInVolume = Math.max(maxInVolume, parseInt(m[1], 10))
        }
        if (maxInVolume > 0) nextChapterNumber = maxInVolume + 1
      }

      const allVolumeSummaries = allVolumes.map((n) => ({ title: n.title, summary: n.summary }))

      const prompt = buildAddChaptersPrompt(
        { title: addChaptersVolume.title, summary: addChaptersVolume.summary, index: volumeIndex >= 0 ? volumeIndex : 0 },
        allVolumeSummaries,
        existingChapters,
        count,
        nextChapterNumber,
        worldContext(currentWork),
        charactersContext(currentWork.characters),
        constraintsContext(currentWork.constraints),
        storylines.map((s) => ({ id: s.id, name: s.name, description: s.description })),
      )

      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) jsonStr = codeBlockMatch[1]
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '生成失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0]) as { title: string; summary: string; storylineIds?: string[] }[]
      // 构建名称→ID 映射（兼容 AI 输出名称而非 ID 的情况）
      const nameToId = new Map<string, string>()
      for (const s of storylines) {
        nameToId.set(s.name, s.id)
        nameToId.set(s.name.toLowerCase(), s.id)
      }
      const validStorylineIds = new Set(storylines.map((s) => s.id))
      const resolveStorylineIds = (ids: string[] | undefined): string[] => {
        if (!ids || !ids.length) return []
        return ids
          .map((id) => {
            if (validStorylineIds.has(id)) return id
            // 尝试按名称匹配
            return nameToId.get(id) || nameToId.get(id.trim()) || null
          })
          .filter((id): id is string => id !== null)
      }

      const normalizeTitle = makeTitleNormalizer()
      const startOrder = outline.length
      const newNodes: OutlineNode[] = parsed.map((item, i) => {
        const chapterNum = nextChapterNumber + i
        const rawTitle = item.title || `新章节 ${i + 1}`
        return {
          id: generateId(),
          parentId: addChaptersVolume.id,
          title: normalizeTitle(rawTitle, chapterNum),
          summary: item.summary || '',
          order: startOrder + i,
          level: 'chapter',
          characterIds: [],
          storylineIds: resolveStorylineIds(item.storylineIds),
        }
      })

      const newOutline = [...outline, ...newNodes]
      await persistOutline(newOutline)
      // AI 面板显示修正后的结果
      const correctedText = `已为「${addChaptersVolume.title}」生成 ${newNodes.length} 个章节：\n\n${newNodes.map((n) => `${n.title}\n${n.summary}`).join('\n\n')}`
      setAIStream(false, correctedText)
      message.success(`已为「${addChaptersVolume.title}」添加 ${newNodes.length} 个章节`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      setLoading(false)
      setAddChaptersVolume(null)
    }
  }

  // 新增节点
  const handleAdd = (level: 'volume' | 'chapter', parentId?: string) => {
    const newNode: OutlineNode = {
      id: generateId(),
      parentId,
      title: level === 'volume' ? '新卷' : '新章',
      summary: '',
      order: outline.length,
      level,
      characterIds: [],
      storylineIds: [],
    }
    setEditing(newNode)
    form.setFieldsValue({ title: newNode.title, summary: '' })
    setEditModalOpen(true)
  }

  // 新建序章卷（排在最前面，章节不参与编号）
  const handleAddPrologue = async () => {
    if (!currentWork) return
    const volId = generateId()
    const chId = generateId()
    const volNode: OutlineNode = {
      id: volId,
      title: '序章',
      summary: '正文前的背景铺垫',
      order: 0,
      level: 'volume',
      characterIds: [],
      storylineIds: [],
    }
    const chNode: OutlineNode = {
      id: chId,
      parentId: volId,
      title: '前言',
      summary: '',
      order: 1,
      level: 'chapter',
      characterIds: [],
      storylineIds: [],
    }
    // 所有现有节点 order +2，给序章卷和前言腾位
    const shifted = outline.map((n) => ({ ...n, order: n.order + 2 }))
    const newOutline = [volNode, chNode, ...shifted]
    await persistOutline(newOutline)
    message.success('已创建序章卷')
  }

  // 保存新增
  const handleSaveNew = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    await persistOutline([...outline, { ...editing, ...values }])
    setEditModalOpen(false)
    setEditing(null)
  }

  const isNew = editing && !outline.find((n) => n.id === editing.id)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>主线大纲</Title>
        {!readOnly && (
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => handleAdd('volume')}>新增卷</Button>
            <Button onClick={handleAddPrologue}>新建序章卷</Button>
            {!outline.some((n) => n.level === 'chapter') && (
              <Button icon={<ExperimentOutlined />} onClick={openGenModal} loading={loading}>
                AI 随机生成
              </Button>
            )}
            {outline.length > 0 && (
              <Button icon={<ExperimentOutlined />} onClick={() => { multiGenForm.setFieldsValue({ volumeIds: [], countPerVolume: 5 }); setMultiGenModalOpen(true) }}>
                AI 连续生成多卷
              </Button>
            )}
            {outline.length > 0 && (
              <>
                <Button icon={<ExperimentOutlined />} onClick={handleCheckOutline} loading={checking}>
                  检查逻辑完整性
                </Button>
                <Button onClick={handleRenumberChapters}>
                  修复章节编号
                </Button>
              </>
            )}
            {outline.length > 0 && (
              <Popconfirm title="确定清空所有大纲？" onConfirm={handleClear} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}
                onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
              >
                <Button danger>清空大纲</Button>
              </Popconfirm>
            )}
          </Space>
        )}
      </div>

      {/* 简要统计 */}
      {outline.length > 0 && (() => {
        const volCount = outline.filter((n) => n.level === 'volume').length
        const chCount = outline.filter((n) => n.level === 'chapter').length
        const estWords = chCount * 3000
        return (
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Tag color="blue">{volCount} 卷</Tag>
              <Tag color="blue">{chCount} 章</Tag>
              <Tag color="purple">预计 {estWords.toLocaleString()} 字</Tag>
            </Space>
          </div>
        )
      })()}

      {/* 故事线索管理 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>故事线：</Text>
          {storylines.map((sl) => {
            const count = outline.filter((n) => n.storylineIds?.includes(sl.id)).length
            return (
              <Tag
                key={sl.id}
                color={sl.color}
                style={{ cursor: 'pointer', margin: 0 }}
                onClick={() => openSlModal(sl)}
              >
                {sl.name}{count > 0 && ` (${count})`}
              </Tag>
            )
          })}
          {!readOnly && (
            <>
              <Tag
                style={{ cursor: 'pointer', borderStyle: 'dashed', margin: 0 }}
                onClick={() => openSlModal()}
              >
                + 添加线索
              </Tag>
              <Tag
                style={{ cursor: 'pointer', borderStyle: 'dashed', margin: 0, color: '#722ed1', borderColor: '#722ed1' }}
                onClick={handleRecommendStorylines}
              >
                {slRecommending ? '推荐中...' : '✨ AI 推荐'}
              </Tag>
              {storylines.length > 0 && outline.some((n) => n.level === 'chapter') && (
                <Tag
                  style={{ cursor: 'pointer', borderStyle: 'dashed', margin: 0, color: '#13c2c2', borderColor: '#13c2c2' }}
                  onClick={handleFixStorylineBinding}
                >
                  {slFixing ? '修复中...' : '🔧 修复关联'}
                </Tag>
              )}
            </>
          )}
        </div>
        <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
          点击线索标签可编辑，点击章节上的线索标签可取消关联
        </Text>
      </div>

      <Spin spinning={loading}>
        {outline.length === 0 && !loading ? (
          <Empty description="点击上方按钮让 AI 生成主线大纲" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {volumes.map((vol, _volIdx) => {
              const chapters = getChapters(vol.id)
              return (
                <Card
                  key={vol.id}
                  title={
                    <Space>
                      <BookOutlined />
                      <Text strong style={{ fontSize: 15 }}>{vol.title}</Text>
                      <Tag>{chapters.length} 章</Tag>
                    </Space>
                  }
                  extra={
                    !readOnly ? (
                      <Space>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => handleAdd('chapter', vol.id)}>手动添加</Button>
                        <Button size="small" icon={<ExperimentOutlined />} onClick={() => openAddChapters(vol)}>AI 添加</Button>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(vol)} />
                        <Popconfirm title="确定删除？章节也会被删除" onConfirm={() => removeNode(vol.id)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}
                          onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
                        >
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ) : undefined
                  }
                >
                  {vol.summary && (
                    <div style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          color: '#666',
                          fontSize: 14,
                          lineHeight: 1.8,
                          whiteSpace: 'pre-wrap',
                          overflow: 'hidden',
                          maxHeight: expandedSummaries.has(vol.id) ? 'none' : 80,
                        }}
                      >{vol.summary}</div>
                      {vol.summary.length > 100 && (
                        <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }}
                          onClick={() => setExpandedSummaries((prev) => {
                            const next = new Set(prev)
                            next.has(vol.id) ? next.delete(vol.id) : next.add(vol.id)
                            return next
                          })}
                        >
                          {expandedSummaries.has(vol.id) ? '收起' : '展开全部'}
                        </Button>
                      )}
                    </div>
                  )}

                  {chapters.length === 0 ? (
                    <Text type="secondary">暂无章节</Text>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {chapters.map((ch, _chIdx) => (
                        <Card
                          key={ch.id}
                          size="small"
                          style={{ background: '#fafafa' }}
                          title={
                            <Space>
                              <FileTextOutlined />
                              <Text strong>{ch.title}</Text>
                            </Space>
                          }
                          extra={
                            !readOnly ? (
                              <Space>
                                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(ch)} />
                                <Popconfirm title="确定删除？" onConfirm={() => removeNode(ch.id)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}
                                  onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
                                >
                                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                            ) : undefined
                          }
                        >
                          <div>
                            <div
                              style={{
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                overflow: 'hidden',
                                maxHeight: expandedSummaries.has(ch.id) ? 'none' : 66,
                                fontSize: 13,
                              }}
                            >
                              {ch.summary || '暂无剧情简述'}
                            </div>
                            {(ch.summary || '').length > 100 && (
                              <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }}
                                onClick={() => setExpandedSummaries((prev) => {
                                  const next = new Set(prev)
                                  next.has(ch.id) ? next.delete(ch.id) : next.add(ch.id)
                                  return next
                                })}
                              >
                                {expandedSummaries.has(ch.id) ? '收起' : '展开'}
                              </Button>
                            )}
                          </div>
                          {/* 故事线标记 */}
                          {ch.storylineIds && ch.storylineIds.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                              {ch.storylineIds.map((sid) => {
                                const sl = (currentWork?.storylines ?? []).find((s) => s.id === sid)
                                if (!sl) return null
                                return (
                                  <Tooltip key={sid} title={`${sl.name}：${sl.description || '暂无描述'}`} placement="top">
                                    <Tag
                                      color={sl.color || 'blue'}
                                      style={{ cursor: 'pointer', fontSize: 11, margin: 0 }}
                                      onClick={() => toggleStorylineOnNode(ch.id, sid)}
                                    >
                                      {sl.name}
                                    </Tag>
                                  </Tooltip>
                                )
                              })}
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </Spin>

      {/* 生成设置弹窗 */}
      <Modal
        title="AI 生成大纲设置"
        open={genModalOpen}
        forceRender
        mask={{ closable: false }}
        onOk={handleGenerate}
        onCancel={() => setGenModalOpen(false)}
        okText="开始生成"
        cancelText="取消"
      >
        <Form form={genForm} layout="vertical" initialValues={{ volumes: 3, genMode: 'volumeOnly', chaptersPerVolume: 5 }}>
          <Form.Item name="volumes" label="卷数">
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="genMode" label="生成模式">
            <Radio.Group>
              <Radio value="volumeOnly">只生成卷（后续单独添加章）</Radio>
              <Radio value="all">一次性生成卷+章</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.genMode !== cur.genMode}>
            {({ getFieldValue }) =>
              getFieldValue('genMode') === 'all' && (
                <Form.Item name="chaptersPerVolume" label="每卷章数">
                  <InputNumber min={1} max={20} style={{ width: '100%' }} />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title={isNew ? (editing?.level === 'volume' ? '新增卷' : '新增章节') : '编辑'}
        open={editModalOpen}
        forceRender
        mask={{ closable: false }}
        onOk={isNew ? handleSaveNew : handleSave}
        onCancel={() => setEditModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={600}
        footer={(_, { OkBtn, CancelBtn }) => (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              icon={<ExperimentOutlined />}
              loading={polishing}
              onClick={handleAIPolish}
              disabled={readOnly || !!isNew}
            >
              AI 润色
            </Button>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        )}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="summary" label="剧情简述">
            <TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="100-200字的剧情概要" />
          </Form.Item>
          {storylines.length > 0 && (
            <Form.Item name="storylineIds" label="关联故事线">
              <Space wrap>
                {storylines.map((sl) => {
                  const selected = storylineIds.includes(sl.id)
                  return (
                    <Tooltip key={sl.id} title={sl.description || '暂无描述'} placement="top">
                      <Tag
                        color={selected ? sl.color : undefined}
                        style={{ cursor: 'pointer', margin: 0 }}
                        onClick={() => {
                          form.setFieldsValue({
                            storylineIds: selected
                              ? storylineIds.filter((id: string) => id !== sl.id)
                              : [...storylineIds, sl.id],
                          })
                          // 强制刷新
                          setEditing({ ...editing! })
                        }}
                      >
                        {sl.name}
                      </Tag>
                    </Tooltip>
                  )
                })}
              </Space>
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* AI 添加章节弹窗 */}
      <Modal
        title={`AI 为「${addChaptersVolume?.title || ''}」添加章节`}
        open={addChaptersModalOpen}
        forceRender
        mask={{ closable: false }}
        onOk={handleAIAddChapters}
        onCancel={() => { setAddChaptersModalOpen(false); setAddChaptersVolume(null) }}
        okText="开始生成"
        cancelText="取消"
      >
        <Form form={addChaptersForm} layout="vertical" initialValues={{ count: 3 }}>
          <Form.Item name="count" label="添加章节数" rules={[{ required: true, message: '请输入章节数' }]}>
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            AI 会根据卷简介、已有章节和核心约束，生成新章节的标题和剧情简述。
          </Text>
        </Form>
      </Modal>

      {/* 故事线编辑弹窗 */}
      <Modal
        title={editingSl ? '编辑线索' : '添加线索'}
        open={slModalOpen}
        forceRender
        mask={{ closable: false }}
        onOk={handleSaveSl}
        onCancel={() => { setSlModalOpen(false); setEditingSl(null) }}
        okText="保存"
        cancelText="取消"
        footer={editingSl ? (_, { OkBtn, CancelBtn }) => (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Popconfirm title="确定删除此线索？" onConfirm={() => { handleDeleteSl(editingSl.id); setSlModalOpen(false) }} okText="确认" cancelText="取消"
              onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
            >
              <Button danger>删除</Button>
            </Popconfirm>
            <Space>
              <Button onClick={handlePolishStoryline} loading={slPolishing}>✨ AI 润色</Button>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Space>
              <Button onClick={handlePolishStoryline} loading={slPolishing}>✨ AI 润色</Button>
              <Button onClick={() => { setSlModalOpen(false); setEditingSl(null) }}>取消</Button>
              <Button type="primary" onClick={handleSaveSl}>保存</Button>
            </Space>
          </div>
        )}
      >
        <Form form={slForm} layout="vertical">
          <Form.Item name="name" label="线索名称" rules={[{ required: true, message: '请输入线索名称' }]}>
            <Input placeholder="如：感情线、复仇线、身世之谜" />
          </Form.Item>
          <Form.Item name="color" label="颜色">
            <Space>
              {SL_COLORS.map((c) => (
                <Tag
                  key={c.value}
                  color={c.value}
                  style={{ cursor: 'pointer', border: slColor === c.value ? '2px solid #333' : '2px solid transparent' }}
                  onClick={() => {
                    slForm.setFieldsValue({ color: c.value })
                    setSlColor(c.value)
                  }}
                >
                  {c.label}
                </Tag>
              ))}
            </Space>
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="这条线索的核心走向..." />
          </Form.Item>
          {editingSl && (() => {
            const linkedNodes = outline.filter((n) => n.storylineIds?.includes(editingSl.id))
            return linkedNodes.length > 0 ? (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>关联章节：</Text>
                <div style={{ marginTop: 4 }}>
                  {linkedNodes.map((n) => (
                    <Tag key={n.id} style={{ marginBottom: 4 }}>{n.title}</Tag>
                  ))}
                </div>
              </div>
            ) : null
          })()}
        </Form>
      </Modal>

      {/* AI 连续生成多卷弹窗 */}
      <Modal
        title="AI 连续生成多卷章节"
        open={multiGenModalOpen}
        forceRender
        onOk={handleMultiVolumeGenerate}
        onCancel={() => setMultiGenModalOpen(false)}
        okText="开始生成"
        cancelText="取消"
        mask={{ closable: false }}
        confirmLoading={multiGenerating}
      >
        <Form form={multiGenForm} layout="vertical" initialValues={{ volumeIds: [], countPerVolume: 5, allowReshuffle: true }}>
          <Form.Item name="volumeIds" label="选择要连续生成的卷（至少 2 卷）">
            <Checkbox.Group
              options={outline.filter((n) => n.level === 'volume').sort((a, b) => a.order - b.order).map((v, i) => ({
                label: `第${i + 1}卷「${v.title}」`,
                value: v.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="countPerVolume" label="每卷生成章数">
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="allowReshuffle" valuePropName="checked">
            <Checkbox>允许 AI 调整各卷摘要（重新分配剧情到更合理的位置）</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
