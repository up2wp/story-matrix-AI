import { useState, useEffect, useCallback } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Select, Popconfirm, Space, Switch, Typography, Tag, message, Tabs, Card } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, UserOutlined, SettingOutlined, RobotOutlined, CustomerServiceOutlined, PictureOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { db } from '@/core/db'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { ALL_FEATURE_KEYS, FEATURE_LABELS, grantedFeaturesForUser, setUserFeatureGrant } from '@/core/feature-permissions'
import type { FeatureKey, User, AIConfig, VoiceboxConfig, ImageGenerationConfig, ImageGenerationModelConfig } from '@/core/types'

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
          { key: 'image-generation', label: '生图模型', icon: <PictureOutlined />, children: <ImageGenerationSettings /> },
          { key: 'voicebox', label: 'Voicebox', icon: <CustomerServiceOutlined />, children: <VoiceboxSettings /> },
        ]}
      />
    </div>
  )
}

// --- 生图模型设置 ---

function normalizeCapabilityInput(value: unknown) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
}

function serializeImageConfigForForm(config: ImageGenerationConfig) {
  return {
    ...config,
    immich: { ...config.immich },
    models: config.models.map(model => ({
      ...model,
      capabilities: {
        sizes: model.capabilities.sizes.join(', '),
        qualities: model.capabilities.qualities.join(', '),
        formats: model.capabilities.formats.join(', '),
      },
    })),
  }
}

function normalizeImageConfigFromForm(values: ImageGenerationConfig): ImageGenerationConfig {
  const models = (values.models || []).map((model: ImageGenerationModelConfig) => ({
    ...model,
    id: model.id?.trim(),
    label: model.label?.trim(),
    baseUrl: model.baseUrl?.trim(),
    model: model.model?.trim(),
    capabilities: {
      sizes: normalizeCapabilityInput(model.capabilities?.sizes),
      qualities: normalizeCapabilityInput(model.capabilities?.qualities),
      formats: normalizeCapabilityInput(model.capabilities?.formats),
    },
  })).filter(model => model.id)
  const enabledModelIds = new Set(models.filter(model => model.enabled).map(model => model.id))
  return {
    enabled: Boolean(values.enabled),
    defaultModelId: enabledModelIds.has(values.defaultModelId) ? values.defaultModelId : (models.find(model => model.enabled)?.id || ''),
    storageMode: values.storageMode === 'immich' ? 'immich' : 'local',
    immich: {
      serviceUrl: values.immich?.serviceUrl?.trim() || '',
      apiKey: values.immich?.apiKey || '',
      projectName: values.immich?.projectName?.trim() || '',
      allowPrivateNetwork: Boolean(values.immich?.allowPrivateNetwork),
    },
    models,
  }
}

function ImageGenerationSettings() {
  const imageGenerationConfig = useSystemConfigStore(s => s.imageGenerationConfig)
  const saveImageGenerationConfig = useSystemConfigStore(s => s.saveImageGenerationConfig)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const storageMode = Form.useWatch('storageMode', form) || 'local'
  const watchedModels = Form.useWatch('models', form) || []
  const defaultModelOptions = watchedModels
    .filter((model: Partial<ImageGenerationModelConfig>) => model?.id && model?.enabled)
    .map((model: Partial<ImageGenerationModelConfig>) => ({ value: model.id, label: model.label || model.id }))

  useEffect(() => {
    form.setFieldsValue(serializeImageConfigForForm(imageGenerationConfig))
  }, [imageGenerationConfig, form])

  const handleSave = async (values: ImageGenerationConfig) => {
    const normalized = normalizeImageConfigFromForm(values)
    const duplicateIds = normalized.models.map(model => model.id).filter((id, index, ids) => ids.indexOf(id) !== index)
    if (duplicateIds.length) {
      message.error(`模型 ID 重复：${duplicateIds.join(', ')}`)
      return
    }
    if (normalized.enabled && !normalized.models.some(model => model.enabled)) {
      message.error('开启生图功能前至少需要启用一个模型')
      return
    }
    if (normalized.storageMode === 'immich' && (!normalized.immich.serviceUrl || !normalized.immich.apiKey || !normalized.immich.projectName)) {
      message.error('启用 Immich 存储前需要填写服务地址、API Key 和项目名称')
      return
    }
    setSaving(true)
    try {
      await saveImageGenerationConfig(normalized)
      message.success('生图配置已保存')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form form={form} onFinish={handleSave} layout="vertical" initialValues={serializeImageConfigForForm(imageGenerationConfig)}>
      <Card title="生图功能" style={{ marginBottom: 16 }}>
        <Form.Item name="enabled" valuePropName="checked" extra="关闭后，所有用户都不能执行提示词生成或图片生成。已有作品视觉资产仍可按作品权限查看。">
          <Switch checkedChildren="已开启" unCheckedChildren="已关闭" />
        </Form.Item>
        <Form.Item name="defaultModelId" label="默认模型" extra="只可选择已启用模型。普通用户只能看到模型名称、能力和默认模型，不会看到 API 地址或密钥。">
          <Select allowClear options={defaultModelOptions} placeholder="选择默认生图模型" />
        </Form.Item>
        <Form.Item name="storageMode" label="图片存储方式" extra="切换只影响新生成图片；历史图片按自身记录的存储位置展示。">
          <Select options={[{ value: 'local', label: '本地存储' }, { value: 'immich', label: 'Immich 存储' }]} />
        </Form.Item>
      </Card>

      {storageMode === 'immich' && (
        <Card title="Immich 存储" style={{ marginBottom: 16 }}>
          <Form.Item name={['immich', 'serviceUrl']} label="Immich 服务地址" rules={[{ required: true, message: '请输入 Immich 服务地址' }]} extra="只保存在服务端；浏览器不会直连 Immich。默认拒绝本机、内网和 metadata 地址。">
            <Input placeholder="https://immich.example.com" />
          </Form.Item>
          <Form.Item name={['immich', 'apiKey']} label="Immich API Key" rules={[{ required: true, message: '请输入 Immich API Key' }]} extra="保存后以掩码回显，普通用户响应不会包含该密钥。">
            <Input.Password placeholder="输入 Immich API Key" />
          </Form.Item>
          <Form.Item name={['immich', 'projectName']} label="项目名称 / 相册名" rules={[{ required: true, message: '请输入项目名称' }]} extra="生成图片会自动创建或复用同名 Immich 相册。">
            <Input placeholder="story-matrix-production" />
          </Form.Item>
          <Form.Item name={['immich', 'allowPrivateNetwork']} valuePropName="checked" extra="仅自托管 Immich 位于内网时开启；开启后仍禁止 metadata/link-local 等危险地址。">
            <Switch checkedChildren="允许内网" unCheckedChildren="禁用内网" />
          </Form.Item>
        </Card>
      )}

      <Card title="可用模型" style={{ marginBottom: 16 }}>
        <Form.List name="models">
          {(fields, { add, remove }) => (
            <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
              {fields.map(field => (
                <Card
                  key={field.key}
                  size="small"
                  title={`模型 ${field.name + 1}`}
                  extra={<Button danger type="link" onClick={() => remove(field.name)}>移除</Button>}
                >
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space wrap style={{ width: '100%' }}>
                      <Form.Item {...field} name={[field.name, 'enabled']} valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Switch checkedChildren="启用" unCheckedChildren="停用" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'provider']} label="提供商" rules={[{ required: true }]} style={{ minWidth: 180, flex: 1, marginBottom: 0 }}>
                        <Select options={[{ value: 'openai', label: 'OpenAI Images' }, { value: 'custom', label: 'OpenAI 兼容' }]} />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'id']} label="模型 ID" rules={[{ required: true, message: '请输入唯一模型 ID' }]} style={{ minWidth: 180, flex: 1, marginBottom: 0 }}>
                        <Input placeholder="openai-gpt-image" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'label']} label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]} style={{ minWidth: 180, flex: 1, marginBottom: 0 }}>
                        <Input placeholder="GPT Image" />
                      </Form.Item>
                    </Space>
                    <Form.Item {...field} name={[field.name, 'baseUrl']} label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]} extra="仅服务端使用，普通用户配置响应会隐藏该地址。">
                      <Input placeholder="https://api.openai.com/v1" />
                    </Form.Item>
                    <Space wrap style={{ width: '100%' }}>
                      <Form.Item {...field} name={[field.name, 'model']} label="上游模型名" rules={[{ required: true, message: '请输入上游模型名' }]} style={{ minWidth: 220, flex: 1, marginBottom: 0 }}>
                        <Input placeholder="gpt-image-2" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'apiKey']} label="API Key" rules={[{ required: true, message: '请输入 API Key' }]} style={{ minWidth: 260, flex: 1, marginBottom: 0 }} extra="保存后以掩码回显，浏览器不会在用户端拿到真实密钥。">
                        <Input.Password placeholder="sk-..." />
                      </Form.Item>
                    </Space>
                    <Space wrap style={{ width: '100%' }}>
                      <Form.Item {...field} name={[field.name, 'capabilities', 'sizes']} label="尺寸" style={{ minWidth: 220, flex: 1, marginBottom: 0 }}>
                        <Input placeholder="1024x1024, 1536x1024" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'capabilities', 'qualities']} label="质量" style={{ minWidth: 180, flex: 1, marginBottom: 0 }}>
                        <Input placeholder="standard, high" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'capabilities', 'formats']} label="格式" style={{ minWidth: 180, flex: 1, marginBottom: 0 }}>
                        <Input placeholder="png, jpeg, webp" />
                      </Form.Item>
                    </Space>
                  </Space>
                </Card>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ provider: 'openai', enabled: true, capabilities: { sizes: '1024x1024', qualities: 'standard', formats: 'png' } })}>
                添加生图模型
              </Button>
            </Space>
          )}
        </Form.List>
      </Card>

      <Space>
        <Button type="primary" htmlType="submit" loading={saving}>保存生图配置</Button>
      </Space>
    </Form>
  )
}

// --- Voicebox 设置 ---

function VoiceboxSettings() {
  const voiceboxConfig = useSystemConfigStore(s => s.voiceboxConfig)
  const saveVoiceboxConfig = useSystemConfigStore(s => s.saveVoiceboxConfig)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [profiles, setProfiles] = useState<Array<{ id?: string; profile_id?: string; name?: string; display_name?: string }>>([])

  useEffect(() => {
    form.setFieldsValue(voiceboxConfig)
  }, [voiceboxConfig, form])

  const requestHeaders = () => {
    return { 'Content-Type': 'application/json' }
  }

  const handleSave = async (values: VoiceboxConfig) => {
    setSaving(true)
    try {
      await saveVoiceboxConfig({
        ...values,
        bearerToken: values.bearerToken === '__server_configured__' ? voiceboxConfig.bearerToken : values.bearerToken,
        apiKey: values.apiKey === '__server_configured__' ? voiceboxConfig.apiKey : values.apiKey,
        customHeaderValue: values.customHeaderValue === '__server_configured__' ? voiceboxConfig.customHeaderValue : values.customHeaderValue,
      })
      message.success('Voicebox 配置已保存')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const healthResponse = await fetch('/api/voicebox/health', { headers: requestHeaders(), credentials: 'include' })
      if (!healthResponse.ok) throw new Error(await healthResponse.text())
      const profilesResponse = await fetch('/api/voicebox/profiles', { headers: requestHeaders(), credentials: 'include' })
      if (!profilesResponse.ok) throw new Error(await profilesResponse.text())
      const data = await profilesResponse.json() as Array<{ id?: string; profile_id?: string; name?: string; display_name?: string }>
      setProfiles(data)
      message.success(`Voicebox 连接正常，读取到 ${data.length} 个音色`)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '未知错误'
      message.error(`Voicebox 连接失败: ${errMsg}`)
    } finally {
      setTesting(false)
    }
  }

  const authType = Form.useWatch('authType', form) || 'none'

  return (
    <Form form={form} onFinish={handleSave} layout="vertical" initialValues={voiceboxConfig}>
      <Card title="Voicebox 服务" style={{ marginBottom: 16 }}>
        <Form.Item name="serviceUrl" label="服务地址" rules={[{ required: true, message: '请输入 Voicebox 服务地址' }]} extra="支持本机、内网或线上 Voicebox 域名。浏览器不会直连该地址，所有请求都会通过 Story Matrix 后端代理。">
          <Input placeholder="https://voicebox.example.com" />
        </Form.Item>
        <Form.Item name="authType" label="鉴权方式" rules={[{ required: true, message: '请选择鉴权方式' }]}>
          <Select
            options={[
              { value: 'none', label: '无鉴权' },
              { value: 'bearer', label: 'Bearer Token' },
              { value: 'api-key', label: 'X-API-Key' },
              { value: 'custom-header', label: '自定义 Header' },
            ]}
          />
        </Form.Item>
        {authType === 'bearer' && (
          <Form.Item name="bearerToken" label="Bearer Token" extra="只保存在后端系统配置中，浏览器不会直接发送给 Voicebox。">
            <Input.Password placeholder="输入 Bearer Token" />
          </Form.Item>
        )}
        {authType === 'api-key' && (
          <Form.Item name="apiKey" label="API Key" extra="请求 Voicebox 时后端会以 X-API-Key header 注入。">
            <Input.Password placeholder="输入 API Key" />
          </Form.Item>
        )}
        {authType === 'custom-header' && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Form.Item name="customHeaderName" label="Header 名称" rules={[{ required: true, message: '请输入 Header 名称' }]}>
              <Input placeholder="例如 Authorization 或 X-Voicebox-Key" />
            </Form.Item>
            <Form.Item name="customHeaderValue" label="Header 值">
              <Input.Password placeholder="输入 Header 值" />
            </Form.Item>
          </Space>
        )}
        <Form.Item name="defaultEngine" label="默认引擎" rules={[{ required: true, message: '请输入默认引擎' }]}>
          <Input placeholder="f5-tts" />
        </Form.Item>
        <Form.Item name="defaultLanguage" label="默认语言" rules={[{ required: true, message: '请输入默认语言' }]}>
          <Input placeholder="zh" />
        </Form.Item>
        <Space wrap>
          <Form.Item name="defaultChunking" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch checkedChildren="分块" unCheckedChildren="不分块" />
          </Form.Item>
          <Form.Item name="defaultNormalize" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch checkedChildren="归一化" unCheckedChildren="不归一化" />
          </Form.Item>
          <Form.Item name="defaultCrossfade" label="交叉淡化" style={{ marginBottom: 0 }}>
            <Input type="number" min={0} max={1} step={0.05} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="generationConcurrency" label="全局并发数量" rules={[{ required: true, message: '请输入全局并发数量' }]} style={{ marginBottom: 0 }} extra="作用于整个系统的 Voicebox 生成队列，多个用户共享这个上限。">
            <InputNumber min={1} max={20} precision={0} style={{ width: 160 }} />
          </Form.Item>
        </Space>
      </Card>

      <Space>
        <Button type="primary" htmlType="submit" loading={saving}>保存配置</Button>
        <Button htmlType="button" onClick={handleTest} loading={testing}>检查连接 / 刷新音色</Button>
      </Space>

      <Card title="已读取音色" size="small" style={{ marginTop: 16 }}>
        {profiles.length ? (
          <Space wrap>
            {profiles.map((profile, index) => (
              <Tag key={profile.id || profile.profile_id || index}>{profile.name || profile.display_name || profile.id || profile.profile_id}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">保存配置后点击检查连接，可通过后端代理读取 Voicebox profiles。</Text>
        )}
      </Card>
    </Form>
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

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadUsers() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadUsers])

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
      <div className="desktop-user-table">
        <Table columns={columns} dataSource={users} rowKey="id" loading={loading} pagination={false} scroll={{ x: 600 }} />
      </div>
      <div className="mobile-user-cards">
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          {users.map(user => (
            <Card key={user.id} size="small" title={user.displayName} extra={renderRole(user.role)}>
              <Space orientation="vertical" size="small" style={{ width: '100%' }}>
                <Text type="secondary">用户名：{user.username}</Text>
                <Text type="secondary">创建时间：{new Date(user.createdAt).toLocaleString('zh-CN')}</Text>
                {user.id === currentUser?.id ? (
                  <Text type="secondary">当前用户</Text>
                ) : canManage(user) ? (
                  <Space wrap>
                    <Button icon={<EditOutlined />} onClick={() => openEdit(user)}>编辑</Button>
                    <Popconfirm title="确认停用此用户？" description="停用后该用户将无法登录，已有作品数据会保留。" onConfirm={() => handleDelete(user)} okText="停用" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                      <Button danger icon={<DeleteOutlined />}>停用</Button>
                    </Popconfirm>
                  </Space>
                ) : (
                  <Text type="secondary">无权操作</Text>
                )}
              </Space>
            </Card>
          ))}
        </Space>
      </div>
      <Modal title={editingUser ? '编辑用户' : '添加用户'} open={modalOpen} forceRender mask={{ closable: false }} onCancel={closeModal} onOk={() => form.submit()} confirmLoading={savingUser} okText={editingUser ? '保存' : '创建'} cancelText="取消">
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
  const novelImportConfig = useSystemConfigStore(s => s.novelImportConfig)
  const toggleRegistration = useSystemConfigStore(s => s.toggleRegistration)
  const toggleNovelImport = useSystemConfigStore(s => s.toggleNovelImport)
  const saveNovelImportConfig = useSystemConfigStore(s => s.saveNovelImportConfig)
  const [users, setUsers] = useState<User[]>([])
  const [savingPermission, setSavingPermission] = useState<string | null>(null)

  const loadPermissionUsers = useCallback(async () => {
    const allUsers = await db.users.toArray()
    setUsers(allUsers.filter((user: User) => user.role === 'user').sort((a: User, b: User) => a.createdAt - b.createdAt))
  }, [])

  useEffect(() => {
    void loadPermissionUsers()
  }, [loadPermissionUsers])

  const toggleUserFeature = async (userId: string, feature: FeatureKey, granted: boolean) => {
    setSavingPermission(`${userId}:${feature}`)
    try {
      await saveNovelImportConfig(setUserFeatureGrant(novelImportConfig, userId, feature, granted))
      message.success('功能权限已更新')
    } finally {
      setSavingPermission(null)
    }
  }

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: '#fafafa', borderRadius: 8 }}>
          <div>
            <Text strong>允许本地小说导入</Text>
            <br />
            <Text type="secondary">开启后，拥有者、管理员和已授权普通用户可使用本地导入与阶段反推功能</Text>
          </div>
          <Switch checked={novelImportConfig.enabled} onChange={toggleNovelImport} />
        </div>
        <Card title="用户级功能权限" size="small">
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Text type="secondary">全局开关关闭时所有用户都不可用；开启后，拥有者和管理员默认可用，普通用户需在这里逐项授权。后续新增功能可继续加入同一权限列表。</Text>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={users}
              locale={{ emptyText: '暂无普通用户' }}
              scroll={{ x: 720 }}
              columns={[
                { title: '用户', key: 'user', width: 180, render: (_: unknown, user: User) => <Space><Text strong>{user.displayName}</Text><Text type="secondary">@{user.username}</Text></Space> },
                ...ALL_FEATURE_KEYS.map(feature => ({
                  title: FEATURE_LABELS[feature],
                  key: feature,
                  width: 160,
                  render: (_: unknown, user: User) => {
                    const checked = grantedFeaturesForUser(novelImportConfig, user.id).includes(feature)
                    return (
                      <Switch
                        checked={checked}
                        loading={savingPermission === `${user.id}:${feature}`}
                        disabled={!novelImportConfig.enabled}
                        onChange={(value) => toggleUserFeature(user.id, feature, value)}
                      />
                    )
                  },
                })),
              ]}
            />
          </Space>
        </Card>
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
      const response = await fetch(`/api/ai/models`, {
        method: 'POST',
        headers,
        credentials: 'include',
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

        <Form.Item name="maxTokens" label="最大输出 Token 数" extra="控制 AI 单次最大输出长度，8192 约 4000-6000 中文字。设为 0 则使用模型默认值。">
          <InputNumber min={0} max={128000} step={1024} style={{ width: '100%' }} placeholder="8192" />
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
