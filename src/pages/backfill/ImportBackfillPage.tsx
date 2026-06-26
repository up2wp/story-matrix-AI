import { Alert, Button, Card, Collapse, Empty, List, Radio, Space, Tag, Typography } from 'antd'
import { CheckOutlined, CloseOutlined, ExperimentOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { BACKFILL_TASKS, BACKFILL_TASK_LABELS, useImportBackfill } from '@/features/backfill/useImportBackfill'
import { formatBackfillImpact } from '@/features/backfill/applyBackfill'
import type { BackfillCandidate } from '@/features/backfill/types'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'

const { Title, Paragraph, Text } = Typography

function candidateDescription(candidate: BackfillCandidate) {
  if (candidate.task === 'chapterSummary') return candidate.value.summary
  if (candidate.task === 'characters') return `${candidate.value.name}：${candidate.value.bio || candidate.value.traits.join('、') || '待核对人物信息'}`
  if (candidate.task === 'settings') return `${candidate.value.title}：${candidate.value.content}`
  if (candidate.task === 'constraints') return `${candidate.value.title}：${candidate.value.description}`
  if (candidate.task === 'storylines') return `${candidate.value.name}：${candidate.value.description}`
  return `${candidate.value.field}：${Array.isArray(candidate.value.value) ? candidate.value.value.join('、') : candidate.value.value}`
}

function evidenceColor(candidate: BackfillCandidate) {
  if (candidate.evidenceLabel === '证据充分') return 'green'
  if (candidate.evidenceLabel === '存在冲突') return 'red'
  return 'orange'
}

export default function ImportBackfillPage() {
  const user = useAuthStore(s => s.user)
  const canUseFeature = useSystemConfigStore(s => s.canUseFeature)
  const {
    currentWork,
    task,
    setTask,
    candidates,
    errors,
    running,
    saving,
    windowResult,
    acceptedCandidates,
    impact,
    setCandidateStatus,
    acceptStrongEvidence,
    runExtraction,
    confirmWrite,
  } = useImportBackfill()

  if (!currentWork) {
    return <Empty description="请先从作品列表打开一个作品" />
  }

  if (!canUseFeature(user, 'importBackfill')) {
    return <Alert type="warning" showIcon message="暂无阶段反推权限" description="请联系管理员在系统管理中为你的账号开启导入后阶段反推功能。" />
  }

  const canRun = windowResult.windows.length > 0
  const impactText = impact ? formatBackfillImpact(impact) : '正文 0 处修改'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>阶段反推</Title>
          <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
            AI 只读取已导入正文的小段摘录，提出候选建议；未确认的建议不会写入作品，章节正文不会被修改。
          </Paragraph>
        </div>
        <Tag color="blue" icon={<SafetyCertificateOutlined />}>确认写入前不保存候选</Tag>
      </div>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="先选择一个创作任务"
          description={`本次将从 ${windowResult.windows.length} 个正文小窗口提取建议。${windowResult.skipped.length ? `有 ${windowResult.skipped.length} 章因无正文跳过。` : '不会一次发送整章或整本小说。'}`}
        />

        {!canRun && (
          <Alert type="warning" showIcon message="暂不能阶段反推" description="当前作品没有可用于反推的章节正文。请先完成正文导入并确认章节内容。" />
        )}

        <Card size="small">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Radio.Group value={task} onChange={(event) => setTask(event.target.value)} optionType="button" buttonStyle="solid">
              {BACKFILL_TASKS.map(item => <Radio.Button key={item.value} value={item.value}>{item.label}</Radio.Button>)}
            </Radio.Group>
            <Space wrap>
              <Button type="primary" icon={<ExperimentOutlined />} loading={running} disabled={!canRun} onClick={runExtraction}>
                开始提取候选
              </Button>
              <Button disabled={!candidates.some(candidate => candidate.evidenceLabel === '证据充分')} onClick={acceptStrongEvidence}>
                全选证据充分项
              </Button>
              <Text type="secondary">当前任务：{BACKFILL_TASK_LABELS[task]}，确认前正文 0 处修改</Text>
            </Space>
          </Space>
        </Card>

        {errors.length > 0 && (
          <Alert type="warning" showIcon message="部分候选需要重新提取" description={errors.join('；')} />
        )}

        <Card
          title="候选建议"
          extra={<Text type="secondary">已接受 {acceptedCandidates.length} 条，{impactText}</Text>}
        >
          {candidates.length === 0 ? (
            <Empty description="暂无候选建议。选择任务后点击开始提取。" />
          ) : (
            <List
              dataSource={candidates}
              renderItem={(candidate) => (
                <List.Item>
                  <Card size="small" style={{ width: '100%' }}>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      <Space wrap>
                        <Text strong>{candidate.title}</Text>
                        <Tag color={evidenceColor(candidate)}>{candidate.evidenceLabel}</Tag>
                        <Tag>{candidate.reviewStatus === 'accepted' ? '已接受' : candidate.reviewStatus === 'ignored' ? '已忽略' : '建议'}</Tag>
                        <Text type="secondary">来源：{candidate.sources[0]?.chapterTitle || '未知章节'}</Text>
                      </Space>
                      <Paragraph style={{ margin: 0 }}>{candidateDescription(candidate)}</Paragraph>
                      <Space wrap>
                        <Button size="small" type={candidate.reviewStatus === 'accepted' ? 'primary' : 'default'} icon={<CheckOutlined />} onClick={() => setCandidateStatus(candidate.id, 'accepted')}>
                          接受
                        </Button>
                        <Button size="small" icon={<CloseOutlined />} onClick={() => setCandidateStatus(candidate.id, 'ignored')}>
                          忽略
                        </Button>
                      </Space>
                      <Collapse
                        size="small"
                        ghost
                        items={[{
                          key: 'source',
                          label: `查看来源摘录（来自 ${candidate.sources.length} 处正文）`,
                          children: (
                            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                              {candidate.conflictReason && <Alert type="warning" showIcon message="存在冲突" description={candidate.conflictReason} />}
                              {candidate.replacementWarning && <Alert type="warning" showIcon message="可能替换已有内容" description={candidate.replacementWarning} />}
                              {candidate.sources.map((source, index) => (
                                <Card key={`${source.chapterId}-${source.windowIndex}-${index}`} size="small" type="inner" title={source.chapterTitle}>
                                  <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{source.excerpt || '缺少可核对来源，需人工确认'}</Paragraph>
                                </Card>
                              ))}
                            </Space>
                          ),
                        }]}
                      />
                    </Space>
                  </Card>
                </List.Item>
              )}
            />
          )}
        </Card>

        <Card size="small">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>写入影响：{impactText}</Text>
            <Text type="secondary">只有已接受的候选会写入。已忽略或未确认的建议会在离开页面后丢弃。</Text>
            <Button type="primary" loading={saving} disabled={!acceptedCandidates.length} onClick={confirmWrite}>
              确认写入
            </Button>
          </Space>
        </Card>
      </Space>
    </div>
  )
}
