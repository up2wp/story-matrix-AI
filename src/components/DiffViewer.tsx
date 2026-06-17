import { useMemo, useRef, useEffect } from 'react'
import { diffLines } from 'diff'

interface DiffViewerProps {
  oldText: string
  newText: string
}

export default function DiffViewer({ oldText, newText }: DiffViewerProps) {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText])

  // 同步滚动
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return
    const sync = (source: HTMLDivElement, target: HTMLDivElement) => {
      target.scrollTop = source.scrollTop
      target.scrollLeft = source.scrollLeft
    }
    const onLeft = () => sync(left, right)
    const onRight = () => sync(right, left)
    left.addEventListener('scroll', onLeft)
    right.addEventListener('scroll', onRight)
    return () => {
      left.removeEventListener('scroll', onLeft)
      right.removeEventListener('scroll', onRight)
    }
  }, [])

  // 分离为左（旧）右（新）
  const leftLines: { text: string; type: 'same' | 'removed' }[] = []
  const rightLines: { text: string; type: 'same' | 'added' }[] = []

  for (const part of parts) {
    const lines = part.value.split('\n')
    // 去掉 split 产生的末尾空串
    if (lines[lines.length - 1] === '') lines.pop()

    if (!part.added && !part.removed) {
      for (const line of lines) {
        leftLines.push({ text: line, type: 'same' })
        rightLines.push({ text: line, type: 'same' })
      }
    } else if (part.removed) {
      for (const line of lines) {
        leftLines.push({ text: line, type: 'removed' })
        rightLines.push({ text: '', type: 'same' }) // 占位
      }
    } else if (part.added) {
      for (const line of lines) {
        leftLines.push({ text: '', type: 'same' }) // 占位
        rightLines.push({ text: line, type: 'added' })
      }
    }
  }

  const renderLines = (lines: { text: string; type: string }[]) =>
    lines.map((line, i) => (
      <div
        key={i}
        style={{
          minHeight: 22,
          lineHeight: '22px',
          padding: '0 12px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          background: line.type === 'removed' ? '#fff1f0' : line.type === 'added' ? '#f6ffed' : undefined,
          borderLeft: line.type === 'removed' ? '3px solid #ff4d4f' : line.type === 'added' ? '3px solid #52c41a' : '3px solid transparent',
          fontFamily: 'monospace',
          fontSize: 13,
        }}
      >
        {line.text || ' '}
      </div>
    ))

  return (
    <div style={{ display: 'flex', gap: 2, border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
      <div ref={leftRef} style={{ flex: 1, overflow: 'auto', maxHeight: 400, background: '#fafafa' }}>
        <div style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 12, color: '#999' }}>
          原文
        </div>
        {renderLines(leftLines)}
      </div>
      <div style={{ width: 1, background: '#d9d9d9' }} />
      <div ref={rightRef} style={{ flex: 1, overflow: 'auto', maxHeight: 400, background: '#fafafa' }}>
        <div style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 12, color: '#999' }}>
          建议修改
        </div>
        {renderLines(rightLines)}
      </div>
    </div>
  )
}
