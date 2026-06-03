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
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { StorySeed } from '@/core/types'
import { TIME_PERIODS, REGIONS, GENRES, TONES, AUDIENCES } from '@/features/seed/options'

const { Title, Paragraph } = Typography
const { TextArea } = Input

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
      coreConcept: '',
    })
    message.success('已随机生成，请检查并补充核心概念')
  }

  // 灵感补全：基于已填内容智能补全空字段
  const handleInspiredFill = async () => {
    const hasAny = seed.timePeriod || seed.genre || seed.tone || seed.regions.length > 0
    if (!hasAny) {
      message.info('请先选择至少一个要素，系统会根据你的选择补全其余内容')
      return
    }

    setLoading(true)
    // TODO: 接入 AI 生成，当前用本地规则兜底
    await new Promise((r) => setTimeout(r, 600))

    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
    const genre = seed.genre || pick(GENRES).value
    const genreObj = GENRES.find((g) => g.value === genre)!

    const patch: Partial<StorySeed> = {}
    if (!seed.timePeriod) patch.timePeriod = pick(TIME_PERIODS)
    if (!seed.regions.length) patch.regions = [pick(REGIONS)]
    if (!seed.genre) patch.genre = genre
    if (!seed.subGenre) patch.subGenre = pick(genreObj.sub)
    if (!seed.tone) patch.tone = pick(TONES)
    if (!seed.targetAudience) patch.targetAudience = pick(AUDIENCES)
    if (!seed.coreConcept) {
      const time = seed.timePeriod || patch.timePeriod || '这个世界'
      const region = seed.regions[0] || patch.regions?.[0] || '某地'
      const g = genre
      const tone = seed.tone || patch.tone || ''
      patch.coreConcept = pick([
        `${time}，${region}的${g}世界里，一段${tone}的冒险即将展开`,
        `在${region}，一个关于${g}的${tone}故事`,
        `当${tone}遇上${time}的${g}世界`,
      ])
    }

    onUpdate(patch)
    setLoading(false)
    message.success('已根据你的选择补全信息')
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
            <CreatableSelect
              value={seed.timePeriod}
              presets={TIME_PERIODS}
              placeholder="选择或输入时间背景"
              onChange={(v) => onUpdate({ timePeriod: v })}
              allowClear
            />
          </Form.Item>

          <Form.Item label="地域范围" required>
            <CreatableSelect
              value={seed.regions}
              presets={REGIONS}
              placeholder="选择或输入地域"
              onChange={(v) => onUpdate({ regions: v })}
              multiple
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

          <Divider />

          <Form.Item label="核心概念" required>
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
