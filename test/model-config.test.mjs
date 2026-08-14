import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const aiClient = await readFile(new URL('../src/ai/client.ts', import.meta.url), 'utf8')
const adminPage = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const aiRoute = await readFile(new URL('../server/src/routes/ai.ts', import.meta.url), 'utf8')
const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const systemConfigRoute = await readFile(new URL('../server/src/routes/system-config.ts', import.meta.url), 'utf8')
const imageConfigService = await readFile(new URL('../server/src/services/image-generation-config.ts', import.meta.url), 'utf8')
const systemConfigStore = await readFile(new URL('../src/core/system-config-store.ts', import.meta.url), 'utf8')
const featurePermissionsSource = await readFile(new URL('../src/core/feature-permissions.ts', import.meta.url), 'utf8')
const imageGenerationAccessSource = await readFile(new URL('../server/src/services/image-generation-access.ts', import.meta.url), 'utf8')

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`)
  const next = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

assert.match(
  aiClient,
  /fetch\(`\/api\/ai\/chat-completions`/,
  'AI generation should call the same-origin backend proxy instead of browser-fetching provider baseUrl directly',
)

assert.doesNotMatch(
  aiClient,
  /fetch\(`\$\{config\.baseUrl\}\/chat\/completions`/,
  'AI generation should not expose provider baseUrl/API key through browser requests',
)

assert.doesNotMatch(
  adminPage,
  /mode="tags"/,
  'OpenAI model selector should stay single-value instead of using tag-style multi-select UX',
)

assert.match(
  adminPage,
  /onSearch=\{\(value\) => form\.setFieldValue\('model', value\)\}/,
  'OpenAI model selector should allow typing a custom model id into the single-value field',
)

assert.match(
  adminPage,
  /fetch\('\/api\/ai\/models'/,
  'Model settings should support loading provider model options through the backend proxy',
)

assert.match(
  aiRoute,
  /safeGenerationParams/,
  'AI proxy should forward only whitelisted generation parameters to the provider',
)

assert.match(
  aiRoute,
  /max_tokens/,
  'AI proxy should forward max_tokens so small-window attribution can bound output size',
)

assert.match(
  aiRoute,
  /AI_UPSTREAM_TIMEOUT_MS/,
  'AI proxy should enforce a server-side upstream timeout',
)

assert.match(
  dbSource,
  /ALTER TABLE systemConfig ADD COLUMN novelImportConfig TEXT/,
  'database migration should add novel import config with an additive column',
)

assert.match(
  dbSource,
  /ALTER TABLE systemConfig ADD COLUMN imageGenerationConfig TEXT/,
  'database migration should add image generation config with an additive column',
)

assert.match(
  systemConfigRoute,
  /novelImportConfig/,
  'system config route should read and write the novel import feature switch',
)

assert.match(
  systemConfigStore,
  /defaultNovelImportConfig[\s\S]*enabled: false[\s\S]*featurePermissions: \{ userGrants: \[\] \}/,
  'browser system config should default local novel import to disabled with an empty extensible user permission list',
)

assert.match(
  systemConfigStore,
  /defaultImageGenerationConfig[\s\S]*enabled: false[\s\S]*defaultModelId: ''[\s\S]*providers: \[\][\s\S]*models: \[\][\s\S]*storageMode: 'local'[\s\S]*immich:/,
  'browser system config should default image generation to disabled local storage with no exposed models',
)

assert.match(
  adminPage,
  /用户级功能权限[\s\S]*ALL_FEATURE_KEYS[\s\S]*FEATURE_LABELS/,
  'admin system settings should expose user-level feature permission controls from the central feature registry',
)

assert.match(
  adminPage,
  /生图模型[\s\S]*ImageGenerationSettings[\s\S]*检查 Immich 连接 \/ 项目相册/,
  'admin system settings should expose image generation and Immich storage checks separately from text AI models',
)

assert.match(
  imageGenerationAccessSource,
  /function normalizeFeatureGrant[\s\S]*const features = featureList\(value\.features\)[\s\S]*function normalizeFeaturePermissionConfig[\s\S]*userGrants: grants\.map\(normalizeFeatureGrant\)[\s\S]*export function normalizeNovelImportConfig[\s\S]*featurePermissions: normalizeFeaturePermissionConfig/,
  'shared novel import config service should normalize extensible user feature grants before storing them',
)

assert.match(
  systemConfigRoute,
  /rowToConfig\(row: any, includeAI = false, userId\?: string\)[\s\S]*safeNovelImportConfig = includeAI \? novelImportConfig : maskNovelImportConfigForUser\(novelImportConfig, userId\)[\s\S]*novelImportConfig: safeNovelImportConfig/,
  'system config route should mask novel import config by role and current user id',
)

assert.match(
  imageGenerationAccessSource,
  /export function maskNovelImportConfigForUser[\s\S]*const userGrants = userId \? normalized\.featurePermissions\.userGrants\.filter\(grant => grant\.userId === userId\) : \[\][\s\S]*return \{ enabled: normalized\.enabled, featurePermissions: \{ userGrants \} \}/,
  'ordinary system config responses should keep only current-user grants and omit image generation risk-control metadata',
)

assert.match(
  systemConfigRoute,
  /prepareNovelImportConfigForAdminSave\(\{ incoming: novelImportConfig, actorUserId: currentUser\.id \}\)[\s\S]*prepareNovelImportConfigForAdminSave\(\{ incoming: fields\.novelImportConfig, actorUserId: currentUser\.id, database: db \}\)/,
  'admin system config saves should route novel import permissions through recovery-baseline preparation',
)

assert.match(
  systemConfigRoute,
  /const updateConfig = db\.transaction\(\(\) => \{[\s\S]*prepareNovelImportConfigForAdminSave\(\{ incoming: fields\.novelImportConfig, actorUserId: currentUser\.id, database: db \}\)[\s\S]*UPDATE systemConfig SET[\s\S]*SELECT \* FROM systemConfig WHERE id = \?/,
  'admin system config PATCH should prepare recovery baselines and write the config inside one database transaction',
)

assert.match(
  systemConfigStore,
  /type SystemConfigResponse = \{[\s\S]*readonly novelImportConfig\?: NovelImportConfig[\s\S]*function normalizeSavedNovelImportConfig[\s\S]*response\?\.novelImportConfig \|\| fallback/,
  'browser config store should accept the backend novel import config returned after permission saves',
)

assert.match(
  systemConfigStore,
  /toggleNovelImport[\s\S]*const savedConfig = await db\.systemConfig\.update\('singleton', \{ novelImportConfig \}\)[\s\S]*normalizeSavedNovelImportConfig\(savedConfig, novelImportConfig\)[\s\S]*saveNovelImportConfig[\s\S]*const savedConfig = await db\.systemConfig\.update\('singleton', \{ novelImportConfig \}\)[\s\S]*normalizeSavedNovelImportConfig\(savedConfig, novelImportConfig\)/,
  'browser config store should use the server-returned novel import config so risk-control baselines survive saves',
)

assert.match(
  systemConfigRoute,
  /maskImageGenerationConfigForUser/,
  'ordinary users should receive only enabled image models and capability metadata',
)

assert.match(
  imageConfigService,
  /referenceImages[\s\S]*maxReferenceImages/,
  'image generation model capabilities should include reference-image availability and max count metadata',
)

assert.match(
  imageConfigService.match(/export function maskImageGenerationConfigForUser[\s\S]*?\n}\n/)?.[0] || '',
  /capabilities: model\.capabilities/,
  'ordinary users should see reference-image capability summaries through the existing capability metadata field',
)

assert.match(
  systemConfigRoute,
  /maskImageGenerationConfigForUser/,
  'ordinary users may receive the storage mode but not Immich connection details',
)

assert.doesNotMatch(
  imageConfigService.match(/export function maskImageGenerationConfigForUser[\s\S]*?\n}\n/)?.[0] || '',
  /apiKey/,
  'ordinary image generation config responses should never include provider API keys',
)

assert.doesNotMatch(
  imageConfigService.match(/export function maskImageGenerationConfigForUser[\s\S]*?\n}\n/)?.[0] || '',
  /baseUrl|serviceUrl|immich|__server_configured__|providerModel|providerId/,
  'ordinary image generation config responses should never include provider, upstream model, or Immich connection details',
)

assert.match(
  systemConfigRoute,
  /mergeImageGenerationConfigFromService/,
  'image generation config route should delegate provider key preservation to the shared image config service',
)

assert.match(
  imageConfigService,
  /providers[\s\S]*__server_configured__[\s\S]*existingProvider\?\.apiKey/,
  'image generation config should preserve existing provider keys when admins save masked secrets',
)

assert.match(
  imageConfigService,
  /merged\.immich[\s\S]*MASKED_SECRET[\s\S]*existing\.immich\.apiKey/,
  'image generation config should preserve existing Immich keys when admins save masked secrets',
)

assert.match(
  imageConfigService,
  /normalizeImageGenerationConfig[\s\S]*Array\.isArray\(input\.providers\)[\s\S]*modelInput\.baseUrl[\s\S]*providerByKey/,
  'image generation config should normalize provider-level config while keeping old flat models[] compatible',
)

assert.match(
  imageConfigService,
  /resolveEnabledImageModel[\s\S]*model\.providerId[\s\S]*provider/,
  'generate route should resolve enabled models through their provider config instead of trusting browser-sent provider details',
)

assert.match(
  imageConfigService,
  /requestTimeoutMs[\s\S]*300000/,
  'backend image model config should normalize a configurable per-model request timeout with a 5-minute default for long-running image generation',
)

assert.doesNotMatch(
  imageConfigService.match(/export function maskImageGenerationConfigForUser[\s\S]*?\n}\n/)?.[0] || '',
  /requestTimeoutMs/,
  'ordinary user image model config responses should never expose the per-model request timeout',
)

assert.match(
  featurePermissionsSource,
  /setUserFeatureGrant/,
  'feature permission helper should update one user-feature grant without hard-coding the admin UI',
)

console.log('model-config behavior assertions passed')
