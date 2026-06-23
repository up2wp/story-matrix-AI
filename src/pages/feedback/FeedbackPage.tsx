import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { db } from '@/core/db'
import { useAuthStore } from '@/core/auth-store'
import type { Feedback } from '@/core/types'

const { Title, Text, Link } = Typography

export default function FeedbackPage() {
  const currentUser = useAuthStore(s => s.user)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(false)
  const [submitResult, setSubmitResult] = useState<Feedback | null>(null)
  const canManageFeedback = currentUser?.role === 'owner' || currentUser?.role === 'admin'

  const loadFeedback = useCallback(async () => {
    if (!(currentUser?.role === 'owner' || currentUser?.role === 'admin')) return
    setLoading(true)
    try {
      const items = await db.feedback.toArray()
      setFeedbackList(items.sort((a: Feedback, b: Feedback) => b.createdAt - a.createdAt))
    } finally {
      setLoading(false)
    }
  }, [currentUser?.role])

  useEffect(() => {
    void loadFeedback()
  }, [loadFeedback])

  const handleSubmit = async (values: { title: string; body: string }) => {
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const created = await db.feedback.add({ title: values.title, body: values.body })
      setSubmitResult(created)
      form.resetFields()
      message.success('反馈已提交')
      await loadFeedback()
    } finally {
      setSubmitting(false)
    }
  }

  const renderGitHubResult = (feedback: Feedback) => {
    if (feedback.githubIssueUrl) {
      return <Link href={feedback.githubIssueUrl} target="_blank">查看 GitHub Issue</Link>
    }
    if (feedback.githubIssueError) return <Text type="danger">{feedback.githubIssueError}</Text>
    return <Text type="secondary">未创建</Text>
  }

  const columns: ColumnsType<Feedback> = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '提交人', dataIndex: 'submitter', key: 'submitter', width: 140, render: (value?: string) => value || '未知用户' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: (value?: string) => <Tag>{value || 'open'}</Tag> },
    { title: 'GitHub Issue', key: 'githubIssue', width: 180, render: (_, record) => renderGitHubResult(record) },
    { title: '提交时间', dataIndex: 'createdAt', key: 'createdAt', width: 180, render: (ts: number) => new Date(ts).toLocaleString('zh-CN') },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>问题反馈</Title>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="提交反馈">
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入反馈标题' }]}>
              <Input placeholder="简短描述问题或建议" />
            </Form.Item>
            <Form.Item name="body" label="内容" rules={[{ required: true, message: '请输入反馈内容' }]}>
              <Input.TextArea rows={6} placeholder="请描述复现步骤、期望结果、实际表现或改进建议" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting}>提交反馈</Button>
          </Form>
          {submitResult?.githubIssueUrl && (
            <Alert style={{ marginTop: 16 }} type="success" showIcon message="反馈已同步到 GitHub Issue" description={<Link href={submitResult.githubIssueUrl} target="_blank">{submitResult.githubIssueUrl}</Link>} />
          )}
          {submitResult?.githubIssueError && (
            <Alert style={{ marginTop: 16 }} type="warning" showIcon message="反馈已保存，但 GitHub Issue 创建失败" description={submitResult.githubIssueError} />
          )}
        </Card>

        {canManageFeedback && (
          <Card title="反馈列表">
            <div className="desktop-user-table">
              <Table columns={columns} dataSource={feedbackList} rowKey="id" loading={loading} pagination={false} scroll={{ x: 800 }} />
            </div>
            <div className="mobile-user-cards">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {feedbackList.map(feedback => (
                  <Card key={feedback.id} size="small" title={feedback.title} extra={<Tag>{feedback.status || 'open'}</Tag>}>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      <Text type="secondary">提交人：{feedback.submitter || '未知用户'}</Text>
                      <Text type="secondary">提交时间：{new Date(feedback.createdAt).toLocaleString('zh-CN')}</Text>
                      <Text>{feedback.body}</Text>
                      {renderGitHubResult(feedback)}
                    </Space>
                  </Card>
                ))}
              </Space>
            </div>
          </Card>
        )}
      </Space>
    </div>
  )
}
