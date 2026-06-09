import { useState } from 'react'
import {
  Form,
  Input,
  Select,
  Tag,
  Button,
  Space,
  Typography,
  Divider,
  Spin,
  message,
  Tooltip,
} from 'antd'
import { PlusOutlined, ReloadOutlined, ExperimentOutlined } from '@ant-design/icons'
import type { StorySeed } from '@/core/types'
import { TIME_PERIODS, TIME_PERIOD_GROUPS, REGIONS, REGION_GROUPS, GENRES, TONES, POVS, AUDIENCES } from '@/features/seed/options'
import { useSystemConfigStore } from '@/core/system-config-store'
import { useStore } from '@/core/store'
import { generateStream } from '@/ai/client'
import { CORE_CONCEPT_SYSTEM_PROMPT, buildCoreConceptPolishPrompt, buildCoreConceptGeneratePrompt } from '@/ai/prompts/seed'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input

// 分组标签选择器（选中后自动折叠）
function TagSelect({
  value,
  groups,
  onChange,
  multiple = false,
  placeholder = '自定义',
}: {
  value: string | string[]
  groups: { group: string; items: string[] }[]
  onChange: (v: any) => void
  multiple?: boolean
  placeholder?: string
}) {
  const [expanded, setExpanded] = useState(true)
  const [customMode, setCustomMode] = useState(false)
  const [customValue, setCustomValue] = useState('')

  const hasValue = multiple
    ? Array.isArray(value) && value.length > 0
    : !!value

  const submitCustom = () => {
    const trimmed = customValue.trim()
    if (!trimmed) { setCustomMode(false); setCustomValue(''); return }
    if (multiple) {
      const arr = Array.isArray(value) ? value : []
      onChange([...arr, trimmed])
    } else {
      onChange(trimmed)
      setExpanded(false)
    }
    setCustomValue('')
    setCustomMode(false)
  }

  // 折叠态：只显示已选
  if (hasValue && !expanded && !customMode) {
    const selected = multiple ? (value as string[]) : [value as string]
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
        {selected.map((v) => (
          <Tag
            key={v}
            color="blue"
            closable
            onClose={() => {
              if (multiple) {
                onChange((value as string[]).filter((x) => x !== v))
              } else {
                onChange('')
              }
            }}
            style={{ margin: 0 }}
          >
            {v}
          </Tag>
        ))}
        <Tag
          style={{ cursor: 'pointer', borderStyle: 'dashed', margin: 0 }}
          onClick={() => setExpanded(true)}
        >
          修改
        </Tag>
      </div>
    )
  }

  // 展开态：显示全部选项
  const allPresets = new Set(groups.flatMap((g) => g.items))
  const customValues = multiple
    ? (value as string[]).filter((v) => !allPresets.has(v))
    : (!allPresets.has(value as string) && value ? [value as string] : [])

  return (
    <div style={{ padding: '12px 12px 8px', background: '#fafafa', borderRadius: 6 }}>
      {/* 自定义值（非预设） */}
      {customValues.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {customValues.map((v) => (
            <Tag
              key={v}
              color="blue"
              closable
              onClose={() => {
                if (multiple) {
                  onChange((value as string[]).filter((x) => x !== v))
                } else {
                  onChange('')
                }
              }}
              style={{ margin: 0 }}
            >
              {v}
            </Tag>
          ))}
        </div>
      )}
      {hasValue && (
        <div style={{ marginBottom: 8 }}>
          <a style={{ fontSize: 12 }} onClick={() => { setExpanded(false); setCustomMode(false) }}>
            收起
          </a>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.group} style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            {g.group}
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {g.items.map((item) => {
              const selected = multiple
                ? (value as string[]).includes(item)
                : value === item
              return (
                <Tag
                  key={item}
                  color={selected ? 'blue' : undefined}
                  style={{ cursor: 'pointer', margin: 0 }}
                  onClick={() => {
                    if (multiple) {
                      const arr = Array.isArray(value) ? value : []
                      onChange(selected ? arr.filter((x) => x !== item) : [...arr, item])
                    } else {
                      onChange(selected ? '' : item)
                      if (!selected) setExpanded(false)
                    }
                  }}
                >
                  {item}
                </Tag>
              )
            })}
          </div>
        </div>
      ))}
      {/* 自定义输入 */}
      {customMode ? (
        <Input
          size="small"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          placeholder={`输入${placeholder}，回车确认`}
          onPressEnter={submitCustom}
          onBlur={submitCustom}
          style={{ width: 200, marginTop: 4 }}
          autoFocus
        />
      ) : (
        <Tag
          style={{ cursor: 'pointer', borderStyle: 'dashed', marginTop: 4 }}
          onClick={() => setCustomMode(true)}
        >
          + 自定义
        </Tag>
      )}
    </div>
  )
}

// 通用：支持选择 + 自定义输入的 Select
function CreatableSelect({
  value,
  presets,
  placeholder,
  onChange,
  allowClear = false,
  multiple = false,
}: {
  value: string | string[] | undefined
  presets: string[]
  placeholder: string
  onChange: (v: any) => void
  allowClear?: boolean
  multiple?: boolean
}) {
  const [search, setSearch] = useState('')
  const presetSet = new Set(presets)
  const hasMatch = presets.some((p) => p.includes(search))
  const showCustom = search && !hasMatch && !presetSet.has(search)

  const options = presets.map((t) => ({ label: t, value: t }))

  // 回车添加自定义值
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && showCustom) {
      e.preventDefault()
      if (multiple) {
        const arr = Array.isArray(value) ? value : []
        if (!arr.includes(search)) onChange([...arr, search])
      } else {
        onChange(search)
      }
      setSearch('')
    }
  }

  const dropdownRender = (menu: React.ReactNode) => (
    <>
      {menu}
      {showCustom && (
        <>
          <Divider style={{ margin: '4px 0' }} />
          <div
            style={{ padding: '4px 8px', cursor: 'pointer', color: '#1677ff' }}
            onMouseDown={(e) => {
              e.preventDefault()
              if (multiple) {
                const arr = Array.isArray(value) ? value : []
                if (!arr.includes(search)) onChange([...arr, search])
              } else {
                onChange(search)
              }
              setSearch('')
            }}
          >
            <PlusOutlined style={{ marginRight: 4 }} />
            添加「{search}」
          </div>
        </>
      )}
    </>
  )

  return multiple ? (
    <Select
      mode="multiple"
      value={value as string[]}
      placeholder={placeholder}
      onChange={onChange}
      options={options}
      showSearch
      searchValue={search}
      onSearch={setSearch}
      popupRender={dropdownRender}
      onKeyDown={handleKeyDown}
      tagRender={({ label, closable, onClose }) => (
        <Tag closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>
          {label}
        </Tag>
      )}
    />
  ) : (
    <Select
      value={(value as string) || undefined}
      placeholder={placeholder}
      onChange={onChange}
      options={options}
      showSearch
      searchValue={search}
      onSearch={setSearch}
      popupRender={dropdownRender}
      onKeyDown={handleKeyDown}
      allowClear={allowClear}
      filterOption={(input, option) =>
        (option?.label as string)?.includes(input)
      }
    />
  )
}

interface Props {
  seed: StorySeed
  onUpdate: (patch: Partial<StorySeed>) => void
  workTitle: string
  onTitleChange: (v: string) => void
  onFinish: () => void
  loading: boolean
  setLoading: (v: boolean) => void
}

export default function BasicInfoStep({ seed, onUpdate, workTitle, onTitleChange, onFinish, loading, setLoading }: Props) {
  const currentGenre = GENRES.find((g) => g.value === seed.genre)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)

  // AI 润色/生成核心概念
  const handleAICoreConcept = async () => {
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI API Key')
      return
    }

    const setAIStream = useStore.getState().setAIStream
    setLoading(true)
    setAIStream(true, '')
    try {
      // 构建种子信息（不含 coreConcept 本身）
      const seedForAI = {
        timePeriod: seed.timePeriod,
        regions: seed.regions,
        genre: seed.genre,
        subGenre: seed.subGenre,
        tone: seed.tone,
        targetAudience: seed.targetAudience,
      }

      const hasConcept = seed.coreConcept.trim().length > 0
      const prompt = hasConcept
        ? buildCoreConceptPolishPrompt(seed.coreConcept, seedForAI)
        : buildCoreConceptGeneratePrompt(seedForAI)

      const text = await generateStream(prompt, CORE_CONCEPT_SYSTEM_PROMPT, aiConfig, (_chunk, fullText) => {
        setAIStream(true, fullText)
      })

      // 清理返回文本（去掉引号、多余换行等）
      const cleaned = text.replace(/^["'"']|["'"']$/g, '').trim()
      onUpdate({ coreConcept: cleaned })
      setAIStream(false, text)
      message.success(hasConcept ? '核心概念已润色' : '核心概念已生成')
    } catch (err: any) {
      message.error(`生成失败：${err.message}`)
      setAIStream(false, `生成失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 随机构建：全量随机
  const handleRandomAll = () => {
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
    const pickN = <T,>(arr: T[], n: number): T[] => {
      const shuffled = [...arr].sort(() => Math.random() - 0.5)
      return shuffled.slice(0, n)
    }
    const genre = pick(GENRES)

    onUpdate({
      timePeriod: pick(TIME_PERIODS),
      regions: pickN(REGIONS, Math.random() > 0.5 ? 2 : 1),
      genre: genre.value,
      subGenre: pick(genre.sub),
      tone: pick(TONES),
      targetAudience: pick(AUDIENCES),
      pov: pick(POVS).value,
      coreConcept: '',
    })
    message.success('已随机生成，请检查并补充核心概念')
  }

  const canProceed = seed.timePeriod && seed.genre && seed.tone

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Title level={4} style={{ margin: 0 }}>基础信息</Title>
        <Space>
          <Tooltip title="全量随机生成所有字段">
            <Button icon={<ReloadOutlined />} onClick={handleRandomAll}>
              随机构建
            </Button>
          </Tooltip>
          {/* TODO: AI 接入后启用灵感补全
          <Tooltip title="根据你已选的要素，智能补全其余字段">
            <Button icon={<BulbOutlined />} onClick={handleInspiredFill} loading={loading}>
              灵感补全
            </Button>
          </Tooltip>
          */}
        </Space>
      </div>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        所有字段均支持从列表选择或自行输入，也可先选定部分要素再用「灵感补全」补全
      </Paragraph>

      <Spin spinning={loading}>
        <Form layout="vertical">
          <Form.Item label="作品名称（暂定）">
            <Input
              value={workTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="为你的作品起个名字，可后续修改"
              maxLength={50}
            />
          </Form.Item>

          <Divider />

          <Form.Item label="时间背景" required>
            <TagSelect
              value={seed.timePeriod}
              groups={TIME_PERIOD_GROUPS}
              onChange={(v) => onUpdate({ timePeriod: v })}
              placeholder="时间背景"
            />
          </Form.Item>

          <Form.Item label="地域范围" required>
            <TagSelect
              value={seed.regions}
              groups={REGION_GROUPS}
              onChange={(v) => onUpdate({ regions: v })}
              multiple
              placeholder="地域"
            />
          </Form.Item>

          <Form.Item label="故事类型" required>
            <Space>
              <Select
                value={seed.genre || undefined}
                placeholder="主类型"
                onChange={(v) => {
                  const genre = GENRES.find((g) => g.value === v)
                  onUpdate({ genre: v, subGenre: genre?.sub[0] || '' })
                }}
                options={GENRES.map((g) => ({ label: g.value, value: g.value }))}
                style={{ width: 160 }}
              />
              {currentGenre && (
                <Select
                  value={seed.subGenre || undefined}
                  placeholder="子类型"
                  onChange={(v) => onUpdate({ subGenre: v })}
                  options={currentGenre.sub.map((s) => ({ label: s, value: s }))}
                  style={{ width: 160 }}
                />
              )}
            </Space>
          </Form.Item>

          <Form.Item label="基调风格">
            <CreatableSelect
              value={seed.tone}
              presets={TONES}
              placeholder="选择或输入基调风格"
              onChange={(v) => onUpdate({ tone: v })}
              allowClear
            />
          </Form.Item>

          <Form.Item label="目标读者">
            <CreatableSelect
              value={seed.targetAudience}
              presets={AUDIENCES}
              placeholder="选择或输入目标读者"
              onChange={(v) => onUpdate({ targetAudience: v })}
              allowClear
            />
          </Form.Item>

          <Form.Item label="叙述视角">
            <Space orientation="vertical" size={4} style={{ width: '100%' }}>
              {POVS.map((p) => (
                <Tag
                  key={p.value}
                  color={seed.pov === p.value ? 'blue' : undefined}
                  style={{ cursor: 'pointer', margin: 0 }}
                  onClick={() => onUpdate({ pov: seed.pov === p.value ? '' : p.value })}
                >
                  {p.value}
                </Tag>
              ))}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {POVS.find((p) => p.value === seed.pov)?.desc || ''}
              </Text>
            </Space>
          </Form.Item>

          <Divider />

          <Form.Item
            label={
              <span>
                核心概念{' '}
                <Tooltip title={seed.coreConcept.trim() ? 'AI 润色当前概念' : '根据其他信息 AI 生成概念'}>
                  <Button
                    type="link"
                    size="small"
                    icon={<ExperimentOutlined />}
                    onClick={handleAICoreConcept}
                    loading={loading}
                    style={{ padding: 0, verticalAlign: 'baseline' }}
                  >
                    AI 润色
                  </Button>
                </Tooltip>
              </span>
            }
            required
          >
            <TextArea
              value={seed.coreConcept}
              onChange={(e) => onUpdate({ coreConcept: e.target.value })}
              placeholder="用一句话概括故事的核心卖点，例如：修仙界的食物链顶端是厨子"
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={200}
              showCount
            />
          </Form.Item>
        </Form>
      </Spin>

      <div style={{ textAlign: 'right', marginTop: 24 }}>
        <Button type="primary" onClick={onFinish} disabled={!canProceed}>
          保存并进入世界构建
        </Button>
      </div>
    </div>
  )
}
