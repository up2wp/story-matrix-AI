import { useState, useCallback, useMemo, useRef } from 'react'
import { useStore } from '@/core/store'
import { db } from '@/core/db'
import { message } from 'antd'
import { buildPreviewData } from '@/features/preview/exportUtils'

/** 单个匹配位置 */
export interface MatchPos {
  outlineId: string
  type: 'title' | 'content'
  index: number   // 标题/正文中的字符位置
}

export function useProofread() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)

  const previewData = useMemo(
    () => (currentWork ? buildPreviewData(currentWork) : []),
    [currentWork],
  )

  // 查找替换状态
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [matches, setMatches] = useState<MatchPos[]>([])
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [totalCount, setTotalCount] = useState(0)

  // 防抖保存计时器
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // 滚动到章节
  const scrollToChapter = useCallback((outlineId: string) => {
    document.getElementById(`pr-ch-${outlineId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // 保存章节内容（防抖 500ms）
  const saveContent = useCallback(
    (outlineId: string, content: string) => {
      const key = `content-${outlineId}`
      const existing = saveTimers.current.get(key)
      if (existing) clearTimeout(existing)

      saveTimers.current.set(
        key,
        setTimeout(async () => {
          saveTimers.current.delete(key)
          const work = useStore.getState().currentWork
          if (!work) return

          const latest = await db.works.get(work.id)
          if (latest && latest.updatedAt > work.updatedAt) {
            message.warning('检测到其他页面已修改，请刷新后再操作')
            return
          }

          const chapters = [...(work.chapters ?? [])]
          const idx = chapters.findIndex((c) => c.outlineId === outlineId)
          if (idx === -1) return

          const wordCount = content.replace(/\s/g, '').length
          chapters[idx] = { ...chapters[idx], content, wordCount }

          const now = Date.now()
          await db.works.update(work.id, { chapters, updatedAt: now })
          setCurrentWork({ ...work, chapters, updatedAt: now })
        }, 500),
      )
    },
    [setCurrentWork],
  )

  // 保存章节标题
  const saveTitle = useCallback(
    async (outlineId: string, title: string) => {
      const work = useStore.getState().currentWork
      if (!work || !title.trim()) return

      const latest = await db.works.get(work.id)
      if (latest && latest.updatedAt > work.updatedAt) {
        message.warning('检测到其他页面已修改，请刷新后再操作')
        return
      }

      const outline = work.outline.map((n) =>
        n.id === outlineId ? { ...n, title: title.trim() } : n,
      )
      const chapters = (work.chapters ?? []).map((c) =>
        c.outlineId === outlineId ? { ...c, title: title.trim() } : c,
      )

      const now = Date.now()
      await db.works.update(work.id, { outline, chapters, updatedAt: now })
      setCurrentWork({ ...work, outline, chapters, updatedAt: now })
      message.success('标题已更新')
    },
    [setCurrentWork],
  )

  // 收集所有匹配位置（直接从 store 读取，避免闭包陈旧）
  const collectMatches = useCallback((searchText?: string): MatchPos[] => {
    const s = searchText ?? findText
    if (!s) return []
    const work = useStore.getState().currentWork
    if (!work) return []
    const data = buildPreviewData(work)
    const searchStr = s.toLowerCase()
    const result: MatchPos[] = []

    for (const vol of data) {
      for (const { outline, chapter } of vol.chapters) {
        // 搜索标题
        const titleLower = outline.title.toLowerCase()
        let ti = titleLower.indexOf(searchStr)
        while (ti !== -1) {
          result.push({ outlineId: outline.id, type: 'title', index: ti })
          ti = titleLower.indexOf(searchStr, ti + 1)
        }

        // 搜索正文
        if (chapter?.content) {
          const contentLower = chapter.content.toLowerCase()
          let ci = contentLower.indexOf(searchStr)
          while (ci !== -1) {
            result.push({ outlineId: outline.id, type: 'content', index: ci })
            ci = contentLower.indexOf(searchStr, ci + 1)
          }
        }
      }
    }

    return result
  }, [findText])

  // 选中 textarea 中的匹配文本
  const selectMatchInTextarea = useCallback((outlineId: string, type: 'title' | 'content', index: number) => {
    if (type === 'content') {
      const el = document.querySelector(`#pr-ch-${outlineId} textarea`) as HTMLTextAreaElement | null
      if (el) {
        el.focus()
        el.setSelectionRange(index, index + findText.length)
        // 将 textarea 自身滚动到外层容器可见区域
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } else if (type === 'title') {
      const el = document.querySelector(`#pr-ch-${outlineId} input`) as HTMLInputElement | null
      if (el) {
        el.focus()
        el.setSelectionRange(index, index + findText.length)
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [findText])

  // 跳转到指定匹配
  const goToMatch = useCallback((idx: number, all: MatchPos[]) => {
    if (idx < 0 || idx >= all.length) return
    const m = all[idx]
    setCurrentIdx(idx)
    // 延迟选中（给 React 渲染时间，然后 scrollIntoView 由 selectMatchInTextarea 处理）
    setTimeout(() => selectMatchInTextarea(m.outlineId, m.type, m.index), 150)
  }, [selectMatchInTextarea])

  // 执行查找
  const handleFind = useCallback(() => {
    if (!findText) return
    const all = collectMatches()
    setMatches(all)
    setTotalCount(all.length)
    if (all.length > 0) {
      goToMatch(0, all)
    } else {
      setCurrentIdx(-1)
      message.info('未找到匹配内容')
    }
  }, [findText, collectMatches, goToMatch])

  // 查找下一个
  const findNext = useCallback(() => {
    const all = collectMatches()
    if (all.length === 0) {
      message.info('未找到匹配内容')
      return
    }
    setMatches(all)
    setTotalCount(all.length)
    // 尝试从当前位置之后继续
    const next = currentIdx >= 0 && currentIdx + 1 < all.length ? currentIdx + 1 : 0
    goToMatch(next, all)
  }, [currentIdx, collectMatches, goToMatch])

  // 查找上一个
  const findPrev = useCallback(() => {
    const all = collectMatches()
    if (all.length === 0) {
      message.info('未找到匹配内容')
      return
    }
    setMatches(all)
    setTotalCount(all.length)
    const prev = currentIdx > 0 ? currentIdx - 1 : all.length - 1
    goToMatch(prev, all)
  }, [currentIdx, collectMatches, goToMatch])

  // 替换当前选中的匹配
  const replaceCurrent = useCallback(async () => {
    if (currentIdx < 0 || currentIdx >= matches.length || !findText) return

    const work = useStore.getState().currentWork
    if (!work) return

    const latest = await db.works.get(work.id)
    if (latest && latest.updatedAt > work.updatedAt) {
      message.warning('检测到其他页面已修改，请刷新后再操作')
      return
    }

    const m = matches[currentIdx]
    let chapters = [...(work.chapters ?? [])]
    let outline = [...work.outline]

    if (m.type === 'title') {
      const node = outline.find((n) => n.id === m.outlineId)
      if (node) {
        const newTitle = node.title.slice(0, m.index) + replaceText + node.title.slice(m.index + findText.length)
        outline = outline.map((n) => (n.id === m.outlineId ? { ...n, title: newTitle } : n))
        chapters = chapters.map((c) => (c.outlineId === m.outlineId ? { ...c, title: newTitle } : c))
      }
    } else {
      const ch = chapters.find((c) => c.outlineId === m.outlineId)
      if (ch) {
        const newContent = ch.content.slice(0, m.index) + replaceText + ch.content.slice(m.index + findText.length)
        const wordCount = newContent.replace(/\s/g, '').length
        chapters = chapters.map((c) =>
          c.outlineId === m.outlineId ? { ...c, content: newContent, wordCount } : c,
        )
      }
    }

    const now = Date.now()
    await db.works.update(work.id, { chapters, outline, updatedAt: now })
    setCurrentWork({ ...work, chapters, outline, updatedAt: now })

    // 重新收集匹配并跳到下一个
    setTimeout(() => {
      const all = collectMatches()
      setMatches(all)
      setTotalCount(all.length)
      if (all.length > 0) {
        // 保持 currentIdx 位置（原匹配已被替换，对应位置变为下一个或前一个）
        const nextIdx = Math.min(currentIdx, all.length - 1)
        goToMatch(nextIdx, all)
      } else {
        setCurrentIdx(-1)
      }
    }, 100)
  }, [currentIdx, matches, findText, replaceText, setCurrentWork, collectMatches, goToMatch])

  // 全部替换
  const replaceAll = useCallback(async () => {
    const all = collectMatches()
    if (all.length === 0 || !findText) {
      message.info('未找到匹配内容')
      return
    }

    const work = useStore.getState().currentWork
    if (!work) return

    const latest = await db.works.get(work.id)
    if (latest && latest.updatedAt > work.updatedAt) {
      message.warning('检测到其他页面已修改，请刷新后再操作')
      return
    }

    // 从后往前排序，避免替换后索引偏移
    const sorted = [...all].sort((a, b) => {
      if (a.outlineId !== b.outlineId) return a.outlineId.localeCompare(b.outlineId)
      if (a.type !== b.type) return a.type === 'content' ? -1 : 1
      return b.index - a.index // 从后往前
    })

    let chapters = [...(work.chapters ?? [])]
    let outline = [...work.outline]

    for (const m of sorted) {
      if (m.type === 'title') {
        const node = outline.find((n) => n.id === m.outlineId)
        if (!node) continue
        const newTitle = node.title.slice(0, m.index) + replaceText + node.title.slice(m.index + findText.length)
        outline = outline.map((n) => (n.id === m.outlineId ? { ...n, title: newTitle } : n))
        chapters = chapters.map((c) => (c.outlineId === m.outlineId ? { ...c, title: newTitle } : c))
      } else {
        const ch = chapters.find((c) => c.outlineId === m.outlineId)
        if (!ch) continue
        const newContent = ch.content.slice(0, m.index) + replaceText + ch.content.slice(m.index + findText.length)
        const wordCount = newContent.replace(/\s/g, '').length
        chapters = chapters.map((c) =>
          c.outlineId === m.outlineId ? { ...c, content: newContent, wordCount } : c,
        )
      }
    }

    const now = Date.now()
    await db.works.update(work.id, { chapters, outline, updatedAt: now })
    setCurrentWork({ ...work, chapters, outline, updatedAt: now })
    message.success(`已替换 ${all.length} 处`)
    setMatches([])
    setCurrentIdx(-1)
    setTotalCount(0)
  }, [matches, findText, replaceText, setCurrentWork, collectMatches])

  return {
    currentWork,
    previewData,
    findText,
    setFindText,
    replaceText,
    setReplaceText,
    findOpen,
    setFindOpen,
    matches,
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
  }
}
