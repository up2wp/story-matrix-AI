import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const aiClient = await readFile(new URL('../src/ai/client.ts', import.meta.url), 'utf8')
const adminPage = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const aiRoute = await readFile(new URL('../server/src/routes/ai.ts', import.meta.url), 'utf8')
const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const systemConfigRoute = await readFile(new URL('../server/src/routes/system-config.ts', import.meta.url), 'utf8')
const systemConfigStore = await readFile(new URL('../src/core/system-config-store.ts', import.meta.url), 'utf8')
const featurePermissionsSource = await readFile(new URL('../src/core/feature-permissions.ts', import.meta.url), 'utf8')

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
  /fetch\(`\/api\/ai\/models`/,
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
  /defaultImageGenerationConfig[\s\S]*enabled: false[\s\S]*defaultModelId: ''[\s\S]*models: \[\]/,
  'browser system config should default image generation to disabled with no exposed models',
)

assert.match(
  adminPage,
  /用户级功能权限[\s\S]*ALL_FEATURE_KEYS[\s\S]*FEATURE_LABELS/,
  'admin system settings should expose user-level feature permission controls from the central feature registry',
)

assert.match(
  adminPage,
  /生图模型[\s\S]*ImageGenerationSettings/,
  'admin system settings should expose image generation model configuration separately from text AI models',
)

assert.match(
  systemConfigRoute,
  /normalizeNovelImportConfig[\s\S]*featurePermissions[\s\S]*userGrants/,
  'system config route should normalize extensible user feature grants before storing them',
)

assert.match(
  systemConfigRoute,
  /maskImageGenerationConfigForUser[\s\S]*\.filter\(\(model: any\) => model\.enabled\)[\s\S]*capabilities/,
  'ordinary users should receive only enabled image models and capability metadata',
)

assert.doesNotMatch(
  functionBody(systemConfigRoute, 'maskImageGenerationConfigForUser'),
  /maskImageGenerationConfigForUser[\s\S]*apiKey/,
  'ordinary image generation config responses should never include provider API keys',
)

assert.doesNotMatch(
  functionBody(systemConfigRoute, 'maskImageGenerationConfigForUser'),
  /baseUrl/,
  'ordinary image generation config responses should never include provider base URLs',
)

assert.match(
  systemConfigRoute,
  /mergeImageGenerationConfig[\s\S]*__server_configured__[\s\S]*existingModel\?\.apiKey/,
  'image generation config should preserve existing provider keys when admins save masked secrets',
)

assert.match(
  featurePermissionsSource,
  /setUserFeatureGrant/,
  'feature permission helper should update one user-feature grant without hard-coding the admin UI',
)

console.log('model-config behavior assertions passed')
