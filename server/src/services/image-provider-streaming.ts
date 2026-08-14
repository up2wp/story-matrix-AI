export type OpenAIImageResponseItem = {
  readonly b64_json?: string
  readonly url?: string
}

export type OpenAIImageResponseResult = {
  readonly data: readonly OpenAIImageResponseItem[]
  readonly streaming: boolean
  readonly partialImageEvents: number
  readonly completedImageEvents: number
}

export function openAIStreamingOptions(options: Record<string, string | number>) {
  return { ...options, stream: true }
}

function imageItemFromUnknown(value: unknown): OpenAIImageResponseItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const b64Json = 'b64_json' in value && typeof value.b64_json === 'string' ? value.b64_json : undefined
  const url = 'url' in value && typeof value.url === 'string' ? value.url : undefined
  if (!b64Json && !url) return undefined
  if (b64Json && url) return { b64_json: b64Json, url }
  if (b64Json) return { b64_json: b64Json }
  if (url) return { url }
  return undefined
}

function eventType(value: unknown) {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' ? value.type : undefined
}

function isPartialImageEvent(value: string | undefined) {
  return value === 'image_generation.partial_image' || value === 'image_edit.partial_image'
}

function isCompletedImageEvent(value: string | undefined) {
  return value === 'image_generation.completed' || value === 'image_edit.completed'
}

function sseDataPayloads(text: string) {
  const payloads: string[] = []
  let dataLines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (dataLines.length > 0) payloads.push(dataLines.join('\n'))
      dataLines = []
      continue
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length > 0) payloads.push(dataLines.join('\n'))
  return payloads
}

function parseJsonResponse(text: string): OpenAIImageResponseResult {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('data' in parsed) || !Array.isArray(parsed.data)) {
    throw new Error('Provider 未返回图片')
  }
  const data = parsed.data.map(imageItemFromUnknown).filter((item): item is OpenAIImageResponseItem => Boolean(item))
  return { data, streaming: false, partialImageEvents: 0, completedImageEvents: data.length }
}

function parseSseResponse(text: string): OpenAIImageResponseResult {
  const data: OpenAIImageResponseItem[] = []
  let partialImageEvents = 0
  for (const payload of sseDataPayloads(text)) {
    if (payload === '[DONE]') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Provider 流式响应格式无效', { cause: error })
      throw error
    }
    const type = eventType(parsed)
    if (isPartialImageEvent(type)) partialImageEvents += 1
    if (isCompletedImageEvent(type)) {
      const item = imageItemFromUnknown(parsed)
      if (item) data.push(item)
    }
  }
  if (data.length === 0) throw new Error('Provider 流式响应未返回完成图片')
  return { data, streaming: true, partialImageEvents, completedImageEvents: data.length }
}

export async function parseOpenAIImageStreamResponse(response: Response): Promise<OpenAIImageResponseResult> {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  if (!contentType.toLowerCase().includes('text/event-stream')) return parseJsonResponse(text)
  return parseSseResponse(text)
}
