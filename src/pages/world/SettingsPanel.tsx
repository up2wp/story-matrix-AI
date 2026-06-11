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
} from '@ant-design/icons'
import { useState } from 'react'
import type { Setting } from '@/core/types'
import { generateId } from '@/utils/id'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { generateStream } from '@/ai/client'
import { seedContext, worldContext } from '@/ai/context'
import { WORLD_SYSTEM_PROMPT, buildWorldviewPrompt, SETTING_POLISH_SYSTEM_PROMPT, buildSettingPolishPrompt } from '@/ai/prompts/world'

const { Text, Paragraph } = Typography
const { TextArea } = Input

const CATEGORIES = [
  { value: 'world', label: '世界总览', color: 'blue' },
  { value: 'geography', label: '地理', color: 'green' },
  { value: 'politics', label: '政治', color: 'red' },
  { value: 'magic', label: '魔法/力量体系', color: 'purple' },
  { value: 'tech', label: '科技', color: 'cyan' },
  { value: 'culture', label: '文化', color: 'orange' },
  { value: 'economy', label: '经济', color: 'gold' },
  { value: 'history', label: '历史', color: 'geekblue' },
  { value: 'species', label: '种族/生物', color: 'magenta' },
]

interface Props {
  wb: ReturnType<typeof import('@/features/world/useWorldBuilder').useWorldBuilder>
}

export default function SettingsPanel({ wb }: Props) {
  const readOnly = useStore((s) => s.readOnly)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editing, setEditing] = useState<Setting | null>(null)
  const [form] = Form.useForm()
  const [polishing, setPolishing] = useState(false)

  const settings = wb.currentWork?.settings ?? []

  // AI 随机生成世界观设定（流式输出到 AI 面板）
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
      const prompt = buildWorldviewPrompt(seedContext(work))
      const text = await generateStream(prompt, WORLD_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      // 解析 AI 返回的 JSON（兼容 markdown 代码块）
      let jsonStr = text
      // 尝试提取 ```json ... ``` 中的内容
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1]
      }
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.error('AI 返回内容：', text)
        message.error('AI 返回格式异常，请重试')
        setAIStream(false, '生成失败：返回格式异常')
        return
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        category: string
        title: string
        content: string
      }>

      const generated: Setting[] = parsed.map((item) => ({
        id: generateId(),
        category: CATEGORIES.some((c) => c.value === item.category) ? item.category : 'world',
        title: item.title,
        content: item.content,
        relatedSettingIds: [],
        relatedCharacterIds: [],
      }))

      await wb.setSettings([...settings, ...generated])
      setAIStream(false, text)
      message.success(`已生成 ${generated.length} 条世界观设定`)
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      wb.setLoading(false)
    }
  }

  // AI 润色当前编辑的设定
  const handleAIPolish = async () => {
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }
    if (!editing) return

    const values = form.getFieldsValue()
    const currentSetting = {
      category: values.category || editing.category,
      title: values.title || editing.title,
      content: values.content || editing.content,
    }

    if (!currentSetting.content.trim()) {
      message.warning('请先填写设定内容再润色')
      return
    }

    const setAIStream = useStore.getState().setAIStream
    setPolishing(true)
    setAIStream(true, '')
    try {
      const work = wb.currentWork!
      const prompt = buildSettingPolishPrompt(
        currentSetting,
        worldContext(work),
      )
      const text = await generateStream(prompt, SETTING_POLISH_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
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
        title: parsed.title || currentSetting.title,
        content: parsed.content || currentSetting.content,
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

  // 打开编辑弹窗
  const openEdit = (setting: Setting) => {
    setEditing(setting)
    form.setFieldsValue(setting)
    setEditModalOpen(true)
  }

  // 保存编辑
  const handleSave = async () => {
    const values = form.getFieldsValue()
    if (editing) {
      await wb.updateSetting(editing.id, values)
    }
    setEditModalOpen(false)
    setEditing(null)
  }

  // 新增设定
  const handleAdd = () => {
    const newSetting: Setting = {
      id: generateId(),
      category: 'world',
      title: '新设定',
      content: '',
      relatedSettingIds: [],
      relatedCharacterIds: [],
    }
    setEditing(newSetting)
    form.setFieldsValue(newSetting)
    setEditModalOpen(true)
  }

  // 保存新增
  const handleSaveNew = async () => {
    const values = form.getFieldsValue()
    if (editing && !settings.find((s) => s.id === editing.id)) {
      await wb.addSetting({ ...editing, ...values })
    }
    setEditModalOpen(false)
    setEditing(null)
  }

  const getCategoryInfo = (cat: string) =>
    CATEGORIES.find((c) => c.value === cat) || { label: cat, color: 'default' }

  return (
    <div>
      {!readOnly && (
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button icon={<PlusOutlined />} onClick={handleAdd}>手动新增</Button>
            <Button icon={<ExperimentOutlined />} onClick={handleAIGenerate} loading={wb.loading}>
              AI 随机生成
            </Button>
            {settings.length > 0 && (
              <Popconfirm title="确定清空所有世界观设定？" onConfirm={() => wb.setSettings([])} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}
                onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
              >
                <Button danger>清空世界观</Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      )}

      <Spin spinning={wb.loading}>
        {settings.length === 0 && !wb.loading ? (
          <Empty description="暂无设定，可手动新增或让 AI 随机生成" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {settings.map((setting) => {
              const cat = getCategoryInfo(setting.category)
              return (
                <Card key={setting.id} size="small">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <Space style={{ marginBottom: 8 }}>
                        <Tag color={cat.color}>{cat.label}</Tag>
                        <Text strong>{setting.title}</Text>
                      </Space>
                      <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {setting.content}
                      </Paragraph>
                    </div>
                    {!readOnly && (
                      <Space>
                        <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(setting)} />
                        <Popconfirm title="确定删除？" onConfirm={() => wb.removeSetting(setting.id)} okButtonProps={{ autoFocus: true }}
                          onOpenChange={(open) => { if (open) setTimeout(() => { (document.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement | null)?.focus() }, 100) }}
                        >
                          <Button type="text" danger icon={<DeleteOutlined />} />
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
        title={settings.find((s) => s.id === editing?.id) ? '编辑设定' : '新增设定'}
        open={editModalOpen}
        forceRender
        mask={{ closable: false }}
        onOk={settings.find((s) => s.id === editing?.id) ? handleSave : handleSaveNew}
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
          <Form.Item name="category" label="分类">
            <Select options={CATEGORIES.map((c) => ({ label: c.label, value: c.value }))} />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <TextArea autoSize={{ minRows: 4, maxRows: 12 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
