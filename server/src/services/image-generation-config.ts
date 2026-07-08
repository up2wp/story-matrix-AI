export type ImageProviderType = 'openai' | 'openai-compatible' | 'custom' | 'minimax'
export type ImageProviderProtocol = 'openai-images' | 'openai-compatible-images' | 'minimax-image-generation'

export interface ImageGenerationModelCapability {
  sizes: string[]
  qualities: string[]
  formats: string[]
  aspectRatios?: string[]
  referenceImages?: boolean
  maxReferenceImages?: number
}

export interface ImageGenerationProviderConfig {
  id: string
  type: ImageProviderType
  label: string
  baseUrl: string
  apiKey?: string
  protocol: ImageProviderProtocol
  enabled: boolean
  status?: 'untested' | 'ready' | 'failed'
  statusMessage?: string
}

export type ImageProviderConfig = ImageGenerationProviderConfig

export interface ImageGenerationModelConfig {
  id: string
  label: string
  provider: ImageProviderType
  providerId: string
  baseUrl: string
  apiKey?: string
  model: string
  providerModel: string
  enabled: boolean
  capabilities: ImageGenerationModelCapability
}

export interface ImageGenerationConfig {
  enabled: boolean
  defaultModelId: string
  providers: ImageGenerationProviderConfig[]
  models: ImageGenerationModelConfig[]
  storageMode: 'local' | 'immich'
  immich: {
    serviceUrl: string
    apiKey?: string
    projectName: string
    allowPrivateNetwork: boolean
  }
}

const MASKED_SECRET = '__server_configured__'
type ImageGenerationConfigInput = Record<string, unknown>

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export function defaultImageGenerationConfig(): ImageGenerationConfig {
  return {
    enabled: false,
    defaultModelId: '',
    providers: [],
    models: [],
    storageMode: 'local',
    immich: { serviceUrl: '', apiKey: '', projectName: '', allowPrivateNetwork: false },
  }
}

export function normalizeStringList(value: unknown) {
  if (typeof value === 'string') return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)))
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)))
}

function defaultReferenceImageCapability(provider: ImageGenerationProviderConfig, providerModel: string) {
  const model = providerModel.trim().toLowerCase()
  if (provider.protocol === 'minimax-image-generation' || provider.type === 'minimax') return true
  if ((provider.protocol === 'openai-images' || provider.protocol === 'openai-compatible-images') && /^gpt-image-[12]$/.test(model)) return true
  return false
}

function defaultMaxReferenceImages(provider: ImageGenerationProviderConfig) {
  return provider.protocol === 'minimax-image-generation' || provider.type === 'minimax' ? 1 : 3
}

function normalizeReferenceImageCapability(value: unknown, provider: ImageGenerationProviderConfig, providerModel: string) {
  return value === true || defaultReferenceImageCapability(provider, providerModel)
}

function normalizeMaxReferenceImages(value: unknown, referenceImages: boolean) {
  if (!referenceImages || typeof value !== 'number' || value <= 0) return 0
  return Math.min(Math.floor(value), 3)
}

function providerType(value: unknown): ImageProviderType {
  if (value === 'minimax') return 'minimax'
  if (value === 'openai-compatible') return 'openai-compatible'
  if (value === 'custom') return 'custom'
  return 'openai'
}

function defaultProtocol(type: ImageProviderType): ImageProviderProtocol {
  if (type === 'minimax') return 'minimax-image-generation'
  if (type === 'custom' || type === 'openai-compatible') return 'openai-compatible-images'
  return 'openai-images'
}

function defaultBaseUrl(type: ImageProviderType) {
  if (type === 'minimax') return 'https://api.minimaxi.com'
  if (type === 'openai') return 'https://api.openai.com/v1'
  return ''
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'provider'
}

function providerKey(provider: { type: ImageProviderType; baseUrl: string; apiKey?: string }) {
  return [provider.type, provider.baseUrl.replace(/\/+$/, ''), provider.apiKey || ''].join('|')
}

function uniqueId(base: string, seen: Set<string>) {
  const id = slug(base)
  let next = id
  let count = 2
  while (seen.has(next)) {
    next = `${id}-${count}`
    count += 1
  }
  seen.add(next)
  return next
}

function normalizeProvider(rawInput: unknown, seen: Set<string>): ImageGenerationProviderConfig {
  const raw = objectValue(rawInput)
  const type = providerType(raw?.type || raw?.provider)
  const id = uniqueId(String(raw?.id || raw?.label || type), seen)
  const protocol = raw?.protocol === 'minimax-image-generation' || raw?.protocol === 'openai-compatible-images' || raw?.protocol === 'openai-images' ? raw.protocol : defaultProtocol(type)
  return {
    id,
    type,
    label: String(raw?.label || (type === 'minimax' ? 'MiniMax 中国' : type === 'openai' ? 'OpenAI Images' : 'OpenAI 兼容')).trim(),
    baseUrl: String(raw?.baseUrl || defaultBaseUrl(type)).trim(),
    apiKey: String(raw?.apiKey || ''),
    protocol,
    enabled: raw?.enabled !== false,
    status: raw?.status === 'ready' || raw?.status === 'failed' ? raw.status : 'untested',
    statusMessage: String(raw?.statusMessage || ''),
  }
}

export function normalizeImageGenerationConfig(inputValue: unknown): ImageGenerationConfig {
  const input = objectValue(inputValue)
  const providerIds = new Set<string>()
  const providers: ImageGenerationProviderConfig[] = []
  const providerByKey = new Map<string, ImageGenerationProviderConfig>()

  for (const rawProvider of Array.isArray(input.providers) ? input.providers : []) {
    const provider = normalizeProvider(rawProvider, providerIds)
    providers.push(provider)
    providerByKey.set(providerKey(provider), provider)
  }

  const models = Array.isArray(input.models) ? input.models : []
  const modelIds = new Set<string>()
  const normalizedModels: ImageGenerationModelConfig[] = []

  for (const rawModel of models) {
    const modelInput = objectValue(rawModel)
    const type = providerType(modelInput.provider)
    let provider = providers.find(item => item.id === modelInput.providerId)
    if (!provider) {
      const draft = {
        type,
        label: modelInput.providerLabel || (type === 'minimax' ? 'MiniMax 中国' : type === 'openai' ? 'OpenAI Images' : 'OpenAI 兼容'),
        baseUrl: String(modelInput.baseUrl || defaultBaseUrl(type)).trim(),
        apiKey: String(modelInput.apiKey || ''),
        protocol: defaultProtocol(type),
        enabled: true,
      }
      const key = providerKey(draft)
      provider = providerByKey.get(key)
      if (!provider) {
        provider = normalizeProvider({ ...draft, id: `${type}-${providers.length + 1}` }, providerIds)
        providers.push(provider)
        providerByKey.set(key, provider)
      }
    }

    const providerModel = String(modelInput.providerModel || modelInput.model || '').trim()
    const id = uniqueId(String(modelInput.id || `${provider.id}-${providerModel || 'model'}`), modelIds)
    const rawCapabilities = objectValue(modelInput.capabilities)
    const referenceImages = normalizeReferenceImageCapability(rawCapabilities.referenceImages, provider, providerModel)
    const maxReferenceImages = normalizeMaxReferenceImages(rawCapabilities.maxReferenceImages, referenceImages) || (referenceImages ? defaultMaxReferenceImages(provider) : 0)
    normalizedModels.push({
      id,
      label: String(modelInput.label || providerModel || id).trim(),
      provider: provider.type,
      providerId: provider.id,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: providerModel,
      providerModel,
      enabled: Boolean(modelInput.enabled),
      capabilities: {
        sizes: normalizeStringList(rawCapabilities.sizes),
        qualities: normalizeStringList(rawCapabilities.qualities),
        formats: normalizeStringList(rawCapabilities.formats),
        aspectRatios: normalizeStringList(rawCapabilities.aspectRatios),
        referenceImages,
        maxReferenceImages,
      },
    })
  }

  const defaultModelId = String(input.defaultModelId || '').trim()
  const enabledModelIds = new Set(normalizedModels.filter(model => model.enabled).map(model => model.id))
  return {
    enabled: Boolean(input.enabled),
    defaultModelId: enabledModelIds.has(defaultModelId) ? defaultModelId : (normalizedModels.find(model => model.enabled)?.id || ''),
    providers,
    models: normalizedModels,
    storageMode: input.storageMode === 'immich' ? 'immich' : 'local',
    immich: {
      serviceUrl: String(objectValue(input.immich).serviceUrl || '').trim(),
      apiKey: String(objectValue(input.immich).apiKey || ''),
      projectName: String(objectValue(input.immich).projectName || '').trim(),
      allowPrivateNetwork: Boolean(objectValue(input.immich).allowPrivateNetwork),
    },
  }
}

export function validateImageGenerationConfig(config: ImageGenerationConfig) {
  if (!config.enabled) return
  const enabledModels = config.models.filter(model => model.enabled)
  if (enabledModels.length === 0) throw new Error('开启生图功能前至少需要启用一个生图模型')
  for (const model of enabledModels) {
    const provider = config.providers.find(item => item.id === model.providerId && item.enabled)
    if (!provider) throw new Error(`生图模型 ${model.label} 缺少可用厂商配置`)
    if (!model.id || !model.label || !model.providerModel) throw new Error('启用的生图模型必须包含名称和厂商模型')
    if (!provider.baseUrl) throw new Error(`厂商 ${provider.label} 缺少 API 地址`)
    if (!provider.apiKey) throw new Error(`厂商 ${provider.label} 缺少 API Key`)
  }
  if (config.storageMode === 'immich' && (!config.immich.serviceUrl || !config.immich.apiKey || !config.immich.projectName)) {
    throw new Error('启用 Immich 存储前需要填写服务地址、API Key 和项目名称')
  }
}

export function maskImageGenerationConfigForAdmin(config: ImageGenerationConfig) {
  return {
    ...config,
    providers: config.providers.map(provider => ({ ...provider, apiKey: provider.apiKey ? MASKED_SECRET : '' })),
    models: config.models.map(model => ({ ...model, apiKey: model.apiKey ? MASKED_SECRET : '' })),
    immich: { ...config.immich, apiKey: config.immich.apiKey ? MASKED_SECRET : '' },
  }
}

export function maskImageGenerationConfigForUser(config: ImageGenerationConfig) {
  return {
    enabled: config.enabled,
    defaultModelId: config.defaultModelId,
    storageMode: config.storageMode,
    models: config.models.filter(model => model.enabled).map(model => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      enabled: model.enabled,
      capabilities: model.capabilities,
    })),
  }
}

export function mergeImageGenerationConfig(fieldsConfig: ImageGenerationConfigInput, existingConfig?: unknown) {
  const existing = normalizeImageGenerationConfig(existingConfig || defaultImageGenerationConfig())
  const merged = normalizeImageGenerationConfig({ ...existing, ...fieldsConfig })
  merged.providers = merged.providers.map(provider => {
    const existingProvider = existing.providers.find(item => item.id === provider.id)
    return { ...provider, apiKey: provider.apiKey === MASKED_SECRET ? existingProvider?.apiKey || '' : provider.apiKey }
  })
  merged.models = merged.models.map(model => {
    const provider = merged.providers.find(item => item.id === model.providerId)
    return { ...model, baseUrl: provider?.baseUrl || model.baseUrl, apiKey: provider?.apiKey || model.apiKey }
  })
  merged.immich = { ...merged.immich, apiKey: merged.immich.apiKey === MASKED_SECRET ? existing.immich.apiKey || '' : merged.immich.apiKey }
  validateImageGenerationConfig(merged)
  return merged
}

export function resolveEnabledImageModel(config: ImageGenerationConfig, modelId: string) {
  const model = config.models.find(item => item.id === modelId && item.enabled)
  if (!model) return undefined
  const provider = config.providers.find(item => item.id === model.providerId && item.enabled)
  if (!provider) return undefined
  return { model, provider }
}
