import {
  Button,
  Space,
  Typography,
  Card,
  Tag,
  Empty,
  Spin,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Progress,
  Radio,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  AimOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { useState, useMemo } from 'react'
import type { Constraint, ConstraintType, ConstraintPriority, ConstraintStatus } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generateStream } from '@/ai/client'
import { seedContext, worldContext, charactersContext, constraintsContext } from '@/ai/context'
import { CONSTRAINT_SYSTEM_PROMPT, buildConstraintsPrompt, CONSTRAINT_POLISH_SYSTEM_PROMPT, buildConstraintPolishPrompt } from '@/ai/prompts/constraints'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input

const TYPE_CONFIG: Record<ConstraintType, { label: string; color: string; icon: React.ReactNode }> = {
  event: { label: '关键事件', color: 'red', icon: <AimOutlined /> },
  fate: { label: '角色命运', color: 'purple', icon: <AimOutlined /> },
  foreshadow: { label: '伏笔回收', color: 'orange', icon: <AimOutlined /> },
  rule: { label: '逻辑红线', color: 'volcano', icon: <AimOutlined /> },
  rhythm: { label: '节奏要求', color: 'blue', icon: <AimOutlined /> },
}

const PRIORITY_CONFIG: Record<ConstraintPriority, { label: string; color: string }> = {
  required: { label: '必须', color: 'red' },
  suggested: { label: '建议', color: 'orange' },
  optional: { label: '可选', color: 'default' },
}

const STATUS_CONFIG: Record<ConstraintStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待完成', color: 'default', icon: <ClockCircleOutlined /> },
  fulfilled: { label: '已满足', color: 'success', icon: <CheckCircleOutlined /> },
  waived: { label: '已放弃', color: 'default', icon: <MinusCircleOutlined /> },
}

export default function ConstraintsPage() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const readOnly = useStore((s) => s.readOnly)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [loading, setLoading] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editing, setEditing] = useState<Constraint | null>(null)
  const [filterType, setFilterType] = useState<ConstraintType | 'all'>('all')
  const [filterPriority, setFilterPriority] = useState<ConstraintPriority | 'all'>('all')
  const [form] = Form.useForm()
  const [polishing, setPolishing] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const constraints = currentWork?.constraints ?? []

  // 持久化
  const persistConstraints = async (newConstraints: Constraint[]) => {
    if (!currentWork) return
    await db.works.update(currentWork.id, { constraints: newConstraints })
    setCurrentWork({ ...currentWork, constraints: newConstraints, updatedAt: Date.now() })
  }

  // AI 生成约束
  const handleGenerate = async () => {
    if (!currentWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    setAIStream(true, '')
    try {
      const prompt = buildConstraintsPrompt(
        seedContext(currentWork),
        worldContext(currentWork),
        charactersContext(currentWork.characters, 'major'),
      )
      const text = await generateStream(prompt, CONSTRAINT_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) jsonStr = codeBlockMatch[1]
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.error('AI 返回内容：', text)
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '生成失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<any>
      const generated: Constraint[] = parsed.map((item) => ({
        id: generateId(),
        type: item.type || 'event',
        title: item.title || '未命名',
        description: item.description || '',
        priority: item.priority || 'suggested',
        status: 'pending',
      }))

      await persistConstraints([...constraints, ...generated])
      setAIStream(false, text)
      message.success(`已生成 ${generated.length} 条核心约束`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // AI 润色单条约束
  const handleAIPolish = async () => {
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    if (!editing || !currentWork) return
    const values = form.getFieldsValue()
    const currentConstraint = JSON.stringify({
      type: values.type || editing.type,
      title: values.title || editing.title,
      description: values.description || editing.description,
      priority: values.priority || editing.priority,
    }, null, 2)

    const setAIStream = useStore.getState().setAIStream
    setPolishing(true)
    setAIStream(true, '')
    try {
      const prompt = buildConstraintPolishPrompt(
        currentConstraint,
        constraintsContext(constraints),
        seedContext(currentWork),
        worldContext(currentWork),
        charactersContext(currentWork.characters, 'major'),
      )
      const text = await generateStream(prompt, CONSTRAINT_POLISH_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) jsonStr = codeBlockMatch[1]
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '润色失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0])
      form.setFieldsValue({
        title: parsed.title,
        description: parsed.description,
        type: parsed.type,
        priority: parsed.priority,
      })
      setAIStream(false, text)
      message.success('AI 润色完成')
    } catch (err: any) {
      message.error(`润色失败：${err.message}`)
      setAIStream(false, `润色失败：${err.message}`)
    } finally {
      setPolishing(false)
    }
  }

  const handleClear = async () => {
    await persistConstraints([])
    message.success('已清空核心约束')
  }

  const filteredConstraints = useMemo(() => {
    return constraints.filter((c) => {
      if (filterType !== 'all' && c.type !== filterType) return false
      if (filterPriority !== 'all' && c.priority !== filterPriority) return false
      return true
    })
  }, [constraints, filterType, filterPriority])

  // 统计
  const stats = useMemo(() => {
    const total = constraints.length
    const fulfilled = constraints.filter((c) => c.status === 'fulfilled').length
    const waived = constraints.filter((c) => c.status === 'waived').length
    const pending = total - fulfilled - waived
    const percent = total > 0 ? Math.round((fulfilled / total) * 100) : 0
    return { total, fulfilled, pending, waived, percent }
  }, [constraints])

  const openEdit = (constraint: Constraint) => {
    setEditing(constraint)
    form.setFieldsValue(constraint)
    setEditModalOpen(true)
  }

  const handleSave = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const updated = constraints.map((c) =>
      c.id === editing.id ? { ...c, ...values } : c,
    )
    await persistConstraints(updated)
    setEditModalOpen(false)
    setEditing(null)
  }

  const handleAdd = () => {
    const newConstraint: Constraint = {
      id: generateId(),
      type: 'event',
      title: '新约束',
      description: '',
      priority: 'suggested',
      status: 'pending',
    }
    setEditing(newConstraint)
    form.setFieldsValue(newConstraint)
    setEditModalOpen(true)
  }

  const handleSaveNew = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    await persistConstraints([...constraints, { ...editing, ...values }])
    setEditModalOpen(false)
    setEditing(null)
  }

  const removeConstraint = async (id: string) => {
    await persistConstraints(constraints.filter((c) => c.id !== id))
  }

  const isNew = editing && !constraints.find((c) => c.id === editing.id)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>核心约束</Title>
        {!readOnly && (
          <Space>
            <Button icon={<PlusOutlined />} onClick={handleAdd}>手动新增</Button>
            <Button icon={<ExperimentOutlined />} onClick={handleGenerate} loading={loading}>
              AI 随机生成
            </Button>
            {constraints.length > 0 && (
              <Popconfirm title="确定清空所有约束？" onConfirm={handleClear} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}
                onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
              >
                <Button danger>清空约束</Button>
              </Popconfirm>
            )}
          </Space>
        )}
      </div>

      {/* 进度统计 */}
      {constraints.length > 0 && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space size="large">
            <div>
              <Text type="secondary">总计</Text>
              <div><Text strong style={{ fontSize: 20 }}>{stats.total}</Text></div>
            </div>
            <div>
              <Text type="secondary">已满足</Text>
              <div><Text strong style={{ fontSize: 20, color: '#52c41a' }}>{stats.fulfilled}</Text></div>
            </div>
            <div>
              <Text type="secondary">待完成</Text>
              <div><Text strong style={{ fontSize: 20, color: '#faad14' }}>{stats.pending}</Text></div>
            </div>
            <div>
              <Text type="secondary">已放弃</Text>
              <div><Text strong style={{ fontSize: 20, color: '#999' }}>{stats.waived}</Text></div>
            </div>
            <div style={{ flex: 1 }}>
              <Text type="secondary">完成度</Text>
              <Progress percent={stats.percent} size="small" />
            </div>
          </Space>
        </Card>
      )}

      {/* 筛选器 */}
      {constraints.length > 0 && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Radio.Group value={filterType} onChange={(e) => setFilterType(e.target.value)} size="small">
            <Radio.Button value="all">全部类型</Radio.Button>
            {Object.entries(TYPE_CONFIG).map(([key, config]) => (
              <Radio.Button key={key} value={key}>{config.label}</Radio.Button>
            ))}
          </Radio.Group>
          <Select
            value={filterPriority}
            onChange={setFilterPriority}
            size="small"
            style={{ width: 120 }}
            options={[
              { label: '全部优先级', value: 'all' },
              { label: '必须', value: 'required' },
              { label: '建议', value: 'suggested' },
              { label: '可选', value: 'optional' },
            ]}
          />
        </Space>
      )}

      <Spin spinning={loading}>
        {constraints.length === 0 && !loading ? (
          <Empty description="点击上方按钮让 AI 生成核心约束" />
        ) : filteredConstraints.length === 0 ? (
          <Empty description="没有符合筛选条件的约束" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredConstraints.map((constraint) => {
              const typeInfo = TYPE_CONFIG[constraint.type]
              const priorityInfo = PRIORITY_CONFIG[constraint.priority]
              const statusInfo = STATUS_CONFIG[constraint.status]
              return (
                <Card
                  key={constraint.id}
                  size="small"
                  style={{
                    borderLeft: `3px solid ${constraint.status === 'fulfilled' ? '#52c41a' : constraint.status === 'waived' ? '#999' : '#1677ff'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <Space style={{ marginBottom: 4 }}>
                        {typeInfo.icon}
                        <Tag color={typeInfo.color}>{typeInfo.label}</Tag>
                        <Tag color={priorityInfo.color}>{priorityInfo.label}</Tag>
                        <Tag color={statusInfo.color} icon={statusInfo.icon}>{statusInfo.label}</Tag>
                        <Text strong>{constraint.title}</Text>
                      </Space>
                      {constraint.description && (() => {
                        const expanded = expandedIds.has(constraint.id)
                        return (
                          <div>
                            <Paragraph
                              style={{
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                ...(expanded ? {} : { maxHeight: '20em', overflow: 'hidden' }),
                              }}
                              type="secondary"
                            >
                              {constraint.description}
                            </Paragraph>
                            {constraint.description.split('\n').length > 20 && (
                              <Text
                                type="secondary"
                                style={{ fontSize: 12, cursor: 'pointer', color: '#1677ff' }}
                                onClick={() => {
                                  setExpandedIds(prev => {
                                    const next = new Set(prev)
                                    if (next.has(constraint.id)) next.delete(constraint.id)
                                    else next.add(constraint.id)
                                    return next
                                  })
                                }}
                              >
                                {expanded ? '收起' : '展开全部'}
                              </Text>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    {!readOnly && (
                      <Space>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(constraint)} />
                        <Popconfirm title="确定删除？" onConfirm={() => removeConstraint(constraint.id)} okButtonProps={{ autoFocus: true }}
                          onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
                        >
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Spin>

      <Modal
        title={isNew ? '新增约束' : '编辑约束'}
        open={editModalOpen}
        forceRender
        mask={{ closable: false }}
        onOk={isNew ? handleSaveNew : handleSave}
        onCancel={() => setEditModalOpen(false)}
        width={600}
        footer={(_, { OkBtn, CancelBtn }) => (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              icon={<ExperimentOutlined />}
              loading={polishing}
              onClick={handleAIPolish}
              disabled={readOnly}
            >
              AI 润色
            </Button>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        )}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="类型">
            <Select
              options={Object.entries(TYPE_CONFIG).map(([key, config]) => ({
                label: config.label,
                value: key,
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select
              options={[
                { label: '必须', value: 'required' },
                { label: '建议', value: 'suggested' },
                { label: '可选', value: 'optional' },
              ]}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { label: '待完成', value: 'pending' },
                { label: '已满足', value: 'fulfilled' },
                { label: '已放弃', value: 'waived' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
