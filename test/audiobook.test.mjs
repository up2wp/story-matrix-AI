import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const typesSource = await readFile(new URL('../src/core/types.ts', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../src/core/store.ts', import.meta.url), 'utf8')
const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const worksRouteSource = await readFile(new URL('../server/src/routes/works.ts', import.meta.url), 'utf8')
const systemConfigRouteSource = await readFile(new URL('../server/src/routes/system-config.ts', import.meta.url), 'utf8')
const serverIndexSource = await readFile(new URL('../server/src/index.ts', import.meta.url), 'utf8')
const voiceboxRouteSource = await readFile(new URL('../server/src/routes/voicebox.ts', import.meta.url), 'utf8')
const userVoicesRouteSource = await readFile(new URL('../server/src/routes/user-voices.ts', import.meta.url), 'utf8')
const voiceboxClientSource = await readFile(new URL('../src/features/audiobook/voiceboxClient.ts', import.meta.url), 'utf8')
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
const voicesPageSource = await readFile(new URL('../src/pages/voices/VoicesPage.tsx', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const chapterAudioPlayerSource = await readFile(new URL('../src/pages/preview/ChapterAudioPlayer.tsx', import.meta.url), 'utf8')

assert.match(
  typesSource,
  /audiobook\?: WorkAudiobookConfig/,
  'Work should carry optional audiobook state so old works remain loadable',
)

assert.match(
  storeSource,
  /if \(!work\.audiobook\)/,
  'legacy works should receive audiobook defaults during client migration',
)

assert.match(
  worksRouteSource,
  /'audiobook'/,
  'work PATCH nested-key allowlist should persist audiobook state in works.data JSON',
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
  systemConfigRouteSource,
  /voiceboxConfig/,
  'system config route should read and write Voicebox settings through the singleton config',
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

assert.match(
  chapterAudiobookPanelSource,
  /chapterCharacterBindings\(chapter\.id, chapterCharacterIds\)/,
  'chapter audiobook panel should read chapter-scoped role bindings',
)

assert.match(
  chapterAudiobookPanelSource,
  /searchParams\.get\('soundId'\)/,
  'chapter audiobook panel should consume returned soundId from voice management',
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
  /声音管理/,
  'sidebar should expose the user-level voice management page',
)

assert.match(
  appSource,
  /path="\/voices"/,
  'app routing should include the voice management page',
)

assert.match(
  useAudiobookSource,
  /missingBindings/,
  'generation should block when a segment speaker has no ready voice binding',
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
  chapterAudioPlayerSource,
  /voiceboxClient\.fetchMediaUrl\(voiceboxClient\.audioUrl/,
  'chapter audio playback should fetch proxied audio with authentication before rendering audio tags',
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
  chapterAudioPlayerSource,
  /downloadChapterAudioManifest/,
  'chapter audio surface should provide a chapter-level download artifact',
)

console.log('audiobook behavior assertions passed')
