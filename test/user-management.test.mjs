import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const dbSource = await readFile(new URL('../server/src/db.ts', import.meta.url), 'utf8')
const seedSource = await readFile(new URL('../server/src/seed.ts', import.meta.url), 'utf8')
const authRouteSource = await readFile(new URL('../server/src/routes/auth.ts', import.meta.url), 'utf8')
const usersRouteSource = await readFile(new URL('../server/src/routes/users.ts', import.meta.url), 'utf8')
const authStoreSource = await readFile(new URL('../src/core/auth-store.ts', import.meta.url), 'utf8')
const adminPageSource = await readFile(new URL('../src/pages/admin/AdminPage.tsx', import.meta.url), 'utf8')
const topBarSource = await readFile(new URL('../src/components/layout/TopBar.tsx', import.meta.url), 'utf8')
const adminRouteSource = await readFile(new URL('../src/components/auth/AdminRoute.tsx', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')

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

console.log('user-management behavior assertions passed')
