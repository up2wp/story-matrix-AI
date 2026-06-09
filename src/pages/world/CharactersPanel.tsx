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
  StarOutlined,
  StarFilled,
  ArrowRightOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import type { Character, CharacterArc, Relation } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { db } from '@/core/db'
import { generateStream } from '@/ai/client'
import { seedContext, charactersContext, worldContext } from '@/ai/context'
import { CHARACTER_SYSTEM_PROMPT, buildCharacterPrompt, buildCharacterPolishPrompt } from '@/ai/prompts/seed'

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
  const [editArc, setEditArc] = useState<CharacterArc[]>([])
  const [form] = Form.useForm()
  const [polishing, setPolishing] = useState(false)

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
    setEditArc([])
    form.setFieldsValue({
      name: char.name,
      bio: char.bio,
      traits: [],
      habits: [],
      tags: [],
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
      const settings = work.settings ?? []
      const prompt = buildCharacterPrompt(
        seedContext(work),
        charactersContext(characters),
        settings.length ? worldContext(work) : undefined,
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
        setAIStream(false, '生成失败')
        return
      }
      const parsed = JSON.parse(jsonMatch[0])
      // 解析关系：AI 返回的 targetId 可能是角色名，需要解析为 ID
      const rawRelations = parsed.relations || []
      const resolvedRelations = rawRelations.map((r: any) => {
        if (r.targetId && !characters.find((c) => c.id === r.targetId)) {
          // targetId 不是 ID，尝试按名字匹配
          const match = characters.find((c) => c.name === r.targetId)
          return { ...r, targetId: match?.id || '' }
        }
        return r
      }).filter((r: any) => r.targetId) // 过滤掉匹配不到的

      const newChar: Character = {
        id: generateId(),
        name: parsed.name || '未命名',
        role: 'major',
        bio: parsed.bio || '',
        personality: {
          traits: parsed.personality?.traits || [],
          habits: (parsed.personality?.habits || []).map((h: string) => h.replace(/\s+/g, ' ').trim()).filter(Boolean),
          arc: parsed.personality?.arc || [],
        },
        relations: resolvedRelations,
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

  // AI 润色当前编辑的角色
  const handleAIPolish = async () => {
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    if (!editing) return

    const values = form.getFieldsValue()
    // 构建当前角色信息
    const currentChar = {
      name: values.name || editing.name,
      bio: values.bio || editing.bio,
      personality: {
        traits: values.traits?.length ? values.traits : editing.personality.traits,
        habits: values.habits?.length ? values.habits : editing.personality.habits,
        arc: editing.personality.arc,
      },
      tags: values.tags?.length ? values.tags : editing.tags.filter((t) => t !== '主角'),
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
      // 更新表单
      form.setFieldsValue({
        bio: parsed.bio || currentChar.bio,
        traits: parsed.personality?.traits || currentChar.personality.traits,
        habits: (parsed.personality?.habits || currentChar.personality.habits).map((h: string) => h.replace(/\s+/g, ' ').trim()).filter(Boolean),
        tags: (parsed.tags || currentChar.tags).filter((t: string) => t !== '主角'),
      })
      // 更新编辑中的性格弧线
      if (parsed.personality?.arc) {
        setEditArc(parsed.personality.arc)
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

  // 打开编辑弹窗
  const openEdit = (char: Character) => {
    setEditing(char)
    setIsNew(false)
    setEditRelations(char.relations ? [...char.relations] : [])
    setEditArc(char.personality.arc ? [...char.personality.arc] : [])
    form.setFieldsValue({
      name: char.name,
      bio: char.bio,
      traits: char.personality.traits,
      habits: char.personality.habits,
      tags: char.tags.filter((t) => t !== '主角'),
    })
    setEditModalOpen(true)
  }

  // 保存（新增或编辑）
  // 批量替换文本中的旧角色名
  const batchReplaceName = (text: string, oldName: string, newName: string): string => {
    if (!oldName || oldName === newName || !text) return text
    return text.replaceAll(oldName, newName)
  }

  const handleSave = async () => {
    if (!editing) return
    const values = form.getFieldsValue()
    const isProtagonist = editing.tags.includes('主角')
    const userTags: string[] = values.tags || []
    const oldName = editing.name
    const newName = values.name
    const nameChanged = !isNew && oldName && newName && oldName !== newName

    const charData: Partial<Character> = {
      name: newName,
      bio: values.bio,
      personality: {
        ...editing.personality,
        traits: values.traits || [],
        habits: values.habits || [],
        arc: editArc,
      },
      relations: editRelations,
      tags: isProtagonist ? ['主角', ...userTags] : userTags,
    }

    if (isNew) {
      await wb.addCharacter({ ...editing, ...charData } as Character)
      message.success(`已添加 ${newName}`)
    } else {
      await wb.updateCharacter(editing.id, charData)

      // 批量替换角色名
      if (nameChanged) {
        const work = wb.currentWork
        if (work) {
          let replacedCount = 0
          const replace = (text: string) => {
            const result = batchReplaceName(text, oldName, newName)
            if (result !== text) replacedCount++
            return result
          }

          // 替换所有角色的 bio、arc、relations 描述
          const updatedCharacters = work.characters.map((c) => {
            const newBio = replace(c.bio)
            const newArc = c.personality.arc.map((a) => ({
              ...a,
              description: replace(a.description),
              trigger: a.trigger ? replace(a.trigger) : a.trigger,
            }))
            const newRelations = c.relations.map((r) => ({
              ...r,
              description: replace(r.description),
            }))
            return { ...c, bio: newBio, personality: { ...c.personality, arc: newArc }, relations: newRelations }
          })

          // 替换章节正文、标题、场景、历史版本
          const updatedChapters = work.chapters.map((ch) => ({
            ...ch,
            title: replace(ch.title),
            content: replace(ch.content),
            scenes: ch.scenes.map((s) => ({
              ...s,
              title: replace(s.title),
              summary: replace(s.summary),
              content: replace(s.content),
            })),
            versions: ch.versions.map((v) => ({
              ...v,
              content: replace(v.content),
              note: v.note ? replace(v.note) : v.note,
            })),
          }))

          // 替换故事种子核心概念
          const updatedSeed = {
            ...work.seed,
            coreConcept: replace(work.seed.coreConcept),
          }

          // 替换大纲节点标题和简述
          const updatedOutline = work.outline.map((n) => ({
            ...n,
            title: replace(n.title),
            summary: replace(n.summary),
          }))

          // 替换设定内容
          const updatedSettings = work.settings.map((s) => ({
            ...s,
            title: replace(s.title),
            content: replace(s.content),
          }))

          // 替换约束描述
          const updatedConstraints = work.constraints.map((c) => ({
            ...c,
            title: replace(c.title),
            description: replace(c.description),
          }))

          // 替换故事线描述
          const updatedStorylines = work.storylines.map((s) => ({
            ...s,
            name: replace(s.name),
            description: replace(s.description),
            chapterLinks: s.chapterLinks.map((cl) => ({
              ...cl,
              description: replace(cl.description),
            })),
          }))

          if (replacedCount > 0) {
            await db.works.update(work.id, {
              seed: updatedSeed,
              characters: updatedCharacters,
              chapters: updatedChapters,
              outline: updatedOutline,
              settings: updatedSettings,
              constraints: updatedConstraints,
              storylines: updatedStorylines,
            })
            useStore.getState().setCurrentWork({
              ...work,
              seed: updatedSeed,
              characters: updatedCharacters,
              chapters: updatedChapters,
              outline: updatedOutline,
              settings: updatedSettings,
              constraints: updatedConstraints,
              storylines: updatedStorylines,
              updatedAt: Date.now(),
            })
            message.success(`已将「${oldName}」批量替换为「${newName}」，涉及 ${replacedCount} 处`)
          }
        }
      }
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

                  {char.personality.traits.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>性格特质</Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {char.personality.traits.map((t) => (
                          <Tag key={t}>{t}</Tag>
                        ))}
                      </div>
                    </div>
                  )}
                  {char.personality.habits.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>行为习惯</Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {char.personality.habits.map((h) => (
                          <Tag key={h} color="default">{h}</Tag>
                        ))}
                      </div>
                    </div>
                  )}
                  {char.personality.arc.length > 0 && (
                    <Collapse
                      ghost
                      defaultActiveKey={['arc']}
                      items={[
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
                      ]}
                    />
                  )}
                </Card>
              )
            })}
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
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="bio" label="经历背景">
            <TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
          </Form.Item>
          <Form.Item name="traits" label="性格特质">
            <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={['、', ',']} />
          </Form.Item>
          <Form.Item name="habits" label="行为习惯">
            <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={['、', ',']} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={['、', ',']} />
          </Form.Item>

          {/* 性格弧线编辑 */}
          <Form.Item label="性格弧线">
            {editArc.map((a, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Input
                    placeholder="阶段名称"
                    value={a.stage}
                    onChange={(e) => {
                      const updated = [...editArc]
                      updated[i] = { ...updated[i], stage: e.target.value }
                      setEditArc(updated)
                    }}
                    style={{ flex: 1 }}
                  />
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setEditArc(editArc.filter((_, j) => j !== i))} />
                </div>
                <Input.TextArea
                  placeholder="该阶段的性格状态描述"
                  value={a.description}
                  onChange={(e) => {
                    const updated = [...editArc]
                    updated[i] = { ...updated[i], description: e.target.value }
                    setEditArc(updated)
                  }}
                  autoSize={{ minRows: 1, maxRows: 3 }}
                />
                <Input
                  placeholder="触发转变的事件（可选）"
                  value={a.trigger || ''}
                  onChange={(e) => {
                    const updated = [...editArc]
                    updated[i] = { ...updated[i], trigger: e.target.value || undefined }
                    setEditArc(updated)
                  }}
                />
              </div>
            ))}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => setEditArc([...editArc, { stage: '', description: '' }])} block>
              添加阶段
            </Button>
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
