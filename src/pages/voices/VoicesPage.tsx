import { useState } from 'react'
import { Button, Card, Checkbox, Empty, Flex, Form, Input, Popconfirm, Space, Spin, Tag, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import { CustomerServiceOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, UploadOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router'
import { useUserVoices } from '@/features/audiobook/useUserVoices'
import { voiceboxClient } from '@/features/audiobook/voiceboxClient'

const { Title, Text, Paragraph } = Typography

export default function VoicesPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { voices, loading, saving, createVoice, renameVoice, removeVoice } = useUserVoices()
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const returnTo = params.get('returnTo')

  const handleCreate = async () => {
    const values = await form.validateFields()
    const file = fileList[0]?.originFileObj
    if (!file) {
      message.warning('请先选择参考音频')
      return
    }
    const voice = await createVoice({
      displayName: values.displayName,
      referenceText: values.referenceText,
      consentConfirmed: values.consentConfirmed,
      file,
    })
    form.resetFields()
    setFileList([])
    if (returnTo) {
      const target = new URL(returnTo, window.location.origin)
      target.searchParams.set('soundId', voice.id)
      const characterId = params.get('characterId')
      if (characterId) target.searchParams.set('characterId', characterId)
      navigate(`${target.pathname}${target.search}`)
    }
  }

  const playSample = async (voiceId: string, sampleId: string) => {
    setPlayingId(voiceId)
    try {
      const url = await voiceboxClient.fetchMediaUrl(voiceboxClient.sampleUrl(sampleId))
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '试听失败'
      message.error(errMsg)
    } finally {
      setPlayingId(null)
    }
  }

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }} align="center">
        <Title level={4} style={{ margin: 0 }}><CustomerServiceOutlined /> 声音管理</Title>
        {returnTo && <Button onClick={() => navigate(returnTo)}>返回章节</Button>}
      </Space>

      <Card title="添加自己的声音" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="displayName" label="音色名称" rules={[{ required: true, message: '请填写音色名称' }]}>
            <Input placeholder="例如：我的旁白声" />
          </Form.Item>
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>参考音频 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <Upload beforeUpload={() => false} maxCount={1} fileList={fileList} accept="audio/*" onChange={({ fileList: next }) => setFileList(next)}>
              <Button icon={<UploadOutlined />}>选择音频文件</Button>
            </Upload>
          </div>
          <Form.Item name="referenceText" label="参考音频文本" rules={[{ required: true, message: '请填写参考音频对应文本' }]}>
            <Input.TextArea rows={3} placeholder="逐字填写参考音频中说出的内容，便于 QwenTTS 克隆音色" />
          </Form.Item>
          <Form.Item name="consentConfirmed" valuePropName="checked" rules={[{ validator: (_, checked) => checked ? Promise.resolve() : Promise.reject(new Error('请确认声音授权')) }]}>
            <Checkbox>我确认这是自己的声音，或已获得该声音权利人的授权</Checkbox>
          </Form.Item>
          <Button type="primary" loading={saving} onClick={handleCreate}>上传到 Voicebox 并保存</Button>
        </Form>
      </Card>

      <Card title="我的声音">
        {loading ? <Spin /> : voices.length === 0 ? <Empty description="暂无声音，先上传一个参考音频" /> : (
          <Flex vertical>
            {voices.map((voice) => (
              <div key={voice.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {editingId === voice.id ? <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} /> : <Space>{voice.displayName}<Tag color="blue">自建</Tag></Space>}
                  </div>
                  <Space orientation="vertical" size={2} style={{ marginTop: 4 }}>
                    <Text type="secondary">Voicebox profile: {voice.profileName || voice.profileId}</Text>
                    <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0 }}>参考文本：{voice.referenceText}</Paragraph>
                  </Space>
                </div>
                <Space style={{ flexShrink: 0, marginLeft: 12 }}>
                  {voice.sampleId ? <Button type="link" icon={<PlayCircleOutlined />} loading={playingId === voice.id} onClick={() => playSample(voice.id, voice.sampleId!)}>试听</Button> : <Tag>无样本</Tag>}
                  {editingId === voice.id ? <Button type="link" onClick={() => { void renameVoice(voice.id, editingName); setEditingId(null) }}>保存</Button> : <Button type="link" icon={<EditOutlined />} onClick={() => { setEditingId(voice.id); setEditingName(voice.displayName) }}>重命名</Button>}
                  <Popconfirm title="删除后，引用该声音的章节需要重新选择音色" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeVoice(voice.id)}>
                    <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              </div>
            ))}
          </Flex>
        )}
      </Card>
    </div>
  )
}
