import { useState, useEffect, useCallback } from 'react'
import { Table, Button, Modal, Form, Input, Select, Popconfirm, Space, Switch, Typography, Tag, message, Tabs, Card } from 'antd'
import { PlusOutlined, DeleteOutlined, UserOutlined, SettingOutlined, RobotOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { db } from '@/core/db'
import { useAuthStore, hashPassword } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generateId } from '@/utils/id'
import type { User, AIConfig } from '@/core/types'

const { Title, Text } = Typography

export default function AdminPage() {
  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>系统管理</Title>
      <Tabs
        items={[
          { key: 'users', label: '用户管理', icon: <UserOutlined />, children: <UserManagement /> },
          { key: 'settings', label: '系统设置', icon: <SettingOutlined />, children: <SystemSettings /> },
          { key: 'model', label: '模型管理', icon: <RobotOutlined />, children: <ModelSettings /> },
        ]}
      />
    </div>
  )
}

// --- 用户管理 ---

function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const allUsers = await db.users.toArray()
      setUsers(allUsers.sort((a, b) => a.createdAt - b.createdAt))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const handleAdd = async (values: { username: string; password: string; displayName: string; role: 'admin' | 'user' }) => {
    const existing = await db.users.where('username').equals(values.username).first()
    if (existing) {
      message.error('用户名已存在')
      return
    }
    const newUser: User = {
      id: generateId(),
      username: values.username,
      passwordHash: await hashPassword(values.password),
      displayName: values.displayName,
      role: values.role,
      createdAt: Date.now(),
    }
    await db.users.add(newUser)
    message.success('用户创建成功')
    setModalOpen(false)
    form.resetFields()
    loadUsers()
  }

  const handleDelete = async (user: User) => {
    if (user.role === 'admin') {
      const adminCount = users.filter(u => u.role === 'admin').length
      if (adminCount <= 1) {
        message.error('不能删除最后一个管理员')
        return
      }
    }
    const workCount = await db.works.where('ownerId').equals(user.id).count()
    if (workCount > 0) {
      message.error(`该用户还有 ${workCount} 个作品，请先删除或转移作品`)
      return
    }
    await db.users.delete(user.id)
    message.success('用户已删除')
    loadUsers()
  }

  const columns: ColumnsType<User> = [
    { title: '用户名', dataIndex: 'username', key: 'username', width: 120 },
    { title: '显示名称', dataIndex: 'displayName', key: 'displayName', width: 120 },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: string) => role === 'admin' ? <Tag color="red">管理员</Tag> : <Tag color="blue">普通用户</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (ts: number) => new Date(ts).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: User) => {
        const currentUserId = useAuthStore.getState().user?.id
        if (record.id === currentUserId) return <Text type="secondary">当前用户</Text>
        return (
          <Popconfirm title="确认删除此用户？" onConfirm={() => handleDelete(record)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        )
      },
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          添加用户
        </Button>
      </div>
      <Table columns={columns} dataSource={users} rowKey="id" loading={loading} pagination={false} scroll={{ x: 600 }} />
      <Modal title="添加用户" open={modalOpen} mask={{ closable: false }} onCancel={() => { setModalOpen(false); form.resetFields() }} onOk={() => form.submit()} okText="创建" cancelText="取消">
        <Form form={form} onFinish={handleAdd} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={[{ value: 'admin', label: '管理员' }, { value: 'user', label: '普通用户' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// --- 系统设置 ---

function SystemSettings() {
  const registrationEnabled = useSystemConfigStore(s => s.registrationEnabled)
  const toggleRegistration = useSystemConfigStore(s => s.toggleRegistration)

  return (
    <div>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: '#fafafa', borderRadius: 8 }}>
          <div>
            <Text strong>允许用户注册</Text>
            <br />
            <Text type="secondary">开启后，登录页面将显示注册链接，允许新用户自行注册</Text>
          </div>
          <Switch checked={registrationEnabled} onChange={toggleRegistration} />
        </div>
      </Space>
    </div>
  )
}

// --- 模型管理 ---

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; models: string[] }> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  vllm: {
    label: 'vLLM',
    baseUrl: 'http://localhost:8000/v1',
    models: [],
  },
  custom: {
    label: '自定义 (OpenAI 兼容)',
    baseUrl: '',
    models: [],
  },
}

function ModelSettings() {
  const aiConfig = useSystemConfigStore(s => s.aiConfig)
  const saveAIConfig = useSystemConfigStore(s => s.saveAIConfig)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    form.setFieldsValue(aiConfig)
  }, [aiConfig])

  const handleProviderChange = (provider: string) => {
    const preset = PROVIDER_PRESETS[provider]
    if (preset) {
      form.setFieldsValue({
        baseUrl: preset.baseUrl,
        model: preset.models[0] || '',
      })
    }
  }

  const handleSave = async (values: AIConfig) => {
    setSaving(true)
    try {
      await saveAIConfig(values)
      message.success('模型配置已保存')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const values = form.getFieldsValue() as AIConfig
    if (!values.apiKey && values.provider === 'openai') {
      message.warning('请先填写 API Key')
      return
    }
    if (!values.model) {
      message.warning('请填写模型名称')
      return
    }
    setTesting(true)
    try {
      const { generate } = await import('@/ai/client')
      const result = await generate('说"测试成功"', '你是一个测试助手，只需回复用户要求的内容。', values)
      message.success(`测试成功: ${result.slice(0, 50)}`)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '未知错误'
      message.error(`测试失败: ${errMsg}`)
    } finally {
      setTesting(false)
    }
  }

  const provider = Form.useWatch('provider', form) || 'openai'

  return (
    <Form form={form} onFinish={handleSave} layout="vertical" initialValues={aiConfig}>
      <Card title="模型提供商" style={{ marginBottom: 16 }}>
        <Form.Item name="provider" label="提供商类型" rules={[{ required: true }]}>
          <Select onChange={handleProviderChange}>
            <Select.Option value="openai">OpenAI</Select.Option>
            <Select.Option value="vllm">vLLM</Select.Option>
            <Select.Option value="custom">自定义 (OpenAI 兼容)</Select.Option>
          </Select>
        </Form.Item>

        {provider === 'openai' && (
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
            <Input.Password placeholder="sk-..." />
          </Form.Item>
        )}

        {provider === 'vllm' && (
          <Form.Item name="apiKey" label="API Key（可选）">
            <Input.Password placeholder="如果 vLLM 启用了认证，请填写" />
          </Form.Item>
        )}

        {provider === 'custom' && (
          <Form.Item name="apiKey" label="API Key（可选）">
            <Input.Password placeholder="如果服务需要认证，请填写" />
          </Form.Item>
        )}

        <Form.Item name="baseUrl" label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]}>
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>

        <Form.Item name="model" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}>
          {provider === 'openai' ? (
            <Select
              showSearch
              allowClear
              options={PROVIDER_PRESETS.openai.models.map(m => ({ label: m, value: m }))}
              placeholder="选择或输入模型名称"
              dropdownRender={(menu) => menu}
              mode={undefined}
            />
          ) : (
            <Input placeholder="例如: llama-3-8b, qwen2-7b" />
          )}
        </Form.Item>
      </Card>

      <Space>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存配置
        </Button>
        <Button type="default" htmlType="button" onClick={handleTest} loading={testing}>
          测试连接
        </Button>
      </Space>

      <Card title="使用说明" size="small" style={{ marginTop: 16 }}>
        <ul style={{ margin: 0, paddingLeft: 20, color: '#666' }}>
          <li><Text type="secondary">OpenAI：填写官方 API Key，选择模型即可</Text></li>
          <li><Text type="secondary">vLLM：填写 vLLM 服务地址（如 http://192.168.1.100:8000/v1），模型名称与 vLLM 加载的模型一致</Text></li>
          <li><Text type="secondary">自定义：任何兼容 OpenAI API 格式的服务（如 Ollama、LiteLLM 等）</Text></li>
        </ul>
      </Card>
    </Form>
  )
}
