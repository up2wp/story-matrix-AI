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
  Popconfirm,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import type { Character, Relation } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generateStream } from '@/ai/client'
import { charactersContext, worldContext } from '@/ai/context'
import { SUPPORTING_SYSTEM_PROMPT, buildSupportingCharsPrompt } from '@/ai/prompts/world'
import { CHARACTER_SYSTEM_PROMPT, buildCharacterPolishPrompt } from '@/ai/prompts/seed'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface Props {
  wb: ReturnType<typeof import('@/features/world/useWorldBuilder').useWorldBuilder>
}

const RELATION_TYPES = ['血缘', '师徒', '朋友', '敌对', '暧昧', '上下级', '盟友', '宿敌', '青梅竹马', '对手']

export default function SupportingPanel({ wb }: Props) {
  const readOnly = useStore((s) => s.readOnly)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editing, setEditing] = useState<Character | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [editRelations, setEditRelations] = useState<Relation[]>([])
  const [form] = Form.useForm()
  const [polishing, setPolishing] = useState(false)

  const characters = wb.currentWork?.characters ?? []
  const supportingChars = characters.filter((c) => c.role !== 'major')

  // 获取角色名
  const getCharName = (id: string) => characters.find((c) => c.id === id)?.name || '未知'

  // 添加/更新/删除关系
  const addRelation = () => setEditRelations([...editRelations, { targetId: '', type: '', description: '' }])
  const updateRelation = (index: number, patch: Partial<Relation>) => {
    const updated = [...editRelations]
    updated[index] = { ...updated[index], ...patch }
    setEditRelations(updated)
  }
  const removeRelation = (index: number) => setEditRelations(editRelations.filter((_, i) => i !== index))

  // AI 随机生成 3 个非主要人物
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
      const majorChars = characters.filter((c) => c.role === 'major')
      const prompt = buildSupportingCharsPrompt(
        charactersContext(majorChars),
        worldContext(work),
      )
      const text = await generateStream(prompt, SUPPORTING_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
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
      const generated: Character[] = parsed.slice(0, 3).map((item) => ({
        id: generateId(),
        name: item.name || '未命名',
        role: item.role || 'supporting',
        bio: item.bio || '',
        personality: {
          traits: item.personality?.traits || [],
          habits: (item.personality?.habits || []).map((h: string) => h.replace(/\s+/g, ' ').trim()).filter(Boolean),
          arc: item.personality?.arc || [],
        },
        relations: item.relations || [],
        tags: item.tags || [],
      }))

      await wb.setCharacters([...characters, ...generated])
      setAIStream(false, text)
      message.success(`已生成 ${generated.length} 个非主要人物`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      wb.setLoading(false)
    }
  }

  // 清空所有非主要人物
  const handleClearAll = async () => {
    const majorOnly = characters.filter((c) => c.role === 'major')
    await wb.setCharacters(majorOnly)
    message.success('已清空所有非主要人物')
  }

  // AI 润色当前编辑的角色
  const handleAIPolish = async () => {
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    if (!editing) return

    const values = form.getFieldsValue()
    const currentChar = {
      name: values.name || editing.name,
      bio: values.bio || editing.bio,
      personality: {
        traits: values.traits ? values.traits.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean) : editing.personality.traits,
        habits: editing.personality.habits,
        arc: editing.personality.arc,
      },
      tags: values.tags ? values.tags.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean) : editing.tags,
    }

    const setAIStream = useStore.getState().setAIStream
    setPolishing(true)
    setAIStream(true, '')
    try {
      const work = wb.currentWork!
      const prompt = buildCharacterPolishPrompt(
        currentChar,
        worldContext(work),
        charactersContext(characters),
      )
      const text = await generateStream(prompt, CHARACTER_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      // 解析 AI 返回的 JSON（兼容 markdown 代码块）
      let jsonStr = text
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1]
      }
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.error('AI 返回内容：', text)
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '润色失败')
        return
      }

      const parsed = JSON.parse(jsonMatch[0])
      form.setFieldsValue({
        bio: parsed.bio || currentChar.bio,
        traits: (parsed.personality?.traits || currentChar.personality.traits).join('、'),
        tags: (parsed.tags || currentChar.tags).join('、'),
      })
      if (parsed.personality?.arc) {
        setEditing({
          ...editing,
          personality: {
            ...editing.personality,
            arc: parsed.personality.arc,
          },
        })
      }
      setAIStream(false, text)
      message.success('AI 润色完成')
    } catch (err: any) {
      message.error(`润色失败：${err.message}`)
      setAIStream(false, `润色失败：${err.message}`)
    } finally {
      setPolishing(false)
    }
  }

  // 手动新增
  const handleAdd = () => {
    const newChar: Character = {
      id: generateId(),
      name: '新角色',
      role: 'minor',
      bio: '',
      personality: { traits: [], habits: [], arc: [] },
      relations: [],
      tags: [],
    }
    setEditing(newChar)
    setIsNew(true)
    setEditRelations([])
    form.setFieldsValue({ name: newChar.name, role: newChar.role, bio: '', traits: '', tags: '' })
    setEditModalOpen(true)
  }

  // 打开编辑
  const openEdit = (char: Character) => {
    setEditing(char)
    setIsNew(false)
    setEditRelations(char.relations ? [...char.relations] : [])
    form.setFieldsValue({
      name: char.name,
      role: char.role,
      bio: char.bio,
      traits: char.personality.traits.join('、'),
      tags: char.tags.join('、'),
    })
    setEditModalOpen(true)
  }

  // 保存（新增或编辑）
  const handleSave = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const charData = {
      name: values.name,
      role: values.role,
      bio: values.bio,
      personality: {
        ...editing.personality,
        traits: values.traits.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean),
      },
      relations: editRelations,
      tags: values.tags.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean),
    }

    if (isNew) {
      await wb.addCharacter({ ...editing, ...charData })
      message.success(`已添加 ${values.name}`)
    } else {
      await wb.updateCharacter(editing.id, charData)
    }
    setEditModalOpen(false)
    setEditing(null)
  }

  return (
    <div>
      {!readOnly && (
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button icon={<PlusOutlined />} onClick={handleAdd}>手动新增</Button>
            <Button icon={<ExperimentOutlined />} onClick={handleAIGenerate} loading={wb.loading}>
              AI 随机生成 3 个
            </Button>
            {supportingChars.length > 0 && (
              <Popconfirm title="确定清空所有非主要人物？" onConfirm={handleClearAll} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                <Button danger>清空所有</Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      )}

      <Spin spinning={wb.loading}>
        {supportingChars.length === 0 && !wb.loading ? (
          <Empty description="暂无非主要人物，可手动新增或让 AI 生成" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {supportingChars.map((char) => (
              <Card key={char.id} size="small" style={{ borderLeft: char.role === 'supporting' ? '3px solid #52c41a' : '3px solid #d9d9d9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <Space style={{ marginBottom: 4 }}>
                      <TeamOutlined />
                      <Text strong>{char.name}</Text>
                      <Tag color={char.role === 'supporting' ? 'green' : 'default'}>
                        {char.role === 'supporting' ? '配角' : '路人'}
                      </Tag>
                      {char.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </Space>
                    <Paragraph style={{ margin: 0 }} type="secondary">{char.bio || '暂无背景'}</Paragraph>
                    {char.relations && char.relations.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {char.relations.map((r, i) => (
                          <Tag key={i} color="orange">
                            {getCharName(r.targetId)}：{r.type || '未定义'}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </div>
                  {!readOnly && (
                    <Space>
                      <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(char)} />
                      <Popconfirm title="确定删除？" onConfirm={async () => {
                        for (const c of characters) {
                          if (c.relations?.some((r) => r.targetId === char.id)) {
                            await wb.updateCharacter(c.id, { relations: c.relations.filter((r) => r.targetId !== char.id) })
                          }
                        }
                        await wb.removeCharacter(char.id)
                        message.success('已删除')
                      }} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Spin>

      <Modal
        title={isNew ? '新增角色' : '编辑角色'}
        open={editModalOpen}
        mask={{ closable: false }}
        onOk={handleSave}
        onCancel={() => setEditModalOpen(false)}
        okText="保存"
        cancelText="取消"
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
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="定位">
            <Select
              options={[
                { label: '配角', value: 'supporting' },
                { label: '路人', value: 'minor' },
              ]}
            />
          </Form.Item>
          <Form.Item name="bio" label="背景">
            <TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="traits" label="性格特质">
            <Input placeholder="用顿号分隔" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="用顿号分隔" />
          </Form.Item>

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
