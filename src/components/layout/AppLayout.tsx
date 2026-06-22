import { useEffect, useState } from 'react'
import { Layout, Space, Button, Typography, Tag, Modal, Input, Spin, message } from 'antd'
import { RobotOutlined, EditOutlined } from '@ant-design/icons'
import { Outlet, useLocation } from 'react-router'
import Sidebar from './Sidebar'
import AIPanel from './AIPanel'
import TopBar from './TopBar'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generate } from '@/ai/client'
import { seedContext, worldContext, charactersContext, constraintsContext } from '@/ai/context'

const { Content } = Layout
const { Title } = Typography

// 不需要 AI 面板的页面
const NO_AI_PANEL_PATHS = ['/works', '/admin', '/preview']
// 不需要页面头部的页面
const NO_HEADER_PATHS = ['/works', '/admin', '/login', '/preview']

export default function AppLayout() {
  const aiPanelOpen = useStore((s) => s.aiPanelOpen)
  const toggleAIPanel = useStore((s) => s.toggleAIPanel)
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed)
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const readOnly = useStore((s) => s.readOnly)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const location = useLocation()

  const [titleModalOpen, setTitleModalOpen] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [aiTitles, setAiTitles] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)

  const showAIPanel = aiPanelOpen && !NO_AI_PANEL_PATHS.includes(location.pathname)
  const showHeader = currentWork && !NO_HEADER_PATHS.includes(location.pathname)
  const isChaptersPage = location.pathname === '/chapters'

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)')
    const syncSidebar = () => setSidebarCollapsed(media.matches)
    syncSidebar()
    media.addEventListener('change', syncSidebar)
    return () => media.removeEventListener('change', syncSidebar)
  }, [setSidebarCollapsed])

  const openTitleModal = () => {
    setTitleInput(currentWork?.title || '')
    setAiTitles([])
    setTitleModalOpen(true)
  }

  const handleSaveTitle = async () => {
    if (!currentWork || !titleInput.trim()) return
    const newTitle = titleInput.trim()
    await db.works.update(currentWork.id, { title: newTitle })
    setCurrentWork({ ...currentWork, title: newTitle })
    setTitleModalOpen(false)
    message.success('标题已更新')
  }

  const handleAITitles = async () => {
    if (!currentWork) return
    if (!aiConfig?.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    setAiLoading(true)
    try {
      const context = [
        `故事种子：${seedContext(currentWork)}`,
        `世界观：${worldContext(currentWork)}`,
        `主要人物：${charactersContext(currentWork.characters)}`,
        currentWork.constraints.length > 0 ? `核心约束：${constraintsContext(currentWork.constraints)}` : '',
      ].filter(Boolean).join('\n\n')

      const prompt = `根据以下故事信息，为这部小说推荐 10 个标题。

${context}

要求：
- 标题要吸引读者，体现故事核心
- 风格多样，涵盖不同方向（悬念型、意境型、人物型、冲突型等）
- 每个标题不超过 10 个字
- 严格输出 JSON 字符串数组，如：["标题一", "标题二", ...]
- 只输出 JSON，不要输出其他内容`

      const text = await generate(prompt, '你是一位资深的小说编辑，擅长为作品起标题。', aiConfig)
      // 解析 AI 返回的 JSON（兼容 markdown 代码块）
      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1]
      }
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const titles = JSON.parse(jsonMatch[0]) as string[]
        setAiTitles(titles.filter((t) => typeof t === 'string'))
      } else {
        console.error('AI 返回内容：', text)
        message.error('AI 返回格式异常')
      }
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <Layout style={{ height: '100dvh', minHeight: '100vh', overflow: 'hidden' }}>
      <TopBar />
      <Layout style={{ flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <Content style={{
          padding: 24,
          overflow: isChaptersPage ? 'hidden' : 'auto',
          WebkitOverflowScrolling: 'touch',
          display: isChaptersPage ? 'flex' : 'block',
          flexDirection: isChaptersPage ? 'column' : undefined,
        }}>
          {showHeader && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Space>
                <Title level={4} style={{ margin: 0 }}>
                  {currentWork.title}
                  {!readOnly && (
                    <EditOutlined
                      style={{ fontSize: 14, marginLeft: 8, cursor: 'pointer', color: '#999' }}
                      onClick={openTitleModal}
                    />
                  )}
                </Title>
                {readOnly && <Tag color="orange">只读</Tag>}
              </Space>
              <Button
                type={aiPanelOpen ? 'primary' : 'default'}
                icon={<RobotOutlined />}
                onClick={toggleAIPanel}
              >
                AI
              </Button>
            </div>
          )}
          <Outlet />
        </Content>
      </Layout>
      {showAIPanel && <AIPanel />}

      <Modal
        mask={{ closable: false }}
                title="编辑标题"
        open={titleModalOpen}
                onCancel={() => setTitleModalOpen(false)}
        onOk={handleSaveTitle}
        okText="保存"
        cancelText="取消"
        width={500}
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="输入标题"
            onPressEnter={handleSaveTitle}
          />
          <div>
            <Button
              icon={<RobotOutlined />}
              onClick={handleAITitles}
              loading={aiLoading}
              size="small"
            >
              AI 推荐标题
            </Button>
          </div>
          {aiTitles.length > 0 && (
            <div style={{ border: '1px solid #d9d9d9', borderRadius: 6 }}>
              {aiTitles.map((title, i) => (
                <div
                  key={i}
                  style={{ cursor: 'pointer', padding: '8px 12px', borderBottom: i < aiTitles.length - 1 ? '1px solid #f0f0f0' : undefined }}
                  onClick={() => setTitleInput(title)}
                >
                  {title}
                </div>
              ))}
            </div>
          )}
          {aiLoading && <Spin size="small" />}
        </Space>
      </Modal>
    </Layout>
  )
}
