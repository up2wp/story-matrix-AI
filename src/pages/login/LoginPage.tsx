import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { Form, Input, Button, Card, Typography, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'

const { Title, Text, Link } = Typography

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const login = useAuthStore(s => s.login)
  const registrationEnabled = useSystemConfigStore(s => s.registrationEnabled)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: Location })?.from?.pathname || '/works'

  const loadConfig = useSystemConfigStore(s => s.loadConfig)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const success = await login(values.username, values.password)
      if (success) {
        // 登录成功后重新加载配置（带 token 才能获取 AI 配置）
        await loadConfig()
        navigate(from, { replace: true })
      } else {
        message.error('用户名或密码错误')
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
          <Text type="secondary">AI 驱动的小说创作工具</Text>
        </div>
        <Form onFinish={onFinish} autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              登录
            </Button>
          </Form.Item>
        </Form>
        {registrationEnabled && (
          <div style={{ textAlign: 'center' }}>
            <Text type="secondary">没有账号？</Text> <Link onClick={() => navigate('/register')}>注册新账号</Link>
          </div>
        )}
      </Card>
    </div>
  )
}
