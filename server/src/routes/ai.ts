import { Router } from 'express'

const router = Router()

interface AIConfigPayload {
  apiKey?: string
  baseUrl?: string
  model?: string
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionPayload {
  config?: AIConfigPayload
  messages?: ChatMessage[]
  stream?: boolean
}

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
}

function providerHeaders(apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

async function readProviderError(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return response.statusText
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message || text
  } catch {
    return text
  }
}

router.post('/models', async (req, res) => {
  const { config } = req.body as { config?: AIConfigPayload }
  const baseUrl = normalizeBaseUrl(config?.baseUrl)

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: providerHeaders(config?.apiKey),
    })

    if (!response.ok) {
      return res.status(response.status).json({ error: await readProviderError(response) })
    }

    const data = await response.json() as { data?: Array<{ id?: string }> }
    res.json({ models: (data.data || []).map((model) => model.id).filter(Boolean) })
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型列表获取失败'
    res.status(502).json({ error: message })
  }
})

router.post('/chat-completions', async (req, res) => {
  const { config, messages, stream } = req.body as ChatCompletionPayload
  if (!config?.model || !messages?.length) {
    return res.status(400).json({ error: '缺少模型或消息内容' })
  }

  try {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: providerHeaders(config.apiKey),
      body: JSON.stringify({ model: config.model, messages, stream: Boolean(stream) }),
    })

    if (!response.ok) {
      return res.status(response.status).json({ error: await readProviderError(response) })
    }

    if (stream) {
      res.status(response.status)
      res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      if (!response.body) return res.end()

      for await (const chunk of response.body) {
        res.write(chunk)
      }
      return res.end()
    }

    res.status(response.status).json(await response.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 请求失败'
    res.status(502).json({ error: message })
  }
})

export default router
