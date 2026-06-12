import { Alert, Button, Card, Space, Typography } from 'antd'
import { CustomerServiceOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import type { Work } from '@/core/types'

const { Text } = Typography

interface Props {
  work: Work
}

export default function AudiobookPanel({ work }: Props) {
  const navigate = useNavigate()
  const writtenChapter = work.chapters.find((chapter) => chapter.content.trim())

  return (
    <Card style={{ marginBottom: 16 }} title={<><CustomerServiceOutlined /> 有声读物</>}>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="有声读物生成已迁移到章节丰盈"
          description="请在每个章节正文下方配置旁白、角色音色、AI 提示词和章节音频。全文预览只负责阅读和导出。"
        />
        <Button type="primary" disabled={!writtenChapter} onClick={() => navigate(writtenChapter ? `/chapters?chapterId=${encodeURIComponent(writtenChapter.id)}` : '/chapters')}>前往章节丰盈</Button>
        <Text type="secondary">当前版本按章节生成和交付音频，不做整本拼接、发布级混音或 Story Matrix 自建音色库。</Text>
      </Space>
    </Card>
  )
}
