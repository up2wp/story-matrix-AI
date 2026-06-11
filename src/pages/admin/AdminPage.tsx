import { useState, useEffect, useCallback } from 'react'
import { Table, Button, Modal, Form, Input, Select, Popconfirm, Space, Switch, Typography, Tag, message, Tabs, Card } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, UserOutlined, SettingOutlined, RobotOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { getToken } from '@/core/api-client'
import { db } from '@/core/db'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'
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
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [form] = Form.useForm()
  const currentUser = useAuthStore(s => s.user)

  const roleOptions = currentUser?.role === 'owner'
    ? [{ value: 'admin', label: '管理员' }, { value: 'user', label: '普通用户' }]
    : [{ value: 'user', label: '普通用户' }]

  const canManage = useCallback((target: User) => {
    if (!currentUser || target.id === currentUser.id || target.role === 'owner') return false
    if (currentUser.role === 'owner') return target.role === 'admin' || target.role === 'user'
    if (currentUser.role === 'admin') return target.role === 'user'
    return false
  }, [currentUser])

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

  const openCreate = () => {
    setEditingUser(null)
    form.resetFields()
    form.setFieldsValue({ role: 'user' })
    setModalOpen(true)
  }

  const openEdit = (user: User) => {
    setEditingUser(user)
    form.setFieldsValue({ username: user.username, displayName: user.displayName, role: user.role, password: '' })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingUser(null)
    form.resetFields()
  }

  const handleSaveUser = async (values: { username: string; password?: string; displayName: string; role: User['role'] }) => {
    setSavingUser(true)
    try {
      if (editingUser) {
        const changes: Partial<User> & { password?: string } = {
          displayName: values.displayName,
          role: values.role,
        }
        if (values.password) changes.password = values.password
        await db.users.update(editingUser.id, changes)
        message.success('用户已更新')
      } else {
        const existing = await db.users.where('username').equals(values.username).first()
        if (existing) {
          message.error('用户名已存在')
          return
        }
        await db.users.add({ username: values.username, password: values.password, displayName: values.displayName, role: values.role })
        message.success('用户创建成功')
      }
      closeModal()
      loadUsers()
    } finally {
      setSavingUser(false)
    }
  }

  const handleDelete = async (user: User) => {
    await db.users.delete(user.id)
    message.success('用户已停用')
    loadUsers()
  }

  const renderRole = (role: User['role']) => {
    if (role === 'owner') return <Tag color="gold">拥有者</Tag>
    if (role === 'admin') return <Tag color="red">管理员</Tag>
    return <Tag color="blue">普通用户</Tag>
  }

  const columns: ColumnsType<User> = [
    { title: '用户名', dataIndex: 'username', key: 'username', width: 120 },
    { title: '显示名称', dataIndex: 'displayName', key: 'displayName', width: 120 },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: renderRole,
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
      width: 180,
      render: (_: unknown, record: User) => {
        if (record.id === currentUser?.id) return <Text type="secondary">当前用户</Text>
        if (!canManage(record)) return <Text type="secondary">无权操作</Text>
        return (
          <Space size="small">
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
            <Popconfirm title="确认停用此用户？" description="停用后该用户将无法登录，已有作品数据会保留。" onConfirm={() => handleDelete(record)} okText="停用" cancelText="取消" okButtonProps={{ autoFocus: true }}>
              <Button type="link" danger icon={<DeleteOutlined />}>停用</Button>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!currentUser || !['owner', 'admin'].includes(currentUser.role)}>
          添加用户
        </Button>
      </div>
      <Table columns={columns} dataSource={users} rowKey="id" loading={loading} pagination={false} scroll={{ x: 600 }} />
      <Modal title={editingUser ? '编辑用户' : '添加用户'} open={modalOpen} mask={{ closable: false }} onCancel={closeModal} onOk={() => form.submit()} confirmLoading={savingUser} okText={editingUser ? '保存' : '创建'} cancelText="取消">
        <Form form={form} onFinish={handleSaveUser} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: !editingUser, message: '请输入用户名' }]}>
            <Input disabled={!!editingUser} />
          </Form.Item>
          <Form.Item name="password" label={editingUser ? '重置密码' : '密码'} rules={editingUser ? [] : [{ required: true, message: '请输入密码' }, { min: 4, message: '密码至少4位' }]} extra={editingUser ? '留空则不修改密码' : undefined}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={roleOptions} />
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
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelOptions, setModelOptions] = useState(PROVIDER_PRESETS.openai.models)

  useEffect(() => {
    form.setFieldsValue(aiConfig)
  }, [aiConfig, form])

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

  const loadModels = async () => {
    const values = form.getFieldsValue() as AIConfig
    if (!values.baseUrl) return
    setLoadingModels(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = getToken()
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch(`/api/ai/models`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ config: values }),
      })
      if (!response.ok) throw new Error(await response.text())
      const data = await response.json() as { models?: string[] }
      if (data.models?.length) setModelOptions(data.models)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '未知错误'
      message.error(`模型列表获取失败: ${errMsg}`)
    } finally {
      setLoadingModels(false)
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
              loading={loadingModels}
              onSearch={(value) => form.setFieldValue('model', value)}
              onDropdownVisibleChange={(open) => { if (open) loadModels() }}
              options={modelOptions.map(m => ({ label: m, value: m }))}
              placeholder="选择或输入模型名称"
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
