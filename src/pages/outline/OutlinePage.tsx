import {
  Button,
  Space,
  Typography,
  Empty,
  Spin,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Card,
  Tag,
  Collapse,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  BookOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useState, useMemo, useCallback } from 'react'
import type { OutlineNode } from '@/core/types'
import { generateId } from '@/utils/id'
import { injectGlobalConstraintsToNode, autoBindGlobalConstraints, autoMatchUnboundConstraints, getScope } from '@/utils/constraints'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generateStream } from '@/ai/client'
import { seedContext, worldContext, charactersContext, constraintsContext } from '@/ai/context'
import { OUTLINE_SYSTEM_PROMPT, buildOutlinePrompt } from '@/ai/prompts/outline'
import { MATCH_CONSTRAINTS_SYSTEM_PROMPT, buildMatchConstraintsPrompt } from '@/ai/prompts/constraints'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

export default function OutlinePage() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const readOnly = useStore((s) => s.readOnly)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [loading, setLoading] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [genModalOpen, setGenModalOpen] = useState(false)
  const [editing, setEditing] = useState<OutlineNode | null>(null)
  const [form] = Form.useForm()
  const [genForm] = Form.useForm()

  const outline = currentWork?.outline ?? []

  // 持久化
  const persistOutline = useCallback(
    async (newOutline: OutlineNode[]) => {
      if (!currentWork) return
      const updated = { ...currentWork, outline: newOutline, updatedAt: Date.now() }
      await db.works.update(currentWork.id, { outline: newOutline })
      setCurrentWork(updated)
    },
    [currentWork, setCurrentWork],
  )

  // 打开生成设置弹窗
  const openGenModal = () => {
    genForm.setFieldsValue({ volumes: 3, chaptersPerVolume: 5 })
    setGenModalOpen(true)
  }

  // AI 生成大纲
  const handleGenerate = async () => {
    if (!currentWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const values = genForm.getFieldsValue()
    const volumes = values.volumes || 3
    const chaptersPerVolume = values.chaptersPerVolume || 5
    setGenModalOpen(false)

    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    setAIStream(true, '')
    try {
      const basePrompt = buildOutlinePrompt(
        seedContext(currentWork),
        worldContext(currentWork),
        charactersContext(currentWork.characters, 'major'),
        constraintsContext(currentWork.constraints),
      )
      const prompt = `${basePrompt}\n\n要求：生成 ${volumes} 卷，每卷 ${chaptersPerVolume} 章。`

      const text = await generateStream(prompt, OUTLINE_SYSTEM_PROMPT, aiConfig, (chunk) => {
        setAIStream(true, chunk)
      })

      // 解析 AI 返回的 JSON（兼容 markdown 代码块）
      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1]
      }
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.error('AI 返回内容：', text)
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '生成失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<any>
      const nodes: OutlineNode[] = []
      let order = 0
      let currentVolumeId: string | undefined

      for (const item of parsed) {
        const id = generateId()
        if (item.level === 'volume') {
          currentVolumeId = id
        }
        const node: OutlineNode = {
          id,
          parentId: item.level === 'chapter' ? currentVolumeId : undefined,
          title: item.title,
          summary: item.summary || '',
          order: order++,
          level: item.level || 'chapter',
          characterIds: item.characters || [],
          storylineIds: [],
          constraintIds: [],
        }
        // 自动带入全局约束
        nodes.push(injectGlobalConstraintsToNode(node, currentWork.constraints))
      }

      // 同步全局约束的 relatedOutlineIds
      const globalResult = autoBindGlobalConstraints(currentWork.constraints, nodes)
      // 自动匹配未绑定的局部约束到章节节点
      const matchResult = autoMatchUnboundConstraints(globalResult.constraints, globalResult.outline)
      await persistOutline(matchResult.outline)
      // 清理孤儿章节（outlineId 不在新大纲中的章节）
      const validOutlineIds = new Set(matchResult.outline.map((n) => n.id))
      const orphanedChapters = currentWork.chapters.filter((c) => !validOutlineIds.has(c.outlineId))
      if (orphanedChapters.length > 0) {
        const keptChapters = currentWork.chapters.filter((c) => validOutlineIds.has(c.outlineId))
        await db.works.update(currentWork.id, { chapters: keptChapters })
        setCurrentWork({ ...currentWork, chapters: keptChapters })
      }
      // 更新约束的 relatedOutlineIds
      if (matchResult.constraints !== currentWork.constraints) {
        await db.works.update(currentWork.id, { constraints: matchResult.constraints })
        setCurrentWork({ ...currentWork, constraints: matchResult.constraints, outline: matchResult.outline, updatedAt: Date.now() })
      }
      setAIStream(false, text)
      message.success(`已生成 ${nodes.filter((n) => n.level === 'volume').length} 卷 ${nodes.filter((n) => n.level === 'chapter').length} 章的大纲`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 清空大纲
  const handleClear = async () => {
    await persistOutline([])
    message.success('已清空大纲')
  }

  // 重新匹配局部约束到大纲节点（AI 分析情节语义）
  const handleRematch = async () => {
    if (!currentWork) return
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }

    const localConstraints = currentWork.constraints.filter((c) => getScope(c) === 'local')
    const chapterNodes = outline.filter((n) => n.level === 'chapter')
    if (!localConstraints.length) {
      message.info('没有局部约束需要匹配')
      return
    }
    if (!chapterNodes.length) {
      message.info('没有章节节点，请先生成大纲')
      return
    }

    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    setAIStream(true, '')
    try {
      const prompt = buildMatchConstraintsPrompt(
        localConstraints.map((c) => ({ id: c.id, type: c.type, title: c.title, description: c.description })),
        chapterNodes.map((n) => ({ id: n.id, title: n.title, summary: n.summary })),
      )
      const text = await generateStream(prompt, MATCH_CONSTRAINTS_SYSTEM_PROMPT, aiConfig, (chunk) => {
        setAIStream(true, chunk)
      })

      // 解析 AI 返回的 JSON（兼容 markdown 代码块）
      let jsonStr2 = text
      const codeBlockMatch2 = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch2) {
        jsonStr2 = codeBlockMatch2[1]
      }
      const jsonMatch = jsonStr2.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.error('AI 返回内容：', text)
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '匹配失败：格式异常')
        setLoading(false)
        return
      }

      const mapping = JSON.parse(jsonMatch[0]) as Record<string, string[]>
      const validNodeIds = new Set(chapterNodes.map((n) => n.id))

      // 更新约束的 relatedOutlineIds
      const newConstraints = currentWork.constraints.map((c) => {
        if (getScope(c) !== 'local') return c
        const ids = (mapping[c.id] || []).filter((id) => validNodeIds.has(id))
        return { ...c, relatedOutlineIds: ids }
      })

      // 同步全局约束 + 更新大纲节点
      const globalResult = autoBindGlobalConstraints(newConstraints, outline)
      // 根据新的 relatedOutlineIds 更新节点 constraintIds
      const newOutline = globalResult.outline.map((node) => {
        const globalIds = node.constraintIds.filter((id) => {
          const constraint = newConstraints.find((c) => c.id === id)
          return constraint && getScope(constraint) === 'global'
        })
        const localIds = newConstraints
          .filter((c) => getScope(c) === 'local' && c.relatedOutlineIds.includes(node.id))
          .map((c) => c.id)
        return { ...node, constraintIds: [...new Set([...globalIds, ...localIds])] }
      })

      await persistOutline(newOutline)
      await db.works.update(currentWork.id, { constraints: globalResult.constraints })
      setCurrentWork({ ...currentWork, constraints: globalResult.constraints, outline: newOutline, updatedAt: Date.now() })

      const matched = newConstraints.filter((c) => getScope(c) === 'local' && c.relatedOutlineIds.length > 0).length
      setAIStream(false, `匹配完成：${matched}/${localConstraints.length} 条局部约束已绑定`)
      message.success(`AI 匹配完成：${matched}/${localConstraints.length} 条局部约束已绑定`)
    } catch (err: any) {
      message.error(`匹配失败：${err.message}`)
      setAIStream(false, `匹配失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 卷列表（卡片式）
  const volumes = useMemo(() => {
    return outline
      .filter((n) => n.level === 'volume')
      .sort((a, b) => a.order - b.order)
  }, [outline])

  // 获取某卷下的章节
  const getChapters = (volumeId: string) => {
    return outline
      .filter((n) => n.parentId === volumeId)
      .sort((a, b) => a.order - b.order)
  }

  // 打开编辑
  const openEdit = (node: OutlineNode) => {
    setEditing(node)
    form.setFieldsValue({ title: node.title, summary: node.summary })
    setEditModalOpen(true)
  }

  // 保存编辑
  const handleSave = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const newOutline = outline.map((n) =>
      n.id === editing.id ? { ...n, ...values } : n,
    )
    await persistOutline(newOutline)
    setEditModalOpen(false)
    setEditing(null)
  }

  // 删除节点（含子节点）
  const removeNode = async (id: string) => {
    const toRemove = new Set<string>()
    const collect = (nodeId: string) => {
      toRemove.add(nodeId)
      outline.filter((n) => n.parentId === nodeId).forEach((n) => collect(n.id))
    }
    collect(id)
    const newOutline = outline.filter((n) => !toRemove.has(n.id))
    await persistOutline(newOutline)
  }

  // 新增节点
  const handleAdd = (level: 'volume' | 'chapter', parentId?: string) => {
    const rawNode: OutlineNode = {
      id: generateId(),
      parentId,
      title: level === 'volume' ? '新卷' : '新章',
      summary: '',
      order: outline.length,
      level,
      characterIds: [],
      storylineIds: [],
      constraintIds: [],
    }
    // 自动带入全局约束
    const newNode = injectGlobalConstraintsToNode(rawNode, currentWork?.constraints ?? [])
    setEditing(newNode)
    form.setFieldsValue({ title: newNode.title, summary: '' })
    setEditModalOpen(true)
  }

  // 保存新增
  const handleSaveNew = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    await persistOutline([...outline, { ...editing, ...values }])
    setEditModalOpen(false)
    setEditing(null)
  }

  const isNew = editing && !outline.find((n) => n.id === editing.id)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>主线大纲</Title>
        {!readOnly && (
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => handleAdd('volume')}>新增卷</Button>
            <Button icon={<ExperimentOutlined />} onClick={openGenModal} loading={loading}>
              AI 随机生成
            </Button>
            {outline.length > 0 && currentWork?.constraints && currentWork.constraints.length > 0 && (
              <Button onClick={handleRematch}>重新匹配局部约束</Button>
            )}
            {outline.length > 0 && (
              <Popconfirm title="确定清空所有大纲？" onConfirm={handleClear} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                <Button danger>清空大纲</Button>
              </Popconfirm>
            )}
          </Space>
        )}
      </div>

      {/* 简要统计 */}
      {outline.length > 0 && (() => {
        const volCount = outline.filter((n) => n.level === 'volume').length
        const chCount = outline.filter((n) => n.level === 'chapter').length
        const estWords = chCount * 3000
        return (
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Tag color="blue">{volCount} 卷</Tag>
              <Tag color="blue">{chCount} 章</Tag>
              <Tag color="purple">预计 {estWords.toLocaleString()} 字</Tag>
            </Space>
          </div>
        )
      })()}

      <Spin spinning={loading}>
        {outline.length === 0 && !loading ? (
          <Empty description="点击上方按钮让 AI 生成主线大纲" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {volumes.map((vol, volIdx) => {
              const chapters = getChapters(vol.id)
              return (
                <Card
                  key={vol.id}
                  title={
                    <Space>
                      <BookOutlined />
                      <Text strong style={{ fontSize: 15 }}>{vol.title}</Text>
                      <Tag>{chapters.length} 章</Tag>
                    </Space>
                  }
                  extra={
                    !readOnly ? (
                      <Space>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => handleAdd('chapter', vol.id)}>添加章节</Button>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(vol)} />
                        <Popconfirm title="确定删除？章节也会被删除" onConfirm={() => removeNode(vol.id)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ) : undefined
                  }
                >
                  {vol.summary && (
                    <Paragraph type="secondary" style={{ marginBottom: 16 }}>{vol.summary}</Paragraph>
                  )}

                  {chapters.length === 0 ? (
                    <Text type="secondary">暂无章节</Text>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {chapters.map((ch, chIdx) => (
                        <Card
                          key={ch.id}
                          size="small"
                          style={{ background: '#fafafa' }}
                          title={
                            <Space>
                              <FileTextOutlined />
                              <Text strong>{ch.title}</Text>
                            </Space>
                          }
                          extra={
                            !readOnly ? (
                              <Space>
                                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(ch)} />
                                <Popconfirm title="确定删除？" onConfirm={() => removeNode(ch.id)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                            ) : undefined
                          }
                        >
                          <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                            {ch.summary || '暂无剧情简述'}
                          </Paragraph>
                          {ch.characterIds && ch.characterIds.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              {ch.characterIds.map((name) => (
                                <Tag key={name} color="blue">{name}</Tag>
                              ))}
                            </div>
                          )}
                          {ch.constraintIds && ch.constraintIds.length > 0 && (() => {
                            const globalConstraints = ch.constraintIds
                              .map((cid) => currentWork?.constraints.find((c) => c.id === cid))
                              .filter((c) => c && (c.scope ?? 'local') === 'global')
                            const localConstraints = ch.constraintIds
                              .map((cid) => currentWork?.constraints.find((c) => c.id === cid))
                              .filter((c) => c && (c.scope ?? 'local') !== 'global')
                            return (
                              <div style={{ marginTop: 8 }}>
                                {globalConstraints.length > 0 && (
                                  <div style={{ marginBottom: 4 }}>
                                    {globalConstraints.map((c) => (
                                      <div key={c!.id}>
                                        <Tag color="cyan" style={{ fontSize: 11, marginBottom: 2 }}>🌐 {c!.title}</Tag>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {localConstraints.length > 0 && (
                                  <div>
                                    {localConstraints.map((c) => (
                                      <div key={c!.id}>
                                        <Tag color="geekblue" style={{ fontSize: 11, marginBottom: 2 }}>📌 {c!.title}</Tag>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </Card>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </Spin>

      {/* 生成设置弹窗 */}
      <Modal
        title="AI 生成大纲设置"
        open={genModalOpen}
        onOk={handleGenerate}
        onCancel={() => setGenModalOpen(false)}
        okText="开始生成"
        cancelText="取消"
      >
        <Form form={genForm} layout="vertical" initialValues={{ volumes: 3, chaptersPerVolume: 5 }}>
          <Form.Item name="volumes" label="卷数">
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="chaptersPerVolume" label="每卷章数">
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title={isNew ? (editing?.level === 'volume' ? '新增卷' : '新增章节') : '编辑'}
        open={editModalOpen}
        onOk={isNew ? handleSaveNew : handleSave}
        onCancel={() => setEditModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="summary" label="剧情简述">
            <TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="100-200字的剧情概要" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
