import type { AudiobookSegment, Chapter } from '@/core/types'
import { voiceboxClient } from './voiceboxClient'

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'chapter-audio'
}

export function completedAudioSegments(segments: AudiobookSegment[]) {
  return segments.filter((segment) => segment.status === 'completed' && segment.generationId)
}

export function downloadChapterAudioManifest(chapter: Chapter, segments: AudiobookSegment[]) {
  const completed = completedAudioSegments(segments)
  const manifest = {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    generatedAt: new Date().toISOString(),
    format: 'story-matrix-voicebox-chapter-manifest-v1',
    segments: completed.map((segment) => ({
      order: segment.order,
      speakerName: segment.speakerName,
      text: segment.text,
      audioUrl: voiceboxClient.audioUrl(segment.generationId || ''),
      generationId: segment.generationId,
    })),
  }
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sanitizeFilename(chapter.title)}-audiobook-manifest.json`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
