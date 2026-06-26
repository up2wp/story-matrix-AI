import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const seedSource = await readFile(new URL('../server/src/seed.ts', import.meta.url), 'utf8')
const authRouteSource = await readFile(new URL('../server/src/routes/auth.ts', import.meta.url), 'utf8')
const usersRouteSource = await readFile(new URL('../server/src/routes/users.ts', import.meta.url), 'utf8')
const worksRouteSource = await readFile(new URL('../server/src/routes/works.ts', import.meta.url), 'utf8')
const authStoreSource = await readFile(new URL('../src/core/auth-store.ts', import.meta.url), 'utf8')
const loginPageSource = await readFile(new URL('../src/pages/login/LoginPage.tsx', import.meta.url), 'utf8')
const worksPageSource = await readFile(new URL('../src/pages/works/WorksPage.tsx', import.meta.url), 'utf8')
const adminPageSource = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const topBarSource = await readFile(new URL('../src/components/layout/TopBar.tsx', import.meta.url), 'utf8')
const adminRouteSource = await readFile(new URL('../src/components/auth/AdminRoute.tsx', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
const chaptersPageSource = await readFile(new URL('../src/pages/chapters/ChaptersPage.tsx', import.meta.url), 'utf8')
const viteConfigSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
const dockerfileSource = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
const dockerComposeSource = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8')
const dockerignoreSource = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8')

assert.match(
  dbSource,
  /ALTER TABLE users ADD COLUMN deletedAt INTEGER/,
  'database migration should add deletedAt without rebuilding or dropping the users table',
)

assert.match(
  dbSource,
  /UPDATE users SET role = 'owner' WHERE username = 'admin' AND role = 'admin'/,
  'database migration should upgrade the existing admin account to owner without touching other fields',
)

assert.match(
  seedSource,
  /run\(id, 'admin', sha256\('admin'\), 'Admin', 'owner', Date\.now\(\)\)/,
  'fresh installs should seed the default admin account as owner',
)

assert.match(
  seedSource,
  /UPDATE users SET role = 'owner', deletedAt = NULL WHERE username = 'admin'/,
  'seeding should revive and upgrade an existing default admin without resetting password or displayName',
)

assert.match(
  authRouteSource,
  /WHERE username = \? AND deletedAt IS NULL/,
  'login should reject soft-deleted users',
)

assert.match(
  authRouteSource,
  /router\.patch\('\/profile', requireAuth/,
  'auth routes should expose a self-service profile update endpoint',
)

assert.match(
  authRouteSource,
  /router\.post\('\/change-password', requireAuth/,
  'auth routes should expose a server-side password change endpoint',
)

assert.match(
  usersRouteSource,
  /function canManageUser|canManageUser\(currentUser, target\)/,
  'user mutation routes should enforce role-scoped management permissions',
)

assert.match(
  usersRouteSource,
  /UPDATE users SET deletedAt = \?/,
  'delete user route should soft-delete users instead of hard deleting rows',
)

assert.match(
  usersRouteSource,
  /function canViewUser/,
  'single-user lookup endpoints should enforce role-scoped visibility',
)

assert.match(
  worksRouteSource,
  /function canAccessWork/,
  'work detail and mutation routes should enforce owner/shared access rules',
)

assert.match(
  worksRouteSource,
  /for \(const key of \['shared', 'title', 'createdAt', 'updatedAt'\]\)/,
  'work patch route should not allow ownerId transfer through scalar updates',
)

assert.match(
  worksRouteSource,
  /currentUser\.role === 'owner' \|\| currentUser\.role === 'admin'/,
  'owners and admins should be able to list all users works',
)

assert.match(
  worksRouteSource,
  /access === 'none'/,
  'shared non-owned works should be readable instead of limited to title-only summaries',
)

assert.match(
  worksRouteSource,
  /ownerName|displayName/,
  'work list API should include creator names without requiring clients to call user-management endpoints',
)

assert.match(
  worksRouteSource,
  /user\.role === 'admin'/,
  'admins should be handled explicitly so they cannot inspect other users work content',
)

assert.doesNotMatch(
  usersRouteSource,
  /DELETE FROM users/,
  'user routes should not hard-delete user records',
)

assert.match(
  authStoreSource,
  /\/api\/auth\/change-password/,
  'frontend password changes should call the server endpoint',
)

assert.match(
  authStoreSource,
  /\/api\/auth\/profile/,
  'frontend profile updates should call the server endpoint',
)

assert.match(
  loginPageSource,
  /useEffect\(\(\) => \{\s*loadConfig\(\)/s,
  'login page should load public system config before login so enabled registration is visible immediately',
)

assert.match(
  worksPageSource,
  /user\.role === 'owner' \|\| user\.role === 'admin'/,
  'works page should treat owners and admins as privileged viewers',
)

assert.match(
  worksPageSource,
  /dataIndex: 'ownerName'/,
  'works list should render creator information returned by the works API',
)

assert.doesNotMatch(
  worksPageSource,
  /db\.users\.toArray\(\)/,
  'normal user works list should not depend on the admin-only user management endpoint',
)

assert.match(
  worksPageSource,
  /\{ title: '创建人', dataIndex: 'ownerName', key: 'ownerName'/,
  'works list should show creator information for every user role',
)

assert.match(
  worksPageSource,
  /const canCopy = \(work: WorkItem\) => isOwner\(work\) \|\| canManageAllWorks/,
  'normal users should not be allowed to copy other users shared works',
)

assert.match(
  worksPageSource,
  /const canImportNovel = Boolean\(user && novelImportEnabled && canManageAllWorks\)/,
  'local novel import should require both the system switch and owner/admin role',
)

assert.match(
  worksPageSource,
  /\{canImportNovel && \([\s\S]*导入小说[\s\S]*\)\}/,
  'works page should hide the import entry when the current user cannot import',
)

assert.match(
  worksPageSource,
  /\{canCopy\(record\) && \([\s\S]*复制[\s\S]*\)\}/,
  'works page should hide the copy action when the current user cannot copy the work',
)

assert.match(
  worksPageSource,
  /title: '进度\/阶段'/,
  'works list should show progress or stage information',
)

assert.doesNotMatch(
  worksPageSource,
  /<Tag>仅标题<\/Tag>/,
  'works page should not block privileged or shared records with a title-only action',
)

assert.match(
  adminPageSource,
  /title=\{editingUser \? '编辑用户' : '添加用户'\}/,
  'user management should reuse the modal for both creating and editing users',
)

assert.match(
  adminPageSource,
  /留空则不修改密码/,
  'editing a user should allow password reset without requiring a password change',
)

assert.match(
  adminPageSource,
  /确认停用此用户/,
  'user deletion UI should present soft-delete language',
)

assert.match(
  topBarSource,
  /label: '个人资料'/,
  'avatar dropdown should expose profile editing',
)

assert.match(
  adminRouteSource,
  /\['owner', 'admin'\]\.includes\(user\.role\)/,
  'owners and admins should both be allowed into the admin route',
)

assert.match(
  sidebarSource,
  /\['owner', 'admin'\]\.includes\(user\.role\)/,
  'owners and admins should both see the system management navigation item',
)

assert.match(
  sidebarSource,
  /!readOnly[\s\S]*key: '\/voices'[\s\S]*label: '声音管理'/,
  'read-only work viewing should hide work-level voice management navigation',
)

assert.match(
  sidebarSource,
  /!readOnly[\s\S]*key: '\/character-voices'[\s\S]*label: '角色声音'/,
  'read-only work viewing should hide character voice navigation',
)

assert.match(
  viteConfigSource,
  /process\.env\.APP_VERSION[\s\S]*git describe --tags --exact-match HEAD[\s\S]*git rev-parse --short HEAD[\s\S]*return 'dev'[\s\S]*__APP_VERSION__/,
  'vite config should expose an automatic app version from build args, git tag, short hash, or dev fallback',
)

assert.match(
  dockerfileSource,
  /FROM node:24-alpine AS builder[\s\S]*RUN apk add --no-cache git[\s\S]*RUN npm run build/,
  'docker image builds should have git available so vite can resolve the current tag or hash automatically',
)

assert.match(
  dockerComposeSource,
  /build: \./,
  'docker compose should use the normal build context so docker builds resolve version the same way as local builds',
)

assert.doesNotMatch(
  dockerignoreSource,
  /^\.git$/m,
  'docker build context should include .git so version resolution is automatic without manual version files',
)

assert.match(
  sidebarSource,
  /const appVersion = __APP_VERSION__|__APP_VERSION__/,
  'sidebar should read the build-time app version constant',
)

assert.match(
  sidebarSource,
  /flexDirection: 'column'[\s\S]*<Menu[\s\S]*flex: 1[\s\S]*版本[\s\S]*appVersion/s,
  'sidebar should reserve bottom space for the current version label without replacing navigation',
)

assert.match(
  chaptersPageSource,
  /currentWork && !readOnly[\s\S]*<ChapterAudiobookPanel/,
  'read-only chapter viewing should hide chapter audiobook controls and content',
)

console.log('user-management behavior assertions passed')
