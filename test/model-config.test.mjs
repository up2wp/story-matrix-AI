import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const aiClient = await readFile(new URL('../src/ai/client.ts', import.meta.url), 'utf8')
const adminPage = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const aiRoute = await readFile(new URL('../server/src/routes/ai.ts', import.meta.url), 'utf8')
const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const systemConfigRoute = await readFile(new URL('../server/src/routes/system-config.ts', import.meta.url), 'utf8')
const systemConfigStore = await readFile(new URL('../src/core/system-config-store.ts', import.meta.url), 'utf8')

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
  systemConfigRoute,
  /novelImportConfig/,
  'system config route should read and write the novel import feature switch',
)

assert.match(
  systemConfigStore,
  /defaultNovelImportConfig[\s\S]*enabled: false/,
  'browser system config should default local novel import to disabled',
)

assert.match(
  adminPage,
  /允许本地小说导入[\s\S]*管理员和拥有者可在作品列表导入本地 \.txt \/ \.md 文件/,
  'admin system settings should expose the owner/admin-only local novel import switch',
)

console.log('model-config behavior assertions passed')
