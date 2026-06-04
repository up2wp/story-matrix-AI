import { useState, useMemo, useCallback } from 'react'
import { message } from 'antd'
import { useStore } from '@/core/store'
import { buildPreviewData, buildMarkdown, buildTxt, downloadBlob } from './exportUtils'

export function usePreview() {
  const currentWork = useStore((s) => s.currentWork)
  const [includeMetadata, setIncludeMetadata] = useState(false)
  const [includeEmptyChapters, setIncludeEmptyChapters] = useState(true)

  const previewData = useMemo(() => {
    if (!currentWork) return []
    return buildPreviewData(currentWork)
  }, [currentWork])

  const totalWordCount = useMemo(() => {
    if (!currentWork) return 0
    return currentWork.chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
  }, [currentWork])

  const chapterCount = useMemo(() => {
    if (!currentWork) return 0
    return currentWork.chapters.filter((ch) => ch.content).length
  }, [currentWork])

  const totalChapterCount = useMemo(() => {
    if (!currentWork) return 0
    return currentWork.outline.filter((n) => n.level === 'chapter').length
  }, [currentWork])

  const scrollToChapter = useCallback((outlineId: string) => {
    const el = document.getElementById(`ch-${outlineId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const scrollToVolume = useCallback((volumeId: string) => {
    const el = document.getElementById(`vol-${volumeId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleExportMarkdown = useCallback(() => {
    if (!currentWork) return
    const content = buildMarkdown(currentWork, { includeMetadata, includeEmptyChapters })
    const filename = `${currentWork.title}.md`
    downloadBlob(content, filename, 'text/markdown;charset=utf-8')
    message.success('Markdown 已导出')
  }, [currentWork, includeMetadata, includeEmptyChapters])

  const handleExportTxt = useCallback(() => {
    if (!currentWork) return
    const content = buildTxt(currentWork, { includeMetadata, includeEmptyChapters })
    const filename = `${currentWork.title}.txt`
    downloadBlob(content, filename, 'text/plain;charset=utf-8')
    message.success('TXT 已导出')
  }, [currentWork, includeMetadata, includeEmptyChapters])

  return {
    currentWork,
    previewData,
    includeMetadata,
    setIncludeMetadata,
    includeEmptyChapters,
    setIncludeEmptyChapters,
    totalWordCount,
    chapterCount,
    totalChapterCount,
    scrollToChapter,
    scrollToVolume,
    handleExportMarkdown,
    handleExportTxt,
  }
}
