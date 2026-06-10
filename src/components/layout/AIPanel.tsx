import { useEffect, useRef, useCallback } from 'react'
import { Typography, Button, Empty, Spin } from 'antd'
import { LoadingOutlined, CloseOutlined } from '@ant-design/icons'
import { useStore } from '@/core/store'

const { Paragraph } = Typography

export default function AIPanel() {
  const aiPanelOpen = useStore((s) => s.aiPanelOpen)
  const toggleAIPanel = useStore((s) => s.toggleAIPanel)
  const aiStreaming = useStore((s) => s.aiStreaming)
  const aiStreamText = useStore((s) => s.aiStreamText)
  const bodyRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 流式输出时自动滚到底部
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [aiStreamText])

  // 点击外部关闭
  const handleOutsideClick = useCallback(
    (e: MouseEvent) => {
      if (!aiPanelOpen) return
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        toggleAIPanel()
      }
    },
    [aiPanelOpen, toggleAIPanel],
  )

  useEffect(() => {
    if (aiPanelOpen) {
      // 延迟注册，避免当前点击事件立即触发关闭
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleOutsideClick)
      }, 100)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleOutsideClick)
      }
    }
  }, [aiPanelOpen, handleOutsideClick])

  if (!aiPanelOpen) return null

  return (
    <>
      {/* 半透明遮罩 */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
        }}
      />
      {/* 悬浮面板 */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          zIndex: 1000,
          background: '#fff',
          boxShadow: '-2px 0 12px rgba(0,0,0,0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 标题栏 */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>AI 助手</span>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={toggleAIPanel} />
        </div>

        {/* 内容区 */}
        <div
          ref={bodyRef}
          style={{
            flex: 1,
            padding: 16,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
          }}
        >
          {aiStreaming && (
            <div style={{ marginBottom: 8 }}>
              <Spin indicator={<LoadingOutlined spin />} size="small" />
              <span style={{ marginLeft: 8, fontSize: 12, color: '#999' }}>生成中...</span>
            </div>
          )}
          {aiStreamText ? (
            <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13, lineHeight: 1.8 }}>
              {aiStreamText}
            </Paragraph>
          ) : !aiStreaming ? (
            <Empty description="选择操作让 AI 帮你创作" />
          ) : null}
        </div>
      </div>
    </>
  )
}
