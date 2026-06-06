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
import { OUTLINE_SYSTEM_PROMPT, buildOutlinePrompt, buildOutlineNodePolishPrompt, buildAddChaptersPrompt, buildStorylineRecommendPrompt, buildStorylinePolishPrompt, buildFixStorylineBindingPrompt } from '@/ai/prompts/outline'

const { Title, Text, Paragraph } = Typography
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
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [genModalOpen, setGenModalOpen] = useState(false)
  const [addChaptersModalOpen, setAddChaptersModalOpen] = useState(false)
  const [addChaptersVolume, setAddChaptersVolume] = useState<OutlineNode | null>(null)
  const [editing, setEditing] = useState<OutlineNode | null>(null)
  const [form] = Form.useForm()
  const [genForm] = Form.useForm()
  const [addChaptersForm] = Form.useForm()

  // --- 故事线 ---
  const [slModalOpen, setSlModalOpen] = useState(false)
  const [editingSl, setEditingSl] = useState<Storyline | null>(null)
  const [slColor, setSlColor] = useState<string>('blue')
  const [slForm] = Form.useForm()
  const [slRecommending, setSlRecommending] = useState(false)
  const [slPolishing, setSlPolishing] = useState(false)
  const [slFixing, setSlFixing] = useState(false)

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
      const updated = { ...currentWork, outline: newOutline, updatedAt: Date.now() }
      await db.works.update(currentWork.id, { outline: newOutline })
      setCurrentWork(updated)
    },
    [currentWork, setCurrentWork],
  )

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
      const outlineStr = outline.map((n) => `${n.level === 'volume' ? '【卷】' : '【章】'}${n.title}：${n.summary}`).join('\n')
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
    if (!currentWork || !editingSl) return
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
      const outlineStr = outline.map((n) => `${n.level === 'volume' ? '【卷】' : '【章】'}${n.title}：${n.summary}`).join('\n')

      const prompt = buildStorylinePolishPrompt(
        { name: values.name || editingSl.name, description: values.description },
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
    const chaptersPerVolume = values.chaptersPerVolume || 5
    setGenModalOpen(false)

    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    setAIStream(true, '')
    try {
      const basePrompt = buildOutlinePrompt(
        seedContext(currentWork),
        worldContext(currentWork),
        charactersContext(currentWork.characters, 'major'),
        constraintsContext(currentWork.constraints),
        storylines.map((s) => ({ id: s.id, name: s.name, description: s.description })),
      )
      const prompt = `${basePrompt}\n\n要求：生成 ${volumes} 卷，每卷 ${chaptersPerVolume} 章。`

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
    await persistOutline([])
    if (currentWork?.chapters?.length || currentWork?.eventLog?.length) {
      await db.works.update(currentWork.id, { chapters: [], eventLog: [] })
      setCurrentWork({ ...currentWork, chapters: [], eventLog: [], updatedAt: Date.now() })
    }
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

  // 删除节点（含子节点 + 关联章节）
  const removeNode = async (id: string) => {
    const toRemove = new Set<string>()
    const collect = (nodeId: string) => {
      toRemove.add(nodeId)
      outline.filter((n) => n.parentId === nodeId).forEach((n) => collect(n.id))
    }
    collect(id)
    const newOutline = outline.filter((n) => !toRemove.has(n.id))
    // 同步清理关联的章节内容
    const keptChapters = (currentWork?.chapters ?? []).filter((c) => !toRemove.has(c.outlineId))
    await persistOutline(newOutline)
    if (keptChapters.length < (currentWork?.chapters ?? []).length) {
      await db.works.update(currentWork!.id, { chapters: keptChapters })
      setCurrentWork({ ...currentWork!, chapters: keptChapters })
    }
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
    setAIStream(true, '')
    try {
      const existingChapters = outline
        .filter((n) => n.parentId === addChaptersVolume.id)
        .sort((a, b) => a.order - b.order)
        .map((n) => ({ title: n.title, summary: n.summary }))

      // 从所有已有章节标题中提取最大编号
      const allChapterTitles = outline.filter((n) => n.level === 'chapter').map((n) => n.title)
      let maxNum = 0
      for (const t of allChapterTitles) {
        const m = t.match(/第(\d+)章/)
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
      }
      const nextChapterNumber = maxNum + 1

      // 构建全卷结构
      const allVolumes = outline
        .filter((n) => n.level === 'volume')
        .sort((a, b) => a.order - b.order)
        .map((n) => ({ title: n.title, summary: n.summary }))
      const volumeIndex = allVolumes.findIndex((_, i) => {
        const vol = outline.filter((n) => n.level === 'volume').sort((a, b) => a.order - b.order)[i]
        return vol?.id === addChaptersVolume.id
      })

      const prompt = buildAddChaptersPrompt(
        { title: addChaptersVolume.title, summary: addChaptersVolume.summary, index: volumeIndex >= 0 ? volumeIndex : 0 },
        allVolumes,
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

      const startOrder = outline.length
      const newNodes: OutlineNode[] = parsed.map((item, i) => ({
        id: generateId(),
        parentId: addChaptersVolume.id,
        title: item.title || `新章节 ${i + 1}`,
        summary: item.summary || '',
        order: startOrder + i,
        level: 'chapter',
        characterIds: [],
        storylineIds: resolveStorylineIds(item.storylineIds),
      }))

      const newOutline = [...outline, ...newNodes]
      await persistOutline(newOutline)
      setAIStream(false, text)
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
            {!outline.some((n) => n.level === 'chapter') && (
              <Button icon={<ExperimentOutlined />} onClick={openGenModal} loading={loading}>
                AI 随机生成
              </Button>
            )}
            {outline.length > 0 && (
              <Popconfirm title="确定清空所有大纲？" onConfirm={handleClear} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
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
                        <Popconfirm title="确定删除？章节也会被删除" onConfirm={() => removeNode(vol.id)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ) : undefined
                  }
                >
                  {vol.summary && (
                    <Paragraph type="secondary" style={{ marginBottom: 16 }}>{vol.summary}</Paragraph>
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
                                <Popconfirm title="确定删除？" onConfirm={() => removeNode(ch.id)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                            ) : undefined
                          }
                        >
                          <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                            {ch.summary || '暂无剧情简述'}
                          </Paragraph>
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
        mask={{ closable: false }}
        onOk={handleGenerate}
        onCancel={() => setGenModalOpen(false)}
        okText="开始生成"
        cancelText="取消"
      >
        <Form form={genForm} layout="vertical" initialValues={{ volumes: 3, chaptersPerVolume: 5 }}>
          <Form.Item name="volumes" label="卷数">
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="chaptersPerVolume" label="每卷章数">
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title={isNew ? (editing?.level === 'volume' ? '新增卷' : '新增章节') : '编辑'}
        open={editModalOpen}
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
                  const selected = (form.getFieldValue('storylineIds') || []).includes(sl.id)
                  return (
                    <Tooltip key={sl.id} title={sl.description || '暂无描述'} placement="top">
                      <Tag
                        color={selected ? sl.color : undefined}
                        style={{ cursor: 'pointer', margin: 0 }}
                        onClick={() => {
                          const current: string[] = form.getFieldValue('storylineIds') || []
                          form.setFieldsValue({
                            storylineIds: selected
                              ? current.filter((id) => id !== sl.id)
                              : [...current, sl.id],
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
        mask={{ closable: false }}
        onOk={handleSaveSl}
        onCancel={() => { setSlModalOpen(false); setEditingSl(null) }}
        okText="保存"
        cancelText="取消"
        footer={editingSl ? (_, { OkBtn, CancelBtn }) => (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Popconfirm title="确定删除此线索？" onConfirm={() => { handleDeleteSl(editingSl.id); setSlModalOpen(false) }} okText="确认" cancelText="取消">
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
    </div>
  )
}
