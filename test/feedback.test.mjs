import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('../server/src/index.ts', import.meta.url), 'utf8')
const systemConfigRouteSource = await readFile(new URL('../server/src/routes/system-config.ts', import.meta.url), 'utf8')
const feedbackRouteSource = await readFile(new URL('../server/src/routes/feedback.ts', import.meta.url), 'utf8')
const apiClientSource = await readFile(new URL('../src/core/api-client.ts', import.meta.url), 'utf8')
const typeSource = await readFile(new URL('../src/core/types.ts', import.meta.url), 'utf8')
const systemConfigStoreSource = await readFile(new URL('../src/core/system-config-store.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
const adminPageSource = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const feedbackPageSource = await readFile(new URL('../src/pages/feedback/FeedbackPage.tsx', import.meta.url), 'utf8')

assert.match(
  dbSource,
  /CREATE TABLE IF NOT EXISTS feedback/,
  'database should create a feedback table for persisted user-submitted issues',
)

assert.match(
  dbSource,
  /ALTER TABLE systemConfig ADD COLUMN githubConfig TEXT/,
  'database migration should add githubConfig without rebuilding systemConfig',
)

assert.match(
  indexSource,
  /app\.use\('\/api\/feedback', requireAuth, feedbackRouter\)/,
  'server should mount authenticated feedback routes',
)

assert.match(
  systemConfigRouteSource,
  /githubConfig[\s\S]*__server_configured__/,
  'system config route should mask configured GitHub tokens when returning settings',
)

assert.match(
  feedbackRouteSource,
  /https:\/\/api\.github\.com\/repos\/\$\{config\.owner\}\/\$\{config\.repo\}\/issues/,
  'feedback creation should submit configured feedback to GitHub Issues',
)

assert.match(
  feedbackRouteSource,
  /router\.get\('\/', requireAdmin/,
  'only owners and admins should be able to list all feedback',
)

assert.match(
  feedbackRouteSource,
  /router\.post\('\/'/,
  'authenticated users should be able to submit feedback',
)

assert.match(
  apiClientSource,
  /feedback: createTable<any>\('feedback'\)/,
  'frontend API client should expose feedback table operations',
)

assert.match(
  typeSource,
  /interface Feedback/,
  'frontend types should define the feedback shape',
)

assert.match(
  systemConfigStoreSource,
  /saveGitHubConfig/,
  'system config store should persist GitHub Issue settings',
)

assert.match(
  appSource,
  /path="\/feedback" element=\{<FeedbackPage \/>\}/,
  'app router should expose a protected feedback page',
)

assert.match(
  sidebarSource,
  /key: '\/feedback'[\s\S]*问题反馈/,
  'sidebar should provide a feedback entry for logged-in users',
)

assert.match(
  adminPageSource,
  /GithubOutlined[\s\S]*GitHub Issue/,
  'admin page should include GitHub Issue settings',
)

assert.match(
  feedbackPageSource,
  /currentUser\?\.role === 'owner' \|\| currentUser\?\.role === 'admin'/,
  'feedback page should show the feedback list to owners and admins',
)

console.log('feedback behavior assertions passed')
