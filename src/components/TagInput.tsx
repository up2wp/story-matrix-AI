import { useState, useRef } from 'react'
import { Tag, Input } from 'antd'

interface TagInputProps {
  value?: string[]
  onChange?: (value: string[]) => void
  placeholder?: string
  color?: string
  tokenSeparators?: string[]
}

/**
 * 可编辑的标签输入框。
 * 点击标签 × 删除后，文本回填到输入框，方便修改后重新添加。
 */
export default function TagInput({ value = [], onChange, placeholder, color, tokenSeparators = ['、', ','] }: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<any>(null)

  const commit = (text: string) => {
    const parts = text.split(new RegExp(`[${tokenSeparators.map(s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('')}]`))
    const newTags = parts.map(s => s.trim()).filter(s => s && !value.includes(s))
    if (newTags.length) {
      onChange?.([...value, ...newTags])
    }
    setInputValue('')
  }

  const handleClose = (removed: string) => {
    onChange?.(value.filter(t => t !== removed))
    setInputValue(removed)
    // 等渲染完成后 focus input
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 6, minHeight: 32, alignItems: 'center', cursor: 'text' }}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map(tag => (
        <Tag key={tag} color={color} closable onClose={e => { e.preventDefault(); handleClose(tag) }}>
          {tag}
        </Tag>
      ))}
      <Input
        ref={inputRef}
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onBlur={() => { if (inputValue.trim()) commit(inputValue) }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(inputValue)
          }
          // 退格键删最后一个标签（输入框为空时）
          if (e.key === 'Backspace' && !inputValue && value.length) {
            handleClose(value[value.length - 1])
          }
        }}
        variant="borderless"
        placeholder={value.length ? '' : placeholder}
        style={{ flexBasis: '100%', minWidth: 0 }}
      />
    </div>
  )
}
