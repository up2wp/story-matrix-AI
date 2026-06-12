import { useCallback, useEffect, useState } from 'react'
import { message } from 'antd'
import type { UserVoiceAsset } from '@/core/types'
import { userVoicesClient, voiceboxClient } from './voiceboxClient'

function profileId(profile: { id?: string; profile_id?: string }) {
  return profile.id || profile.profile_id || ''
}

function profileName(profile: { name?: string; display_name?: string; id?: string; profile_id?: string }) {
  return profile.name || profile.display_name || profileId(profile)
}

export function useUserVoices() {
  const [voices, setVoices] = useState<UserVoiceAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setVoices(await userVoicesClient.list())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const createVoice = async (input: { displayName: string; file: File; referenceText: string; consentConfirmed: boolean }) => {
    if (!input.referenceText.trim()) throw new Error('请填写参考音频文本')
    if (!input.consentConfirmed) throw new Error('请确认声音授权')
    setSaving(true)
    try {
      const profile = await voiceboxClient.createProfile({ name: input.displayName.trim(), voice_type: 'cloned', description: input.referenceText.trim().slice(0, 200) })
      const id = profileId(profile)
      if (!id) throw new Error('Voicebox 未返回 profile id')
      const sample = await voiceboxClient.uploadSample(id, input.file, input.referenceText.trim())
      const voice = await userVoicesClient.create({
        displayName: input.displayName.trim(),
        profileId: id,
        profileName: profileName(profile),
        sampleId: sample.id || sample.sample_id,
        referenceText: input.referenceText.trim(),
        consentConfirmed: input.consentConfirmed,
      })
      setVoices((items) => [voice, ...items.filter((item) => item.id !== voice.id)])
      message.success('声音已添加')
      return voice
    } finally {
      setSaving(false)
    }
  }

  const renameVoice = async (id: string, displayName: string) => {
    const voice = await userVoicesClient.rename(id, displayName.trim())
    setVoices((items) => items.map((item) => item.id === id ? voice : item))
    message.success('名称已更新')
  }

  const removeVoice = async (id: string) => {
    await userVoicesClient.remove(id)
    setVoices((items) => items.filter((item) => item.id !== id))
    message.success('声音已删除')
  }

  return { voices, loading, saving, refresh, createVoice, renameVoice, removeVoice }
}
