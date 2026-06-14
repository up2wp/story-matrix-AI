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
const characterVoicesPageSource = await readFile(new URL('../src/pages/character-voices/CharacterVoicesPage.tsx', import.meta.url), 'utf8')
const voicesPageSource = await readFile(new URL('../src/pages/voices/VoicesPage.tsx', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const chapterAudioPlayerSource = await readFile(new URL('../src/pages/preview/ChapterAudioPlayer.tsx', import.meta.url), 'utf8')
const segmentReviewTableSource = await readFile(new URL('../src/pages/preview/SegmentReviewTable.tsx', import.meta.url), 'utf8')
const segmentRulesSource = await readFile(new URL('../src/features/audiobook/segmentRules.ts', import.meta.url), 'utf8')
const segmentUtilsSource = await readFile(new URL('../src/features/audiobook/segmentUtils.ts', import.meta.url), 'utf8')
const readmeSource = await readFile(new URL('../README.md', import.meta.url), 'utf8')

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
  storeSource,
  /function ensurePromptTemplatePlaceholder[\s\S]*template\.includes\('【上下文】'\)[\s\S]*`\$\{template\}。当前语境：【上下文】`/,
  'legacy narrator prompts should migrate to include the required context placeholder',
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
  /prompt: `\$\{work\.seed\.tone \|\| '自然'\}、清晰、适合长篇小说旁白。当前语境：【上下文】`[\s\S]*promptTemplate: `\$\{work\.seed\.tone \|\| '自然'\}、清晰、适合长篇小说旁白。当前语境：【上下文】`/,
  'new work audiobook defaults should include a valid narrator prompt template',
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
  /key: '\/works'[\s\S]*key: '\/voices'[\s\S]*\.\.\.\(hasWork/,
  'sidebar should expose user-level voice management directly below works before work-scoped items',
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
  /key: '\/character-voices'[\s\S]*label: '角色声音'[\s\S]*key: '\/chapters'/,
  'sidebar should place character voice settings before chapter enrichment',
)

assert.match(
  characterVoicesPageSource,
  /narratorBinding/,
  'character voice settings page should configure the work narrator voice',
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
  /buildSegmentTonePrompt[\s\S]*binding\.speakerKind === 'narrator'[\s\S]*return template\.trim\(\)/,
  'one-click tone prompt should apply narrator voice prompt directly without context replacement',
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
  /候选 speaker/,
  'small-window attribution prompt should constrain the model to candidate speakers',
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
  /generateSegmentTonePrompts[\s\S]*buildAudiobookToneCompressionPrompt[\s\S]*parseToneCompressionJson/,
  'audiobook hook should use AI compression for batch tone prompts',
)

assert.match(
  useAudiobookSource,
  /generateSegmentTonePrompts[\s\S]*directPromptsBySegmentId[\s\S]*segment\.speakerKind === 'narrator'[\s\S]*directPromptsBySegmentId\.set\(segment\.id, buildSegmentTonePrompt\(effectiveBinding, previousSegments\)\)[\s\S]*continue/,
  'one-click tone generation should fill narrator prompts directly without waiting for AI compression',
)

assert.match(
  useAudiobookSource,
  /if \(promptInputs\.length\)[\s\S]*buildAudiobookToneCompressionPrompt\(promptInputs\)/,
  'one-click tone generation should call AI compression only when character prompts need compression',
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
  /if \(!promptsBySegmentId\.size\) throw new Error\('AI 没有返回可用语气提示词'\)/,
  'tone generation should fail visibly when AI returns no usable prompts',
)

assert.match(
  useAudiobookSource,
  /approveReviewSegments[\s\S]*needsReview: false[\s\S]*attributionStatus: 'manual'/,
  'audiobook hook should expose a confirmation action for reviewed attribution results',
)

assert.doesNotMatch(
  segmentReviewTableSource,
  /onGenerateTonePrompt\?\./,
  'segment review table should not require users to generate tone prompts row by row',
)

assert.match(
  useAudiobookSource,
  /mergeConsecutiveSegments/,
  'audiobook hook should expose a persistent merge operation for selected segments',
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
  /downloadChapterAudioManifest/,
  'chapter audio surface should provide a chapter-level download artifact',
)

assert.match(
  chapterAudioPlayerSource,
  /downloadChapterAudioManifest\(chapter, segments\)[\s\S]*合并章节音频/,
  'chapter audio surface should present the chapter-level merge/download action as 合并章节音频',
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
