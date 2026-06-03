import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import type { StorySeed, Work } from '@/core/types'
import { db } from '@/core/db'
import { useStore } from '@/core/store'
import { useAuthStore } from '@/core/auth-store'
import { generateId } from '@/utils/id'

// ============================================================
// 故事萌芽状态管理
// ============================================================

const defaultSeed: StorySeed = {
  timePeriod: '',
  regions: [],
  genre: '',
  subGenre: '',
  coreConcept: '',
  tone: '',
  targetAudience: '',
}

export function useSeedWizard() {
  const navigate = useNavigate()
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const currentWork = useStore((s) => s.currentWork)

  // 从已有作品初始化（编辑模式），否则空白起步
  const [seed, setSeed] = useState<StorySeed>(currentWork?.seed ? { ...currentWork.seed } : { ...defaultSeed })
  const [workTitle, setWorkTitle] = useState(currentWork?.title || '')
  const [loading, setLoading] = useState(false)
  const [workId, setWorkId] = useState<string | null>(currentWork?.id || null)

  // 更新种子信息
  const updateSeed = useCallback((patch: Partial<StorySeed>) => {
    setSeed((prev) => ({ ...prev, ...patch }))
  }, [])

  // 保存并完成，进入世界构建
  const finishWizard = useCallback(async () => {
    const currentUser = useAuthStore.getState().user
    if (!currentUser) return

    const title = workTitle || `新作品 ${new Date().toLocaleDateString()}`
    const now = Date.now()

    if (workId) {
      // 更新已有作品
      await db.works.update(workId, { seed, title, updatedAt: now })
      const work = await db.works.get(workId)
      if (work) setCurrentWork(work)
    } else {
      // 创建新作品
      const id = generateId()
      const work: Work = {
        id,
        ownerId: currentUser.id,
        shared: false,
        title,
        createdAt: now,
        updatedAt: now,
        seed,
        characters: [],
        settings: [],
        constraints: [],
        storylines: [],
        outline: [],
        chapters: [],
      }
      await db.works.add(work)
      setCurrentWork(work)
    }
    navigate('/world')
  }, [seed, workTitle, workId, navigate, setCurrentWork])

  return {
    seed,
    updateSeed,
    workTitle,
    setWorkTitle,
    loading,
    setLoading,
    finishWizard,
  }
}
