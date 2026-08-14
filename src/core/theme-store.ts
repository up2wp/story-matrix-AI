import { create } from 'zustand'
import type { ThemePreference } from './types'

export type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  syncSystemTheme: () => () => void
  syncUserThemePreference: (themePreference: ThemePreference) => void
  resetToSystem: () => void
}

function readSystemIsDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolvedThemeFor(themePreference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  if (themePreference === 'dark') return 'dark'
  if (themePreference === 'light') return 'light'
  return systemIsDark ? 'dark' : 'light'
}

const initialSystemIsDark = readSystemIsDark()

export const useThemeStore = create<ThemeState>((set) => ({
  themePreference: 'system',
  resolvedTheme: resolvedThemeFor('system', initialSystemIsDark),

  syncSystemTheme: () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
    const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemIsDark = (systemIsDark: boolean) => {
      set((state) => ({
        resolvedTheme: resolvedThemeFor(state.themePreference, systemIsDark),
      }))
    }
    syncSystemIsDark(systemThemeQuery.matches)
    const handleSystemThemeChange = (event: MediaQueryListEvent) => syncSystemIsDark(event.matches)
    systemThemeQuery.addEventListener('change', handleSystemThemeChange)
    return () => systemThemeQuery.removeEventListener('change', handleSystemThemeChange)
  },

  syncUserThemePreference: (themePreference: ThemePreference) => {
    set({ themePreference, resolvedTheme: resolvedThemeFor(themePreference, readSystemIsDark()) })
  },

  resetToSystem: () => {
    set({ themePreference: 'system', resolvedTheme: resolvedThemeFor('system', readSystemIsDark()) })
  },
}))
