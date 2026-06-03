import { useEffect, useRef } from 'react'
import { Typography, Input, Button, Space, Empty, Spin } from 'antd'
import { SendOutlined, LoadingOutlined } from '@ant-design/icons'
import { useStore } from '@/core/store'

const { Title, Paragraph } = Typography
const { TextArea } = Input

export default function AIPanel() {
  const aiPanelOpen = useStore((s) => s.aiPanelOpen)
  const aiStreaming = useStore((s) => s.aiStreaming)
  const aiStreamText = useStore((s) => s.aiStreamText)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 流式输出时自动滚到底部
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [aiStreamText])

  if (!aiPanelOpen) return null

  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        background: '#fafafa',
        borderLeft: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        <Title level={5} style={{ margin: 0 }}>
          AI 助手
        </Title>
      </div>

      <div
        ref={bodyRef}
        style={{
          flex: 1,
          padding: 16,
          overflowY: 'scroll',
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

      <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
        <Space.Compact style={{ width: '100%' }}>
          <TextArea
            placeholder="描述你想要 AI 做什么..."
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ resize: 'none' }}
          />
          <Button type="primary" icon={<SendOutlined />} />
        </Space.Compact>
      </div>
    </div>
  )
}
