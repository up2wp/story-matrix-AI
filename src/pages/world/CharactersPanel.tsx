import {
  Card,
  Button,
  Space,
  Tag,
  Typography,
  Empty,
  Spin,
  Modal,
  Form,
  Input,
  Select,
  message,
  Collapse,
  Popconfirm,
} from 'antd'
import {
  PlusOutlined,
  ExperimentOutlined,
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
  StarOutlined,
  StarFilled,
  ArrowRightOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import type { Character, Relation } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generateStream } from '@/ai/client'
import { seedContext, charactersContext } from '@/ai/context'
import { CHARACTER_SYSTEM_PROMPT, buildCharacterPrompt } from '@/ai/prompts/seed'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface Props {
  wb: ReturnType<typeof import('@/features/world/useWorldBuilder').useWorldBuilder>
}

const EMPTY_CHAR: Character = {
  id: '',
  name: '新角色',
  role: 'major',
  bio: '',
  personality: { traits: [], habits: [], arc: [] },
  relations: [],
  tags: [],
}

const RELATION_TYPES = ['血缘', '师徒', '朋友', '敌对', '暧昧', '上下级', '盟友', '宿敌', '青梅竹马', '对手']

export default function CharactersPanel({ wb }: Props) {
  const readOnly = useStore((s) => s.readOnly)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editing, setEditing] = useState<Character | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [editRelations, setEditRelations] = useState<Relation[]>([])
  const [form] = Form.useForm()

  const characters = wb.currentWork?.characters ?? []
  const majorChars = characters.filter((c) => c.role === 'major')

  // 切换主角标记
  const toggleProtagonist = async (char: Character) => {
    const isProtag = char.tags.includes('主角')
    // 先取消其他角色的主角标记
    if (!isProtag) {
      for (const c of majorChars) {
        if (c.tags.includes('主角')) {
          await wb.updateCharacter(c.id, {
            tags: c.tags.filter((t) => t !== '主角'),
          })
        }
      }
    }
    await wb.updateCharacter(char.id, {
      tags: isProtag
        ? char.tags.filter((t) => t !== '主角')
        : ['主角', ...char.tags],
    })
  }

  // 手动新增
  const handleAdd = () => {
    const char = { ...EMPTY_CHAR, id: generateId() }
    setEditing(char)
    setIsNew(true)
    setEditRelations([])
    form.setFieldsValue({
      name: char.name,
      bio: char.bio,
      traits: '',
      habits: '',
      tags: '',
    })
    setEditModalOpen(true)
  }

  // AI 随机生成一个主要人物
  const handleAIGenerate = async () => {
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    const setAIStream = useStore.getState().setAIStream
    wb.setLoading(true)
    setAIStream(true, '')
    try {
      const work = wb.currentWork!
      const prompt = buildCharacterPrompt(seedContext(work), charactersContext(characters))
      const text = await generateStream(prompt, CHARACTER_SYSTEM_PROMPT, aiConfig, (chunk) => {
        setAIStream(true, chunk)
      })

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '生成失败')
        return
      }
      const parsed = JSON.parse(jsonMatch[0])
      const newChar: Character = {
        id: generateId(),
        name: parsed.name || '未命名',
        role: 'major',
        bio: parsed.bio || '',
        personality: {
          traits: parsed.personality?.traits || [],
          habits: parsed.personality?.habits || [],
          arc: parsed.personality?.arc || [],
        },
        relations: parsed.relations || [],
        tags: parsed.tags || [],
      }
      await wb.addCharacter(newChar)
      setAIStream(false, text)
      message.success(`已生成主要人物：${newChar.name}`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      wb.setLoading(false)
    }
  }

  // 打开编辑弹窗
  const openEdit = (char: Character) => {
    setEditing(char)
    setIsNew(false)
    setEditRelations(char.relations ? [...char.relations] : [])
    form.setFieldsValue({
      name: char.name,
      bio: char.bio,
      traits: char.personality.traits.join('、'),
      habits: char.personality.habits.join('、'),
      tags: char.tags.filter((t) => t !== '主角').join('、'),
    })
    setEditModalOpen(true)
  }

  // 保存（新增或编辑）
  const handleSave = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const isProtagonist = editing.tags.includes('主角')
    const userTags = values.tags.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean)
    const charData: Partial<Character> = {
      name: values.name,
      bio: values.bio,
      personality: {
        ...editing.personality,
        traits: values.traits.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean),
        habits: values.habits.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean),
      },
      relations: editRelations,
      tags: isProtagonist ? ['主角', ...userTags] : userTags,
    }

    if (isNew) {
      await wb.addCharacter({ ...editing, ...charData } as Character)
      message.success(`已添加 ${values.name}`)
    } else {
      await wb.updateCharacter(editing.id, charData)
    }
    setEditModalOpen(false)
    setEditing(null)
  }

  // 删除
  const handleDelete = async (id: string) => {
    // 同时清理其他角色对该角色的关系引用
    for (const c of characters) {
      if (c.relations?.some((r) => r.targetId === id)) {
        await wb.updateCharacter(c.id, {
          relations: c.relations.filter((r) => r.targetId !== id),
        })
      }
    }
    await wb.removeCharacter(id)
    message.success('已删除')
  }

  // 获取角色名
  const getCharName = (id: string) => characters.find((c) => c.id === id)?.name || '未知'

  // 添加关系
  const addRelation = () => {
    setEditRelations([...editRelations, { targetId: '', type: '', description: '' }])
  }

  // 更新关系
  const updateRelation = (index: number, patch: Partial<Relation>) => {
    const updated = [...editRelations]
    updated[index] = { ...updated[index], ...patch }
    setEditRelations(updated)
  }

  // 删除关系
  const removeRelation = (index: number) => {
    setEditRelations(editRelations.filter((_, i) => i !== index))
  }

  return (
    <div>
      {!readOnly && (
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button icon={<PlusOutlined />} onClick={handleAdd}>手动新增</Button>
            <Button icon={<ExperimentOutlined />} onClick={handleAIGenerate} loading={wb.loading}>
              AI 随机生成
            </Button>
          </Space>
        </div>
      )}

      <Spin spinning={wb.loading}>
        {majorChars.length === 0 && !wb.loading ? (
          <Empty description="暂无主要人物，可手动新增或让 AI 生成" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {majorChars.map((char) => {
              const isProtagonist = char.tags.includes('主角')
              const otherChars = characters.filter((c) => c.id !== char.id)
              return (
                <Card
                  key={char.id}
                  size="small"
                  style={isProtagonist ? { border: '2px solid #faad14' } : undefined}
                  title={
                    <Space>
                      {isProtagonist ? (
                        <StarFilled style={{ color: '#faad14', cursor: readOnly ? 'default' : 'pointer' }} onClick={() => !readOnly && toggleProtagonist(char)} />
                      ) : (
                        <StarOutlined style={{ color: '#d9d9d9', cursor: readOnly ? 'default' : 'pointer' }} onClick={() => !readOnly && toggleProtagonist(char)} />
                      )}
                      <Text strong>{char.name}</Text>
                      {isProtagonist && <Tag color="gold">主角</Tag>}
                      {char.tags.filter((t) => t !== '主角').map((t) => (
                        <Tag key={t} color="blue">{t}</Tag>
                      ))}
                    </Space>
                  }
                  extra={
                    !readOnly ? (
                      <Space>
                        {isProtagonist ? (
                          <Button size="small" type="primary" icon={<StarFilled />} style={{ background: '#faad14', borderColor: '#faad14' }} onClick={() => toggleProtagonist(char)}>
                            主角
                          </Button>
                        ) : (
                          <Button size="small" icon={<StarOutlined />} onClick={() => toggleProtagonist(char)}>
                            设为主角
                          </Button>
                        )}
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(char)}>
                          编辑
                        </Button>
                        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(char.id)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ) : undefined
                  }
                >
                  <Paragraph style={{ marginBottom: 12 }}>{char.bio || '暂无背景描述'}</Paragraph>

                  {/* 关系展示 */}
                  {char.relations && char.relations.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>角色关系：</Text>
                      <div style={{ marginTop: 4 }}>
                        {char.relations.map((r, i) => (
                          <Tag key={i} color="orange">
                            {getCharName(r.targetId)}：{r.type || '未定义'}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  )}

                  <Collapse
                    ghost
                    items={[
                      {
                        key: 'personality',
                        label: '性格详情',
                        children: (
                          <div>
                            {char.personality.traits.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <Text type="secondary">特质：</Text>
                                <div>
                                  {char.personality.traits.map((t) => (
                                    <Tag key={t}>{t}</Tag>
                                  ))}
                                </div>
                              </div>
                            )}
                            {char.personality.habits.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <Text type="secondary">习惯：</Text>
                                <div>
                                  {char.personality.habits.map((h) => (
                                    <Tag key={h} color="default">{h}</Tag>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ),
                      },
                      ...(char.personality.arc.length > 0
                        ? [
                            {
                              key: 'arc',
                              label: '性格弧线',
                              children: (
                                <div>
                                  {char.personality.arc.map((a, i) => (
                                    <div key={i} style={{ marginBottom: 8 }}>
                                      <Tag color="purple">{a.stage}</Tag>
                                      <Text>{a.description}</Text>
                                      {a.trigger && (
                                        <div style={{ marginLeft: 24 }}>
                                          <Text type="secondary">
                                            <ArrowRightOutlined /> 触发：{a.trigger}
                                          </Text>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                </Card>
              )
            })}
          </div>
        )}
      </Spin>

      <Modal
        title={isNew ? '新增角色' : '编辑角色'}
        open={editModalOpen}
        onOk={handleSave}
        onCancel={() => setEditModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="bio" label="经历背景">
            <TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
          </Form.Item>
          <Form.Item name="traits" label="性格特质">
            <Input placeholder="用顿号分隔，如：坚韧、重情义、嫉恶如仇" />
          </Form.Item>
          <Form.Item name="habits" label="行为习惯">
            <Input placeholder="用顿号分隔" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="用顿号分隔" />
          </Form.Item>

          {/* 关系编辑 */}
          <Form.Item label="角色关系">
            {editRelations.map((rel, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <Select
                  placeholder="选择角色"
                  value={rel.targetId || undefined}
                  onChange={(v) => updateRelation(i, { targetId: v })}
                  options={characters
                    .filter((c) => c.id !== editing?.id)
                    .map((c) => ({ label: c.name, value: c.id }))}
                  style={{ flex: 2 }}
                  allowClear
                />
                <Select
                  placeholder="关系类型"
                  value={rel.type || undefined}
                  onChange={(v) => updateRelation(i, { type: v })}
                  options={RELATION_TYPES.map((t) => ({ label: t, value: t }))}
                  style={{ flex: 1 }}
                  showSearch
                  allowClear
                />
                <Input
                  placeholder="描述（可选）"
                  value={rel.description}
                  onChange={(e) => updateRelation(i, { description: e.target.value })}
                  style={{ flex: 2 }}
                />
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeRelation(i)} />
              </div>
            ))}
            <Button type="dashed" icon={<PlusOutlined />} onClick={addRelation} block>
              添加关系
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
