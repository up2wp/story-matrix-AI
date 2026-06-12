import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const typesSource = await readFile(new URL('../src/core/types.ts', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../src/core/store.ts', import.meta.url), 'utf8')
const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const worksRouteSource = await readFile(new URL('../server/src/routes/works.ts', import.meta.url), 'utf8')
const systemConfigRouteSource = await readFile(new URL('../server/src/routes/system-config.ts', import.meta.url), 'utf8')
const serverIndexSource = await readFile(new URL('../server/src/index.ts', import.meta.url), 'utf8')
const voiceboxRouteSource = await readFile(new URL('../server/src/routes/voicebox.ts', import.meta.url), 'utf8')
const voiceboxClientSource = await readFile(new URL('../src/features/audiobook/voiceboxClient.ts', import.meta.url), 'utf8')
const systemConfigStoreSource = await readFile(new URL('../src/core/system-config-store.ts', import.meta.url), 'utf8')
const adminPageSource = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const useAudiobookSource = await readFile(new URL('../src/features/audiobook/useAudiobook.ts', import.meta.url), 'utf8')
const audiobookPromptSource = await readFile(new URL('../src/ai/prompts/audiobook.ts', import.meta.url), 'utf8')
const previewPageSource = await readFile(new URL('../src/pages/preview/PreviewPage.tsx', import.meta.url), 'utf8')
const audiobookPanelSource = await readFile(new URL('../src/pages/preview/AudiobookPanel.tsx', import.meta.url), 'utf8')
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
  /ALTER TABLE systemConfig ADD COLUMN voiceboxConfig TEXT/,
  'database migration should add voiceboxConfig with an additive ALTER TABLE upgrade path',
)

assert.doesNotMatch(
  dbSource,
  /DROP TABLE systemConfig|CREATE TABLE .*systemConfig_new|ALTER TABLE systemConfig RENAME/i,
  'voicebox migration should not rebuild or drop the existing systemConfig table',
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
  voiceboxRouteSource,
  /router\.get\('\/profiles'/,
  'Voicebox proxy should expose explicit profile listing route',
)

assert.match(
  voiceboxRouteSource,
  /multipart\/form-data/,
  'reference uploads should forward multipart sample uploads to Voicebox semantics',
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

assert.doesNotMatch(
  voiceboxClientSource,
  /127\.0\.0\.1:17493|serviceUrl|bearerToken|apiKey|customHeaderValue/,
  'browser Voicebox client should not call Voicebox directly or carry upstream credentials',
)

assert.match(
  previewPageSource,
  /<AudiobookPanel work=\{currentWork\} \/>/,
  'audiobook workflow should live under full-text preview',
)

assert.match(
  useAudiobookSource,
  /missingBindings/,
  'generation should block when a segment speaker has no ready voice binding',
)

assert.match(
  audiobookPromptSource,
  /不要引用 Voicebox personality/,
  'audiobook prompts should be owned by Story Matrix rather than Voicebox personality prompts',
)

assert.match(
  audiobookPanelSource,
  /SegmentReviewTable/,
  'audiobook panel should show editable segment review before generation',
)

assert.match(
  useAudiobookSource,
  /retryFailedOnly/,
  'chapter generation should support retrying failed segments without duplicating completed work',
)

assert.match(
  chapterAudioPlayerSource,
  /voiceboxClient\.audioUrl/,
  'chapter audio playback should use proxied same-origin Voicebox audio URLs',
)

assert.match(
  chapterAudioPlayerSource,
  /downloadChapterAudioManifest/,
  'chapter audio surface should provide a chapter-level download artifact',
)

console.log('audiobook behavior assertions passed')
