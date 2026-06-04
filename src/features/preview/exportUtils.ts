import type { Work, Character, Setting, OutlineNode } from '@/core/types'

export interface ExportOptions {
  includeMetadata: boolean
  includeEmptyChapters: boolean
}

interface PreviewVolume {
  volume: OutlineNode
  chapters: { outline: OutlineNode; chapter: { content: string; title: string } | null }[]
}

/** 组装预览数据结构 */
export function buildPreviewData(work: Work): PreviewVolume[] {
  const { outline, chapters } = work
  const volumes = outline
    .filter((n) => n.level === 'volume')
    .sort((a, b) => a.order - b.order)

  return volumes.map((vol) => {
    const chapterNodes = outline
      .filter((n) => n.parentId === vol.id)
      .sort((a, b) => a.order - b.order)

    return {
      volume: vol,
      chapters: chapterNodes.map((node) => {
        const ch = chapters.find((c) => c.outlineId === node.id)
        return {
          outline: node,
          chapter: ch ? { content: ch.content, title: ch.title } : null,
        }
      }),
    }
  })
}

/** 文件名安全化 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名'
}

/** 角色资料文本 */
function characterBlock(c: Character): string {
  const lines = [`### ${c.name}`, '', c.bio]
  if (c.personality.traits.length) lines.push('', `**性格特质：**${c.personality.traits.join('、')}`)
  if (c.personality.habits.length) lines.push('', `**行为习惯：**${c.personality.habits.join('；')}`)
  if (c.personality.arc.length) {
    lines.push('', '**性格弧线：**')
    for (const a of c.personality.arc) {
      lines.push(`- **${a.stage}**：${a.description}${a.trigger ? `（触发：${a.trigger}）` : ''}`)
    }
  }
  if (c.tags.length) lines.push('', `**标签：**${c.tags.join('、')}`)
  return lines.join('\n')
}

/** 设定资料文本 */
function settingBlock(s: Setting): string {
  return `### ${s.title}\n\n${s.content}`
}

/** 生成设定总览 Markdown */
function metadataMarkdown(work: Work): string {
  const { seed, characters, settings } = work
  const lines: string[] = ['---', '', '# 设定总览', '']

  // 故事种子
  lines.push('## 故事基础', '')
  lines.push(`- **类型：**${seed.genre}${seed.subGenre ? `·${seed.subGenre}` : ''}`)
  lines.push(`- **时间背景：**${seed.timePeriod}`)
  lines.push(`- **地域范围：**${seed.regions.join('、')}`)
  lines.push(`- **基调：**${seed.tone}`)
  lines.push(`- **核心概念：**${seed.coreConcept}`)
  if (seed.targetAudience) lines.push(`- **目标读者：**${seed.targetAudience}`)
  lines.push('')

  // 主要人物
  const majorChars = characters.filter((c) => c.role === 'major')
  if (majorChars.length) {
    lines.push('## 主要人物', '')
    for (const c of majorChars) lines.push(characterBlock(c), '')
  }

  // 世界观设定
  if (settings.length) {
    lines.push('## 世界观设定', '')
    for (const s of settings) lines.push(settingBlock(s), '')
  }

  lines.push('---', '')
  return lines.join('\n')
}

/** 组装完整 Markdown */
export function buildMarkdown(work: Work, options: ExportOptions): string {
  const data = buildPreviewData(work)
  const parts: string[] = []

  // 标题
  parts.push(`# ${work.title}`, '')

  // 可选设定资料
  if (options.includeMetadata) {
    parts.push(metadataMarkdown(work))
  }

  // 正文
  for (const vol of data) {
    parts.push(`# ${vol.volume.title}`, '')
    if (vol.volume.summary) parts.push(`> ${vol.volume.summary}`, '')

    for (const { outline, chapter } of vol.chapters) {
      if (!chapter?.content && !options.includeEmptyChapters) continue
      parts.push(`## ${outline.title}`, '')
      if (chapter?.content) {
        parts.push(chapter.content)
      } else {
        parts.push('（本章暂无正文）')
      }
      parts.push('')
    }
  }

  return parts.join('\n')
}

/** 去除 Markdown 格式，转纯文本 */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')    // 标题标记
    .replace(/\*\*(.*?)\*\*/g, '$1') // 粗体
    .replace(/\*(.*?)\*/g, '$1')     // 斜体
    .replace(/^>\s+/gm, '')          // 引用
    .replace(/^[-*]\s+/gm, '· ')    // 列表
    .replace(/!\[.*?\]\(.*?\)/g, '') // 图片
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // 链接
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // 代码
    .replace(/---+/g, '────────')    // 分隔线
}

/** 组装纯 TXT */
export function buildTxt(work: Work, options: ExportOptions): string {
  const data = buildPreviewData(work)
  const parts: string[] = []

  parts.push(work.title, '═'.repeat(work.title.length * 2), '')

  if (options.includeMetadata) {
    parts.push(stripMarkdown(metadataMarkdown(work)))
  }

  for (const vol of data) {
    parts.push(`【${vol.volume.title}】`, '')
    if (vol.volume.summary) parts.push(vol.volume.summary, '')

    for (const { outline, chapter } of vol.chapters) {
      if (!chapter?.content && !options.includeEmptyChapters) continue
      parts.push(`  ${outline.title}`, '')
      if (chapter?.content) {
        parts.push(stripMarkdown(chapter.content))
      } else {
        parts.push('（本章暂无正文）')
      }
      parts.push('')
    }
  }

  return parts.join('\n')
}

/** 触发浏览器下载 */
export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = sanitizeFilename(filename)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
