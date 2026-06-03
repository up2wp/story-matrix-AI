import { useRef, useEffect, useCallback } from 'react'

interface RichEditorProps {
  content?: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
}

export default function RichEditor({
  content = '',
  onChange,
  placeholder,
  editable = true,
}: RichEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const ignoreChange = useRef(false)

  // 外部内容变更时同步
  useEffect(() => {
    if (ref.current && ref.current.value !== content) {
      ignoreChange.current = true
      ref.current.value = content
      // 自动滚动到底部（流式输出时）
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [content])

  const handleChange = useCallback(() => {
    if (ignoreChange.current) {
      ignoreChange.current = false
      return
    }
    onChange?.(ref.current?.value ?? '')
  }, [onChange])

  return (
    <textarea
      ref={ref}
      defaultValue={content}
      onChange={handleChange}
      readOnly={!editable}
      placeholder={placeholder}
      style={{
        width: '100%',
        minHeight: 400,
        padding: 12,
        border: 'none',
        outline: 'none',
        resize: 'vertical',
        fontFamily: 'inherit',
        fontSize: 14,
        lineHeight: 1.8,
        whiteSpace: 'pre-wrap',
        background: 'transparent',
      }}
    />
  )
}
