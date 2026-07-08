import type { ImageGenerationModelConfig, ImageGenerationProviderConfig } from './image-generation-config.js'
import { normalizeSafeBaseUrl, readSafeImageBuffer, readUpstreamError, safeUpstreamFetch } from './safe-upstream-fetch.js'

export interface ProviderImageResult {
  buffer: Buffer
  warning?: string
}

export interface ImageModelCandidate {
  providerModel: string
  label: string
  capabilities: { sizes: string[]; qualities: string[]; formats: string[]; aspectRatios?: string[]; referenceImages?: boolean; maxReferenceImages?: number }
  source: 'provider' | 'preset' | 'manual'
  requiresConfirmation: boolean
}

export interface ProviderReferenceImage {
  buffer: Buffer
  mimeType: string
}

const OPENAI_DEFAULT_SIZE = '1024x1024'
const MINIMAX_ASPECT_RATIOS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']

function discoveredOpenAICapabilities(providerModel: string) {
  const supportsReferenceImages = /^gpt-image-[12]$/i.test(providerModel)
  return { sizes: [], qualities: [], formats: [], referenceImages: supportsReferenceImages, maxReferenceImages: supportsReferenceImages ? 3 : 0 }
}

function providerHeaders(apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function multipartHeaders(apiKey?: string) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function safeCount(value: unknown) {
  return typeof value === 'number' && value > 0 ? Math.min(Math.floor(value), 4) : 1
}

function openAIOptions(body: Record<string, unknown>, model: ImageGenerationModelConfig) {
  const options: Record<string, string | number> = { n: safeCount(body.n) }
  const capabilities = model.capabilities || { sizes: [], qualities: [], formats: [] }
  if (typeof body.size === 'string' && capabilities.sizes?.includes(body.size)) options.size = body.size
  if (!options.size && capabilities.sizes?.includes(OPENAI_DEFAULT_SIZE)) options.size = OPENAI_DEFAULT_SIZE
  if (typeof body.quality === 'string' && capabilities.qualities?.includes(body.quality)) options.quality = body.quality
  if (typeof body.format === 'string' && capabilities.formats?.includes(body.format)) options.output_format = body.format
  return options
}

function minimaxOptions(body: Record<string, unknown>, model: ImageGenerationModelConfig) {
  const capabilities = model.capabilities || { sizes: [], qualities: [], formats: [], aspectRatios: [] }
  const aspectRatios = capabilities.aspectRatios?.length ? capabilities.aspectRatios : MINIMAX_ASPECT_RATIOS
  const options: Record<string, string | number | boolean> = { response_format: 'base64', n: safeCount(body.n), prompt_optimizer: false }
  if (typeof body.size === 'string') {
    const sizeRatio: Record<string, string> = { '1024x1024': '1:1', '1792x1024': '16:9', '1024x1792': '9:16' }
    const ratio = sizeRatio[body.size]
    if (!ratio) throw new Error('MiniMax 当前不支持所选尺寸，请选择可用比例')
    if (aspectRatios.includes(ratio)) options.aspect_ratio = ratio
  } else if (aspectRatios.includes('1:1')) {
    options.aspect_ratio = '1:1'
  }
  return options
}

function decodeBase64Image(value: string) {
  const payload = value.includes(',') ? value.split(',').pop() || '' : value
  const buffer = Buffer.from(payload, 'base64')
  if (!buffer.length) throw new Error('MiniMax 返回的图片内容无效')
  return buffer
}

function minimaxErrorMessage(code?: number, message?: string) {
  if (code === 1002) return 'MiniMax 请求过于频繁，请稍后重试'
  if (code === 1004) return 'MiniMax API Key 无效，请检查厂商配置'
  if (code === 1008) return 'MiniMax 账号余额不足，请充值后重试'
  if (message?.includes('sensitive')) return 'MiniMax 拒绝了敏感内容，请调整提示词'
  return message ? `MiniMax 生图失败：${message}` : 'MiniMax 生图失败'
}

async function normalizeProviderImage(item: { b64_json?: string; url?: string }) {
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64')
  if (item.url) {
    const response = await safeUpstreamFetch(item.url)
    if (!response.ok) throw new Error(await readUpstreamError(response))
    return readSafeImageBuffer(response)
  }
  throw new Error('Provider 未返回可用图片')
}

function bufferBlob(image: ProviderReferenceImage) {
  const arrayBuffer = image.buffer.buffer.slice(image.buffer.byteOffset, image.buffer.byteOffset + image.buffer.byteLength) as ArrayBuffer
  return new Blob([arrayBuffer], { type: image.mimeType })
}

async function generateOpenAIReferenceImages(provider: ImageGenerationProviderConfig, model: ImageGenerationModelConfig, prompt: string, body: Record<string, unknown>, referenceImages: ProviderReferenceImage[]) {
  const form = new FormData()
  form.append('model', model.providerModel || model.model)
  form.append('prompt', prompt)
  form.append('response_format', 'b64_json')
  for (const [key, value] of Object.entries(openAIOptions(body, model))) form.append(key, String(value))
  for (const [index, image] of referenceImages.entries()) {
    form.append('image[]', bufferBlob(image), `reference-${index + 1}.${image.mimeType.split('/')[1] || 'png'}`)
  }
  const response = await safeUpstreamFetch(`${normalizeSafeBaseUrl(provider.baseUrl)}/images/edits`, {
    method: 'POST',
    headers: multipartHeaders(provider.apiKey),
    body: form,
  })
  if (!response.ok) throw new Error(await readUpstreamError(response))
  const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const first = data.data?.[0]
  if (!first) throw new Error('Provider 未返回图片')
  return [{ buffer: await normalizeProviderImage(first) }]
}

export async function generateProviderImages(provider: ImageGenerationProviderConfig, model: ImageGenerationModelConfig, prompt: string, body: Record<string, unknown> & { referenceImages?: ProviderReferenceImage[] }): Promise<ProviderImageResult[]> {
  if (!provider.apiKey) throw new Error('生图厂商未配置 API Key')
  const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages : []
  if (provider.protocol === 'minimax-image-generation' || provider.type === 'minimax') {
    if (prompt.length > 1500) throw new Error('MiniMax 提示词不能超过 1500 字')
    const minimaxReferenceLimit = model.capabilities.referenceImages ? (model.capabilities.maxReferenceImages || 1) : 0
    if (referenceImages.length > minimaxReferenceLimit) throw new Error('MiniMax 当前模型最多支持 1 张参考图')
    const subjectReference = referenceImages.length === 1 ? { subject_reference: [{ type: 'character', image_file: `data:${referenceImages[0].mimeType};base64,${referenceImages[0].buffer.toString('base64')}` }] } : {}
    const response = await safeUpstreamFetch(`${normalizeSafeBaseUrl(provider.baseUrl)}/v1/image_generation`, {
      method: 'POST',
      headers: providerHeaders(provider.apiKey),
      body: JSON.stringify({ model: model.providerModel || model.model, prompt, ...minimaxOptions(body, model), ...subjectReference }),
    })
    if (!response.ok) throw new Error(await readUpstreamError(response))
    const data = await response.json() as { base_resp?: { status_code?: number; status_msg?: string }; data?: { image_base64?: string[]; image_urls?: string[] }; metadata?: { success_count?: string | number; failed_count?: string | number } }
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) throw new Error(minimaxErrorMessage(data.base_resp.status_code, data.base_resp.status_msg))
    const buffers = (data.data?.image_base64 || []).map(decodeBase64Image)
    if (buffers.length === 0 && data.data?.image_urls?.length) {
      const responseFromUrl = await safeUpstreamFetch(data.data.image_urls[0])
      if (!responseFromUrl.ok) throw new Error(await readUpstreamError(responseFromUrl))
      buffers.push(await readSafeImageBuffer(responseFromUrl))
    }
    if (buffers.length === 0) throw new Error('MiniMax 未返回可用图片')
    const failedCount = Number(data.metadata?.failed_count || 0)
    return buffers.map((buffer, index) => ({ buffer, warning: failedCount > 0 && index === 0 ? `MiniMax 部分图片生成失败：${failedCount} 张失败` : undefined }))
  }

  if (referenceImages.length > 0) return generateOpenAIReferenceImages(provider, model, prompt, body, referenceImages)

  const response = await safeUpstreamFetch(`${normalizeSafeBaseUrl(provider.baseUrl)}/images/generations`, {
    method: 'POST',
    headers: providerHeaders(provider.apiKey),
    body: JSON.stringify({ model: model.providerModel || model.model, prompt, response_format: 'b64_json', ...openAIOptions(body, model) }),
  })
  if (!response.ok) throw new Error(await readUpstreamError(response))
  const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const first = data.data?.[0]
  if (!first) throw new Error('Provider 未返回图片')
  return [{ buffer: await normalizeProviderImage(first) }]
}

export async function generateImageWithProvider(input: { provider: ImageGenerationProviderConfig; model: ImageGenerationModelConfig; prompt: string; options: Record<string, unknown> }) {
  const results = await generateProviderImages(input.provider, input.model, input.prompt, input.options)
  return { images: results.map(result => result.buffer), warning: results[0]?.warning }
}

export async function discoverProviderModels(provider: ImageGenerationProviderConfig): Promise<ImageModelCandidate[]> {
  if (provider.type === 'minimax' || provider.protocol === 'minimax-image-generation') {
    return ['image-01', 'image-01-live'].map(providerModel => ({
      providerModel,
      label: providerModel === 'image-01-live' ? 'MiniMax image-01-live' : 'MiniMax image-01',
      capabilities: { sizes: ['1024x1024', '1792x1024', '1024x1792'], qualities: ['standard'], formats: ['png'], aspectRatios: MINIMAX_ASPECT_RATIOS, referenceImages: true, maxReferenceImages: 1 },
      source: 'preset',
      requiresConfirmation: false,
    }))
  }
  const response = await safeUpstreamFetch(`${normalizeSafeBaseUrl(provider.baseUrl)}/models`, { headers: providerHeaders(provider.apiKey) })
  if (!response.ok) throw new Error(await readUpstreamError(response))
  const data = await response.json() as { data?: Array<{ id?: string }> }
  return (data.data || []).map(item => String(item.id || '').trim()).filter(Boolean).map(providerModel => ({
    providerModel,
    label: providerModel,
    capabilities: discoveredOpenAICapabilities(providerModel),
    source: 'provider',
    requiresConfirmation: true,
  }))
}
