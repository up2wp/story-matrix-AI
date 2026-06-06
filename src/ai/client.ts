import { generateText, streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { AIConfig } from '@/core/types'

// ============================================================
// AI 服务层 - 封装 Vercel AI SDK
// ============================================================

// 缓存 provider 实例，避免重复创建
let cachedProvider: ReturnType<typeof createOpenAI> | null = null
let cachedConfigKey = ''

function createProvider(config: AIConfig) {
  const configKey = `${config.apiKey}|${config.baseUrl || ''}`
  if (cachedProvider && cachedConfigKey === configKey) {
    return cachedProvider
  }
  cachedProvider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
  })
  cachedConfigKey = configKey
  return cachedProvider
}

/**
 * 一次性生成文本
 */
export async function generate(prompt: string, systemPrompt: string, config: AIConfig) {
  const provider = createProvider(config)
  const result = await generateText({
    model: provider(config.model),
    system: systemPrompt,
    prompt,
  })
  return result.text
}

/**
 * 流式生成文本
 * onChunk 接收增量 chunk，而不是完整文本
 */
export async function generateStream(
  prompt: string,
  systemPrompt: string,
  config: AIConfig,
  onChunk: (chunk: string, fullText: string) => void,
) {
  const provider = createProvider(config)
  const result = streamText({
    model: provider(config.model),
    system: systemPrompt,
    prompt,
  })

  let fullText = ''
  for await (const chunk of result.textStream) {
    fullText += chunk
    onChunk(chunk, fullText)
  }
  return fullText
}
