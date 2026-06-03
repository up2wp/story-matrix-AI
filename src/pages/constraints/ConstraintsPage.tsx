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
import { useState, useCallback, useMemo } from 'react'
import type { Constraint, ConstraintType, ConstraintPriority, ConstraintStatus, ConstraintScope } from '@/core/types'
import { generateId } from '@/utils/id'
import { deriveScope, autoBindGlobalConstraints, bindConstraintToNodes } from '@/utils/constraints'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generateStream } from '@/ai/client'
import { seedContext, worldContext, charactersContext } from '@/ai/context'
import { CONSTRAINT_SYSTEM_PROMPT, buildConstraintsPrompt } from '@/ai/prompts/constraints'

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

const SCOPE_CONFIG: Record<ConstraintScope, { label: string; color: string }> = {
  local: { label: '局部', color: 'geekblue' },
  global: { label: '全局', color: 'cyan' },
}

/**
 * 根据绑定章节的写作进度自动计算约束状态
 * - 未绑定章节 → pending
 * - 局部约束：绑定的章节全部有内容 → fulfilled，否则 pending
 * - 全局约束：所有章节都有内容 → fulfilled，否则 pending
 */
function getConstraintStatus(
  constraint: Constraint,
  outline: Array<{ id: string; level: string }>,
  chapters: Array<{ outlineId: string; wordCount: number }>,
): ConstraintStatus {
  const scope = constraint.scope ?? deriveScope(constraint.type)
  const chapterNodes = outline.filter((n) => n.level === 'chapter')
  if (!chapterNodes.length) return 'pending'

  if (scope === 'global') {
    // 全局约束：所有章节都有内容才算满足
    const allWritten = chapterNodes.every((node) => {
      const chapter = chapters.find((c) => c.outlineId === node.id)
      return chapter && chapter.wordCount > 0
    })
    return allWritten ? 'fulfilled' : 'pending'
  }

  // 局部约束
  if (constraint.relatedOutlineIds.length === 0) return 'pending'
  const allWritten = constraint.relatedOutlineIds.every((nodeId) => {
    const chapter = chapters.find((c) => c.outlineId === nodeId)
    return chapter && chapter.wordCount > 0
  })
  return allWritten ? 'fulfilled' : 'pending'
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

  const constraints = currentWork?.constraints ?? []
  const chapters = currentWork?.chapters ?? []
  const outline = currentWork?.outline ?? []

  // 持久化（含全局约束自动绑定）
  const persistConstraints = useCallback(
    async (newConstraints: Constraint[]) => {
      if (!currentWork) return
      const result = autoBindGlobalConstraints(newConstraints, currentWork.outline)
      const updated = {
        ...currentWork,
        constraints: result.constraints,
        outline: result.outline,
        updatedAt: Date.now(),
      }
      await db.works.update(currentWork.id, {
        constraints: result.constraints,
        outline: result.outline,
      })
      setCurrentWork(updated)
    },
    [currentWork, setCurrentWork],
  )

  // AI 生成约束（流式输出）
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
      const text = await generateStream(prompt, CONSTRAINT_SYSTEM_PROMPT, aiConfig, (chunk) => {
        setAIStream(true, chunk)
      })

      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '生成失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<any>
      const generated: Constraint[] = parsed.map((item) => {
        const type = item.type || 'event'
        const scope = deriveScope(type)
        return {
          id: generateId(),
          type,
          scope,
          title: item.title || '未命名',
          description: item.description || '',
          priority: item.priority || 'suggested',
          relatedOutlineIds: [],
          status: 'pending',
        }
      })

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

  // 清空约束
  const handleClear = async () => {
    await persistConstraints([])
    message.success('已清空核心约束')
  }

  // 筛选后的约束
  const filteredConstraints = useMemo(() => {
    return constraints.filter((c) => {
      if (filterType !== 'all' && c.type !== filterType) return false
      if (filterPriority !== 'all' && c.priority !== filterPriority) return false
      return true
    })
  }, [constraints, filterType, filterPriority])

  // 统计（基于自动计算的状态）
  const stats = useMemo(() => {
    const total = constraints.length
    const fulfilled = constraints.filter((c) => getConstraintStatus(c, outline, chapters) === 'fulfilled').length
    const pending = total - fulfilled
    const bound = constraints.filter((c) => {
      const scope = c.scope ?? deriveScope(c.type)
      return scope === 'global' || c.relatedOutlineIds.length > 0
    }).length
    return { total, fulfilled, pending, bound, percent: total > 0 ? Math.round((fulfilled / total) * 100) : 0 }
  }, [constraints, outline, chapters])

  // 打开编辑
  const openEdit = (constraint: Constraint) => {
    setEditing(constraint)
    setEditModalOpen(true)
    // 延迟设置表单值，确保条件渲染的字段已挂载
    setTimeout(() => {
      form.setFieldsValue({
        ...constraint,
        scope: constraint.scope ?? deriveScope(constraint.type),
        relatedOutlineIds: constraint.relatedOutlineIds ?? [],
      })
    }, 0)
  }

  // 保存编辑
  const handleSave = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const updatedConstraint = { ...editing, ...values, scope: deriveScope(values.type || editing.type) }
    let newConstraints = constraints.map((c) =>
      c.id === editing.id ? updatedConstraint : c,
    )
    // 如果是局部约束且 relatedOutlineIds 变化，同步大纲节点
    if (updatedConstraint.scope === 'local' && currentWork) {
      const result = bindConstraintToNodes(
        editing.id,
        values.relatedOutlineIds || [],
        newConstraints,
        currentWork.outline,
      )
      newConstraints = result.constraints
      const updated = {
        ...currentWork,
        constraints: result.constraints,
        outline: result.outline,
        updatedAt: Date.now(),
      }
      await db.works.update(currentWork.id, {
        constraints: result.constraints,
        outline: result.outline,
      })
      setCurrentWork(updated)
      setEditModalOpen(false)
      setEditing(null)
      return
    }
    await persistConstraints(newConstraints)
    setEditModalOpen(false)
    setEditing(null)
  }

  // 新增
  const handleAdd = () => {
    const newConstraint: Constraint = {
      id: generateId(),
      type: 'event',
      scope: 'local',
      title: '新约束',
      description: '',
      priority: 'suggested',
      relatedOutlineIds: [],
      status: 'pending',
    }
    setEditing(newConstraint)
    form.setFieldsValue(newConstraint)
    setEditModalOpen(true)
  }

  // 保存新增
  const handleSaveNew = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const newConstraint = {
      ...editing,
      ...values,
      scope: deriveScope(values.type || editing.type),
    }
    await persistConstraints([...constraints, newConstraint])
    setEditModalOpen(false)
    setEditing(null)
  }

  // 删除
  const removeConstraint = async (id: string) => {
    await persistConstraints(constraints.filter((c) => c.id !== id))
  }

  // 局部约束绑定到大纲节点
  const handleBindNodes = async (constraintId: string, nodeIds: string[]) => {
    if (!currentWork) return
    const result = bindConstraintToNodes(constraintId, nodeIds, constraints, currentWork.outline)
    const updated = {
      ...currentWork,
      constraints: result.constraints,
      outline: result.outline,
      updatedAt: Date.now(),
    }
    await db.works.update(currentWork.id, {
      constraints: result.constraints,
      outline: result.outline,
    })
    setCurrentWork(updated)
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
              <Popconfirm title="确定清空所有约束？" onConfirm={handleClear} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
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
              <Text type="secondary">已绑定</Text>
              <div><Text strong style={{ fontSize: 20, color: '#1677ff' }}>{stats.bound}</Text></div>
            </div>
            <div>
              <Text type="secondary">已满足</Text>
              <div><Text strong style={{ fontSize: 20, color: '#52c41a' }}>{stats.fulfilled}</Text></div>
            </div>
            <div>
              <Text type="secondary">待完成</Text>
              <div><Text strong style={{ fontSize: 20, color: '#faad14' }}>{stats.pending}</Text></div>
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
              const calcStatus = getConstraintStatus(constraint, outline, chapters)
              const statusInfo = STATUS_CONFIG[calcStatus]
              return (
                <Card
                  key={constraint.id}
                  size="small"
                  style={{
                    borderLeft: `3px solid ${calcStatus === 'fulfilled' ? '#52c41a' : '#1677ff'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <Space style={{ marginBottom: 4 }}>
                        {typeInfo.icon}
                        <Tag color={typeInfo.color}>{typeInfo.label}</Tag>
                        <Tag color={SCOPE_CONFIG[constraint.scope ?? deriveScope(constraint.type)].color}>{SCOPE_CONFIG[constraint.scope ?? deriveScope(constraint.type)].label}</Tag>
                        <Tag color={priorityInfo.color}>{priorityInfo.label}</Tag>
                        <Tag color={statusInfo.color} icon={statusInfo.icon}>{statusInfo.label}</Tag>
                        <Text strong>
                          {constraint.title}
                        </Text>
                      </Space>
                      <Paragraph style={{ margin: 0 }} type="secondary">
                        {constraint.description}
                      </Paragraph>
                      {(constraint.scope ?? deriveScope(constraint.type)) === 'global' ? (
                        <div style={{ marginTop: 4 }}>
                          <Tag color="cyan">自动绑定全部章节</Tag>
                        </div>
                      ) : constraint.relatedOutlineIds.length > 0 ? (
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>绑定章节：</Text>
                          {constraint.relatedOutlineIds.map((nodeId) => {
                            const node = currentWork?.outline.find((n) => n.id === nodeId)
                            const chapter = chapters.find((c) => c.outlineId === nodeId)
                            const hasContent = chapter && chapter.wordCount > 0
                            return node ? (
                              <Tag key={nodeId} color={hasContent ? 'green' : 'blue'} style={{ fontSize: 12 }}>
                                {node.title}{hasContent ? ' ✓' : ''}
                              </Tag>
                            ) : null
                          })}
                        </div>
                      ) : (
                        <div style={{ marginTop: 4 }}>
                          <Text type="warning" style={{ fontSize: 12 }}>⚠ 未绑定章节</Text>
                        </div>
                      )}
                    </div>
                    {!readOnly && (
                      <Space>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(constraint)} />
                        <Popconfirm title="确定删除？" onConfirm={() => removeConstraint(constraint.id)} okButtonProps={{ autoFocus: true }}>
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
        onOk={isNew ? handleSaveNew : handleSave}
        onCancel={() => setEditModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="类型">
            <Select
              options={Object.entries(TYPE_CONFIG).map(([key, config]) => ({
                label: config.label,
                value: key,
              }))}
              onChange={(value: ConstraintType) => {
                form.setFieldValue('scope', deriveScope(value))
              }}
            />
          </Form.Item>
          <Form.Item name="scope" label="作用范围" tooltip="局部=绑定具体章节，全局=自动绑定全部章节">
            <Select
              disabled
              options={[
                { label: '局部（绑定具体章节）', value: 'local' },
                { label: '全局（自动绑定全部章节）', value: 'global' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.scope !== cur.scope}>
            {({ getFieldValue }) => {
              const scope = getFieldValue('scope')
              if (scope === 'global') return null
              return (
                <Form.Item name="relatedOutlineIds" label="绑定章节">
                  <Select
                    mode="multiple"
                    placeholder="选择要绑定的大纲节点"
                    options={currentWork?.outline
                      .filter((n) => n.level === 'chapter')
                      .map((n) => ({ label: n.title, value: n.id })) ?? []}
                  />
                </Form.Item>
              )
            }}
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
        </Form>
      </Modal>
    </div>
  )
}
