import type { AudiobookSegment, Chapter } from '@/core/types'

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'chapter-audio'
}

export function completedAudioSegments(segments: AudiobookSegment[]) {
  return segments.filter((segment) => segment.status === 'completed' && segment.generationId)
}

export function downloadBlobUrl(url: string, chapter: Pick<Chapter, 'title'>) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sanitizeFilename(chapter.title)}-audiobook.wav`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
