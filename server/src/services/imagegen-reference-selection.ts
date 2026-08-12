import type { ImageGenerationConfig, ImageGenerationModelConfig } from './image-generation-config.js'
import { readImagegenReferenceAsset } from './imagegen-reference-assets.js'
import type { ProviderReferenceImage } from './image-providers.js'

const MAX_TEST_REFERENCE_IMAGES = 3

export type ResolveImagegenReferenceSelectionInput = {
  readonly value: unknown
  readonly ownerId: string
  readonly config: ImageGenerationConfig
  readonly model: ImageGenerationModelConfig
}

export type ResolveImagegenReferenceSelectionResult =
  | { readonly ok: true; readonly ids: readonly string[]; readonly images: readonly ProviderReferenceImage[] }
  | { readonly ok: false; readonly statusCode: 400; readonly error: string }

function referenceImageIds(value: unknown) {
  if (value === undefined) return { ok: true, ids: [] } as const
  if (!Array.isArray(value)) return { ok: false, error: 'referenceImageIds 必须是参考图 ID 数组' } as const
  const ids = value.map(item => String(item || '').trim()).filter(Boolean)
  if (ids.length !== new Set(ids).size) return { ok: false, error: '不能重复选择同一张参考图' } as const
  return { ok: true, ids } as const
}

function effectiveReferenceImageLimit(model: ImageGenerationModelConfig) {
  if (!model.capabilities.referenceImages) return 0
  return Math.min(MAX_TEST_REFERENCE_IMAGES, model.capabilities.maxReferenceImages || 0)
}

function validateReferenceSelection(model: ImageGenerationModelConfig, ids: readonly string[]) {
  if (ids.length === 0) return { ok: true } as const
  const limit = effectiveReferenceImageLimit(model)
  if (limit === 0) return { ok: false, error: '当前模型不支持参考图' } as const
  if (ids.length > limit) return { ok: false, error: `当前模型最多支持 ${limit} 张参考图` } as const
  return { ok: true } as const
}

export async function resolveImagegenReferenceSelection(input: ResolveImagegenReferenceSelectionInput): Promise<ResolveImagegenReferenceSelectionResult> {
  const parsed = referenceImageIds(input.value)
  if (!parsed.ok) return { ok: false, statusCode: 400, error: parsed.error }
  const selection = validateReferenceSelection(input.model, parsed.ids)
  if (!selection.ok) return { ok: false, statusCode: 400, error: selection.error }
  try {
    const images = await Promise.all(parsed.ids.map(id => readImagegenReferenceAsset(input.ownerId, id, input.config, 'original')))
    return { ok: true, ids: parsed.ids, images }
  } catch (error) {
    return { ok: false, statusCode: 400, error: error instanceof Error ? error.message : '参考图不可用' }
  }
}
