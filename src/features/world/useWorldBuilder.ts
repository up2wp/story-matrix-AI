import { useState, useCallback } from 'react'
import type { Work, Setting, Character } from '@/core/types'
import { db } from '@/core/db'
import { useStore } from '@/core/store'

// ============================================================
// 世界构建状态管理
// ============================================================

export type WorldTab = 'settings' | 'characters' | 'supporting'

export function useWorldBuilder() {
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)

  const [activeTab, setActiveTab] = useState<WorldTab>('settings')
  const [loading, setLoading] = useState(false)

  // 持久化更新
  const persistWork = useCallback(
    async (patch: Partial<Work>) => {
      if (!currentWork) return
      const updated = { ...currentWork, ...patch, updatedAt: Date.now() }
      await db.works.update(currentWork.id, patch)
      setCurrentWork(updated)
    },
    [currentWork, setCurrentWork],
  )

  // --- 设定管理 ---

  const addSetting = useCallback(
    async (setting: Setting) => {
      if (!currentWork) return
      const settings = [...currentWork.settings, setting]
      await persistWork({ settings })
    },
    [currentWork, persistWork],
  )

  const updateSetting = useCallback(
    async (id: string, patch: Partial<Setting>) => {
      if (!currentWork) return
      const settings = currentWork.settings.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      )
      await persistWork({ settings })
    },
    [currentWork, persistWork],
  )

  const removeSetting = useCallback(
    async (id: string) => {
      if (!currentWork) return
      const settings = currentWork.settings.filter((s) => s.id !== id)
      await persistWork({ settings })
    },
    [currentWork, persistWork],
  )

  const setSettings = useCallback(
    async (settings: Setting[]) => {
      await persistWork({ settings })
    },
    [persistWork],
  )

  // --- 角色管理 ---

  const updateCharacter = useCallback(
    async (id: string, patch: Partial<Character>) => {
      if (!currentWork) return
      const characters = currentWork.characters.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      )
      await persistWork({ characters })
    },
    [currentWork, persistWork],
  )

  const addCharacter = useCallback(
    async (char: Character) => {
      if (!currentWork) return
      const characters = [...currentWork.characters, char]
      await persistWork({ characters })
    },
    [currentWork, persistWork],
  )

  const removeCharacter = useCallback(
    async (id: string) => {
      if (!currentWork) return
      const characters = currentWork.characters.filter((c) => c.id !== id)
      await persistWork({ characters })
    },
    [currentWork, persistWork],
  )

  const setCharacters = useCallback(
    async (characters: Character[]) => {
      await persistWork({ characters })
    },
    [persistWork],
  )

  return {
    currentWork,
    activeTab,
    setActiveTab,
    loading,
    setLoading,
    addSetting,
    updateSetting,
    removeSetting,
    setSettings,
    updateCharacter,
    addCharacter,
    removeCharacter,
    setCharacters,
  }
}
