import { useMemo, useState } from 'react'
import { message } from 'antd'
import { generate } from '@/ai/client'
import { BACKFILL_SYSTEM_PROMPT, buildBackfillPrompt } from '@/ai/prompts/backfill'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useSystemConfigStore } from '@/core/system-config-store'
import { applyBackfillPatch, buildBackfillPatch } from './applyBackfill'
import { buildBackfillWindows } from './chunking'
import { parseBackfillJson } from './extract'
import { reconcileBackfillCandidates } from './reconcile'
import type { BackfillCandidate, BackfillTask } from './types'

export const BACKFILL_TASK_LABELS: Record<BackfillTask, string> = {
  chapterSummary: '先补章节摘要',
  characters: '识别主要人物',
  settings: '补世界设定',
  constraints: '提取核心约束',
  storylines: '整理故事线',
  seed: '补故事萌芽',
}

export const BACKFILL_TASKS = Object.entries(BACKFILL_TASK_LABELS).map(([value, label]) => ({
  value: value as BackfillTask,
  label,
}))

export function useImportBackfill() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const aiConfig = useSystemConfigStore((s) => s.aiConfig)
  const [task, setTask] = useState<BackfillTask>('chapterSummary')
  const [candidates, setCandidates] = useState<BackfillCandidate[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)

  const windowResult = useMemo(() => buildBackfillWindows(currentWork?.chapters ?? []), [currentWork?.chapters])
  const acceptedCandidates = useMemo(() => candidates.filter(candidate => candidate.reviewStatus === 'accepted'), [candidates])
  const impact = useMemo(() => currentWork ? buildBackfillPatch(currentWork, candidates).summary : null, [currentWork, candidates])

  const setCandidateStatus = (id: string, reviewStatus: BackfillCandidate['reviewStatus']) => {
    setCandidates(prev => prev.map(candidate => candidate.id === id ? { ...candidate, reviewStatus } : candidate))
  }

  const acceptStrongEvidence = () => {
    setCandidates(prev => prev.map(candidate => candidate.evidenceLabel === '证据充分' ? { ...candidate, reviewStatus: 'accepted' } : candidate))
  }

  const runExtraction = async () => {
    if (!currentWork) return
    if (!windowResult.windows.length) {
      message.warning('当前作品没有可用于阶段反推的章节正文')
      return
    }
    if (!aiConfig.apiKey) {
      message.warning('请先在系统管理中配置 AI')
      return
    }
    setRunning(true)
    setErrors([])
    try {
      const parsed: BackfillCandidate[] = []
      const nextErrors: string[] = []
      for (const window of windowResult.windows) {
        const text = await generate(buildBackfillPrompt(task, window), BACKFILL_SYSTEM_PROMPT, { ...aiConfig, maxTokens: 1600 })
        const result = parseBackfillJson(task, text, window)
        parsed.push(...result.candidates)
        nextErrors.push(...result.errors)
      }
      const reconciled = reconcileBackfillCandidates(parsed)
      setCandidates(reconciled)
      setErrors(nextErrors)
      if (reconciled.length) message.success(`已生成 ${reconciled.length} 条候选建议，请确认后再写入`)
      else message.info(`这批正文没有足够可靠的「${BACKFILL_TASK_LABELS[task]}」建议`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '阶段反推失败')
    } finally {
      setRunning(false)
    }
  }

  const confirmWrite = async () => {
    if (!currentWork || !acceptedCandidates.length) return
    setSaving(true)
    try {
      const applied = applyBackfillPatch(currentWork, candidates)
      await db.works.update(currentWork.id, applied.patch)
      setCurrentWork(applied.work)
      setCandidates([])
      message.success('已确认写入阶段数据，章节正文未修改')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '确认写入失败')
    } finally {
      setSaving(false)
    }
  }

  return {
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
  }
}
