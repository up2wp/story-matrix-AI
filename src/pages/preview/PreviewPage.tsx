import { Card, Typography, Space, Button, Checkbox, Empty, Statistic, Divider } from 'antd'
import {
  DownloadOutlined,
  FileTextOutlined,
  BookOutlined,
} from '@ant-design/icons'
import { Navigate } from 'react-router'
import { usePreview } from '@/features/preview/usePreview'

const { Title, Text, Paragraph } = Typography

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

  if (!currentWork) return <Navigate to="/works" replace />

  const { seed, characters, settings } = currentWork

  return (
    <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>
      {/* 左栏：目录 */}
      <div
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

        <Space direction="vertical" size={0} style={{ marginBottom: 16 }}>
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 工具栏 */}
        <div style={{ flexShrink: 0, marginBottom: 16 }}>
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
          </Space>
        </div>

        {/* 全文内容 */}
        <Card
          bodyStyle={{ padding: 24, maxWidth: 800, margin: '0 auto' }}
          style={{ flex: 1, overflow: 'auto' }}
        >
          {/* 可选：设定资料前言 */}
          {includeMetadata && (
            <div style={{ marginBottom: 32 }}>
              <Title level={3}>设定总览</Title>

              <Title level={5}>故事基础</Title>
              <Paragraph>
                类型：{seed.genre}{seed.subGenre ? `·${seed.subGenre}` : ''}<br />
                时间背景：{seed.timePeriod}<br />
                地域范围：{seed.regions.join('、')}<br />
                基调：{seed.tone}<br />
                核心概念：{seed.coreConcept}
                {seed.targetAudience && <><br />目标读者：{seed.targetAudience}</>}
              </Paragraph>

              {characters.filter((c) => c.role === 'major').length > 0 && (
                <>
                  <Title level={5}>主要人物</Title>
                  {characters.filter((c) => c.role === 'major').map((c) => (
                    <div key={c.id} style={{ marginBottom: 12 }}>
                      <Text strong>{c.name}</Text>
                      <Paragraph style={{ marginBottom: 4 }}>{c.bio}</Paragraph>
                      {c.personality.traits.length > 0 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          性格特质：{c.personality.traits.join('、')}
                        </Text>
                      )}
                    </div>
                  ))}
                </>
              )}

              {settings.length > 0 && (
                <>
                  <Title level={5}>世界观设定</Title>
                  {settings.map((s) => (
                    <div key={s.id} style={{ marginBottom: 12 }}>
                      <Text strong>{s.title}</Text>
                      <Paragraph style={{ marginBottom: 0 }}>{s.content}</Paragraph>
                    </div>
                  ))}
                </>
              )}

              <Divider />
            </div>
          )}

          {/* 卷 > 章正文 */}
          {previewData.length === 0 ? (
            <Empty description="暂无大纲，请先创建大纲" />
          ) : (
            previewData.map((vol) => (
              <div key={vol.volume.id} id={`vol-${vol.volume.id}`} style={{ marginBottom: 40 }}>
                <Title level={2} style={{ marginBottom: 4 }}>{vol.volume.title}</Title>
                {vol.volume.summary && (
                  <Paragraph type="secondary" style={{ marginBottom: 24 }}>
                    {vol.volume.summary}
                  </Paragraph>
                )}

                {vol.chapters.map(({ outline, chapter }) => (
                  <div key={outline.id} id={`ch-${outline.id}`} style={{ marginBottom: 32 }}>
                    <Title level={3} style={{ marginBottom: 8 }}>{outline.title}</Title>
                    {chapter?.content ? (
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: 15 }}>
                        {chapter.content}
                      </div>
                    ) : (
                      <Text type="secondary" italic>（本章暂无正文）</Text>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  )
}
