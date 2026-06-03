import { generateText, streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { AIConfig } from '@/core/types'

// ============================================================
// AI 服务层 - 封装 Vercel AI SDK
// ============================================================

function createProvider(config: AIConfig) {
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
  })
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
 */
export async function generateStream(
  prompt: string,
  systemPrompt: string,
  config: AIConfig,
  onChunk: (text: string) => void,
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
    onChunk(fullText)
  }
  return fullText
}
