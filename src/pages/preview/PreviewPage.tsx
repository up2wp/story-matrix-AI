import { useState } from 'react'
import { Card, Typography, Space, Button, Checkbox, Empty, Divider } from 'antd'
import {
  DownloadOutlined,
  FileTextOutlined,
  BookOutlined,
  ExpandOutlined,
  CompressOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons'
import { Navigate } from 'react-router'
import { usePreview } from '@/features/preview/usePreview'
import AudiobookPanel from './AudiobookPanel'

const { Title, Text, Paragraph } = Typography

// 浅色/暗色主题配色
const THEMES = {
  light: {
    bg: '#fff',
    text: '#1a1a1a',
    secondary: '#666',
    title: '#000',
    border: '#f0f0f0',
    headerBg: '#fafafa',
  },
  dark: {
    bg: '#1a1a1a',
    text: '#c8c8c8',
    secondary: '#888',
    title: '#e0e0e0',
    border: '#333',
    headerBg: '#222',
  },
}

export default function PreviewPage() {
  const {
    currentWork,
    previewData,
    includeMetadata,
    setIncludeMetadata,
    includeEmptyChapters,
    setIncludeEmptyChapters,
    totalWordCount,
    chapterCount,
    totalChapterCount,
    scrollToChapter,
    scrollToVolume,
    handleExportMarkdown,
    handleExportTxt,
  } = usePreview()

  const [fullscreen, setFullscreen] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  if (!currentWork) return <Navigate to="/works" replace />

  const { seed, characters, settings } = currentWork
  const theme = darkMode ? THEMES.dark : THEMES.light

  // 正文内容渲染（复用）
  const renderContent = (colorStyle?: React.CSSProperties) => (
    <>
      {includeMetadata && (
        <div style={{ marginBottom: 32 }}>
          <Title level={3} style={colorStyle}>设定总览</Title>

          <Title level={5} style={colorStyle}>故事基础</Title>
          <Paragraph style={colorStyle}>
            类型：{seed.genre}{seed.subGenre ? `·${seed.subGenre}` : ''}<br />
            时间背景：{seed.timePeriod}<br />
            地域范围：{seed.regions.join('、')}<br />
            基调：{seed.tone}<br />
            核心概念：{seed.coreConcept}
            {seed.targetAudience && <><br />目标读者：{seed.targetAudience}</>}
          </Paragraph>

          {characters.filter((c) => c.role === 'major').length > 0 && (
            <>
              <Title level={5} style={colorStyle}>主要人物</Title>
              {characters.filter((c) => c.role === 'major').map((c) => (
                <div key={c.id} style={{ marginBottom: 12 }}>
                  <Text strong style={colorStyle}>{c.name}</Text>
                  <Paragraph style={{ marginBottom: 4, ...colorStyle }}>{c.bio}</Paragraph>
                  {c.personality.traits.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12, color: theme.secondary }}>
                      性格特质：{c.personality.traits.join('、')}
                    </Text>
                  )}
                </div>
              ))}
            </>
          )}

          {settings.length > 0 && (
            <>
              <Title level={5} style={colorStyle}>世界观设定</Title>
              {settings.map((s) => (
                <div key={s.id} style={{ marginBottom: 12 }}>
                  <Text strong style={colorStyle}>{s.title}</Text>
                  <Paragraph style={{ marginBottom: 0, ...colorStyle }}>{s.content}</Paragraph>
                </div>
              ))}
            </>
          )}

          <Divider style={{ borderColor: theme.border }} />
        </div>
      )}

      {previewData.length === 0 ? (
        <Empty description="暂无大纲，请先创建大纲" />
      ) : (
        previewData.map((vol) => (
          <div key={vol.volume.id} id={fullscreen ? `fs-vol-${vol.volume.id}` : `vol-${vol.volume.id}`} style={{ marginBottom: 40 }}>
            <Title level={2} style={{ marginBottom: 4, ...colorStyle }}>{vol.volume.title}</Title>
            {vol.volume.summary && (
              <Paragraph style={{ marginBottom: 24, color: theme.secondary }}>
                {vol.volume.summary}
              </Paragraph>
            )}

            {vol.chapters.map(({ outline, chapter }) => (
              <div key={outline.id} id={fullscreen ? `fs-ch-${outline.id}` : `ch-${outline.id}`} style={{ marginBottom: 32 }}>
                <Title level={3} style={{ marginBottom: 8, ...colorStyle }}>{outline.title}</Title>
                {chapter?.content ? (
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 2, fontSize: 17, ...colorStyle }}>
                    {chapter.content}
                  </div>
                ) : (
                  <Text type="secondary" italic style={{ color: theme.secondary }}>（本章暂无正文）</Text>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </>
  )

  // 全屏阅读模式
  if (fullscreen) {
    const colorStyle = { color: theme.text }
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: theme.bg, display: 'flex', flexDirection: 'column' }}>
        {/* 浮动工具栏 */}
        <div style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 2001,
          display: 'flex',
          gap: 8,
          background: theme.headerBg,
          borderRadius: 8,
          padding: '6px 10px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          opacity: 0.6,
          transition: 'opacity 0.2s',
        }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
        >
          <Button
            type="text"
            size="small"
            icon={darkMode ? <SunOutlined /> : <MoonOutlined />}
            onClick={() => setDarkMode(!darkMode)}
            style={{ color: theme.text }}
          />
          <Button
            type="text"
            size="small"
            icon={<CompressOutlined />}
            onClick={() => setFullscreen(false)}
            style={{ color: theme.text }}
          />
        </div>

        {/* 目录 + 正文 */}
        <div className="preview-fullscreen-layout" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 左侧迷你目录 */}
          <div className="preview-fullscreen-toc" style={{ width: 200, flexShrink: 0, overflow: 'auto', padding: '16px 12px', borderRight: `1px solid ${theme.border}` }}>
            <Text strong style={{ fontSize: 13, color: theme.title, display: 'block', marginBottom: 12 }}>
              {currentWork.title}
            </Text>
            {previewData.map((vol) => (
              <div key={vol.volume.id} style={{ marginBottom: 6 }}>
                <Text style={{ cursor: 'pointer', fontSize: 12, display: 'block', padding: '2px 0', color: theme.secondary }}
                  onClick={() => document.getElementById(`fs-vol-${vol.volume.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
                  {vol.volume.title}
                </Text>
                {vol.chapters.map(({ outline, chapter }) => (
                  <Text
                    key={outline.id}
                    style={{
                      cursor: 'pointer',
                      fontSize: 11,
                      display: 'block',
                      padding: '1px 0 1px 12px',
                      color: chapter?.content ? theme.text : theme.secondary,
                    }}
                    onClick={() => document.getElementById(`fs-ch-${outline.id}`)?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    {outline.title}
                  </Text>
                ))}
              </div>
            ))}
          </div>

          {/* 正文 */}
          <div className="preview-fullscreen-content" style={{ flex: 1, overflow: 'auto', padding: '32px 48px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              {renderContent(colorStyle)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 普通模式
  return (
    <div className="preview-page-layout" style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>
      {/* 左栏：目录 */}
      <div
        className="preview-page-toc"
        style={{
          width: 240,
          flexShrink: 0,
          overflow: 'auto',
          borderRight: '1px solid #f0f0f0',
          paddingRight: 16,
        }}
      >
        <Title level={5} style={{ marginBottom: 8 }}>
          <BookOutlined style={{ marginRight: 8 }} />
          {currentWork.title}
        </Title>

        <Space orientation="vertical" size={0} style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {totalChapterCount} 章 · 已写 {chapterCount} 章
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            总字数 {totalWordCount.toLocaleString()}
          </Text>
        </Space>

        <Divider style={{ margin: '8px 0 12px' }} />

        {previewData.map((vol) => (
          <div key={vol.volume.id} style={{ marginBottom: 8 }}>
            <Text
              strong
              style={{ cursor: 'pointer', fontSize: 13, display: 'block', padding: '4px 0' }}
              onClick={() => scrollToVolume(vol.volume.id)}
            >
              {vol.volume.title}
            </Text>
            {vol.chapters.map(({ outline, chapter }) => (
              <Text
                key={outline.id}
                type={chapter?.content ? undefined : 'secondary'}
                style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  display: 'block',
                  padding: '2px 0 2px 16px',
                  color: chapter?.content ? '#333' : '#bbb',
                }}
                onClick={() => scrollToChapter(outline.id)}
              >
                {outline.title}
              </Text>
            ))}
          </div>
        ))}

        {previewData.length === 0 && (
          <Empty description="暂无大纲" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>

      {/* 右栏：正文 */}
      <div className="preview-page-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 工具栏 */}
        <div className="preview-toolbar" style={{ flexShrink: 0, marginBottom: 16 }}>
          <Space wrap>
            <Checkbox
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
            >
              包含设定资料
            </Checkbox>
            <Checkbox
              checked={includeEmptyChapters}
              onChange={(e) => setIncludeEmptyChapters(e.target.checked)}
            >
              包含空章节
            </Checkbox>
            <Button icon={<DownloadOutlined />} onClick={handleExportMarkdown}>
              导出 Markdown
            </Button>
            <Button icon={<FileTextOutlined />} onClick={handleExportTxt}>
              导出 TXT
            </Button>
            <Button icon={<ExpandOutlined />} onClick={() => setFullscreen(true)}>
              全屏阅读
            </Button>
          </Space>
        </div>

        <AudiobookPanel work={currentWork} />

        {/* 全文内容 */}
        <Card
          className="preview-content-card"
          bodyStyle={{ padding: 24, maxWidth: 800, margin: '0 auto' }}
          style={{ flex: 1, overflow: 'auto' }}
        >
          {renderContent()}
        </Card>
      </div>
    </div>
  )
}
