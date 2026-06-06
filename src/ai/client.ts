import type { AIConfig } from '@/core/types'

// ============================================================
// AI 服务层 - 原生 fetch + SSE，完整控制 ReadableStream 生命周期
// ============================================================

/**
 * 一次性生成文本（非流式）
 */
export async function generate(prompt: string, systemPrompt: string, config: AIConfig) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300000)

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: false,
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      const err = await response.text().catch(() => '')
      throw new Error(`AI 请求失败: ${response.status} ${err}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 流式生成文本（SSE）
 * onChunk 接收增量 chunk 和累积 fullText
 * 彻底清理 ReadableStream 避免内存泄漏
 */
export async function generateStream(
  prompt: string,
  systemPrompt: string,
  config: AIConfig,
  onChunk: (chunk: string, fullText: string) => void,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300000)

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: true,
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      const err = await response.text().catch(() => '')
      throw new Error(`AI 请求失败: ${response.status} ${err}`)
    }

    reader = response.body?.getReader() ?? null
    if (!reader) throw new Error('响应体不可读')

    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const jsonStr = trimmed.slice(6)
        if (jsonStr === '[DONE]') continue

        try {
          const parsed = JSON.parse(jsonStr)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            fullText += content
            onChunk(content, fullText)
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    return fullText
  } finally {
    clearTimeout(timeoutId)
    if (reader) {
      try { reader.cancel() } catch {}
      reader = null
    }
  }
}
