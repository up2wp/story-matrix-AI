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
  const composing = useRef(false)

  // 外部内容变更时同步（IME 组合期间跳过，避免打断输入）
  useEffect(() => {
    if (composing.current) return
    const el = ref.current
    if (!el) return
    if (document.activeElement === el && el.value === content) return
    if (el.value === content) return
    el.value = content
    el.scrollTop = el.scrollHeight
  }, [content])

  const handleChange = useCallback(() => {
    if (composing.current) return
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
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => {
        composing.current = false
        onChange?.(ref.current?.value ?? '')
      }}
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
