import { useRef, useEffect, useCallback } from 'react'

interface RichEditorProps {
  content?: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
  height?: string | number
}

export default function RichEditor({
  content = '',
  onChange,
  placeholder,
  editable = true,
  height = '100%',
}: RichEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const ignoreChange = useRef(false)

  // 外部内容变更时同步
  useEffect(() => {
    const el = ref.current
    if (!el || el.value === content) return
    el.value = content
    el.scrollTop = el.scrollHeight
  }, [content])

  const handleChange = useCallback(() => {
    if (ignoreChange.current) {
      ignoreChange.current = false
      return
    }
    onChange?.(ref.current?.value ?? '')
  }, [onChange])

  const isFlex = height === '100%'

  return (
    <textarea
      ref={ref}
      defaultValue=""
      onChange={handleChange}
      readOnly={!editable}
      placeholder={placeholder}
      style={{
        width: '100%',
        height: isFlex ? undefined : (typeof height === 'number' ? `${height}px` : height),
        minHeight: isFlex ? 0 : 400,
        padding: 12,
        border: 'none',
        outline: 'none',
        resize: 'none',
        fontFamily: 'inherit',
        fontSize: 14,
        lineHeight: 1.8,
        whiteSpace: 'pre-wrap',
        background: 'transparent',
        boxSizing: 'border-box',
        overflow: 'auto',
        flex: isFlex ? 1 : undefined,
      }}
    />
  )
}
