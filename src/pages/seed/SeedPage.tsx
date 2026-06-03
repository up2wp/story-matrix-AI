import { Card, Tag, Typography, Descriptions } from 'antd'
import BasicInfoStep from './BasicInfoStep'
import { useSeedWizard } from '@/features/seed/useSeedWizard'
import { useStore } from '@/core/store'

const { Title, Paragraph } = Typography

export default function SeedPage() {
  const w = useSeedWizard()
  const readOnly = useStore((s) => s.readOnly)
  const currentWork = useStore((s) => s.currentWork)

  // 只读模式：显示种子数据摘要
  if (readOnly && currentWork) {
    const { seed } = currentWork
    return (
      <div>
        <Title level={3} style={{ marginBottom: 24 }}>故事萌芽</Title>
        <Card title="基础信息">
          <Descriptions column={2} size="small">
            <Descriptions.Item label="时间背景">{seed.timePeriod || '-'}</Descriptions.Item>
            <Descriptions.Item label="地域范围">{seed.regions.join('、') || '-'}</Descriptions.Item>
            <Descriptions.Item label="主类型">{seed.genre || '-'}</Descriptions.Item>
            <Descriptions.Item label="子类型">{seed.subGenre || '-'}</Descriptions.Item>
            <Descriptions.Item label="基调风格">{seed.tone || '-'}</Descriptions.Item>
            <Descriptions.Item label="目标读者">{seed.targetAudience || '-'}</Descriptions.Item>
          </Descriptions>
          {seed.coreConcept && (
            <div style={{ marginTop: 8 }}>
              <Tag color="blue">核心概念</Tag>
              <Paragraph style={{ margin: '4px 0 0' }}>{seed.coreConcept}</Paragraph>
            </div>
          )}
        </Card>
      </div>
    )
  }

  return (
    <BasicInfoStep
      seed={w.seed}
      onUpdate={w.updateSeed}
      workTitle={w.workTitle}
      onTitleChange={w.setWorkTitle}
      onFinish={w.finishWizard}
      loading={w.loading}
      setLoading={w.setLoading}
    />
  )
}
