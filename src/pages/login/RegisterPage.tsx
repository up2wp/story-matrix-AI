import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Form, Input, Button, Card, Typography, message } from 'antd'
import { UserOutlined, LockOutlined, IdcardOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/core/auth-store'

const { Title, Text, Link } = Typography

export default function RegisterPage() {
  const [loading, setLoading] = useState(false)
  const register = useAuthStore(s => s.register)
  const navigate = useNavigate()

  const onFinish = async (values: { username: string; password: string; confirmPassword: string; displayName: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      const result = await register(values.username, values.password, values.displayName)
      if (result.success) {
        message.success('注册成功')
        navigate('/works', { replace: true })
      } else {
        message.error(result.error || '注册失败')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
         minHeight: '100dvh',
         padding: 16,
         background: '#f5f5f5',
      }}
    >
      <Card style={{ width: 'min(400px, 100%)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 4 }}>Story Matrix AI</Title>
          <Text type="secondary">创建新账号</Text>
        </div>
        <Form onFinish={onFinish} autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item name="displayName" rules={[{ required: true, message: '请输入显示名称' }]}>
            <Input prefix={<IdcardOutlined />} placeholder="显示名称" size="large" autoComplete="name" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }, { min: 4, message: '密码至少4位' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmPassword" rules={[{ required: true, message: '请确认密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="确认密码" size="large" autoComplete="new-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              注册
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Text type="secondary">已有账号？</Text> <Link onClick={() => navigate('/login')}>去登录</Link>
        </div>
      </Card>
    </div>
  )
}
