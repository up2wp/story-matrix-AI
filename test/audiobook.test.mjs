import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const typesSource = await readFile(new URL('../src/core/types.ts', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../src/core/store.ts', import.meta.url), 'utf8')
const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const worksRouteSource = await readFile(new URL('../server/src/routes/works.ts', import.meta.url), 'utf8')
const systemConfigRouteSource = await readFile(new URL('../server/src/routes/system-config.ts', import.meta.url), 'utf8')
const serverIndexSource = await readFile(new URL('../server/src/index.ts', import.meta.url), 'utf8')
const voiceboxRouteSource = await readFile(new URL('../server/src/routes/voicebox.ts', import.meta.url), 'utf8')
const userVoicesRouteSource = await readFile(new URL('../server/src/routes/user-voices.ts', import.meta.url), 'utf8')
const voiceboxClientSource = await readFile(new URL('../src/features/audiobook/voiceboxClient.ts', import.meta.url), 'utf8')
const audioUtilsSource = await readFile(new URL('../src/features/audiobook/audioUtils.ts', import.meta.url), 'utf8')
const promptTemplateUtilsSource = await readFile(new URL('../src/features/audiobook/promptTemplateUtils.ts', import.meta.url), 'utf8')
const useUserVoicesSource = await readFile(new URL('../src/features/audiobook/useUserVoices.ts', import.meta.url), 'utf8')
const systemConfigStoreSource = await readFile(new URL('../src/core/system-config-store.ts', import.meta.url), 'utf8')
const adminPageSource = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const useAudiobookSource = await readFile(new URL('../src/features/audiobook/useAudiobook.ts', import.meta.url), 'utf8')
const audiobookPromptSource = await readFile(new URL('../src/ai/prompts/audiobook.ts', import.meta.url), 'utf8')
const previewPageSource = await readFile(new URL('../src/pages/preview/PreviewPage.tsx', import.meta.url), 'utf8')
const audiobookPanelSource = await readFile(new URL('../src/pages/preview/AudiobookPanel.tsx', import.meta.url), 'utf8')
const voiceBindingCardSource = await readFile(new URL('../src/pages/preview/VoiceBindingCard.tsx', import.meta.url), 'utf8')
const chapterAudiobookPanelSource = await readFile(new URL('../src/pages/chapters/ChapterAudiobookPanel.tsx', import.meta.url), 'utf8')
const characterVoicesPageSource = await readFile(new URL('../src/pages/character-voices/CharacterVoicesPage.tsx', import.meta.url), 'utf8')
const voicesPageSource = await readFile(new URL('../src/pages/voices/VoicesPage.tsx', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const chapterAudioPlayerSource = await readFile(new URL('../src/pages/preview/ChapterAudioPlayer.tsx', import.meta.url), 'utf8')
const segmentReviewTableSource = await readFile(new URL('../src/pages/preview/SegmentReviewTable.tsx', import.meta.url), 'utf8')
const segmentRulesSource = await readFile(new URL('../src/features/audiobook/segmentRules.ts', import.meta.url), 'utf8')
const segmentUtilsSource = await readFile(new URL('../src/features/audiobook/segmentUtils.ts', import.meta.url), 'utf8')
const readmeSource = await readFile(new URL('../README.md', import.meta.url), 'utf8')

function loadSegmentRulesForTest() {
  let nextId = 0
  const executableSource = segmentRulesSource
    .replace(/^import type .*$/m, '')
    .replace(/^import \{ generateId \}.*$/m, 'const generateId = () => `test-segment-${nextId += 1}`')
    .replace('export function createRuleBasedSegments', 'function createRuleBasedSegments')
    .replace('export function segmentsNeedingAttribution', 'function segmentsNeedingAttribution')
  const { outputText } = ts.transpileModule(executableSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023 },
  })
  return Function('nextId', `${outputText}; return { createRuleBasedSegments, segmentsNeedingAttribution }`)(nextId)
}

const { createRuleBasedSegments: createRuleBasedSegmentsForTest, segmentsNeedingAttribution: segmentsNeedingAttributionForTest } = loadSegmentRulesForTest()

function loadWorksRouteForTest() {
  const mergeRecordStart = worksRouteSource.indexOf('function mergeRecord')
  const segmentPatchStart = worksRouteSource.indexOf('const SEGMENT_PATCH_FIELDS')
  const executableSource = worksRouteSource.slice(mergeRecordStart, segmentPatchStart)
  const { outputText } = ts.transpileModule(executableSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023 },
  })
  return Function(`${outputText}; return { mergeAudiobook }`)()
}

const { mergeAudiobook: mergeAudiobookForTest } = loadWorksRouteForTest()

function loadSegmentUtilsForTest() {
  let nextId = 0
  const executableSource = segmentUtilsSource
    .replace(/^import type .*$/m, '')
    .replace(/^import \{ generateId \}.*$/m, 'const generateId = () => `test-refined-${nextId += 1}`')
    .replace('export interface AttributionResult', 'interface AttributionResult')
    .replace('export interface AttributionChildResult', 'interface AttributionChildResult')
    .replace('export function parseSegmentJson', 'function parseSegmentJson')
    .replace('export function normalizeSegments', 'function normalizeSegments')
    .replace('export function parseAttributionJson', 'function parseAttributionJson')
    .replace('export function applyAttributionResults', 'function applyAttributionResults')
    .replace('export function segmentContainsQuotes', 'function segmentContainsQuotes')
    .replace('export function applySegmentRefinementResults', 'function applySegmentRefinementResults')
    .replace('export function markAttributionFailed', 'function markAttributionFailed')
    .replace('export function mergeConsecutiveSegments', 'function mergeConsecutiveSegments')
    .replace('export function segmentSpeakerKey', 'function segmentSpeakerKey')
  const { outputText } = ts.transpileModule(executableSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023 },
  })
  return Function('nextId', `${outputText}; return { normalizeSegments, applyAttributionResults, segmentContainsQuotes, applySegmentRefinementResults }`)(nextId)
}

const { normalizeSegments: normalizeSegmentsForTest, applyAttributionResults: applyAttributionResultsForTest, segmentContainsQuotes: segmentContainsQuotesForTest, applySegmentRefinementResults: applySegmentRefinementResultsForTest } = loadSegmentUtilsForTest()

function loadVoiceBindingCardForTest() {
  const helperStart = voiceBindingCardSource.indexOf('const MIN_VOICE_SELECT_WIDTH')
  const componentStart = voiceBindingCardSource.indexOf('export default function VoiceBindingCard')
  assert.ok(helperStart >= 0, 'VoiceBindingCard should define adaptive select sizing constants')
  assert.ok(componentStart > helperStart, 'VoiceBindingCard sizing helper should be defined before the component')
  const executableSource = voiceBindingCardSource.slice(helperStart, componentStart)
    .replace('export function getVoiceSelectWidth', 'function getVoiceSelectWidth')
  const { outputText } = ts.transpileModule(executableSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023 },
  })
  return Function(`${outputText}; return { getVoiceSelectWidth }`)()
}

const { getVoiceSelectWidth: getVoiceSelectWidthForTest } = loadVoiceBindingCardForTest()

assert.equal(
  getVoiceSelectWidthForTest(['短音色', '特别长的角色声音名称用于验证下拉选框宽度会跟随选项扩展'], 1440),
  474,
  'voice select should grow with long option labels on wide screens',
)

assert.equal(
  getVoiceSelectWidthForTest(['特别长的角色声音名称用于验证下拉选框宽度会跟随选项扩展并且不能无限扩大超过桌面上限'], 1440),
  520,
  'voice select should not exceed the desktop width cap',
)

assert.equal(
  getVoiceSelectWidthForTest(['特别长的角色声音名称用于验证移动端不会横向溢出屏幕'], 360),
  296,
  'voice select should cap itself to the mobile viewport minus page breathing room',
)

assert.equal(
  getVoiceSelectWidthForTest([], 1440),
  240,
  'voice select should keep a usable minimum width when no voices are available',
)

function workForSegmentRules() {
  return {
    id: 'work-1',
    characters: [
      { id: 'character-kamishiro', name: '神代司', role: 'major', bio: '', personality: { traits: [], habits: [], arc: [] }, relations: [], tags: [] },
      { id: 'character-chiba', name: '千叶雏', role: 'major', bio: '', personality: { traits: [], habits: [], arc: [] }, relations: [], tags: [] },
    ],
  }
}

function chapterForSegmentRules(content) {
  return { id: 'chapter-1', outlineId: 'outline-1', title: '测试章节', content, wordCount: content.length, scenes: [], versions: [] }
}

assert.match(
  typesSource,
  /audiobook\?: WorkAudiobookConfig/,
  'Work should carry optional audiobook state so old works remain loadable',
)

assert.match(
  typesSource,
  /AudiobookAttributionStatus/,
  'audiobook segments should persist attribution state separately from audio generation status',
)

assert.match(
  typesSource,
  /segmentationSource\?: AudiobookSegmentationSource/,
  'audiobook segments should record whether they came from legacy, AI, or rule segmentation',
)

assert.match(
  storeSource,
  /if \(!work\.audiobook\)/,
  'legacy works should receive audiobook defaults during client migration',
)

assert.match(
  storeSource,
  /segmentationSource: typeof record\.segmentationSource === 'string' \? record\.segmentationSource : 'legacy'/,
  'legacy segments should migrate with explicit segmentation source metadata',
)

assert.match(
  worksRouteSource,
  /router\.patch\('\/:id\/audiobook'[\s\S]*res\.json\(\{ audiobook: merged\.audiobook, updatedAt \}\)/,
  'audiobook persistence should use a dedicated minimal endpoint that returns only audiobook state and updatedAt',
)

assert.match(
  useAudiobookSource,
  /db\.works\.updateAudiobook\(work\.id, audiobookChanges\)/,
  'audiobook persistence should send audiobook deltas instead of PATCHing the whole audiobook through the generic work endpoint',
)

assert.match(
  useAudiobookSource,
  /function audiobookDelta\(current: WorkAudiobookConfig, next: WorkAudiobookConfig\)[\s\S]*const segmentsByChapter = changedRecordEntries\(current\.segmentsByChapter, next\.segmentsByChapter\)[\s\S]*const chapterAudio = changedRecordEntries\(current\.chapterAudio, next\.chapterAudio\)/,
  'audiobook persistence should compute changed record entries so single-segment generation does not send unrelated audiobook state',
)

assert.match(
  useAudiobookSource,
  /const audiobookChanges = work\.audiobook \? audiobookDelta\(work\.audiobook, nextAudiobook\) : nextAudiobook/,
  'audiobook persistence should send a full audiobook only for first-time initialization and deltas afterwards',
)

assert.doesNotMatch(
  useAudiobookSource,
  /const audiobookChanges = nextAudiobook/,
  'audiobook persistence should not use the full nextAudiobook object as the network payload',
)

assert.doesNotMatch(
  useAudiobookSource,
  /db\.works\.update\(work\.id, \{ audiobook: nextAudiobook \}\)/,
  'audiobook generation should not send the entire audiobook object through the generic work update endpoint',
)

assert.match(
  storeSource,
  /function ensurePromptTemplatePlaceholder[\s\S]*speakerKind === 'narrator'[\s\S]*当前语境\[:：\][\s\S]*【上下文】[\s\S]*template\.includes\('【上下文】'\)/,
  'narrator prompts should migrate away from context placeholders while character prompts keep the required placeholder',
)

assert.match(
  storeSource,
  /function bindingNeedsPromptTemplateMigration[\s\S]*!record\.prompt\.includes\('【上下文】'\)[\s\S]*!record\.promptTemplate\.includes\('【上下文】'\)/,
  'legacy non-empty prompt templates without the context placeholder should trigger audiobook migration',
)

assert.match(
  storeSource,
  /bindingNeedsPromptTemplateMigration\(audiobook\.narratorBinding\)[\s\S]*Object\.values\(characterBindings\)\.some\(bindingNeedsPromptTemplateMigration\)[\s\S]*Object\.values\(chapterBindings\)\.some/,
  'audiobook migration should persist placeholder repairs for narrator, global character, and chapter bindings',
)

assert.match(
  storeSource,
  /prompt: `\$\{work\.seed\.tone \|\| '自然'\}、清晰、适合长篇小说旁白。`[\s\S]*promptTemplate: `\$\{work\.seed\.tone \|\| '自然'\}、清晰、适合长篇小说旁白。`/,
  'new work audiobook defaults should use a fixed narrator prompt without context placeholders',
)

assert.match(
  worksRouteSource,
  /'audiobook'/,
  'work PATCH nested-key allowlist should persist audiobook state in works.data JSON',
)

const mergedBystanderBindings = mergeAudiobookForTest({
  bystanderBindings: {
    male: { id: 'bystander-male', profileId: 'old-male' },
    female: { id: 'bystander-female', profileId: 'old-female' },
  },
}, {
  bystanderBindings: {
    male: { id: 'bystander-male', profileId: 'new-male' },
  },
})
assert.deepEqual(
  mergedBystanderBindings.bystanderBindings,
  {
    male: { id: 'bystander-male', profileId: 'new-male' },
    female: { id: 'bystander-female', profileId: 'old-female' },
  },
  'audiobook PATCH merge should preserve the untouched bystander voice when saving only one side',
)

assert.match(
  dbSource,
  /CREATE TABLE IF NOT EXISTS userVoices/,
  'database migration should add user voice index with an additive CREATE TABLE path',
)

assert.match(
  dbSource,
  /CREATE TABLE IF NOT EXISTS voiceboxGenerations/,
  'database migration should add server-owned Voicebox generation authorization table',
)

assert.doesNotMatch(
  dbSource,
  /DROP TABLE|CREATE TABLE .*_new|ALTER TABLE .* RENAME/i,
  'voicebox migrations should not rebuild, rename, or drop existing data tables',
)

assert.match(
  storeSource,
  /chapterBindings: \{\}/,
  'legacy works should receive chapter binding defaults without deleting old audiobook data',
)

assert.match(
  typesSource,
  /AudiobookSpeakerKind = 'narrator' \| 'character' \| 'bystanderMale' \| 'bystanderFemale'/,
  'audiobook speaker kind should include fixed male and female bystander voices',
)

assert.match(
  storeSource,
  /BYSTANDER_PROMPT_TEMPLATE = '当前语境：【上下文】'[\s\S]*bystanderBindings:[\s\S]*路人男声[\s\S]*路人女声/,
  'new and migrated audiobook state should include fixed-prompt bystander voice bindings',
)

assert.match(
  systemConfigRouteSource,
  /voiceboxConfig/,
  'system config route should read and write Voicebox settings through the singleton config',
)

assert.match(
  typesSource,
  /generationConcurrency: number/,
  'Voicebox config should include a configurable audiobook generation concurrency limit',
)

assert.match(
  systemConfigStoreSource,
  /generationConcurrency: 2/,
  'browser Voicebox config defaults should cap audiobook generation concurrency at two jobs',
)

assert.match(
  systemConfigRouteSource,
  /generationConcurrency: 2/,
  'server Voicebox config defaults should cap audiobook generation concurrency at two jobs',
)

assert.match(
  adminPageSource,
  /name="generationConcurrency"[\s\S]*全局并发数量/,
  'Voicebox admin settings should let owners and admins configure the global generation concurrency limit',
)

assert.match(
  voiceboxRouteSource,
  /runWithVoiceboxGenerationSlot[\s\S]*loadVoiceboxGenerationConcurrency[\s\S]*activeVoiceboxGenerations[\s\S]*voiceboxGenerationQueue/,
  'Voicebox generation proxy should enforce one backend-wide queue shared by all users',
)

assert.match(
  typesSource,
  /authType: 'none' \| 'bearer' \| 'api-key' \| 'custom-header'/,
  'Voicebox config should support explicit auth modes for production services',
)

assert.match(
  systemConfigStoreSource,
  /serviceUrl: 'http:\/\/127\.0\.0\.1:17493'/,
  'local Voicebox URL should remain only as the default development value',
)

assert.match(
  adminPageSource,
  /https:\/\/voicebox\.example\.com/,
  'Voicebox admin UI should guide users toward remote production service URLs',
)

assert.match(
  systemConfigRouteSource,
  /maskVoiceboxConfig/,
  'public system config reads should mask Voicebox credentials',
)

assert.match(
  systemConfigRouteSource,
  /mergeVoiceboxConfig/,
  'saving masked Voicebox credentials should preserve existing server-side secrets',
)

assert.match(
  serverIndexSource,
  /app\.use\('\/api\/voicebox', requireAuth, voiceboxRouter\)/,
  'Voicebox proxy routes should be mounted behind authentication',
)

assert.match(
  serverIndexSource,
  /app\.use\('\/api\/user-voices', requireAuth, userVoicesRouter\)/,
  'user voice asset routes should be mounted behind authentication',
)

assert.match(
  userVoicesRouteSource,
  /ownerId = \?/,
  'user voice assets should be queried by owner id',
)

assert.match(
  userVoicesRouteSource,
  /consentConfirmedAt/,
  'user voice uploads should persist authorization confirmation time',
)

assert.match(
  userVoicesRouteSource,
  /loadProfileOwners\(\)\[profileId\] !== ownerId/,
  'user voice registration should only accept profiles owned by the current user',
)

assert.match(
  voiceboxRouteSource,
  /router\.get\('\/profiles'/,
  'Voicebox proxy should expose explicit profile listing route',
)

assert.match(
  voiceboxRouteSource,
  /profileOwners/,
  'Voicebox proxy should track locally-created profile owners in system config',
)

assert.match(
  voiceboxRouteSource,
  /filterVisibleProfiles/,
  'Voicebox profile listing should filter user-created profiles by current user',
)

assert.match(
  voiceboxRouteSource,
  /function canAccessGeneration/,
  'Voicebox audio and status proxy should authorize generation access server-side',
)

assert.match(
  voiceboxRouteSource,
  /FROM voiceboxGenerations WHERE generationId = \? AND ownerId = \?/,
  'Voicebox audio authorization must not trust user-writable work JSON',
)

assert.doesNotMatch(
  voiceboxRouteSource,
  /works WHERE ownerId|workContainsGeneration/,
  'Voicebox audio authorization should not scan user-writable works data',
)

assert.match(
  voiceboxRouteSource,
  /function ownsSample/,
  'Voicebox sample playback should only allow the owner of a locally-indexed sample',
)

assert.match(
  voiceboxRouteSource,
  /无权上传该音色样本/,
  'Voicebox sample upload should reject writes to public or other-user profiles',
)

assert.match(
  voiceboxRouteSource,
  /无权使用该音色/,
  'Voicebox generation should reject other-user private profiles',
)

assert.match(
  voiceboxRouteSource,
  /currentUser\.id/,
  'Voicebox profile filtering should use the authenticated user id',
)

assert.match(
  voiceboxRouteSource,
  /multipart\/form-data/,
  'reference uploads should forward multipart sample uploads to Voicebox semantics',
)

assert.match(
  voiceboxRouteSource,
  /参考音频不能超过 25MB/,
  'reference uploads should enforce a server-side size limit before forwarding',
)

assert.match(
  voiceboxRouteSource,
  /无权查看该音色样本/,
  'profile sample metadata should require profile ownership',
)

assert.match(
  voiceboxRouteSource,
  /function assertSafeId/,
  'Voicebox proxy should validate path IDs instead of forwarding arbitrary paths',
)

assert.match(
  voiceboxRouteSource,
  /function upstreamHeaders/,
  'Voicebox proxy should inject upstream authentication headers server-side',
)

assert.match(
  voiceboxRouteSource,
  /headers\.Authorization = `Bearer \$\{config\.bearerToken\}`/,
  'Voicebox proxy should support Bearer token authentication',
)

assert.match(
  voiceboxRouteSource,
  /headers\['X-API-Key'\] = config\.apiKey/,
  'Voicebox proxy should support API key authentication',
)

assert.match(
  voiceboxRouteSource,
  /headers\[config\.customHeaderName\] = config\.customHeaderValue/,
  'Voicebox proxy should support custom header authentication',
)

assert.match(
  voiceboxRouteSource,
  /\['http:', 'https:'\]\.includes\(parsed\.protocol\)/,
  'Voicebox proxy should support remote http/https service URLs and reject other schemes',
)

assert.doesNotMatch(
  voiceboxRouteSource,
  /router\.use\('\/\*'|router\.all\('\/\*'/,
  'Voicebox proxy should not use a generic catch-all local proxy',
)

assert.match(
  voiceboxClientSource,
  /fetch\(`\/api\/voicebox\$\{url\}`/,
  'browser Voicebox client should call same-origin backend proxy routes',
)

assert.match(
  voiceboxClientSource,
  /language\?: string/,
  'Voicebox profile creation should allow explicit language selection',
)

assert.match(
  useUserVoicesSource,
  /language: voiceboxConfig\.defaultLanguage/,
  'user voice creation should pass the configured Voicebox language to cloned profiles',
)

assert.match(
  voiceboxClientSource,
  /\/api\/user-voices/,
  'browser user voice client should call same-origin user voice routes',
)

assert.match(
  useAudiobookSource,
  /generatePromptTemplate/,
  'chapter bindings should expose AI-generated QwenTTS prompt templates',
)

assert.doesNotMatch(
  useAudiobookSource,
  /engine: voiceboxConfig\.defaultEngine/,
  'Voicebox generation should not use a configurable model for audiobook output',
)

assert.match(
  useAudiobookSource,
  /engine: 'qwen'/,
  'Voicebox generation should use the Voicebox qwen engine identifier',
)

assert.match(
  useAudiobookSource,
  /model_size: '1\.7B'/,
  'Voicebox generation should request the Qwen 1.7B model through model_size',
)

assert.doesNotMatch(
  useAudiobookSource,
  /qwentts1\.7b/,
  'Voicebox generation should not send the non-schema qwentts1.7b engine id',
)

assert.doesNotMatch(
  voiceboxRouteSource,
  /engine: 'qwentts1\.7b'/,
  'Voicebox proxy should not overwrite generation requests with a non-schema engine id',
)

assert.match(
  voiceboxRouteSource,
  /readVoiceboxStatus/,
  'Voicebox status proxy should adapt upstream SSE status responses into JSON',
)

assert.match(
  voiceboxRouteSource,
  /text\/event-stream/,
  'Voicebox status proxy should recognize Voicebox SSE responses',
)

assert.match(
  voiceboxClientSource,
  /export interface VoiceboxGenerationStatus[\s\S]*status\?: string/,
  'voicebox client should expose a typed generation status response for polling audio readiness',
)

assert.doesNotMatch(
  voiceboxClientSource,
  /127\.0\.0\.1:17493|serviceUrl|bearerToken|apiKey|customHeaderValue/,
  'browser Voicebox client should not call Voicebox directly or carry upstream credentials',
)

assert.doesNotMatch(
  previewPageSource,
  /<AudiobookPanel work=\{currentWork\} \/>/,
  'audiobook workflow should no longer live under full-text preview',
)

assert.match(
  chapterAudiobookPanelSource,
  /有声读物/,
  'chapter page should host the audiobook workflow under each written chapter',
)

assert.doesNotMatch(
  chapterAudiobookPanelSource,
  /VoiceBindingCard|旁白配置|本章角色音色/,
  'chapter audiobook panel should not render voice binding settings that now live on the character voice page',
)

assert.doesNotMatch(
  chapterAudiobookPanelSource,
  /searchParams\.get\('soundId'\)|bindChapterVoice|bindChapterProfile|saveChapterBinding/,
  'chapter audiobook panel should not consume voice-management return params after voice settings move out',
)

assert.match(
  voicesPageSource,
  /我确认这是自己的声音/,
  'voice management page should require voice authorization confirmation',
)

assert.match(
  voicesPageSource,
  /target\.searchParams\.set\('soundId', voice\.id\)/,
  'voice management should return the created soundId to the calling chapter',
)

assert.match(
  sidebarSource,
  /key: '\/works'[\s\S]*!readOnly[\s\S]*key: '\/voices'[\s\S]*\.\.\.\(hasWork/,
  'sidebar should expose user-level voice management directly below works before work-scoped items when editable',
)

assert.match(
  appSource,
  /path="\/voices"/,
  'app routing should include the voice management page',
)

assert.match(
  appSource,
  /path="\/character-voices"/,
  'app routing should include the work-scoped character voice settings page',
)

assert.match(
  sidebarSource,
  /!readOnly[\s\S]*key: '\/character-voices'[\s\S]*label: '角色声音'[\s\S]*key: '\/chapters'/,
  'sidebar should place character voice settings before chapter enrichment when editable',
)

assert.match(
  characterVoicesPageSource,
  /narratorBinding/,
  'character voice settings page should configure the work narrator voice',
)

assert.match(
  characterVoicesPageSource,
  /bystanderBindings[\s\S]*路人声音[\s\S]*fixedPrompt/,
  'character voice settings page should render fixed-prompt bystander voice cards below narrator voice',
)

assert.match(
  voiceBindingCardSource,
  /fixedPrompt[\s\S]*disabled=\{fixedPrompt\}[\s\S]*!fixedPrompt && <Space/,
  'fixed-prompt voice binding cards should disable prompt editing and hide prompt save actions',
)

assert.match(
  characterVoicesPageSource,
  /characterBindings/,
  'character voice settings page should load work characters for voice and prompt settings',
)

assert.match(
  characterVoicesPageSource,
  /useEffect\(\(\) => \{[\s\S]*if \(!currentWork\) return[\s\S]*void refreshProfiles\(\)[\s\S]*\}, \[currentWork, refreshProfiles\]\)/,
  'character voice settings page should refresh Voicebox profiles on entry so bound profile names render without manual refresh',
)

assert.match(
  useAudiobookSource,
  /missingBindings/,
  'generation should block when a segment speaker has no ready voice binding',
)

assert.match(
  useAudiobookSource,
  /const refreshProfiles = useCallback\(async \(\) => \{[\s\S]*voiceboxClient\.profiles\(\)[\s\S]*\}, \[\]\)/,
  'profile refresh callback should be stable so automatic refresh does not loop on every render',
)

assert.match(
  audiobookPromptSource,
  /当前语境：【上下文】/,
  'QwenTTS instruct prompts should preserve the context placeholder',
)

assert.doesNotMatch(
  audiobookPromptSource,
  /朗读[:：]【文本】|当前朗读[:：]【文本】|待朗读正文[:：]【文本】/,
  'QwenTTS instruct prompts should not require speech text placeholders because Voicebox receives text separately',
)

assert.match(
  promptTemplateUtilsSource,
  /removeSpeechTextPlaceholder/,
  'legacy prompt templates should strip speech text placeholders before building Voicebox instruct',
)

assert.match(
  promptTemplateUtilsSource,
  /fillPromptTemplate[\s\S]*overridePrompt\?: string[\s\S]*overridePrompt \|\| binding\.promptTemplate \|\| binding\.prompt/,
  'Voicebox instruct filling should allow a segment-level prompt override from the editable row prompt',
)

assert.match(
  promptTemplateUtilsSource,
  /if \(overridePrompt\?\.trim\(\)\)[\s\S]*return \{ instruct: prompt\.slice\(-limit\), clipped: prompt\.length > limit, hash: stableHash\(prompt\.slice\(-limit\)\) \}/,
  'editable row prompt should be treated as a ready Voicebox instruct without requiring template placeholders',
)

assert.match(
  promptTemplateUtilsSource,
  /binding\.speakerKind === 'narrator'[\s\S]*removeSpeechTextPlaceholder\(template\)[\s\S]*当前语境\[:：\][\s\S]*CONTEXT_PLACEHOLDER[\s\S]*return \{ instruct: narratorPrompt\.slice\(-limit\)/,
  'narrator audio generation should use narrator prompt body directly without filling segment context',
)

assert.match(
  promptTemplateUtilsSource,
  /buildSegmentTonePrompt[\s\S]*binding\.speakerKind === 'narrator'[\s\S]*removeSpeechTextPlaceholder\(template\)[\s\S]*当前语境\[:：\][\s\S]*CONTEXT_PLACEHOLDER/,
  'one-click tone prompt should apply the narrator prompt body directly without context replacement',
)

assert.match(
  promptTemplateUtilsSource,
  /buildSegmentTonePrompt[\s\S]*previousSegments[\s\S]*replaceAll\(CONTEXT_PLACEHOLDER, context\)/,
  'one-click tone prompt should fill character context from previous segments',
)

assert.match(
  audiobookPanelSource,
  /有声读物生成已迁移到章节丰盈/,
  'legacy preview audiobook panel should only point users to chapter enrichment',
)

assert.match(
  chapterAudiobookPanelSource,
  /SegmentReviewTable/,
  'chapter audiobook panel should show editable segment review before generation',
)

assert.match(
  voiceBindingCardSource,
  /我的声音/,
  'voice binding card should expose user-managed voices in the selector',
)

assert.doesNotMatch(
  audiobookPanelSource,
  /Upload|onUploadReference|上传到 Voicebox/,
  'legacy preview audiobook surface should not upload reference audio',
)

assert.match(
  useAudiobookSource,
  /retryFailedOnly/,
  'chapter generation should support retrying failed segments without duplicating completed work',
)

assert.match(
  useAudiobookSource,
  /regenerateSegmentAudio[\s\S]*segmentId[\s\S]*generateChapterAudio\(chapter, \{ segmentIds: \[segmentId\] \}\)/,
  'chapter generation should expose per-segment audio regeneration for edited tone prompts',
)

assert.match(
  useAudiobookSource,
  /fillPromptTemplate\(effectiveBinding, chapter, segment, segment\.prompt\)/,
  'chapter generation should pass the editable row prompt into Voicebox instruct filling',
)

assert.match(
  useAudiobookSource,
  /waitForVoiceboxGeneration\(generationId: string\)[\s\S]*voiceboxClient\.status\(generationId\)[\s\S]*VOICEBOX_COMPLETE_STATUSES\.has\(normalizedStatus\)/,
  'chapter generation should poll Voicebox status and wait for completed before marking segment audio downloadable',
)

assert.match(
  useAudiobookSource,
  /await waitForVoiceboxGeneration\(generationId\)[\s\S]*status: 'completed'/,
  'segment status should become completed only after Voicebox reports the audio generation completed',
)

assert.match(
  useAudiobookSource,
  /const VOICEBOX_GENERATION_CONCURRENCY = 2[\s\S]*Array\.from\(\{ length: Math\.min\(VOICEBOX_GENERATION_CONCURRENCY, segmentsToGenerate\.length\) \}/,
  'chapter audio generation should cap concurrent Voicebox generation jobs at two segments',
)

assert.match(
  useAudiobookSource,
  /const targetGenerationSegments = targetSegmentIds \? (nextSegments|latestSegments)\.filter\(\(segment\) => targetSegmentIds\.has\(segment\.id\)\) : (nextSegments|latestSegments)[\s\S]*const failed = targetGenerationSegments\.filter\(\(segment\) => segment\.status === 'failed'\)/,
  'targeted segment regeneration should count failures only for the requested segment instead of the whole chapter',
)

assert.match(
  segmentRulesSource,
  /createRuleBasedSegments/,
  'audiobook segmentation should start with a local rule-based splitter',
)

assert.match(
  segmentRulesSource,
  /QUOTE_PATTERN/,
  'rule-based segmentation should explicitly detect dialogue quote spans',
)

assert.match(
  segmentRulesSource,
  /shouldSplitQuote/,
  'rule-based segmentation should avoid splitting quoted place names or terms inside one narrator sentence',
)

assert.match(
  segmentRulesSource,
  /if \(!matches\.some/,
  'quoted terms without dialogue cues should remain in the original paragraph segment',
)

const kamishiroSample = '神代司的声音温和得像是在读一份医学报告，没有任何起伏，“在真田那个粗鲁的屠夫手下待了三天，竟然还能保持这种眼神。真是令人赞叹的……伦理坚守。”'
const kamishiroSegments = createRuleBasedSegmentsForTest(workForSegmentRules(), chapterForSegmentRules(kamishiroSample))
assert.deepEqual(
  kamishiroSegments.map((segment) => segment.text),
  [
    '神代司的声音温和得像是在读一份医学报告，没有任何起伏',
    '在真田那个粗鲁的屠夫手下待了三天，竟然还能保持这种眼神。真是令人赞叹的……伦理坚守。',
  ],
  'voice-cue narration before a Chinese quote should split into narrator cue and reviewable dialogue text',
)
assert.equal(kamishiroSegments[1].needsReview, true, 'unknown speaker dialogue should be marked for review')
assert.equal(kamishiroSegments[1].retryable, true, 'unknown speaker dialogue should be retryable for attribution')
assert.equal(kamishiroSegments[1].sourceStartOffset, kamishiroSample.indexOf('在真田'), 'dialogue offset should point at the first character inside the quote')

const chibaSample = '千叶雏死死地盯着他，嘴唇颤抖着，声音虽轻却带着一种刻在骨子里的矜持：“杀了我……或者救我。但请你，不要用那种看牲口一样的眼神看着我。”'
const chibaSegments = createRuleBasedSegmentsForTest(workForSegmentRules(), chapterForSegmentRules(chibaSample))
assert.deepEqual(
  chibaSegments.map((segment) => segment.text),
  [
    '千叶雏死死地盯着他，嘴唇颤抖着，声音虽轻却带着一种刻在骨子里的矜持',
    '杀了我……或者救我。但请你，不要用那种看牲口一样的眼神看着我。',
  ],
  'colon-led voice/action narration before a Chinese quote should split into narrator cue and reviewable dialogue text',
)
assert.equal(chibaSegments[1].needsReview, true, 'colon-led unknown speaker dialogue should be marked for review')
assert.equal(chibaSegments[1].sourceStartOffset, chibaSample.indexOf('杀了我'), 'colon-led dialogue offset should point inside the quote')

const quotedTermSample = '他把这称为“伦理坚守”。'
assert.deepEqual(
  createRuleBasedSegmentsForTest(workForSegmentRules(), chapterForSegmentRules(quotedTermSample)).map((segment) => segment.text),
  [quotedTermSample],
  'non-dialogue quoted terms should stay in the narrator segment',
)

const descriptiveQuotedTermSample = '他的态度很温和，“伦理坚守”这个词用得很准确。'
assert.deepEqual(
  createRuleBasedSegmentsForTest(workForSegmentRules(), chapterForSegmentRules(descriptiveQuotedTermSample)).map((segment) => segment.text),
  [descriptiveQuotedTermSample],
  'descriptive cue words before a quoted term should not split the quote as dialogue',
)

const reviewableSegments = segmentsNeedingAttributionForTest(kamishiroSegments)
assert.equal(reviewableSegments.length, 1, 'newly split unknown speaker dialogue should enter attribution')
assert.equal(reviewableSegments[0].text, kamishiroSegments[1].text, 'attribution should target the dialogue text, not the narrator cue')

assert.equal(segmentContainsQuotesForTest({ text: '她停顿片刻，“继续。”' }), true, 'Chinese quotes should trigger AI refinement')
assert.equal(segmentContainsQuotesForTest({ text: 'She said "continue" quietly.' }), true, 'straight double quotes should trigger AI refinement')
assert.equal(segmentContainsQuotesForTest({ text: 'She called it ‘protocol’.' }), true, 'English single quotes should trigger AI refinement')
assert.equal(segmentContainsQuotesForTest({ text: '没有引号的旁白' }), false, 'plain narration should not trigger AI refinement')

const refinedSegments = applySegmentRefinementResultsForTest(workForSegmentRules(), [{
  id: 'source-segment',
  chapterId: 'chapter-1',
  order: 0,
  speakerKind: 'narrator',
  speakerName: '旁白',
  text: '千叶雏抬头，“我会继续。”神代司点头。',
  mood: '平稳叙述',
  prompt: '',
  sourceStartOffset: 10,
  sourceEndOffset: 32,
  segmentationSource: 'rule',
  attributionSource: 'rule',
  attributionStatus: 'attributed',
  attributionConfidence: 0.82,
  needsReview: false,
  retryable: false,
  status: 'pending',
}], [{
  segmentId: 'source-segment',
  segments: [
    { text: '千叶雏抬头，', speakerKind: 'narrator', speakerName: '旁白', mood: '动作描写', confidence: 0.9, needsReview: false },
    { text: '“我会继续。”', speakerKind: 'character', characterId: 'character-chiba', speakerName: '千叶雏', mood: '坚定对白', confidence: 0.88, needsReview: false },
    { text: '神代司点头。', speakerKind: 'narrator', speakerName: '旁白', mood: '动作描写', confidence: 0.9, needsReview: false },
  ],
}], 'chapter-1-refine-1')

assert.deepEqual(
  refinedSegments.map((segment) => ({ text: segment.text, speakerName: segment.speakerName, order: segment.order, source: segment.segmentationSource })),
  [
    { text: '千叶雏抬头，', speakerName: '旁白', order: 0, source: 'ai' },
    { text: '我会继续。', speakerName: '千叶雏', order: 1, source: 'ai' },
    { text: '神代司点头。', speakerName: '旁白', order: 2, source: 'ai' },
  ],
  'AI refinement results should replace one quoted rule segment with ordered speaker-attributed subsegments and trim wrapping quotes',
)

const bystanderAttributedSegments = applyAttributionResultsForTest(workForSegmentRules(), [{
  id: 'unknown-dialogue',
  chapterId: 'chapter-1',
  order: 0,
  speakerKind: 'narrator',
  speakerName: '旁白',
  text: '别动，我只是路过。',
  mood: '待归因对白',
  prompt: '',
  segmentationSource: 'rule',
  attributionSource: 'rule',
  attributionStatus: 'needs_review',
  attributionConfidence: 0.45,
  needsReview: true,
  retryable: true,
  status: 'pending',
}], [{
  segmentId: 'unknown-dialogue',
  speakerKind: 'bystanderMale',
  characterId: null,
  speakerName: '路人男声',
  mood: '警惕的陌生男性对白',
  confidence: 0.84,
  needsReview: false,
}], 'chapter-1-attr-1')

assert.deepEqual(
  bystanderAttributedSegments.map((segment) => ({ speakerKind: segment.speakerKind, speakerName: segment.speakerName, characterId: segment.characterId, needsReview: segment.needsReview })),
  [{ speakerKind: 'bystanderMale', speakerName: '路人男声', characterId: undefined, needsReview: false }],
  'AI attribution should map real non-role dialogue to the fixed male bystander voice instead of narrator',
)

const bystanderNormalizedSegments = normalizeSegmentsForTest(workForSegmentRules(), chapterForSegmentRules('有人喊道：“快走。”'), [{
  speakerKind: 'bystanderFemale',
  characterId: null,
  speakerName: '路人女声',
  text: '快走。',
  mood: '急促女性对白',
}])
assert.equal(bystanderNormalizedSegments[0].speakerKind, 'bystanderFemale', 'legacy AI segmentation parser should preserve female bystander speakerKind')
assert.equal(bystanderNormalizedSegments[0].speakerName, '路人女声', 'female bystander segments should use the fixed display name')

assert.match(
  audiobookPromptSource,
  /buildAudiobookAttributionPrompt/,
  'audiobook prompts should include a small-window speaker attribution prompt',
)

assert.match(
  audiobookPromptSource,
  /buildAudiobookToneCompressionPrompt/,
  'audiobook prompts should include an AI tone compression prompt',
)

assert.match(
  audiobookPromptSource,
  /每条 tone 控制在 30 字以内[\s\S]*不要描述音色/,
  'tone generation system prompt should cap scene tone descriptions at 30 chars and avoid timbre',
)

assert.match(
  audiobookPromptSource,
  /tone: 30 字以内的中文语气描述[\s\S]*不写音色/,
  'tone compression output contract should request short scene-only tone descriptions',
)

assert.match(
  audiobookPromptSource,
  /候选 speaker/,
  'small-window attribution prompt should constrain the model to candidate speakers',
)

assert.match(
  audiobookPromptSource,
  /bystanderMale[\s\S]*路人男声[\s\S]*bystanderFemale[\s\S]*路人女声/,
  'small-window attribution prompt should include fixed bystander speaker candidates',
)

assert.match(
  audiobookPromptSource,
  /确实是对白但不属于任何角色时选择 bystanderMale 或 bystanderFemale/,
  'AI attribution instructions should classify non-role dialogue into gendered bystander voices',
)

assert.match(
  useAudiobookSource,
  /createRuleBasedSegments\(work, chapter\)/,
  'segmentChapter should create a rule-based draft before calling LLM attribution',
)

assert.match(
  useAudiobookSource,
  /attributeSegmentBatch/,
  'segmentChapter should attribute low-confidence segments in retryable batches',
)

assert.doesNotMatch(
  segmentUtilsSource,
  /results\.length === 1 \? results\[0\]/,
  'single attribution result should not be applied to every segment in the chapter',
)

assert.doesNotMatch(
  useAudiobookSource,
  /buildAudiobookSegmentationPrompt\(work, chapter\)/,
  'segmentChapter should not use the old whole-chapter LLM segmentation prompt as the main path',
)

assert.match(
  chapterAudiobookPanelSource,
  /<Progress/,
  'chapter audiobook panel should show segmentation batch progress',
)

assert.match(
  chapterAudiobookPanelSource,
  /maxHeight: 'min\(42vh, 560px\)'/,
  'chapter audiobook panel should keep a bounded height so the body editor remains visible',
)

assert.match(
  chapterAudiobookPanelSource,
  /overflowY: 'auto'/,
  'chapter audiobook panel should scroll internally for long segment lists',
)

assert.match(
  segmentReviewTableSource,
  /scrollY\?: number/,
  'segment review table should support a bounded vertical scroll area',
)

assert.match(
  segmentReviewTableSource,
  /重试归因/,
  'segment review table should expose per-segment attribution retry',
)

assert.match(
  segmentReviewTableSource,
  /bystanderMale[\s\S]*路人男声[\s\S]*bystanderFemale[\s\S]*路人女声/,
  'segment review table should allow manually selecting bystander voices',
)

assert.match(
  segmentReviewTableSource,
  /AI 细分/,
  'segment review table should expose per-segment AI refinement for manual splitting',
)

assert.match(
  segmentReviewTableSource,
  /onRefineSegment\?\.\(segment\.id\)/,
  'segment review table row AI refinement should call the supplied handler with the current segment id',
)

assert.match(
  segmentReviewTableSource,
  /重新生成音频[\s\S]*播放[\s\S]*下载/,
  'segment review table should expose per-segment regenerate, play, and download audio actions',
)

assert.match(
  segmentReviewTableSource,
  /onRegenerateSegmentAudio\?\.\(segment\.id\)[\s\S]*onPlaySegmentAudio\?\.\(segment\)[\s\S]*onDownloadSegmentAudio\?\.\(segment\)/,
  'segment review table row actions should call the supplied audio handlers with the current segment',
)

assert.match(
  segmentReviewTableSource,
  /合并选中连续分段/,
  'segment review table should allow merging selected consecutive segments',
)

assert.match(
  segmentReviewTableSource,
  /一键生成语气/,
  'segment review table should expose one-click batch tone prompt generation',
)

assert.match(
  segmentReviewTableSource,
  /draftsBySegmentId/,
  'segment review table should keep row edits in local drafts before persistence',
)

assert.doesNotMatch(
  segmentReviewTableSource,
  /onChange=\{\(event\) => void onUpdate\(segment\.id, \{ text: event\.target\.value \}\)\}/,
  'text editing should not persist on every keystroke',
)

assert.doesNotMatch(
  segmentReviewTableSource,
  /onChange=\{\(event\) => void onUpdate\(segment\.id, \{ prompt: event\.target\.value \}\)\}/,
  'prompt editing should not persist on every keystroke',
)

assert.match(
  segmentReviewTableSource,
  /保存修改/,
  'segment review table should expose an explicit save action for dirty row drafts',
)

assert.match(
  chapterAudiobookPanelSource,
  /hasDirtySegments/,
  'chapter audiobook panel should know when segment row drafts are dirty',
)

assert.match(
  chapterAudiobookPanelSource,
  /请先保存分段修改/,
  'chapter audio generation should block when local row drafts are unsaved',
)

assert.match(
  typesSource,
  /segmentVersion\?: number/,
  'audiobook segments should carry a row-level version for conflict detection',
)

assert.match(
  voiceboxClientSource + worksRouteSource,
  /patchAudiobookSegment|segmentPatch/,
  'audiobook persistence should expose a row-level segment patch boundary',
)

assert.match(
  worksRouteSource,
  /const \{ segmentPatch, \.\.\.audiobookPatch \} = audiobookChanges[\s\S]*mergeAudiobook\(existingData\.audiobook, audiobookPatch\)/,
  'segment patch envelope fields should not be persisted into audiobook JSON',
)

assert.match(
  useAudiobookSource,
  /patchSegmentFields/,
  'audiobook hook should persist routine row edits through field-level segment patches',
)

assert.match(
  useAudiobookSource,
  /promptEditedAt/,
  'manual prompt edits should be timestamped so batch tone generation can avoid overwriting them',
)

assert.match(
  useAudiobookSource,
  /generationStatusPatch|patchSegmentFields\(chapter\.id, segment\.id, \{ status:/,
  'audio generation progress should patch only generation-owned fields for the target segment',
)

assert.match(
  useAudiobookSource,
  /latestSegment\?\.segmentVersion[\s\S]*resultSegment\.segmentVersion[\s\S]*return/,
  'older row patch responses should not overwrite newer local audiobook state',
)

assert.match(
  chapterAudiobookPanelSource,
  /disabled=\{writing \|\| hasDirtySegments \|\| generatingChapterId === chapter\.id\}/,
  'AI segmentation should be blocked while row drafts are unsaved',
)

assert.match(
  chapterAudiobookPanelSource,
  /refineSegment\(chapter, segmentId\)/,
  'chapter audiobook panel should wire row AI refinement to the audiobook hook with the current chapter',
)

assert.match(
  segmentReviewTableSource,
  /disabled=\{hasDirtySegments \|\| !onRetryAttribution/,
  'attribution retry should be blocked while row drafts are unsaved',
)

assert.match(
  segmentReviewTableSource,
  /segment\.status !== 'completed'[\s\S]*播放[\s\S]*segment\.status !== 'completed'[\s\S]*下载/,
  'stale or failed segment audio should not remain playable after saved row edits',
)

assert.match(
  segmentReviewTableSource,
  /defaultPageSize: 20,[\s\S]*pageSizeOptions: \[20, 50, 100\]/,
  'segment review table should let users switch to 100 rows per page without forcing pageSize back to 20',
)

assert.match(
  segmentReviewTableSource,
  /待复核[\s\S]*已确认[\s\S]*待生成/,
  'segment review status should distinguish review and attribution states before audio generation',
)

assert.match(
  useAudiobookSource,
  /generateSegmentTonePrompt[\s\S]*buildAudiobookToneCompressionPrompt[\s\S]*parseToneCompressionJson/,
  'audiobook hook should use AI compression for row-level tone prompts',
)

assert.match(
  useAudiobookSource,
  /const generateSegmentTonePrompt = async \(chapterId: string, segmentId: string, options: \{ overwrite\?: boolean \} = \{\}\)[\s\S]*buildAudiobookToneCompressionPrompt\(\[promptInput\]\)[\s\S]*await patchSegmentFields\(chapterId, segment\.id, \{ prompt \}\)/,
  'single tone generation should request and patch exactly one segment at a time',
)

assert.match(
  useAudiobookSource,
  /for \(const segment of orderedSegments\)[\s\S]*await generateSegmentTonePrompt\(chapterId, segment\.id\)[\s\S]*generatedCount \+= 1/,
  'one-click tone generation should await sequential per-segment prompt generation instead of one whole-chapter AI request',
)

assert.doesNotMatch(
  useAudiobookSource,
  /const promptInputs: \{ segmentId: string; speakerName: string; text: string; expandedPrompt: string \}\[\] = \[\][\s\S]*buildAudiobookToneCompressionPrompt\(promptInputs\)/,
  'one-click tone generation should not batch all segment prompt inputs into one AI request',
)

assert.match(
  segmentReviewTableSource,
  /onGenerateTonePrompt\?: \(segmentId: string\) => Promise<void>/,
  'segment review table should accept a single-row tone prompt generator',
)

assert.match(
  segmentReviewTableSource,
  /onGenerateTonePrompt\?\.\(segment\.id\)[\s\S]*重新生成语气提示词/,
  'segment review table should expose per-row tone prompt regeneration with the current segment id',
)

assert.match(
  chapterAudiobookPanelSource,
  /onGenerateTonePrompt=\{async \(segmentId\) => \{ await generateSegmentTonePrompt\(chapter\.id, segmentId, \{ overwrite: true \}\) \}\}/,
  'chapter audiobook panel should wire row tone prompt regeneration to overwrite only the selected segment',
)

assert.match(
  useAudiobookSource,
  /if \(segment\.speakerKind !== 'narrator'\)[\s\S]*if \(!aiConfig\.apiKey\) throw new Error\('请先在系统管理中配置 AI'\)/,
  'tone generation should require AI only when a character segment needs compression',
)

assert.match(
  useAudiobookSource,
  /let prompt = buildSegmentTonePrompt\(effectiveBinding, previousSegments\)[\s\S]*if \(segment\.speakerKind !== 'narrator'\)/,
  'tone generation should fill narrator prompts directly without waiting for AI compression',
)

assert.match(
  useAudiobookSource,
  /if \(segment\.speakerKind !== 'narrator'\)[\s\S]*buildAudiobookToneCompressionPrompt\(\[promptInput\]\)/,
  'tone generation should call AI compression only for the current character segment',
)

assert.match(
  useAudiobookSource,
  /function toneText[\s\S]*result\.tone[\s\S]*result\.prompt[\s\S]*result\.description/,
  'tone compression parser should tolerate common AI field-name drift instead of silently filling nothing',
)

assert.match(
  useAudiobookSource,
  /function toneSegmentId[\s\S]*result\.segmentId \|\| result\.id/,
  'tone compression parser should tolerate id when the AI does not use segmentId',
)

assert.match(
  useAudiobookSource,
  /if \(!prompt\) throw new Error\('AI 没有返回可用语气提示词'\)/,
  'tone generation should fail visibly when AI returns no usable prompts',
)

assert.match(
  useAudiobookSource,
  /approveReviewSegments[\s\S]*needsReview: false[\s\S]*attributionStatus: 'manual'/,
  'audiobook hook should expose a confirmation action for reviewed attribution results',
)

assert.match(
  segmentReviewTableSource,
  /onGenerateTonePrompts[\s\S]*一键生成语气/,
  'segment review table should keep one-click tone generation while also supporting row regeneration',
)

assert.match(
  useAudiobookSource,
  /mergeConsecutiveSegments/,
  'audiobook hook should expose a persistent merge operation for selected segments',
)

assert.match(
  audiobookPromptSource,
  /需要继续细分[\s\S]*segments[\s\S]*text[\s\S]*speakerKind[\s\S]*characterId/,
  'AI attribution prompt should allow each result to return replacement subsegments with speaker fields',
)

assert.match(
  segmentUtilsSource,
  /export function segmentContainsQuotes[\s\S]*[“”"'‘’]/,
  'audiobook utilities should detect Chinese, English, and double quotes before AI refinement',
)

assert.match(
  segmentUtilsSource,
  /export function applySegmentRefinementResults[\s\S]*result\.segments[\s\S]*segmentationSource: 'ai'[\s\S]*\.map\(\(segment, order\)/,
  'AI refinement results should replace a source segment with ordered AI subsegments',
)

assert.match(
  useAudiobookSource,
  /segments\.filter\(segmentContainsQuotes\)[\s\S]*refineSegmentBatch\(work, chapter, quoteSegments/,
  'rule segmentation should send quote-containing segments through AI refinement before attribution completes',
)

assert.match(
  useAudiobookSource,
  /const refineSegment = async \(chapter: Chapter, segmentId: string\)[\s\S]*refineSegmentBatch\(work, chapter, \[segment\]/,
  'audiobook hook should expose manual single-segment AI refinement',
)

assert.match(
  readmeSource,
  /低置信度|失败片段可重试/,
  'README should describe low-confidence review and retryable failed segmentation results',
)

assert.match(
  chapterAudiobookPanelSource,
  /voiceboxClient\.fetchMediaUrl\(voiceboxClient\.audioUrl/,
  'segment audio playback should fetch proxied audio with authentication before playing row audio',
)

assert.match(
  voiceboxClientSource,
  /fetchMediaUrl[\s\S]*requestHeaders\(false\)/,
  'media playback should include the same Bearer token auth used by API calls',
)

assert.match(
  voicesPageSource,
  /voiceboxClient\.fetchMediaUrl\(voiceboxClient\.sampleUrl/,
  'voice sample audition should fetch protected sample audio with authentication',
)

assert.match(
  chapterAudiobookPanelSource,
  /voiceboxClient\.fetchMediaUrl\(voiceboxClient\.audioUrl[\s\S]*anchor\.download/,
  'segment audio download should fetch proxied audio before triggering the row download',
)

assert.match(
  chapterAudioPlayerSource,
  /synthesizeChapterAudio/,
  'chapter audio surface should start a backend chapter synthesis job instead of exporting a manifest',
)

assert.match(
  chapterAudioPlayerSource,
  /Progress[\s\S]*synthesisProgress[\s\S]*合成进度/,
  'chapter audio surface should show chapter synthesis progress while the backend concatenates audio',
)

assert.doesNotMatch(
  audioUtilsSource + chapterAudioPlayerSource,
  /manifest|downloadChapterAudioManifest|audiobook-manifest/i,
  'chapter synthesis should not download a JSON manifest when users request merged chapter audio',
)

assert.match(
  voiceboxClientSource,
  /synthesizeChapterAudio[\s\S]*\/api\/voicebox\/chapter-audio/,
  'voicebox client should expose a chapter synthesis API that sends only generation IDs and ordering metadata',
)

assert.match(
  voiceboxClientSource,
  /chapterAudioStatus[\s\S]*\/api\/voicebox\/chapter-audio\/\$\{encodeURIComponent\(jobId\)\}/,
  'voicebox client should poll chapter synthesis progress by job id',
)

assert.match(
  voiceboxClientSource,
  /downloadChapterAudio[\s\S]*\/api\/voicebox\/chapter-audio\/\$\{encodeURIComponent\(jobId\)\}\/audio/,
  'voicebox client should download the synthesized chapter audio blob after completion',
)

assert.match(
  voiceboxRouteSource,
  /router\.post\('\/chapter-audio'/,
  'Voicebox proxy should expose a backend chapter audio synthesis job route',
)

assert.match(
  voiceboxRouteSource,
  /concatWavSegments[\s\S]*createSilentWavPcm16/,
  'chapter audio synthesis should concatenate segment WAV audio with inserted silence between segments',
)

assert.match(
  voiceboxRouteSource,
  /chapterAudioJobs[\s\S]*completedSegments[\s\S]*totalSegments/,
  'chapter audio synthesis jobs should track progress for frontend polling',
)

assert.doesNotMatch(
  chapterAudioPlayerSource,
  /<audio controls/,
  'chapter audio surface should not duplicate per-segment players that now live in the segment table',
)

assert.match(
  chapterAudioPlayerSource,
  /if \(!completed\.length\)/,
  'chapter audio player should not start audio loading or state updates when no completed segments exist',
)

assert.doesNotMatch(
  segmentReviewTableSource,
  /pagination=\{\{ pageSize: 20, showSizeChanger: true \}\}/,
  'segment review table should not hard-control pageSize to 20 after user changes it',
)

console.log('audiobook behavior assertions passed')
