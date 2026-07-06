import { Router } from 'express'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { ImmichClient } from '../services/immich-client.js'
import {
  defaultImageGenerationConfig,
  normalizeImageGenerationConfig,
  resolveEnabledImageModel,
  type ImageGenerationConfig,
  type ImageGenerationModelConfig,
  type ImageGenerationProviderConfig,
} from '../services/image-generation-config.js'
import { discoverProviderModels, generateProviderImages, type ProviderReferenceImage } from '../services/image-providers.js'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSET_DIR = path.join(__dirname, '..', '..', 'data', 'image-assets')
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const IMMICH_UPLOAD_RETRY_LIMIT = 3

interface AIConfigPayload {
  apiKey?: string
  baseUrl?: string
  model?: string
  maxTokens?: number
}

interface WorkRow {
  id: string
  ownerId: string
  shared: number
  data: string
}

interface ImageAssetRecord {
  id: string
  status?: string
  storageMode?: 'local' | 'immich'
  storageStatus?: string
  localAssetId?: string
  immichAssetId?: string
  immichFilename?: string
  assetUrl?: string
}

interface CachedSubjectCandidate extends CandidateSubjectInput {
  id?: string
  kind?: 'clothing' | 'prop'
}

interface CachedBystanderCandidate {
  id?: string
  name?: string
  evidence?: string
}

interface WorkData {
  seed?: { genre?: string; subGenre?: string }
  characters?: Array<{ id: string; name: string; role?: string; bio?: string; tags?: string[]; personality?: { traits?: string[] } }>
  chapters?: Array<{ id: string; title: string; userDirection?: string; content?: string; scenes?: Array<{ title?: string; summary?: string; content?: string }> }>
  visualAssets?: { images?: Record<string, ImageAssetRecord>; candidateCache?: Record<string, { result?: Omit<CandidateAIResponse, 'clothing' | 'props'> & { characters?: Array<{ characterId?: string; name?: string; evidence?: string }>; bystanders?: CachedBystanderCandidate[]; clothing?: CachedSubjectCandidate[]; props?: CachedSubjectCandidate[] } }> }
}

interface CandidateCharacterInput {
  name?: string
  evidence?: string
}

interface ExtractedCharacterInput {
  name?: string
  alias_in_text?: string[]
  mapping_status?: 'matched' | 'new_character'
  matched_character?: string
  character_type?: 'protagonist' | 'supporting' | 'unknown'
  context_summary?: string
  first_mention?: string
}

interface CandidateSubjectInput {
  label?: string
  description?: string
  characterName?: string
  evidence?: string
}

interface CandidateAIResponse {
  extracted_characters?: ExtractedCharacterInput[]
  characters?: CandidateCharacterInput[]
  clothing?: CandidateSubjectInput[]
  props?: CandidateSubjectInput[]
  chapter_summary?: string
}

interface CharacterMappingInput {
  extracted_name?: string
  matched_character_id?: string
  matched_character_name?: string
  confidence?: 'exact' | 'likely' | 'none'
}

interface CharacterMappingAIResponse {
  mappings?: CharacterMappingInput[]
}

type ImageViewDirection = 'front' | 'side' | 'back'
type ImagePromptType = 'characterFace' | 'chapterObject' | 'chapterClothing' | 'chapterProp' | 'characterFullBody'
type VisualCandidateKind = 'character' | 'bystander' | 'clothing' | 'prop'

const NO_DESCRIPTION_CLOTHING_ID = 'clothing:no-description'

const IMAGE_PROMPT_SYSTEM_PROMPT = `你是小说视觉设定提示词助手。你只输出适合图像生成模型的中文视觉提示词。
不要生成剧情正文，不要补写章节，不要输出 JSON。`

const VIEW_DIRECTION_SUFFIX: Record<ImageViewDirection, string> = {
  front: '生成角色设定用白色背景全身图，视角：正面。',
  side: '生成角色设定用白色背景全身图，视角：侧面。',
  back: '生成角色设定用白色背景全身图，视角：背面。',
}

function loadImageGenerationConfig(): ImageGenerationConfig {
  const row = db.prepare('SELECT imageGenerationConfig FROM systemConfig WHERE id = ?').get('singleton') as { imageGenerationConfig?: string } | undefined
  return normalizeImageGenerationConfig(row?.imageGenerationConfig ? JSON.parse(row.imageGenerationConfig) : defaultImageGenerationConfig())
}

function loadSystemAIConfig(): AIConfigPayload | null {
  const row = db.prepare('SELECT aiConfig FROM systemConfig WHERE id = ?').get('singleton') as { aiConfig?: string } | undefined
  return row?.aiConfig ? JSON.parse(row.aiConfig) : null
}

function loadFeaturePermissions() {
  const row = db.prepare('SELECT novelImportConfig FROM systemConfig WHERE id = ?').get('singleton') as { novelImportConfig?: string } | undefined
  const config = row?.novelImportConfig ? JSON.parse(row.novelImportConfig) : { enabled: false, featurePermissions: { userGrants: [] } }
  return Array.isArray(config?.featurePermissions?.userGrants) ? config.featurePermissions.userGrants as Array<{ userId: string; features: string[] }> : []
}

function canUseImageGeneration(req: AuthenticatedRequest, config: ImageGenerationConfig) {
  const user = req.currentUser
  if (!user || !config.enabled) return false
  if (user.role === 'owner' || user.role === 'admin') return true
  return loadFeaturePermissions().some(grant => grant.userId === user.id && grant.features?.includes('imageGeneration'))
}

function safeGenerationOptions(body: Record<string, unknown>, model: ImageGenerationModelConfig) {
  const options: Record<string, string | number> = {}
  const capabilities = model.capabilities || {}
  if (typeof body.size === 'string' && capabilities.sizes?.includes(body.size)) options.size = body.size
  if (typeof body.quality === 'string' && capabilities.qualities?.includes(body.quality)) options.quality = body.quality
  if (typeof body.format === 'string' && capabilities.formats?.includes(body.format)) options.format = body.format
  if (typeof body.aspectRatio === 'string' && capabilities.aspectRatios?.includes(body.aspectRatio)) options.aspect_ratio = body.aspectRatio
  if (typeof body.n === 'number' && body.n > 0 && body.n <= 4) options.n = Math.floor(body.n)
  return options
}

async function readProviderError(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return response.statusText
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message || parsed.message || text
  } catch {
    return text
  }
}

function providerHeaders(apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

async function generateTextPrompt(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const aiConfig = loadSystemAIConfig()
  if (!aiConfig?.apiKey || !aiConfig.model) throw new Error('请先在系统管理中配置 AI')
  const response = await fetch(`${(aiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: providerHeaders(aiConfig.apiKey),
    body: JSON.stringify({ model: aiConfig.model, messages, stream: false, max_tokens: Math.min(aiConfig.maxTokens || 1200, 1200), temperature: 0.7 }),
  })
  if (!response.ok) throw new Error(await readProviderError(response))
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('AI 没有返回可用提示词')
  return text
}

function normalizedOverlapText(value: string) {
  return value.replace(/\s+/g, '')
}

function hasLongSourceOverlap(output: string, sources: string[]) {
  const normalizedOutput = normalizedOverlapText(output)
  if (normalizedOutput.length < 80) return false
  return sources.some(source => {
    const normalizedSource = normalizedOverlapText(source)
    if (normalizedSource.length < 80) return false
    for (let index = 0; index <= normalizedOutput.length - 80; index += 20) {
      if (normalizedSource.includes(normalizedOutput.slice(index, index + 80))) return true
    }
    return false
  })
}

function safeVisualPromptOutput(prompt: string, work: WorkData) {
  const output = safeText(prompt, 1200)
  if (output.length < prompt.trim().length || hasLongSourceOverlap(output, (work.chapters || []).map(fullChapterContent))) {
    throw new Error('视觉提示词包含过长章节摘录')
  }
  return output
}

function workAccess(req: AuthenticatedRequest, workId: string, requireOwner: boolean) {
  const row = db.prepare('SELECT * FROM works WHERE id = ?').get(workId) as WorkRow | undefined
  if (!row) return { status: 404, error: '作品不存在' } as const
  const user = req.currentUser
  const canAccess = row.ownerId === user.id || user.role === 'owner' || user.role === 'admin' || Boolean(row.shared)
  if (!canAccess) return { status: 403, error: '无权查看该作品' } as const
  if (requireOwner && row.ownerId !== user.id) return { status: 403, error: '无权修改该作品' } as const
  return { status: 200, row } as const
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function detectMime(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  throw new Error('Provider 返回的内容不是受支持的图片格式')
}

function saveImageAsset(workId: string, buffer: Buffer) {
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('图片为空或超过大小限制')
  const mimeType = detectMime(buffer)
  const id = randomUUID()
  const workDir = path.join(ASSET_DIR, workId)
  fs.mkdirSync(workDir, { recursive: true })
  const filePath = path.join(workDir, `${id}.${extensionForMime(mimeType)}`)
  fs.writeFileSync(filePath, buffer)
  return { id, mimeType, assetUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}`, thumbnailUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}`, originalUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}` }
}

function readLocalImageAsset(workId: string, assetId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(assetId)) throw new Error('图片 ID 无效')
  const workDir = path.join(ASSET_DIR, workId)
  const files = fs.existsSync(workDir) ? fs.readdirSync(workDir) : []
  const fileName = files.find(file => file.startsWith(`${assetId}.`))
  if (!fileName) throw new Error('图片不存在')
  const filePath = path.join(workDir, fileName)
  const buffer = fs.readFileSync(filePath)
  return { buffer, mimeType: detectMime(buffer), filePath }
}

function compact(value: string | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function fullChapterContent(chapter: NonNullable<WorkData['chapters']>[number]) {
  return String(chapter.content || '').replace(/\r\n?/g, '\n').trim()
}

function buildChapterVisualCandidateContext(work: WorkData, chapterId: string) {
  const chapter = (work.chapters || []).find(item => item.id === chapterId)
  if (!chapter) throw new Error('章节不存在')
  const sceneSummary = (chapter.scenes || [])
    .map(scene => `${scene.title || '未命名'}：${compact(scene.summary || scene.content).slice(0, 180)}`)
    .filter(Boolean)
    .join(' / ')
  return [
    `作品类型：${work.seed?.genre || '暂无'}${work.seed?.subGenre ? ` / ${work.seed.subGenre}` : ''}`,
    `章节：${chapter.title}`,
    `用户方向：${compact(chapter.userDirection) || '暂无'}`,
    `场景摘要：${sceneSummary || '暂无'}`,
    `完整章节正文：\n${fullChapterContent(chapter) || '暂无'}`,
  ].join('\n\n')
}

function buildCharacterMappingIndex(work: WorkData) {
  return (work.characters || []).map(character => `- id: ${character.id}; name: ${character.name}; tags: ${(character.tags || []).slice(0, 6).join('、') || '暂无'}`).join('\n') || '暂无'
}

function buildPeopleExtractionInstruction(context: string) {
  return `# 角色
你是一名专业的小说文本分析助手，擅长从小说完整章节中识别所有出现的人物（含路人）和视觉候选。

# 任务
从指定的小说完整章节中，提取本章节中出现的所有人物（包括主角、配角和路人）。本步骤只抽取章节人物，不要尝试把人物映射到作品角色库，也不要提取服饰或道具。

# 输入数据

## 当前章节内容
服务端会提供完整章节正文用于视觉理解。你只能依据章节内容提取人物和视觉候选，不能补写未出现的人物或物件。

# 输出要求

只输出严格 JSON，不要输出解释、Markdown 或额外文本。JSON 结构必须完全符合：
{"extracted_characters":[{"name":"章节中出现的角色名","alias_in_text":["章节中用过的别称/称呼/代称"],"mapping_status":"new_character","matched_character":"","character_type":"protagonist | supporting | unknown","context_summary":"该角色在本章节中的简要行为描述","first_mention":"首次出处的原文片段"}],"chapter_summary":"本章涉及的人物互动关系简述"}

# 匹配规则

1. 别名识别：章节中可能使用绰号、称号、姓氏、昵称、职位（如“掌门”、“将军”），需汇总到同一章节人物的 alias_in_text。
2. 指代消解：处理“他”、“她”、“此人”等代词时，需结合上下文判断指代对象；无法明确判断时不要单独输出代词人物。
3. 未匹配处理：本步骤不做作品角色映射，所有 mapping_status 固定为 new_character，matched_character 固定为空字符串。
4. 去重：同一角色多次出现只记录一次，alias_in_text 汇总所有出现过的称呼。
5. 谨慎抽取：所有路人、侍卫、店员、医者、围观者、远处人群等可见人物都必须保留。
6. 安全约束：不生成视觉提示词；不返回章节正文或长摘录；first_mention 不超过 40 字；信息不足时返回空数组。

上下文：
${context}`
}

function buildPropsExtractionInstruction(context: string) {
  return `# 角色
你是一名小说章节道具抽取助手。你只负责从完整章节中提取可画成独立素材的道具。

# 任务
从指定小说完整章节中提取明确出现的道具、武器、器物、符号、书信、钥匙等视觉素材。不要提取人物，不要生成视觉提示词。

# 输出要求

只输出严格 JSON，不要输出解释、Markdown 或额外文本。JSON 结构必须完全符合：
{"props":[{"label":"道具名称","description":"可见材质、形状、尺寸、纹样、使用痕迹或用途","characterName":"关联的章节人物名或空字符串","evidence":"不超过40字的章节证据"}]}

# 抽取规则

1. 只提取章节中明确出现的道具，不要根据剧情氛围补写不存在的物件。
2. 道具描述只写本体材质、形状、尺寸、纹样、使用痕迹和用途线索，不写人物动作、场景背景或镜头语言。
3. characterName 只用于辅助关联，最终道具视觉提示词不得包含角色姓名或手持动作。
4. 不返回章节正文或长摘录；信息不足时返回空数组。

上下文：
${context}`
}

function buildClothingExtractionInstruction(context: string, extractedCharacters: ExtractedCharacterInput[]) {
  const people = extractedCharacters.map((item, index) => `- ${index + 1}. ${safeText(item.name, 40)}；别称：${Array.isArray(item.alias_in_text) && item.alias_in_text.length ? item.alias_in_text.join('、') : '暂无'}；证据：${safeText(item.first_mention || item.context_summary, 80) || '暂无'}`).join('\n') || '暂无'
  return `# 角色
你是一名小说章节服饰抽取助手。你只负责从完整章节中提取章节人物的明确服饰描述。

# 任务
基于“章节人物列表”和完整章节正文，提取章节中明确写到的衣袍、制服、盔甲、配饰、颜色、材质、破损、血迹、洁净程度等服饰候选。

# 章节人物列表
${people}

# 输出要求

只输出严格 JSON，不要输出解释、Markdown 或额外文本。JSON 结构必须完全符合：
{"clothing":[{"label":"服饰名称","description":"明确可见的材质、颜色、剪裁、层次、状态或配饰","characterName":"关联的章节人物名或空字符串","evidence":"不超过40字的明文证据"}]}

# 抽取规则

1. 只记录章节明文服饰，不要根据人物身份、职业、时代或场景推断基础服饰。
2. 没有明文服饰的人物不要输出服饰候选；用户可在前端选择固定“无描述”选项生成基础服饰草稿。
3. description 只写服饰本体，不写人物脸、身体、动作、背景、色调或场景氛围。
4. 不返回章节正文或长摘录；信息不足时返回空数组。

上下文：
${context}`
}

function buildPeopleMappingInstruction(extractedCharacters: ExtractedCharacterInput[], characterIndex: string) {
  const extracted = extractedCharacters.map((item, index) => {
    const aliases = Array.isArray(item.alias_in_text) ? item.alias_in_text.join('、') : ''
    return `- ${index + 1}. name: ${safeText(item.name, 40)}; aliases: ${aliases || '暂无'}; evidence: ${safeText(item.first_mention || item.context_summary, 80) || '暂无'}`
  }).join('\n') || '暂无'
  return `# 角色
你是一名小说角色映射助手。你只负责把“章节抽取人物”映射到“作品已知人物列表”，不要抽取新人物，不要生成视觉提示词。

# 输入

## 章节抽取人物
${extracted}

## 作品已知人物列表
${characterIndex}

# 输出要求

只输出严格 JSON，不要输出解释、Markdown 或额外文本。JSON 结构必须完全符合：
{"mappings":[{"extracted_name":"章节抽取人物 name","matched_character_id":"作品已知人物 id；无法确定则为空字符串","matched_character_name":"作品已知人物 name；无法确定则为空字符串","confidence":"exact | likely | none"}]}

# 映射规则

1. 只允许使用“作品已知人物列表”中的 id 和 name。
2. 章节称谓、别名、职位或代词能唯一指向某个已知人物时才映射。
3. 不确定、多义或列表中不存在时，matched_character_id 和 matched_character_name 都返回空字符串，confidence 返回 none。
4. 不要编造人物 id、name、关系或背景。`
}

function parseCandidateJSON(text: string): CandidateAIResponse {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
  if (!candidate || candidate === trimmed.slice(0, 0)) throw new Error('候选提取结果格式无效')
  const parsed = JSON.parse(candidate) as CandidateAIResponse
  return {
    extracted_characters: Array.isArray(parsed.extracted_characters) ? parsed.extracted_characters : [],
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    clothing: Array.isArray(parsed.clothing) ? parsed.clothing : [],
    props: Array.isArray(parsed.props) ? parsed.props : [],
    chapter_summary: typeof parsed.chapter_summary === 'string' ? parsed.chapter_summary : '',
  }
}

function parseCharacterMappingJSON(text: string): CharacterMappingAIResponse {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
  if (!candidate || candidate === trimmed.slice(0, 0)) throw new Error('角色映射结果格式无效')
  const parsed = JSON.parse(candidate) as CharacterMappingAIResponse
  return { mappings: Array.isArray(parsed.mappings) ? parsed.mappings : [] }
}

function safeText(value: string | undefined, maxLength = 80) {
  return compact(value).slice(0, maxLength)
}

function normalizeCandidateKey(value: string | undefined) {
  return safeText(value).toLowerCase().replace(/[\s·・,，。.!！?？:：;；「」『』“”"'()（）\[\]【】]/g, '')
}

function mapCharacterName(work: WorkData, names: string | string[] | undefined) {
  const candidateKeys = (Array.isArray(names) ? names : [names]).map(item => normalizeCandidateKey(item)).filter(Boolean)
  if (!candidateKeys.length) return undefined
  const indexed = (work.characters || []).map(character => ({
    character,
    keys: [character.id, character.name, ...(character.tags || [])].map(item => normalizeCandidateKey(String(item || ''))).filter(Boolean),
  }))
  const exactMatches = indexed.filter(item => candidateKeys.some(key => item.keys.includes(key)))
  if (exactMatches.length === 1) return exactMatches[0].character
  if (exactMatches.length > 1) return undefined
  const containsMatches = indexed.filter(item => candidateKeys.some(candidateKey => candidateKey.length >= 2 && item.keys.some(knownKey => knownKey.length >= 2 && (candidateKey.includes(knownKey) || knownKey.includes(candidateKey)))))
  return containsMatches.length === 1 ? containsMatches[0].character : undefined
}

function normalizeExtractedCharacters(response: CandidateAIResponse): ExtractedCharacterInput[] {
  if (response.extracted_characters?.length) return response.extracted_characters
  return (response.characters || []).map(item => ({
    name: item.name,
    alias_in_text: item.name ? [item.name] : [],
    mapping_status: 'new_character',
    matched_character: '',
    character_type: 'unknown',
    context_summary: item.evidence,
    first_mention: item.evidence,
  }))
}

function candidateId(kind: 'bystander' | 'clothing' | 'prop', label: string, index: number, evidence?: string) {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36)
  const hash = createHash('sha1').update(`${kind}:${label}:${index}:${safeText(evidence, 80)}`).digest('hex').slice(0, 8)
  return `${kind}:${slug || index + 1}:${hash}`
}

function mapCandidateResponse(work: WorkData, response: CandidateAIResponse, mappingResponse?: CharacterMappingAIResponse, mappingError?: string) {
  const seenCharacters = new Set<string>()
  const seenBystanders = new Set<string>()
  const bystanders: Array<{ kind: 'bystander'; id: string; name: string; evidence?: string }> = []
  const mappings = Array.isArray(mappingResponse?.mappings) ? mappingResponse.mappings : []
  const mappingByName = new Map(mappings.map(item => [normalizeCandidateKey(item.extracted_name), item]))
  const findMappingMatch = (item: ExtractedCharacterInput, name: string, aliases: string[]) => {
    const mapping = [name, ...aliases].map(value => mappingByName.get(normalizeCandidateKey(value))).find(Boolean)
    if (!mapping || mapping.confidence === 'none') return undefined
    const byId = (work.characters || []).find(character => character.id === safeText(mapping.matched_character_id, 80))
    if (byId) return byId
    return mapCharacterName(work, [safeText(mapping.matched_character_name, 80), safeText(item.matched_character, 80)])
  }
  const extractedMatches = normalizeExtractedCharacters(response).map((item, index) => {
    const aliases = Array.isArray(item.alias_in_text) ? item.alias_in_text.map(alias => safeText(alias, 40)).filter(Boolean) : []
    const name = safeText(item.name, 40) || aliases[0] || `未命名人物${index + 1}`
    const matched = findMappingMatch(item, name, aliases) || mapCharacterName(work, [safeText(item.matched_character, 40), name, ...aliases])
    return { item, aliases, name, matched }
  })
  const extracted_characters = extractedMatches.map(({ item, aliases, name, matched }) => {
    return {
      name,
      alias_in_text: Array.from(new Set(aliases.length ? aliases : [name])),
      mapping_status: matched ? 'matched' as const : 'new_character' as const,
      matched_character: matched?.name || '',
      character_type: matched ? (item.character_type === 'protagonist' ? 'protagonist' as const : 'supporting' as const) : 'unknown' as const,
      context_summary: safeText(item.context_summary, 120),
      first_mention: safeText(item.first_mention, 60),
    }
  })
  const subjectOwnerByName = new Map<string, { character?: { id: string; name: string }; bystander?: { kind: 'bystander'; id: string; name: string; evidence?: string } }>()
  const registerSubjectOwner = (names: string[], owner: { character?: { id: string; name: string }; bystander?: { kind: 'bystander'; id: string; name: string; evidence?: string } }) => {
    names.map(normalizeCandidateKey).filter(Boolean).forEach(key => subjectOwnerByName.set(key, owner))
  }
  const addBystander = (rawName: string | undefined, evidence: string | undefined, index: number) => {
    const name = safeText(rawName, 40)
    if (!name) return undefined
    const key = normalizeCandidateKey(name)
    const existing = bystanders.find(item => normalizeCandidateKey(item.name) === key)
    if (existing) return existing
    const bystander = { kind: 'bystander' as const, id: candidateId('bystander', name, index, evidence), name, evidence: safeText(evidence, 60) }
    if (!seenBystanders.has(bystander.id)) {
      seenBystanders.add(bystander.id)
      bystanders.push(bystander)
    }
    return bystander
  }
  const characters = extractedMatches.flatMap(({ item, aliases, name, matched }) => {
    const evidence = safeText(item.first_mention || item.context_summary, 60)
    if (!matched) {
      const bystander = addBystander(name, item.first_mention || item.context_summary, bystanders.length)
      if (bystander) registerSubjectOwner([name, ...aliases], { bystander })
      return []
    }
    registerSubjectOwner([name, ...aliases, safeText(item.matched_character, 40), matched.name], { character: { id: matched.id, name: matched.name } })
    if (seenCharacters.has(matched.id)) return []
    seenCharacters.add(matched.id)
    return [{ kind: 'character' as const, characterId: matched.id, name: matched.name, matchedName: name || matched.name, evidence }]
  })
  const mapSubjects = (items: CandidateSubjectInput[] | undefined, kind: 'clothing' | 'prop') => (items || []).map((item, index) => {
    const owner = subjectOwnerByName.get(normalizeCandidateKey(item.characterName))
    const matched = owner?.character || mapCharacterName(work, item.characterName)
    const bystander = matched ? undefined : owner?.bystander || addBystander(item.characterName, item.evidence, bystanders.length + index)
    const label = safeText(item.label, 60) || (kind === 'clothing' ? '未命名服饰' : '未命名道具')
    return { kind, id: candidateId(kind, label, index, item.evidence), label, description: safeText(item.description, 120), characterId: matched?.id, characterCandidateId: bystander?.id, characterName: matched?.name || bystander?.name || safeText(item.characterName, 60), evidence: safeText(item.evidence, 60) }
  })
  const clothing = mapSubjects(response.clothing, 'clothing')
  const result = { extracted_characters, characters, bystanders, clothing, props: mapSubjects(response.props, 'prop'), unmappedCharacters: bystanders.map(item => item.name), mappingStatus: mappingError ? 'partial' as const : 'ok' as const }
  return mappingError ? { ...result, mappingError } : result
}

function normalizeReferenceImageIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 10)
}

function normalizeViewDirection(value: unknown) {
  return value === 'front' || value === 'side' || value === 'back' ? value : undefined
}

async function resolveReferenceImageBytes(workId: string, work: WorkData, imageId: string, config: ImageGenerationConfig) {
  const image = work.visualAssets?.images?.[imageId]
  if (!image) throw new Error('参考图不存在或不属于当前作品')
  if (image.status !== 'succeeded' || image.storageStatus !== 'succeeded') throw new Error('只能选择已成功生成并完成存储的参考图')
  if (image.storageMode === 'local') {
    const assetId = image.localAssetId || image.id
    return readLocalImageAsset(workId, assetId)
  }
  if (image.storageMode === 'immich') {
    if (!image.immichAssetId) throw new Error('参考图 Immich 定位信息不完整')
    const bytes = await immichClientFromConfig(config).fetchAssetBytes(image.immichAssetId, 'original')
    return { buffer: bytes.buffer, mimeType: bytes.contentType }
  }
  throw new Error('参考图定位信息不完整')
}

function deleteLocalStagedImageAsset(workId: string, assetId: string) {
  const local = readLocalImageAsset(workId, assetId)
  fs.unlinkSync(local.filePath)
}

function slugPart(value: string | undefined, fallback: string) {
  const normalized = String(value || fallback).trim().replace(/\s+/g, '-').replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '').slice(0, 48)
  return normalized || fallback
}

function promptTypeLabel(promptId: string) {
  const type = promptId.split(':')[0]
  if (type === 'chapterClothing') return 'chapter-clothing'
  if (type === 'chapterProp') return 'chapter-prop'
  if (type === 'characterFullBody') return 'character-full-body'
  if (type === 'chapterObject') return 'chapter-object-legacy'
  return 'character-face'
}

function visualPromptLabel(type: ImagePromptType) {
  if (type === 'characterFace') return '角色高清面部特写'
  if (type === 'chapterClothing') return '章节服饰'
  if (type === 'chapterProp') return '章节道具'
  if (type === 'chapterObject') return '章节服饰/道具（旧）'
  return '角色多视角全身图'
}

function normalizePromptType(value: unknown): ImagePromptType | undefined {
  return value === 'characterFace' || value === 'chapterObject' || value === 'chapterClothing' || value === 'chapterProp' || value === 'characterFullBody' ? value : undefined
}

function normalizeCandidateKind(value: unknown): VisualCandidateKind | undefined {
  return value === 'character' || value === 'bystander' || value === 'clothing' || value === 'prop' ? value : undefined
}

function serverCharacterLine(work: WorkData, characterId: string | undefined) {
  const character = (work.characters || []).find(item => item.id === characterId)
  if (!character) return ''
  const tags = (character.tags || []).slice(0, 6).join('、')
  const traits = (character.personality?.traits || []).slice(0, 4).join('、')
  return [`作品角色：${character.name}`, character.role ? `角色定位：${character.role}` : '', tags ? `标签：${tags}` : '', traits ? `性格关键词：${traits}` : ''].filter(Boolean).join('\n')
}

function serverChapterLine(work: WorkData, chapterId: string | undefined) {
  const chapter = (work.chapters || []).find(item => item.id === chapterId)
  if (!chapter) return ''
  return [`章节：${chapter.title}`, `完整章节正文（仅用于提取必要主体证据，最终提示词不得照搬背景或长摘录）：\n${fullChapterContent(chapter) || '暂无'}`].join('\n')
}

function cachedVisualSubject(work: WorkData, chapterId: string | undefined, visualSubjectId: string | undefined, candidateKind: VisualCandidateKind | undefined): CachedSubjectCandidate | CachedBystanderCandidate | undefined {
  if (!chapterId || !visualSubjectId) return undefined
  if (visualSubjectId === NO_DESCRIPTION_CLOTHING_ID) return { kind: 'clothing' as const, id: visualSubjectId, label: '无描述', description: '当前章节未提供明确服饰描述。', evidence: '无描述' }
  const result = work.visualAssets?.candidateCache?.[chapterId]?.result
  if (!result) return undefined
  if (candidateKind === 'bystander') return result.bystanders?.find(item => item.id === visualSubjectId)
  if (candidateKind === 'clothing') return result.clothing?.find(item => item.id === visualSubjectId)
  if (candidateKind === 'prop') return result.props?.find(item => item.id === visualSubjectId)
  return result.clothing?.find(item => item.id === visualSubjectId) || result.props?.find(item => item.id === visualSubjectId) || result.bystanders?.find(item => item.id === visualSubjectId)
}

function isCachedBystanderSubject(subject: CachedSubjectCandidate | CachedBystanderCandidate): subject is CachedBystanderCandidate {
  return 'name' in subject && !('label' in subject)
}

function serverSubjectLine(subject: ReturnType<typeof cachedVisualSubject>) {
  if (!subject) return ''
  if (isCachedBystanderSubject(subject)) return [`本章未关联人物：${safeText(subject.name, 60)}`, subject.evidence ? `章节证据：${safeText(subject.evidence, 120)}` : ''].filter(Boolean).join('\n')
  return [`当前视觉主体：${safeText(subject.label, 80) || '未命名主体'}`, subject.description ? `主体描述：${safeText(subject.description, 180)}` : '主体描述：无描述', subject.evidence ? `章节证据：${safeText(subject.evidence, 120)}` : ''].filter(Boolean).join('\n')
}

function buildServerImagePromptContext(work: WorkData, body: Record<string, unknown>) {
  const type = normalizePromptType(body.type)
  if (!type) throw new Error('提示词类型无效')
  const characterId = typeof body.characterId === 'string' ? body.characterId : undefined
  const chapterId = typeof body.chapterId === 'string' ? body.chapterId : undefined
  const visualSubjectId = typeof body.visualSubjectId === 'string' ? body.visualSubjectId : undefined
  const candidateKind = normalizeCandidateKind(body.candidateKind)
  const subject = cachedVisualSubject(work, chapterId, visualSubjectId, candidateKind)
  return [
    `提示词类型：${visualPromptLabel(type)}`,
    serverCharacterLine(work, characterId),
    serverSubjectLine(subject),
    type === 'characterFullBody' ? '' : serverChapterLine(work, chapterId),
  ].filter(Boolean).join('\n\n')
}

function buildServerImagePromptInstruction(type: ImagePromptType, context: string) {
  return `任务：生成「${visualPromptLabel(type)}」视觉提示词草稿。

要求：
- 所有类型都优先生成纯白色背景、主体清晰、可复用的设定素材，不写复杂场景插画。
- 禁止输出背景环境、整体色调、场景氛围、电影感光影、压抑感、破碎感、禁锢感、毛孔可见等无关画质堆叠；不要写霓虹灯、金属墙面、废墟、雨夜、烟雾、战场、宫殿等场景。
- characterFace：纯白色背景，大头像或头肩近景，脸部占画面主体，清晰五官特征；必须描述眉形、眼睛、鼻梁、嘴唇、脸型、肤色、发型、表情和可复用面部特征；避免复杂环境、戏剧光影、剧情动作、身体姿势和道具。
- 如果上下文中的主体类型是 bystander 或“本章未关联人物”，只根据章节证据描述可见外貌，不补写姓名以外的角色生平、阵营、关系或未出现设定。
- chapterClothing：纯白色背景，服饰主体单独展示，突出材质、配色、剪裁、层次、纹样、磨损和时代线索；不要包含角色姓名、角色身份、人物脸、身体、姿势、手持动作、剧情动作、背景、色调或场景氛围。
- chapterProp：纯白色背景，道具主体单独展示，突出材质、形状、尺寸、纹样、使用痕迹和用途线索；不要包含角色姓名、角色身份、人物脸、身体、手持动作、剧情动作、背景、色调或场景氛围。
- characterFullBody：纯白色背景，全身设定图，清晰展示角色体型、服饰轮廓、配色和可复用视觉特征；不要写剧情场景或氛围背景。
- 不写剧情正文，不写解释，不写模型参数。
- 以一段可直接复制的提示词输出。
- 如果信息不足，保留为可编辑的合理占位描述，不要编造关键设定。

上下文：
${context}`
}

function buildImmichFilename(work: WorkRow, body: Record<string, unknown>, mimeType: string) {
  const data = JSON.parse(work.data) as { title?: string; chapters?: Array<{ id: string; title: string }>; characters?: Array<{ id: string; name: string }> }
  const promptId = String(body.promptId || '')
  const chapterId = String(body.chapterId || '')
  const characterId = String(body.characterId || '')
  const chapter = data.chapters?.find(item => item.id === chapterId)
  const character = data.characters?.find(item => item.id === characterId)
  const subject = chapter?.title || character?.name || 'visual'
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return [
    slugPart(String(body.immichProjectName || 'story-matrix'), 'story-matrix'),
    slugPart(work.ownerId, 'user'),
    slugPart(data.title || work.id, 'work'),
    slugPart(subject, 'asset'),
    promptTypeLabel(promptId),
    timestamp,
    randomUUID().slice(0, 8),
  ].join('-') + `.${extensionForMime(mimeType)}`
}

function immichClientFromConfig(config: ImageGenerationConfig) {
  const immich = config.immich
  if (!immich?.serviceUrl || !immich.apiKey || !immich.projectName) throw new Error('Immich 存储配置不完整')
  return new ImmichClient({ serviceUrl: immich.serviceUrl, apiKey: immich.apiKey, projectName: immich.projectName, allowPrivateNetwork: immich.allowPrivateNetwork })
}

async function uploadToImmichWithRetry(client: ImmichClient, buffer: Buffer, filename: string, mimeType: string, albumId: string) {
  let lastError: unknown
  for (let attempt = 0; attempt <= IMMICH_UPLOAD_RETRY_LIMIT; attempt += 1) {
    try {
      return await client.uploadImage({ buffer, filename, mimeType, albumId })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Immich 上传失败')
}

function providerFromDiscoveryDraft(body: Record<string, unknown>, existing: ImageGenerationConfig): ImageGenerationProviderConfig | null {
  const providerId = String(body.providerId || '').trim()
  const savedProvider = providerId ? existing.providers.find(provider => provider.id === providerId) : undefined
  const draft = typeof body.provider === 'object' && body.provider ? body.provider as Record<string, unknown> : undefined
  if (!draft) return savedProvider || null
  const normalized = normalizeImageGenerationConfig({ providers: [{ ...savedProvider, ...draft, id: providerId || draft.id || savedProvider?.id || 'draft-provider' }], models: [] })
  const provider = normalized.providers[0]
  if (provider.apiKey === '__server_configured__' && savedProvider?.apiKey) provider.apiKey = savedProvider.apiKey
  return provider
}

router.post('/providers/discover-models', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  if (!request.currentUser || !['owner', 'admin'].includes(request.currentUser.role)) return res.status(403).json({ error: '需要管理员权限' })
  try {
    const config = loadImageGenerationConfig()
    const provider = providerFromDiscoveryDraft(req.body as Record<string, unknown>, config)
    if (!provider) return res.status(400).json({ error: '缺少生图厂商配置' })
    const candidates = (await discoverProviderModels(provider)).map(candidate => ({
      providerModel: candidate.providerModel,
      label: candidate.label,
      capabilities: candidate.capabilities,
      source: candidate.source,
      requiresConfirmation: candidate.requiresConfirmation,
    }))
    res.json({ candidates })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '模型列表获取失败' })
  }
})

router.post('/extract-candidates', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const workId = String(body.workId || '')
  const chapterId = String(body.chapterId || '')
  if (!workId || !chapterId) return res.status(400).json({ error: '缺少作品或章节' })
  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const access = workAccess(request, workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  try {
    const work = JSON.parse(access.row.data) as WorkData
    const context = buildChapterVisualCandidateContext(work, chapterId)
    const extractionText = await generateTextPrompt([
      { role: 'system', content: '你是小说章节视觉候选提取助手。你只输出严格 JSON。' },
      { role: 'user', content: buildPeopleExtractionInstruction(context) },
    ])
    const extraction = parseCandidateJSON(extractionText)
    const extracted = normalizeExtractedCharacters(extraction)
    const [propsText, clothingText] = await Promise.all([
      generateTextPrompt([
        { role: 'system', content: '你是小说章节道具抽取助手。你只输出严格 JSON。' },
        { role: 'user', content: buildPropsExtractionInstruction(context) },
      ]),
      generateTextPrompt([
        { role: 'system', content: '你是小说章节服饰抽取助手。你只输出严格 JSON。' },
        { role: 'user', content: buildClothingExtractionInstruction(context, extracted) },
      ]),
    ])
    const props = parseCandidateJSON(propsText)
    const clothing = parseCandidateJSON(clothingText)
    const candidates = { ...extraction, props: props.props, clothing: clothing.clothing }
    let mapping: CharacterMappingAIResponse | undefined
    let mappingError: string | undefined
    if (extracted.length > 0 && (work.characters || []).length > 0) {
      try {
        const mappingText = await generateTextPrompt([
          { role: 'system', content: '你是小说角色映射助手。你只输出严格 JSON。' },
          { role: 'user', content: buildPeopleMappingInstruction(extracted, buildCharacterMappingIndex(work)) },
        ])
        mapping = parseCharacterMappingJSON(mappingText)
      } catch {
        mappingError = '角色映射失败，已保留未关联人物候选。'
      }
    }
    res.json(mapCandidateResponse(work, candidates, mapping, mappingError))
  } catch {
    res.status(502).json({ extracted_characters: [], characters: [], bystanders: [], clothing: [], props: [], unmappedCharacters: [], mappingStatus: 'failed', error: '章节视觉候选提取失败，请稍后重试' })
  }
})

router.post('/generate', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const workId = String(body.workId || '')
  const prompt = String(body.prompt || '').trim()
  const referenceImageIds = normalizeReferenceImageIds(body.referenceImageIds)
  const viewDirection = normalizeViewDirection(body.viewDirection)
  if (!workId || !prompt) return res.status(400).json({ error: '缺少作品或提示词' })
  if (prompt.length > 8000) return res.status(400).json({ error: '提示词过长' })
  if (body.viewDirection !== undefined && !viewDirection) return res.status(400).json({ error: '视角方向无效' })

  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const access = workAccess(request, workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  const resolved = resolveEnabledImageModel(config, String(body.modelId || config.defaultModelId))
  if (!resolved) return res.status(400).json({ error: '生图模型不可用' })
  const { provider, model } = resolved
  if (!provider.apiKey) return res.status(400).json({ error: '生图厂商未配置 API Key' })

  try {
    const work = JSON.parse(access.row.data) as WorkData
    const maxReferenceImages = Math.min(3, model.capabilities.maxReferenceImages || 0)
    if (referenceImageIds.length > 0 && !model.capabilities.referenceImages) return res.status(400).json({ error: '该模型不支持参考图' })
    if (referenceImageIds.length > maxReferenceImages) return res.status(400).json({ error: `参考图最多选择 ${maxReferenceImages} 张` })
    const referenceImages: ProviderReferenceImage[] = []
    for (const imageId of referenceImageIds) referenceImages.push(await resolveReferenceImageBytes(workId, work, imageId, config))
    const generationPrompt = viewDirection ? `${prompt}\n${VIEW_DIRECTION_SUFFIX[viewDirection]}` : prompt
    const storageMode = config.storageMode === 'immich' ? 'immich' : 'local'
    const immichClient = storageMode === 'immich' ? immichClientFromConfig(config) : undefined
    if (immichClient) await immichClient.assertReadyForUpload()
    const generated = await generateProviderImages(provider, model, generationPrompt, { ...safeGenerationOptions(body, model), referenceImages })
    const buffer = generated[0].buffer
    const mimeType = detectMime(buffer)
    const snapshots = { basePromptSnapshot: prompt, generationPromptSnapshot: generationPrompt, viewDirection, referenceImageIds }
    if (storageMode === 'local') {
      const saved = saveImageAsset(workId, buffer)
      return res.json({ ...saved, localAssetId: saved.id, storageMode: 'local', storageStatus: 'succeeded', status: 'succeeded', modelId: model.id, modelName: model.model, provider: model.provider, ...snapshots })
    }
    const albumId = await immichClient!.ensureProjectAlbum()
    const filename = buildImmichFilename(access.row, { ...body, immichProjectName: config.immich?.projectName }, mimeType)
    try {
      const uploaded = await uploadToImmichWithRetry(immichClient!, buffer, filename, mimeType, albumId)
      const id = randomUUID()
      return res.json({
        id,
        mimeType,
        storageMode: 'immich',
        storageStatus: 'succeeded',
        status: 'succeeded',
        immichAssetId: uploaded.assetId,
        immichFilename: uploaded.filename,
        thumbnailUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}/thumbnail`,
        originalUrl: `/api/image-generation/assets/${encodeURIComponent(workId)}/${encodeURIComponent(id)}/original`,
        modelId: model.id,
        modelName: model.model,
        provider: model.provider,
        ...snapshots,
      })
    } catch (uploadError) {
      const id = randomUUID()
      const fallback = saveImageAsset(workId, buffer)
      return res.status(202).json({
        id,
        mimeType,
        storageMode: 'immich',
        storageStatus: 'storageUploadFailed',
        status: 'storageUploadFailed',
        localAssetId: fallback.id,
        assetUrl: fallback.assetUrl,
        immichFilename: filename,
        thumbnailUrl: fallback.thumbnailUrl,
        originalUrl: fallback.originalUrl,
        modelId: model.id,
        modelName: model.model,
        provider: model.provider,
        ...snapshots,
        error: uploadError instanceof Error ? uploadError.message : 'Immich 上传失败，已保留可重试状态',
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '生图请求失败'
    res.status(502).json({ error: message })
  }
})

router.post('/prompt', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const workId = String(body.workId || '')
  const type = normalizePromptType(body.type)
  if (!workId || !type) return res.status(400).json({ error: '缺少作品或提示词类型' })
  const config = loadImageGenerationConfig()
  if (!canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
  const access = workAccess(request, workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  try {
    const work = JSON.parse(access.row.data) as WorkData
    const context = buildServerImagePromptContext(work, body)
    const instruction = buildServerImagePromptInstruction(type, context)
    if (context.length > 30000 || instruction.length > 36000) return res.status(400).json({ error: '提示词上下文过长' })
    const prompt = await generateTextPrompt([
      { role: 'system', content: IMAGE_PROMPT_SYSTEM_PROMPT },
      { role: 'user', content: instruction },
    ])
    res.json({ prompt: safeVisualPromptOutput(prompt, work) })
  } catch {
    res.status(502).json({ error: '视觉提示词生成失败，请稍后重试' })
  }
})

router.post('/immich/health', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  if (!request.currentUser || !['owner', 'admin'].includes(request.currentUser.role)) return res.status(403).json({ error: '需要管理员权限' })
  try {
    const config = loadImageGenerationConfig()
    const client = immichClientFromConfig(config)
    await client.assertReadyForUpload()
    const albumId = await client.ensureProjectAlbum()
    res.json({ ok: true, albumId, projectName: config.immich?.projectName })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Immich 连接检查失败' })
  }
})

router.post('/assets/:workId/:assetId/retry-immich', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const access = workAccess(request, req.params.workId, true)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  const data = JSON.parse(access.row.data) as { visualAssets?: { images?: Record<string, ImageAssetRecord> } }
  const image = data.visualAssets?.images?.[req.params.assetId]
  if (!image || image.storageMode !== 'immich') return res.status(404).json({ error: 'Immich 图片记录不存在' })
  if (!image.localAssetId || !image.immichFilename) return res.status(400).json({ error: '图片缺少本地暂存引用，无法重传' })
  try {
    const config = loadImageGenerationConfig()
    const client = immichClientFromConfig(config)
    await client.assertReadyForUpload()
    const albumId = await client.ensureProjectAlbum()
    const local = readLocalImageAsset(req.params.workId, image.localAssetId)
    const uploaded = await uploadToImmichWithRetry(client, local.buffer, image.immichFilename, local.mimeType, albumId)
    deleteLocalStagedImageAsset(req.params.workId, image.localAssetId)
    res.json({
      storageMode: 'immich',
      storageStatus: 'succeeded',
      status: 'succeeded',
      immichAssetId: uploaded.assetId,
      immichFilename: uploaded.filename,
      localAssetId: undefined,
      assetUrl: undefined,
      thumbnailUrl: `/api/image-generation/assets/${encodeURIComponent(req.params.workId)}/${encodeURIComponent(req.params.assetId)}/thumbnail`,
      originalUrl: `/api/image-generation/assets/${encodeURIComponent(req.params.workId)}/${encodeURIComponent(req.params.assetId)}/original`,
      error: undefined,
    })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Immich 重传失败' })
  }
})

router.get('/assets/:workId/:assetId', (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const access = workAccess(request, req.params.workId, false)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  if (!/^[a-f0-9-]{36}$/i.test(req.params.assetId)) return res.status(400).json({ error: '图片 ID 无效' })
  const local = readLocalImageAsset(req.params.workId, req.params.assetId)
  res.setHeader('Content-Type', local.mimeType)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.end(local.buffer)
})

router.get('/assets/:workId/:assetId/:variant', async (req, res) => {
  const request = req as unknown as AuthenticatedRequest
  const access = workAccess(request, req.params.workId, false)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })
  const variant = req.params.variant === 'original' ? 'original' : 'thumbnail'
  const data = JSON.parse(access.row.data) as { visualAssets?: { images?: Record<string, ImageAssetRecord> } }
  const image = data.visualAssets?.images?.[req.params.assetId]
  if (!image) return res.status(404).json({ error: '图片记录不存在' })
  if (image.storageMode !== 'immich') return res.redirect(image.assetUrl || `/api/image-generation/assets/${encodeURIComponent(req.params.workId)}/${encodeURIComponent(image.localAssetId || image.id)}`)
  try {
    const config = loadImageGenerationConfig()
    const client = immichClientFromConfig(config)
    let assetId = image.immichAssetId
    if (!assetId && image.immichFilename) {
      const matches = (await client.searchByFilename(image.immichFilename)).filter(item => item.originalFileName === image.immichFilename || item.originalPath?.endsWith(image.immichFilename || ''))
      if (matches.length !== 1) return res.status(404).json({ error: 'Immich 文件名兜底未命中唯一资产' })
      assetId = matches[0].id
    }
    if (!assetId) return res.status(404).json({ error: 'Immich asset id 缺失' })
    const imageBytes = await client.fetchAssetBytes(assetId, variant)
    res.setHeader('Content-Type', imageBytes.contentType)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.end(imageBytes.buffer)
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Immich 图片读取失败' })
  }
})

export default router
